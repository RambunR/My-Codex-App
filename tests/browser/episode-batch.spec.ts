import {test,expect,type Page,type Browser,type APIRequestContext} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const baseURL='http://127.0.0.1:3001',password='DemoPass123!';
type Session=Awaited<ReturnType<APIRequestContext['storageState']>>;
let ownerState:Session,buyerState:Session,directory:string,video:Buffer,cover:Buffer;
async function json(response:{status:()=>number;json:()=>Promise<unknown>},status=200):Promise<any>{const data=await response.json();expect(response.status(),JSON.stringify(data)).toBe(status);return data;}
test.beforeAll(async({playwright})=>{
  directory=await mkdtemp(path.join(tmpdir(),'lingying-bulk-episodes-'));const file=path.join(directory,'episode.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x96:r=12','-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',file]);
  video=await readFile(file);cover=await readFile('public/images/midnight.jpg');
  for(const[role,email]of [['owner','creator@demo.aidramio.test'],['buyer','viewer@demo.aidramio.test']] as const){const request=await playwright.request.newContext({baseURL});try{await json(await request.post('/api/auth/login',{data:{email,password}}));const state=await request.storageState();if(role==='owner')ownerState=state;else buyerState=state;}finally{await request.dispose();}}
});
test.afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});

async function fixture(page:Page){
  await page.context().addCookies(ownerState.cookies);
  const details={title:`Episode bulk ${Date.now()}-${Math.random().toString(36).slice(2,7)}`,description:'An original local drama for safe episode selection, naming and ordering checks.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
  const{id}=await json(await page.request.post('/api/studio/series',{data:details}),201);
  await json(await page.request.post(`/api/studio/series/${id}/cover`,{multipart:{cover:{name:'cover.jpg',mimeType:'image/jpeg',buffer:cover}}}));
  const episodes=[];for(const number of [1,2,3])episodes.push(await json(await page.request.post(`/api/studio/series/${id}/episodes`,{multipart:{title:`Original story ${String(number).padStart(3,'0')}`,number:String(number),video:{name:`episode-${number}.mp4`,mimeType:'video/mp4',buffer:video}}}),201));
  await json(await page.request.post(`/api/studio/series/${id}/status`,{data:{status:'published'}}));
  const before=(await json(await page.request.get('/api/auth/me'))).user;
  await page.goto(`/studio/series/${id}`);await expect(page.locator('.episode-select-all input')).toBeEnabled();
  return{id,details,episodes,before};
}
const rows=(page:Page)=>page.locator('.episode-manager .episode-editor-row');
const titles=(page:Page)=>page.locator('.episode-manager .episode-editor-copy strong');
const selected=(page:Page,number:number)=>page.getByRole('checkbox',{name:`Select episode ${number}`,exact:true});
async function select(page:Page,numbers:number[]){for(const number of numbers)await selected(page,number).check();}
async function mutation(page:Page,action:string,perform:()=>Promise<unknown>){const response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/episodes/batch')&&response.request().postDataJSON()?.action===action);await perform();return json(await response);}
async function buyer(browser:Browser){return browser.newContext({baseURL,storageState:buyerState});}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

test('selected episode renaming preserves each persisted three-digit suffix and escapes untrusted text',async({page})=>{
  const drama=await fixture(page);await select(page,[1,3]);await page.getByRole('button',{name:'Rename selected',exact:true}).click();
  const name='<img src=x onerror=window.bulkInjected=1>';
  await page.getByRole('textbox',{name:'New episode name',exact:true}).fill(name);
  await expect(page.locator('.episode-batch-preview strong')).toHaveText([`${name} 001`,`${name} 003`]);
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeDisabled();await expect(page.locator('.editor-heading-actions').getByRole('button',{name:'Save details',exact:true})).toBeDisabled();
  await mutation(page,'rename',()=>page.getByRole('button',{name:'Rename 2 episodes',exact:true}).click());
  await expect(titles(page)).toHaveText([`${name} 001`,'Original story 002',`${name} 003`]);
  const stored=await json(await page.request.get(`/api/studio/series/${drama.id}`));expect(stored.episodes.map((episode:any)=>episode.number)).toEqual([1,2,3]);
  expect(stored.episodes.map((episode:any)=>episode.id)).toEqual(drama.episodes.map((episode:any)=>episode.id));
  await expect(page.locator('.episode-editor-copy img')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).bulkInjected)).toBeUndefined();
  await expect(page.locator('.episode-selected-count')).toHaveText('0 selected');
});

test('dragging and arrow reordering require an explicit save and preserve titles, purchases and finances',async({page,browser})=>{
  const drama=await fixture(page),viewer=await buyer(browser);
  try{
    await json(await viewer.request.post(`/api/episodes/${drama.episodes[1].id}/unlock`,{data:{}}));await page.reload();await expect(page.locator('.episode-select-all input')).toBeEnabled();
    const wallet=(await json(await viewer.request.get('/api/wallet'))),owner=(await json(await page.request.get('/api/auth/me'))).user;
    await page.getByRole('button',{name:'Move episode 3 up',exact:true}).click();
    await expect(titles(page)).toHaveText(['Original story 001','Original story 003','Original story 002']);
    expect((await json(await page.request.get(`/api/studio/series/${drama.id}`))).episodes.map((episode:any)=>episode.id)).toEqual(drama.episodes.map((episode:any)=>episode.id));
    await page.getByRole('button',{name:'Cancel reordering',exact:true}).click();
    await expect(titles(page)).toHaveText(['Original story 001','Original story 002','Original story 003']);
    await page.getByRole('button',{name:'Drag episode 3',exact:true}).dragTo(rows(page).nth(0));
    await expect(titles(page)).toHaveText(['Original story 003','Original story 001','Original story 002']);
    await page.getByRole('button',{name:'Save episode order',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'Save the new episode order?',exact:true});await expect(modal).toContainText('2 episodes will change between free and paid.');
    await expect(modal.getByRole('button',{name:'Save episode order',exact:true})).toBeDisabled();
    await modal.getByRole('checkbox',{name:'I understand this changes the episode order and free access.',exact:true}).check();
    await mutation(page,'reorder',()=>modal.getByRole('button',{name:'Save episode order',exact:true}).click());
    const stored=await json(await page.request.get(`/api/studio/series/${drama.id}`));expect(stored.episodes.map((episode:any)=>episode.id)).toEqual([drama.episodes[2].id,drama.episodes[0].id,drama.episodes[1].id]);expect(stored.episodes.map((episode:any)=>episode.number)).toEqual([1,2,3]);expect(stored.episodes.map((episode:any)=>episode.title)).toEqual(['Original story 003','Original story 001','Original story 002']);
    const detail=await json(await viewer.request.get(`/api/series/${drama.id}`));expect(detail.episodes.find((episode:any)=>episode.id===drama.episodes[1].id).unlocked).toBe(true);
    expect(await json(await viewer.request.get('/api/wallet'))).toEqual(wallet);const after=(await json(await page.request.get('/api/auth/me'))).user;for(const key of ['wallet_micros','earnings_micros','used_bytes'])expect(after[key]).toBe(owner[key]);
  }finally{await viewer.close();}
});

test('batch deletion shows actual statistics, supports cancel, and requires the series title and irreversible acknowledgement',async({page,browser})=>{
  const drama=await fixture(page),guest=await browser.newContext({baseURL});
  try{
    const playback=await json(await guest.request.post(`/api/episodes/${drama.episodes[0].id}/playback`,{data:{}}));await page.waitForTimeout(2200);expect((await json(await guest.request.put(`/api/playback/${playback.sessionId}`,{data:{watchedMs:2000}}))).viewCounted).toBe(true);
    await select(page,[1,3]);await page.getByRole('button',{name:'Delete selected',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'Delete selected episodes?',exact:true});
    await expect(modal.locator('[data-metric="episode_count"] dd')).toHaveText('2');await expect(modal.locator('[data-metric="views"] dd')).toHaveText('1');await expect(modal.locator('[data-metric="total_watch_seconds"] dd')).toHaveText('0:02');await expect(modal).toContainText('Deleted episodes cannot be recovered.');
    await modal.getByRole('button',{name:'Cancel',exact:true}).click();expect((await json(await page.request.get(`/api/studio/series/${drama.id}`))).episodes).toHaveLength(3);
    await page.getByRole('button',{name:'Delete selected',exact:true}).click();const remove=modal.getByRole('button',{name:'Permanently delete 2 episodes',exact:true});await expect(remove).toBeDisabled();
    await modal.getByRole('textbox',{name:'Type the series title to confirm',exact:true}).fill(drama.details.title);await expect(remove).toBeDisabled();await modal.getByRole('checkbox',{name:'I understand these episodes and their statistics cannot be recovered.',exact:true}).check();
    const result=await mutation(page,'delete',()=>remove.click());expect(result.cleanup_pending).toBe(false);
    await expect(rows(page)).toHaveCount(1);expect((await json(await page.request.get(`/api/studio/series/${drama.id}`))).episodes.map((episode:any)=>episode.id)).toEqual([drama.episodes[1].id]);
    const after=(await json(await page.request.get('/api/auth/me'))).user;expect(drama.before.used_bytes-after.used_bytes).toBe(drama.episodes[0].bytes+drama.episodes[2].bytes);
    for(const episode of [drama.episodes[0],drama.episodes[2]])expect((await page.request.get(`/api/studio/episodes/${episode.id}/stream`)).status()).toBe(404);
  }finally{await guest.close();}
});

test('a selection containing purchased episodes is protected before any delete request',async({page,browser})=>{
  const drama=await fixture(page),viewer=await buyer(browser);let deletes=0;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/episodes/batch')&&request.postDataJSON()?.action==='delete')deletes++;});
  try{await json(await viewer.request.post(`/api/episodes/${drama.episodes[1].id}/unlock`,{data:{}}));await page.reload();await expect(page.locator('.episode-select-all input')).toBeEnabled();await select(page,[2,3]);await page.getByRole('button',{name:'Delete selected',exact:true}).click();const modal=page.getByRole('dialog',{name:'Delete selected episodes?',exact:true});await expect(modal.locator('[data-metric="paid_episode_count"] dd')).toHaveText('1');await expect(modal.locator('.episode-batch-paid-guard')).toBeVisible();await expect(modal.getByRole('button',{name:/Permanently delete/})).toHaveCount(0);expect(deletes).toBe(0);expect((await json(await page.request.get(`/api/studio/series/${drama.id}`))).episodes).toHaveLength(3);}finally{await viewer.close();}
});

test('a stale episode revision requires a fresh list before renaming',async({page})=>{
  const drama=await fixture(page);await select(page,[1]);await page.getByRole('button',{name:'Rename selected',exact:true}).click();
  await json(await page.request.patch(`/api/studio/episodes/${drama.episodes[0].id}`,{data:{title:'Changed in another window',number:1}}));
  await page.getByRole('textbox',{name:'New episode name',exact:true}).fill('Replacement');await page.getByRole('button',{name:'Rename 1 episodes',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Rename selected episodes',exact:true});await expect(modal).toContainText('The episode list changed. Refresh it before trying again.');await expect(modal.getByRole('button',{name:'Rename 1 episodes',exact:true})).toBeDisabled();
  await modal.getByRole('button',{name:'Refresh episode list',exact:true}).click();await expect(titles(page).first()).toHaveText('Changed in another window');
});

test('a pending-upload refusal is displayed without changing the selected episode',async({page})=>{
  const drama=await fixture(page);await page.route(`**/api/studio/series/${drama.id}/episodes/batch`,route=>route.fulfill({status:409,json:{error:{code:'EPISODE_UPLOAD_PENDING',message:'Finish or cancel pending uploads before editing episodes.'}}}));
  await select(page,[1]);await page.getByRole('button',{name:'Rename selected',exact:true}).click();await page.getByRole('textbox',{name:'New episode name',exact:true}).fill('Replacement');await page.getByRole('button',{name:'Rename 1 episodes',exact:true}).click();await expect(page.locator('.episode-batch-rename .form-error')).toHaveText('Finish or cancel pending uploads before editing episodes.');expect((await json(await page.request.get(`/api/studio/series/${drama.id}`))).episodes[0].title).toBe('Original story 001');
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`episode bulk controls and confirmations fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await fixture(page);
  await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await page.locator('.episode-select-all input').check();await page.locator('.episode-bulk-actions button').first().click();await page.locator('.episode-batch-rename input').fill('A very long episode title — 靈映 神秘故事');
  await expect(page.locator('.episode-batch-preview p')).toHaveCount(3);await expect(page.locator('.episode-batch-rename input')).toHaveCSS('font-size','16px');await noOverflow(page);
  if(locale!=='en')await expect(page.locator('.episode-batch-rename')).not.toContainText('Each title keeps');
  await page.locator('.modal-heading .icon-button').click();await rows(page).nth(2).locator('.episode-move-up').click();await page.locator('.episode-order-actions .button.secondary').click();await noOverflow(page);await page.locator('.modal-heading .icon-button').click();await page.locator('.episode-order-actions .button.ghost').click();await noOverflow(page);
});
