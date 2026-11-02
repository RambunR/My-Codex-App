import {test,expect,type Page,type Request} from '@playwright/test';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const draft={title:'Upload validation fixture',description:'A complete original series used to verify browser-independent episode validation.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
const episodeRoute=/\/api\/studio\/series\/[^/]+\/episodes$/;
async function editor(page:Page){
  const login=await page.request.post('/api/auth/login',{data:{email:'admin@demo.aidramio.test',password:'DemoPass123!'}});expect(login.ok()).toBe(true);const user=(await login.json()).user;
  const created=await page.request.post('/api/studio/series',{data:{...draft,title:`Upload validation ${Date.now()}`}});expect(created.status()).toBe(201);const{id}=await created.json();
  await page.goto(`/studio/series/${id}`);await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();return{id,user};
}
function episodeWrites(page:Page){const writes:Request[]=[];page.on('request',request=>{if(request.method()==='POST'&&episodeRoute.test(new URL(request.url()).pathname))writes.push(request);});return writes;}
async function chooseFolder(page:Page,folder:string){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose a folder',exact:true}).click();await(await chooser).setFiles(folder);}
async function tinyVideo(file:string){execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=24','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-f','mp4','-y',file]);}

test('a 34-episode folder reaches server validation even when the browser cannot read video metadata after two files',async({page})=>{
  test.setTimeout(180000);
  // Model a device whose local video decoder stops reporting metadata after
  // two files. The uploaded bytes remain valid; the server independently
  // checks and processes every episode rather than trusting this decoder.
  await page.addInitScript(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src')!;let reads=0;
    Object.defineProperty(HTMLMediaElement.prototype,'src',{...descriptor,set(value:string){
      if(this instanceof HTMLVideoElement&&String(value).startsWith('blob:')&&++reads>2){const video=this;queueMicrotask(()=>video.dispatchEvent(new Event('error')));return;}
      descriptor.set!.call(this,value);
    }});
  });
  const{id,user}=await editor(page),writes=episodeWrites(page),directory=await mkdtemp(path.join(tmpdir(),'lingying-34-episode-batch-'));
  const folder=path.join(directory,'ClipWeave Exports','001_clips');
  try{
    await mkdir(folder,{recursive:true});const source=path.join(directory,'fixture.mp4');await tinyVideo(source);
    for(let episode=1;episode<=34;episode++)await copyFile(source,path.join(folder,`001_He Said I Wasn’t Smart Enough for Cambri_${String(episode).padStart(3,'0')}.mp4`));
    await chooseFolder(page,folder);await expect(page.locator('.queue-row')).toHaveCount(34);
    await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled({timeout:150000});
    expect(writes).toHaveLength(34);for(const row of await page.locator('.queue-row').all())await expect(row).toContainText('Uploaded');
    await expect(page.locator('.queue-row')).not.toContainText(['Unable to read video.']);
    const result=await(await page.request.get(`/api/studio/series/${id}`)).json();
    expect(result.episodes.map((episode:any)=>episode.number)).toEqual(Array.from({length:34},(_,i)=>i+1));
    for(const episode of result.episodes)expect(episode.duration).toBe(1);
    const after=(await(await page.request.get('/api/auth/me')).json()).user;
    expect(after.used_bytes-user.used_bytes).toBe(result.episodes.reduce((sum:number,episode:any)=>sum+episode.bytes,0));
    for(const key of ['wallet_micros','earnings_micros','publisher_active','dramio_pass'])expect(after[key]).toEqual(user[key]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('invalid and overlong episodes show server errors while the next valid file uploads without quota or numbering gaps',async({page})=>{
  test.setTimeout(90000);
  const{id,user}=await editor(page),writes=episodeWrites(page),responses:Array<Promise<{status:number;code?:string}>>=[];
  page.on('response',response=>{if(response.request().method()==='POST'&&episodeRoute.test(new URL(response.url()).pathname))responses.push(response.json().then(body=>({status:response.status(),code:body.error?.code})));});
  const folder=await mkdtemp(path.join(tmpdir(),'lingying-rejected-upload-batch-'));
  try{
    await writeFile(path.join(folder,'01_broken.mp4'),'This is a malformed file, not an MP4 container.');
    await copyFile(path.resolve('tests/fixtures/cloudflare-media/long-video.mp4'),path.join(folder,'02_overlong.mp4'));
    await tinyVideo(path.join(folder,'03_valid.mp4'));
    await chooseFolder(page,folder);await expect(page.locator('.queue-row')).toHaveCount(3);
    await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled({timeout:60000});
    expect(writes).toHaveLength(3);
    await expect(page.locator('.queue-row').nth(0)).toContainText('Please choose a valid MP4, MOV, or WebM video.');
    await expect(page.locator('.queue-row').nth(1)).toContainText('Episodes must be 3 minutes or less.');
    await expect(page.locator('.queue-row').nth(2)).toContainText('Uploaded');
    expect(await Promise.all(responses)).toEqual([{status:422,code:'INVALID_VIDEO'},{status:422,code:'VIDEO_TOO_LONG'},{status:201,code:undefined}]);
    const result=await(await page.request.get(`/api/studio/series/${id}`)).json();expect(result.episodes).toHaveLength(1);expect(result.episodes[0].number).toBe(1);expect(result.episodes[0].title).toBe('03 valid');
    const after=(await(await page.request.get('/api/auth/me')).json()).user;expect(after.used_bytes-user.used_bytes).toBe(result.episodes[0].bytes);
  }finally{await rm(folder,{recursive:true,force:true});}
});
