import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const MiB=1024*1024,chunkBytes=5*MiB;
const firstId='upload-warning-first',otherId='upload-warning-other';
const editorPath=(id=firstId)=>`/studio/series/${id}`;
const title='Leave while uploads are in progress?';
const user={id:'upload-warning-owner',name:'Warning Creator',email:'warning@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const series=(id:string)=>({id,creator_id:user.id,creator_name:user.name,title:id===firstId?'The Promise We Left Behind':'Another original drama',description:'An original local drama for verifying interruption of an active episode upload batch.',language:'en',genres:['drama'],themes:[],format:'live-action',creation_type:'human',cover:'/images/placeholder.svg',price_cents:10,free_episodes:1,last_episode_free:false,episode_count:0,views:0,saves:0,likes:0,liked:false,status:'draft',featured:0,created_at:'2026-11-03 00:00:00'});
const deferred=()=>{let release!:()=>void;return{promise:new Promise<void>(resolve=>{release=resolve;}),resolve:()=>release()};};
async function fulfill(route:Route,json:unknown,status=200){await route.fulfill({status,json}).catch(()=>{});}
interface Uploaded {id:string;series_id:string;title:string;number:number;duration:number;bytes:number}
async function fixture(page:Page,{mode='chunked',hold='part',episode=1,holdCleanup=false}:{mode?:'chunked'|'multipart';hold?:'part'|'complete'|'multipart';episode?:number;holdCleanup?:boolean}={}){
  const entered=deferred(),release=deferred(),cleanupEntered=deferred(),releaseCleanup=deferred();
  const rows:Uploaded[]=[],sessions=new Map<string,{number:number;title:string;size:number}>();
  const calls={starts:[] as number[],parts:[] as string[],completes:[] as number[],cancels:[] as number[],multipart:[] as number[],aborts:[] as string[]};
  page.on('requestfailed',request=>{if(/\/episode-uploads|\/episodes$/.test(new URL(request.url()).pathname))calls.aborts.push(request.url());});
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    if(path==='/api/auth/me'){await fulfill(route,{user});return;}
    if(path==='/api/config'){await fulfill(route,{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,runtime:mode==='chunked'?'cloudflare':'node',videoFormats:['mp4','mov'],episodeUpload:{mode,chunkBytes},limits:{maxEpisodeBytes:200*MiB,maxEpisodeSeconds:300,quotaBytes:5*1024**3,activationHkd:88}});return;}
    if(path==='/api/studio'){await fulfill(route,{user,series:[series(firstId),series(otherId)],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]});return;}
    if(path==='/api/series'){await fulfill(route,{series:[]});return;}
    if(path===editorPath(firstId).replace('/studio','/api/studio')||path===editorPath(otherId).replace('/studio','/api/studio')){
      const id=path.split('/').at(-1)!;await fulfill(route,{series:{...series(id),episode_count:rows.filter(e=>e.series_id===id).length},episodes:rows.filter(e=>e.series_id===id),episodes_revision:'a'.repeat(64),owner_storage:{used_bytes:rows.reduce((n,e)=>n+e.bytes,0),quota_bytes:user.quota_bytes}});return;
    }
    const base=`/api/studio/series/${firstId}`;
    if(path===base+'/episode-uploads'&&method==='POST'){
      const input=req.postDataJSON(),id=`held-${input.number}`;calls.starts.push(input.number);sessions.set(id,input);await fulfill(route,{id,chunkBytes,partCount:Math.ceil(input.size/chunkBytes),expiresAt:new Date(Date.now()+3600000).toISOString()},201);return;
    }
    const chunk=new RegExp(`^${base}/episode-uploads/([^/]+)(?:/parts/(\\d+)|/(complete))?$`).exec(path);
    if(chunk){
      const input=sessions.get(chunk[1])!;
      if(method==='DELETE'){calls.cancels.push(input.number);cleanupEntered.resolve();if(holdCleanup)await releaseCleanup.promise;await fulfill(route,{ok:true,cancelled:true});return;}
      if(method==='PUT'){calls.parts.push(`${input.number}:${chunk[2]}`);if(hold==='part'&&input.number===episode&&chunk[2]==='1'){entered.resolve();await release.promise;}await fulfill(route,{partNumber:Number(chunk[2])});return;}
      if(method==='POST'&&chunk[3]){calls.completes.push(input.number);if(hold==='complete'&&input.number===episode){entered.resolve();await release.promise;}const saved={id:`committed-${input.number}`,series_id:firstId,title:input.title,number:input.number,duration:12,bytes:input.size};rows.push(saved);await fulfill(route,{...saved,user,owner_storage:{used_bytes:rows.reduce((n,e)=>n+e.bytes,0),quota_bytes:user.quota_bytes}},201);return;}
    }
    if(path===base+'/episodes'&&method==='POST'){
      const body=req.postDataBuffer()!.toString('latin1'),number=Number(/name="number"\r\n\r\n(\d+)/.exec(body)?.[1]);calls.multipart.push(number);
      if(hold==='multipart'&&number===episode){entered.resolve();await release.promise;}
      const saved={id:`committed-${number}`,series_id:firstId,title:'Episode '+number,number,duration:12,bytes:1024};rows.push(saved);await fulfill(route,{...saved,user},201);return;
    }
    await fulfill(route,{ok:true});
  });
  return{calls,rows,entered:entered.promise,cleanupEntered:cleanupEntered.promise,release:release.resolve,releaseCleanup:releaseCleanup.resolve};
}
function files(count=3,size=1024){return Array.from({length:count},(_,i)=>({name:`Chapter ${String(i+1).padStart(3,'0')}—The Promise.mp4`,mimeType:'video/mp4',buffer:Buffer.alloc(size,i+1)}));}
async function choose(page:Page,count=3,size=1024){const chooser=page.waitForEvent('filechooser');await page.locator('.upload-drop button.button.ghost').click();await(await chooser).setFiles(files(count,size));}
async function open(page:Page,id=firstId){await page.goto(editorPath(id));await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();}
const dialog=(page:Page)=>page.getByRole('dialog',{name:title,exact:true});
async function requestLeave(page:Page){await page.locator('.editor-page .back-link').click();await expect(dialog(page)).toBeVisible();await expect(page).toHaveURL(editorPath());}
async function keep(page:Page){await page.locator('.upload-leave-keep').click();await expect(page.locator('.upload-leave-warning')).toHaveCount(0);}

// Each dismissal keeps the very same active request alive. Completing that
// request then proves later parts and queued files can still progress.
test('keep, Escape, close and backdrop preserve the active chunk and the remaining upload batch',async({page})=>{
  const state=await fixture(page);await open(page);await choose(page,3,6*MiB);await state.entered;
  try{
    for(const dismiss of ['keep','escape','close','backdrop']){
      await requestLeave(page);await expect(page.locator('.upload-leave-keep')).toBeFocused();
      if(dismiss==='keep'){await mkdir('/workspace/exports',{recursive:true});await dialog(page).screenshot({path:'/workspace/exports/lingying-upload-leave-warning.png'});await keep(page);}
      if(dismiss==='escape')await page.keyboard.press('Escape');
      if(dismiss==='close')await dialog(page).locator('.modal-heading button').click();
      if(dismiss==='backdrop')await page.locator('.modal-backdrop').click({position:{x:4,y:4}});
      await expect(dialog(page)).toHaveCount(0);expect(state.calls.cancels).toEqual([]);expect(state.calls.aborts).toEqual([]);expect(state.calls.parts).toEqual(['1:1']);await expect(page.locator('.queue-row')).toHaveCount(3);
    }
    state.release();await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();await expect(page.locator('.queue-row')).toContainText(['Uploaded','Uploaded','Uploaded']);expect(state.calls.parts).toEqual(['1:1','1:2','2:1','2:2','3:1','3:2']);expect(state.rows).toHaveLength(3);
    const nativeWarnings:string[]=[];page.on('dialog',async warning=>{nativeWarnings.push(warning.type());await warning.dismiss();});await page.reload();expect(nativeWarnings).toEqual([]);await page.locator('.editor-page .back-link').click();await expect(page).toHaveURL('/studio');await expect(dialog(page)).toHaveCount(0);
  }finally{state.release();state.releaseCleanup();}
});

test('confirmed SPA leave waits for chunk cleanup, stops later files, and preserves already committed episodes',async({page})=>{
  const state=await fixture(page,{episode:2,holdCleanup:true});await open(page);await choose(page,3,6*MiB);await state.entered;
  try{
    expect(state.rows.map(e=>e.number)).toEqual([1]);await page.locator('.sidebar a[href="/browse"]').click();await expect(dialog(page)).toBeVisible();await page.locator('.upload-leave-stop').click();await state.cleanupEntered;
    await expect(page).toHaveURL(editorPath());expect(state.calls.cancels).toEqual([2]);state.releaseCleanup();await expect(page).toHaveURL('/browse');state.release();
    await expect.poll(()=>state.calls.aborts.length).toBeGreaterThan(0);expect(state.calls.starts).toEqual([1,2]);expect(state.calls.parts).toEqual(['1:1','1:2','2:1']);expect(state.calls.completes).toEqual([1]);expect(state.rows.map(e=>e.number)).toEqual([1]);await expect(dialog(page)).toHaveCount(0);
  }finally{state.release();state.releaseCleanup();}
});

test('multipart upload warnings keep the active transfer, and leaving aborts it without sending the next file',async({page})=>{
  const state=await fixture(page,{mode:'multipart',hold:'multipart',episode:2});await open(page);await choose(page);await state.entered;
  try{
    await requestLeave(page);await keep(page);expect(state.calls.multipart).toEqual([1,2]);expect(state.calls.aborts).toEqual([]);await requestLeave(page);await page.locator('.upload-leave-stop').click();await expect(page).toHaveURL('/studio');
    await expect.poll(()=>state.calls.aborts.length).toBeGreaterThan(0);expect(state.calls.multipart).toEqual([1,2]);expect(state.rows.map(e=>e.number)).toEqual([1]);expect(state.calls.cancels).toEqual([]);
  }finally{state.release();}
});

test('native refresh uses a real beforeunload dialog: dismiss keeps the active batch and accept abandons it',async({page})=>{
  const state=await fixture(page);await open(page);await choose(page,2,6*MiB);await state.entered;
  try{
    // File chooser interaction above establishes Chromium sticky activation.
    let pending=page.waitForEvent('dialog');await page.evaluate(()=>{setTimeout(()=>location.reload(),0);});let warning=await pending;expect(warning.type()).toBe('beforeunload');await warning.dismiss();await expect(page).toHaveURL(editorPath());expect(state.calls.parts).toEqual(['1:1']);expect(state.calls.aborts).toEqual([]);await expect(page.locator('.queue-row')).toHaveCount(2);
    pending=page.waitForEvent('dialog');const navigated=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());await page.evaluate(()=>{setTimeout(()=>location.reload(),0);});warning=await pending;expect(warning.type()).toBe('beforeunload');await warning.accept();await navigated;await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();state.release();expect(state.calls.starts).toEqual([1]);expect(state.calls.parts).toEqual(['1:1']);expect(state.calls.completes).toEqual([]);await expect(page.locator('.queue-row')).toHaveCount(0);
  }finally{state.release();state.releaseCleanup();}
});

test('closing the tab presents the browser beforeunload choice without cancelling an upload on dismiss',async({page})=>{
  const state=await fixture(page);await open(page);await choose(page,2);await state.entered;
  try{
    let pending=page.waitForEvent('dialog');await page.close({runBeforeUnload:true});let warning=await pending;expect(warning.type()).toBe('beforeunload');await warning.dismiss();expect(page.isClosed()).toBe(false);await expect(page.locator('.queue-row')).toHaveCount(2);expect(state.calls.aborts).toEqual([]);expect(state.calls.cancels).toEqual([]);
    pending=page.waitForEvent('dialog');await page.close({runBeforeUnload:true});warning=await pending;expect(warning.type()).toBe('beforeunload');const closed=page.waitForEvent('close');await warning.accept();await closed;expect(state.calls.starts).toEqual([1]);expect(state.calls.completes).toEqual([]);
  }finally{state.release();state.releaseCleanup();}
});

for(const direction of ['back','forward'] as const)test(`browser ${direction} to another editor is blocked until the upload leave choice`,async({page})=>{
  const state=await fixture(page);
  // Build both ends through real router transitions so history's numeric index
  // and the requested POP target match normal browser Back/Forward controls.
  if(direction==='back'){
    await open(page,otherId);await page.locator('.editor-page .back-link').click();await expect(page).toHaveURL('/studio');await page.locator(`.studio-series-row a.button[href="${editorPath()}"]`).click();
  }else{
    await open(page);await page.locator('.editor-page .back-link').click();await expect(page).toHaveURL('/studio');await page.locator(`.studio-series-row a.button[href="${editorPath(otherId)}"]`).click();await expect(page).toHaveURL(editorPath(otherId));await page.goBack();await page.goBack();
  }
  await expect(page).toHaveURL(editorPath());await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();await choose(page);await state.entered;
  try{
    const delta=direction==='back'?-2:2;await page.evaluate(value=>history.go(value),delta);await expect(dialog(page)).toBeVisible();await keep(page);await expect(page).toHaveURL(editorPath());expect(state.calls.cancels).toEqual([]);
    await page.evaluate(value=>history.go(value),delta);await expect(dialog(page)).toBeVisible();await page.locator('.upload-leave-stop').click();await expect(page).toHaveURL(editorPath(otherId));expect(state.calls.cancels).toEqual([1]);expect(state.calls.starts).toEqual([1]);expect(state.calls.completes).toEqual([]);await expect(page.locator('.queue-row')).toHaveCount(0);
  }finally{state.release();state.releaseCleanup();}
});

for(const leave of [false,true])test(`folder collection is guarded before the first request; ${leave?'confirmed leave cancels the selection':'keeping allows the selected queue to start'}`,async({page})=>{
  const state=await fixture(page);await open(page);
  await page.evaluate(()=>{
    let read=false;const entry={name:'Season',fullPath:'/Season',isDirectory:true,isFile:false,createReader:()=>({readEntries:(done:(entries:unknown[])=>void)=>{if(read){done([]);return;}read=true;(window as any).__releaseWarningFolder=()=>done([{name:'Finale.mp4',fullPath:'/Season/Finale.mp4',isDirectory:false,isFile:true,file:(success:(f:File)=>void)=>success(new File([new Uint8Array(1024)],'Finale.mp4',{type:'video/mp4'}))}]);}})};
    const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{items:[{kind:'file',webkitGetAsEntry:()=>entry}],files:[]}});document.querySelector('.upload-drop')!.dispatchEvent(event);
  });
  try{
    await expect(page.locator('.folder-reading')).toBeVisible();expect(state.calls.starts).toEqual([]);await requestLeave(page);if(leave){await page.locator('.upload-leave-stop').click();await expect(page).toHaveURL('/studio');await page.evaluate(()=>(window as any).__releaseWarningFolder());expect(state.calls.starts).toEqual([]);await expect(page.locator('.queue-row')).toHaveCount(0);return;}await keep(page);await expect(page.locator('.folder-reading')).toBeVisible();await page.evaluate(()=>(window as any).__releaseWarningFolder());await state.entered;expect(state.calls.starts).toEqual([1]);await page.getByRole('button',{name:'Stop upload',exact:true}).click();await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();await page.locator('.editor-page .back-link').click();await expect(page).toHaveURL('/studio');await expect(dialog(page)).toHaveCount(0);expect(state.calls.cancels).toEqual([1]);
  }finally{state.release();state.releaseCleanup();}
});

test('100% transferred processing stays guarded, and an open warning resolves safely when the batch completes',async({page})=>{
  const state=await fixture(page,{hold:'complete'});await open(page);await choose(page,1);await state.entered;
  try{
    await expect(page.locator('.queue-icon.processing')).toBeVisible();await requestLeave(page);state.release();await expect(page.locator('.upload-leave-warning')).toHaveCount(0);await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();await expect(page).toHaveURL(editorPath());await expect(page.locator('.queue-row')).toContainText('Uploaded');expect(state.rows).toHaveLength(1);
    await page.locator('.editor-page .back-link').click();await expect(page).toHaveURL('/studio');
  }finally{state.release();state.releaseCleanup();}
});

test('a background lazy CSS failure preserves the active upload and leave guard until an explicit safe refresh',async({page})=>{
  const state=await fixture(page),documents:string[]=[];page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documents.push(new URL(request.url()).pathname);});
  await open(page);await choose(page,2,6*MiB);await state.entered;
  try{
    const titleInput=await page.locator('#series-title').elementHandle();
    const prevented=await page.evaluate(()=>{const event=new Event('vite:preloadError',{cancelable:true});Object.defineProperty(event,'payload',{value:new Error('Unable to preload CSS for /assets/Studio-old-release.css')});window.dispatchEvent(event);return event.defaultPrevented;});
    expect(prevented).toBe(true);const notice=page.locator('.page-recovery-notice');await expect(notice).toBeVisible();await expect(notice).toContainText('Your upload is still running. Keep this page open.');await expect(notice.getByRole('button',{name:'Refresh page',exact:true})).toBeDisabled();
    expect(await titleInput!.evaluate(element=>element===document.querySelector('#series-title'))).toBe(true);await expect(page.locator('.queue-row')).toHaveCount(2);expect(documents).toEqual([editorPath()]);expect(state.calls.parts).toEqual(['1:1']);expect(state.calls.aborts).toEqual([]);expect(state.calls.cancels).toEqual([]);
    await requestLeave(page);await keep(page);expect(state.calls.parts).toEqual(['1:1']);expect(state.calls.cancels).toEqual([]);expect(state.calls.aborts).toEqual([]);
    state.release();await expect(page.locator('.queue-row')).toContainText(['Uploaded','Uploaded']);await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();await expect(notice.getByRole('button',{name:'Refresh page',exact:true})).toBeEnabled();
    expect(state.rows).toHaveLength(2);expect(documents).toEqual([editorPath()]);expect(await page.evaluate(()=>sessionStorage.getItem('lingying-page-recovery-v1'))).toBeNull();
    await notice.getByRole('button',{name:'Refresh page',exact:true}).click();await expect(page.locator('.upload-drop button.button.ghost')).toBeEnabled();expect(documents).toEqual([editorPath(),editorPath()]);await expect(page.locator('.queue-row')).toHaveCount(0);expect(state.rows).toHaveLength(2);expect(state.calls.cancels).toEqual([]);
  }finally{state.release();state.releaseCleanup();}
});

for(const locale of ['en','zh-TW','ar'])test(`upload warning fits a 320px ${locale} phone with safe focus and touch actions`,async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3001',hasTouch:true,isMobile:true,viewport:{width:320,height:740}}),page=await context.newPage();await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);const state=await fixture(page);
  try{
    await open(page);await page.locator('.upload-drop input[type=file]:not([webkitdirectory])').setInputFiles(files(2));await state.entered;await page.locator('.editor-page .back-link').tap();const modal=page.getByRole('dialog');await expect(modal).toBeVisible();await expect(page.locator('.upload-leave-keep')).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);const box=await modal.boundingBox();expect(box!.width).toBeLessThanOrEqual(320);expect(box!.x).toBeGreaterThanOrEqual(0);
    for(const selector of ['.upload-leave-keep','.upload-leave-stop']){const bounds=await page.locator(selector).boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(44);}
    for(let index=0;index<5;index++){await page.keyboard.press('Tab');expect(await modal.evaluate(element=>element.contains(document.activeElement))).toBe(true);}await page.locator('.upload-leave-keep').tap();await expect(modal).toHaveCount(0);expect(state.calls.cancels).toEqual([]);expect(state.calls.starts).toEqual([1]);expect(await page.locator('html').getAttribute('dir')).toBe(locale==='ar'?'rtl':'ltr');
  }finally{state.release();state.releaseCleanup();await context.close();}
});
