import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const MiB=1024*1024,chunkBytes=5*MiB,maximum=200*MiB;
const draft={title:'Chunked upload fixture',description:'A private local fixture for testing bounded browser upload requests.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
const deferred=()=>{let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};};
async function safeFulfill(route:Route,json:unknown,status=200){await route.fulfill({status,json}).catch(()=>{});}
async function editor(page:Page){
  const config=await(await page.request.get('/api/config')).json();
  await page.route('**/api/config',route=>route.fulfill({json:{...config,runtime:'cloudflare',episodeUpload:{mode:'chunked',chunkBytes},limits:{...config.limits,maxEpisodeBytes:maximum,maxEpisodeSeconds:300}}}));
  const login=await page.request.post('/api/auth/login',{data:{email:'admin@demo.aidramio.test',password:'DemoPass123!'}});expect(login.ok()).toBe(true);const user=(await login.json()).user;
  const created=await page.request.post('/api/studio/series',{data:{...draft,title:`Chunked browser upload ${Date.now()} ${randomUUID()}`}});expect(created.status()).toBe(201);const{id}=await created.json();
  await page.goto(`/studio/series/${id}`);await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeEnabled();return{id,user};
}
async function sparseMp4(size:number){
  const directory=await mkdtemp(path.join(tmpdir(),'lingying-chunk-browser-')),file=path.join(directory,'Episode—中文_001.mp4');
  const source=await readFile(path.resolve('public/demo-preview.mp4')),free=Buffer.alloc(8);free.writeUInt32BE(size-source.length);free.write('free',4,'ascii');
  const output=await open(file,'w');try{await output.write(source);await output.write(free);await output.truncate(size);}finally{await output.close();}
  return{directory,file};
}
async function chooseFile(page:Page,file:string){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose video files',exact:true}).click();await(await chooser).setFiles(file);}

test('a 200 MiB episode uses forty bounded raw requests and one completion instead of one oversized HTTP body',async({page})=>{
  test.setTimeout(180000);
  const{id,user}=await editor(page),uploadId=randomUUID(),fixture=await sparseMp4(maximum),firstPart=deferred(),allowPart=deferred(),completeEntered=deferred(),allowComplete=deferred();
  const parts:Array<{number:number;bytes:number}>=[];let init:any,completions=0,legacy=0;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/api/studio/series/${id}/episodes`)legacy++;});
  await page.route(`**/api/studio/series/${id}/episode-uploads**`,async route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    if(request.method()==='POST'&&pathname.endsWith('/episode-uploads')){
      init=request.postDataJSON();await safeFulfill(route,{id:uploadId,chunkBytes,partCount:40,expiresAt:new Date(Date.now()+3600000).toISOString()},201);return;
    }
    const part=/\/parts\/(\d+)$/.exec(pathname);
    if(request.method()==='PUT'&&part){
      const number=Number(part[1]),bytes=request.postDataBuffer()!.length;parts.push({number,bytes});expect(request.headers()['content-type']).toBe('application/octet-stream');
      if(number===1){firstPart.resolve();await allowPart.promise;}
      await safeFulfill(route,{partNumber:number});return;
    }
    if(request.method()==='POST'&&pathname.endsWith('/complete')){completions++;completeEntered.resolve();await allowComplete.promise;await safeFulfill(route,{id:randomUUID(),duration:12,bytes:maximum,user,owner_storage:{used_bytes:maximum,quota_bytes:5*1024**3}},201);return;}
    await safeFulfill(route,{ok:true});
  });
  try{
    await chooseFile(page,fixture.file);await firstPart.promise;
    await expect(page.locator('.queue-row')).toContainText('Uploading');await expect(page.locator('.queue-row')).toContainText('%');expect(parts).toEqual([{number:1,bytes:chunkBytes}]);
    allowPart.resolve();await completeEntered.promise;expect(parts).toHaveLength(40);await expect(page.locator('.queue-row')).not.toContainText('Uploaded');
    allowComplete.resolve();await expect(page.locator('.queue-row')).toContainText('Uploaded',{timeout:30000});
    expect(init).toEqual({title:'Episode—中文 001',number:1,filename:'Episode—中文_001.mp4',size:maximum});
    expect(parts).toEqual(Array.from({length:40},(_,i)=>({number:i+1,bytes:chunkBytes})));expect(completions).toBe(1);expect(legacy).toBe(0);
    await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeEnabled();
  }finally{allowPart.resolve();allowComplete.resolve();await rm(fixture.directory,{recursive:true,force:true});}
});

test('a file one byte over 200 MiB is rejected before creating a chunked session',async({page})=>{
  const{id}=await editor(page),fixture=await sparseMp4(maximum+1);let writes=0;
  await page.route(`**/api/studio/series/${id}/episode-uploads**`,route=>{writes++;return route.fulfill({status:500,json:{error:{message:'This request must not be sent.'}}});});
  try{
    await chooseFile(page,fixture.file);await expect(page.locator('.queue-row')).toContainText('200 MiB');await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeEnabled();expect(writes).toBe(0);
  }finally{await rm(fixture.directory,{recursive:true,force:true});}
});

for(const navigation of [false,true])test(`${navigation?'leaving the editor':'stopping a batch'} cancels its active session and sends no later parts`,async({page})=>{
  const{id}=await editor(page),uploadId=randomUUID(),fixture=await sparseMp4(6*MiB),partEntered=deferred(),allowPart=deferred();let parts=0,completions=0,cancellations=0;const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(`**/api/studio/series/${id}/episode-uploads**`,async route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    if(request.method()==='POST'&&pathname.endsWith('/episode-uploads')){await safeFulfill(route,{id:uploadId,chunkBytes,partCount:2,expiresAt:new Date(Date.now()+3600000).toISOString()},201);return;}
    if(request.method()==='PUT'){parts++;partEntered.resolve();await allowPart.promise;await safeFulfill(route,{partNumber:1});return;}
    if(request.method()==='DELETE'){cancellations++;await safeFulfill(route,{ok:true});return;}
    if(pathname.endsWith('/complete'))completions++;
    await safeFulfill(route,{ok:true});
  });
  try{
    await chooseFile(page,fixture.file);await partEntered.promise;
    if(navigation){await page.locator('.editor-page').getByRole('button',{name:'My series',exact:true}).click();await expect(page.getByRole('dialog',{name:'Leave while uploads are in progress?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Leave and stop upload',exact:true}).click();await expect(page).toHaveURL(/\/studio$/);}
    else{await page.getByRole('button',{name:'Stop upload',exact:true}).click();await expect(page.getByRole('button',{name:'Choose video files',exact:true})).toBeEnabled();}
    await expect.poll(()=>cancellations).toBe(1);allowPart.resolve();
    expect(parts).toBe(1);expect(completions).toBe(0);expect(errors).toEqual([]);
  }finally{allowPart.resolve();await rm(fixture.directory,{recursive:true,force:true});}
});
