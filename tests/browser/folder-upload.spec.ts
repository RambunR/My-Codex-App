import {test,expect,type Page,type Request} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const videoSource=path.resolve('public/demo-preview.mp4');
const draft={title:'Folder upload fixture',description:'A complete original series used to verify selective folder uploads.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
async function editor(page:Page){
  const login=await page.request.post('/api/auth/login',{data:{email:'admin@demo.aidramio.test',password:'DemoPass123!'}});expect(login.ok()).toBe(true);const user=(await login.json()).user;expect(user.role).toBe('admin');
  const created=await page.request.post('/api/studio/series',{data:{...draft,title:`Folder upload ${Date.now()}`}});expect(created.status()).toBe(201);const{id}=await created.json();
  await page.goto(`/studio/series/${id}`);await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();
  return{id,user};
}
function episodeWrites(page:Page){const writes:Request[]=[];page.on('request',request=>{if(request.method()==='POST'&&/\/api\/studio\/series\/[^/]+\/episodes$/.test(new URL(request.url()).pathname))writes.push(request);});return writes;}
async function chooseFolder(page:Page,folder:string){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose a folder',exact:true}).click();await(await chooser).setFiles(folder);}
async function done(page:Page,count:number){await expect(page.locator('.queue-row')).toHaveCount(count);for(const row of await page.locator('.queue-row').all())await expect(row).toContainText('Uploaded',{timeout:30000});await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
async function tinyVideo(file:string,seconds:number){await mkdir(path.dirname(file),{recursive:true});execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=24','-t',String(seconds),'-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-f','mp4','-y',file]);}

test('a nested Unicode folder uploads only MP4 files in natural folder order and charges only the uploaded videos',async({page})=>{
  const{id,user}=await editor(page);const writes=episodeWrites(page);const dir=await mkdtemp(path.join(tmpdir(),'lingying-mp4-folder-'));const folder=path.join(dir,'ClipWeave Exports','ClipWeave_20261102_005410_fixture','002_clips','01_002_A Story With Spaces—復仇與秘密');
  let release!:()=>void;const firstUpload=new Promise<void>(resolve=>{release=resolve;});let first=true;
  await page.route(/\/api\/studio\/series\/[^/]+\/episodes$/,async route=>{if(route.request().method()==='POST'&&first){first=false;await firstUpload;}await route.continue();});
  try{
    await tinyVideo(path.join(folder,'1 Clips','clip.mp4'),1);await tinyVideo(path.join(folder,'2 Clips','clip.MP4'),2);await tinyVideo(path.join(folder,'10 Clips','clip.mp4'),3);
    await writeFile(path.join(folder,'manifest.json'),'{}');await writeFile(path.join(folder,'captions.srt'),'1\n00:00:00,000 --> 00:00:01,000\nA caption');await writeFile(path.join(folder,'notes.txt'),'Export notes');await writeFile(path.join(folder,'cover.jpg'),'This sidecar is not a video.');await writeFile(path.join(folder,'._hidden.mp4'),'An AppleDouble metadata file, not a video.');await copyFile(videoSource,path.join(folder,'extra.mov'));await mkdir(path.join(folder,'__MACOSX'));await writeFile(path.join(folder,'__MACOSX','resource.mp4'),'Metadata, not an episode.');
    await page.evaluate(()=>document.addEventListener('change',event=>{const target=event.target;if(target instanceof HTMLInputElement&&target.hasAttribute('webkitdirectory'))(window as any).__selectedFolderPaths=Array.from(target.files||[]).map(file=>file.webkitRelativePath);},true));
    await chooseFolder(page,folder);await expect(page.locator('.folder-selection-summary')).toContainText('3 MP4 videos found.');
    const selected=await page.evaluate(()=>((window as any).__selectedFolderPaths||[]) as string[]);expect(selected.length).toBeGreaterThanOrEqual(8);await expect(page.locator('.folder-selection-summary')).toContainText(`${selected.length-3} other files ignored.`);
    await expect.poll(()=>writes.length).toBe(1);await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeDisabled();await expect(page.locator('.editor-heading-actions').getByRole('button',{name:'Save details',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Publish series',exact:true})).toBeDisabled();
    const guideButton=page.locator('.upload-guide-trigger');await guideButton.click();const guide=page.getByRole('dialog',{name:'How to upload your series',exact:true});
    await expect(guide).toContainText('4 minutes');await expect(guide).toContainText('200 MiB');await expect(guide.locator('.upload-guide-diagram>li')).toHaveCount(4);
    await expect(guide).toContainText('My_Series_1.mp4');await expect(guide).toContainText('My_Series_2.mp4');await expect(guide).toContainText('My_Series_10.mp4');
    await expect(guide).toContainText('select all episodes and rename them together');expect(writes).toHaveLength(1);
    await page.keyboard.press('Escape');await expect(guide).toHaveCount(0);await expect(guideButton).toBeFocused();release();
    await done(page,3);expect(writes).toHaveLength(3);
    await expect(page.locator('.queue-row strong')).toHaveText(['1 Clips/clip.mp4','2 Clips/clip.MP4','10 Clips/clip.mp4']);
    for(const request of writes){const body=request.postDataBuffer()!.toString('latin1');expect(body.match(/name="video"; filename="([^"]+)"/)?.[1]).toMatch(/^clip\.mp4$/i);expect(body).not.toContain('ClipWeave Exports');}
    const result=await(await page.request.get(`/api/studio/series/${id}`)).json();expect(result.episodes.map((episode:any)=>episode.number)).toEqual([1,2,3]);expect(result.episodes.map((episode:any)=>Math.round(episode.duration))).toEqual([1,2,3]);
    const after=(await(await page.request.get('/api/auth/me')).json()).user;expect(after.used_bytes-user.used_bytes).toBe(result.episodes.reduce((sum:number,episode:any)=>sum+episode.bytes,0));for(const key of ['wallet_micros','earnings_micros','publisher_active','dramio_pass'])expect(after[key]).toEqual(user[key]);
  }finally{release();await rm(dir,{recursive:true,force:true});}
});

test('a folder containing only sidecars and other video formats sends no episode upload',async({page})=>{
  const{id,user}=await editor(page);const writes=episodeWrites(page);const dir=await mkdtemp(path.join(tmpdir(),'lingying-folder-without-mp4-'));
  try{for(const name of ['manifest.json','captions.srt','poster.png','notes.txt'])await writeFile(path.join(dir,name),'A non-video sidecar.');await copyFile(videoSource,path.join(dir,'other.mov'));
    await chooseFolder(page,dir);await expect(page.locator('.folder-selection-summary')).toContainText('0 MP4 videos found.');await expect(page.getByText('No MP4 videos found in this folder.',{exact:true}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();await expect(page.locator('.queue-row')).toHaveCount(0);expect(writes).toEqual([]);
    const result=await(await page.request.get(`/api/studio/series/${id}`)).json();expect(result.episodes).toEqual([]);expect((await(await page.request.get('/api/auth/me')).json()).user.used_bytes).toBe(user.used_bytes);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('manual file selection retains supported MOV uploads while folder selection remains MP4-only',async({page})=>{
  const{id}=await editor(page);const writes=episodeWrites(page);const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose video files',exact:true}).click();await(await chooser).setFiles({name:'A manually chosen episode.mov',mimeType:'video/mp4',buffer:await readFile(videoSource)});
  await done(page,1);expect(writes).toHaveLength(1);const result=await(await page.request.get(`/api/studio/series/${id}`)).json();expect(result.episodes).toHaveLength(1);expect(result.episodes[0].title).toBe('A manually chosen episode');
});

test('dropping a folder reads every directory batch, locks concurrent selection and uploads nested MP4 episodes',async({page})=>{
  const{id}=await editor(page);const writes=episodeWrites(page);const first=(await readFile(videoSource)).toString('base64');
  await page.evaluate(base64=>{
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
    const file=(name:string,fullPath:string)=>({name,fullPath,isFile:true,isDirectory:false,file:(success:(value:File)=>void)=>setTimeout(()=>success(new File([bytes],name,{type:/\.mp4$/i.test(name)?'video/mp4':'text/plain'})),10)});
    const directory=(name:string,fullPath:string,batches:any[][])=>({name,fullPath,isFile:false,isDirectory:true,createReader:()=>{let index=0;return{readEntries:(success:(entries:any[])=>void)=>setTimeout(()=>success(batches[index++]||[]),400)};}});
    const root='/A ClipWeave Export—中文';const ten=directory('10 Clips',root+'/10 Clips',[[file('clip.MP4',root+'/10 Clips/clip.MP4')]]);const two=directory('2 Clips',root+'/2 Clips',[[file('clip.mp4',root+'/2 Clips/clip.mp4')]]);
    const entry=directory('A ClipWeave Export—中文',root,[[ten,file('manifest.json',root+'/manifest.json')],[two,file('poster.jpg',root+'/poster.jpg')]]);
    const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{items:[{kind:'file',webkitGetAsEntry:()=>entry,getAsFile:()=>null}],files:[]}});document.querySelector('.upload-drop')!.dispatchEvent(event);
  },first);
  await expect(page.locator('.folder-reading')).toBeVisible();await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeDisabled();await expect(page.locator('.editor-heading-actions').getByRole('button',{name:'Save details',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Publish series',exact:true})).toBeDisabled();expect(writes).toEqual([]);
  await done(page,2);await expect(page.locator('.folder-selection-summary')).toHaveText('2 MP4 videos found. 2 other files ignored.');expect(writes).toHaveLength(2);const result=await(await page.request.get(`/api/studio/series/${id}`)).json();expect(result.episodes.map((episode:any)=>episode.number)).toEqual([1,2]);
});

test('an unreadable dropped folder reports a recoverable error without uploading a partial batch',async({page})=>{
  await editor(page);const writes=episodeWrites(page);await page.evaluate(base64=>{
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));const video={name:'episode.mp4',fullPath:'/Unreadable export/episode.mp4',isFile:true,isDirectory:false,file:(success:(file:File)=>void)=>success(new File([bytes],'episode.mp4',{type:'video/mp4'}))};
    const entry={name:'Unreadable export',fullPath:'/Unreadable export',isFile:false,isDirectory:true,createReader:()=>{let batch=0;return{readEntries:(success:(entries:any[])=>void,failure:(error:Error)=>void)=>setTimeout(()=>batch++===0?success([video]):failure(new Error('File access was revoked.')),50)};}};
    const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{items:[{kind:'file',webkitGetAsEntry:()=>entry,getAsFile:()=>null}],files:[]}});document.querySelector('.upload-drop')!.dispatchEvent(event);
  },(await readFile(videoSource)).toString('base64'));
  await expect(page.getByText('This folder could not be read. Use Choose a folder and try again.',{exact:true}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeEnabled();await expect(page.locator('.queue-row')).toHaveCount(0);expect(writes).toEqual([]);
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`MP4 folder instructions are translated and fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{id:'folder-layout-admin',name:'Folder uploader',email:'folder-layout@example.invalid',role:'admin',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:locale,payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}}}}));
  await page.goto('/studio/new');await expect(page.locator('html')).toHaveAttribute('lang',locale);const hint=page.locator('.folder-upload-hint');await expect(hint).toBeVisible();await expect(hint).toContainText('MP4');await expect(hint).not.toContainText('folderMp4Hint');if(locale!=='en')await expect(hint).not.toContainText('Folder uploads include');if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');await noOverflow(page);
  const trigger=page.locator('.upload-guide-trigger');await expect(trigger).toHaveAttribute('aria-haspopup','dialog');const target=await trigger.boundingBox();expect(target!.width).toBeGreaterThanOrEqual(44);expect(target!.height).toBeGreaterThanOrEqual(44);await trigger.focus();await page.keyboard.press('Enter');
  const guide=page.getByRole('dialog');await expect(guide).toBeVisible();await expect(guide.locator('.upload-guide-diagram>li')).toHaveCount(4);await expect(guide).toContainText('200 MiB');await expect(guide).not.toContainText('uploadGuide');await expect.poll(()=>guide.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);await noOverflow(page);
  await page.keyboard.press('Escape');await expect(guide).toHaveCount(0);await expect(trigger).toBeFocused();await expect(page.locator('.editor-enable-upload')).toBeVisible();
});
