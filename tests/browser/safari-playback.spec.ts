import {test,expect,type Page} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectMp4Playback,patchVideoBytes} from '../../shared/mp4-playback';

let directory:string,videoBytes:Buffer;
const series={id:'safari-drama',title:'Safari playback regression',description:'A moving H.264/AAC fixture for actual decoding and seeking.',language:'en',genres:['drama'],cover:'/images/placeholder.svg',creator_name:'Local fixture',creation_type:'human',price_cents:10,free_episodes:2,episode_count:3,views:0,saves:0,likes:0,liked:false,status:'published',featured:0,created_at:'2026-11-14 00:00:00'};
const episodes=[1,2,3].map(number=>({id:`safari-${number}`,series_id:series.id,title:`Chapter ${number}`,number,duration:8,bytes:1000,free:number<3,unlocked:false}));
test.beforeAll(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'lingying-safari-browser-'));const file=path.join(directory,'export.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=128x224:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','8','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-profile:v','high','-level:v','6.2','-bsf:v','h264_metadata=tick_rate=32000/1','-c:a','aac','-movflags','+faststart','-y',file]);
  const original=await readFile(file),patches=await inspectMp4Playback(original.length,async(o,n)=>original.subarray(o,o+n));expect(patches).toHaveLength(2);videoBytes=Buffer.from(patchVideoBytes(original,0,patches));
});
test.afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
async function fixture(page:Page){
  const errors:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(!['GET','HEAD'].includes(request.method())){writes.push(pathname);return route.fulfill({json:pathname.endsWith('/playback')?{excluded:true}:{ok:true}});}
    if(pathname==='/api/auth/me')return route.fulfill({json:{user:null}});
    if(pathname==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',usdToHkd:7.8,demo:false,limits:{},auth:{google:false,apple:false,email:false}}});
    if(pathname==='/api/series/safari-drama')return route.fulfill({json:{series,episodes}});
    if(/^\/api\/episodes\/safari-[12]\/stream$/.test(pathname)){
      const range=request.headers().range,match=range&&/^bytes=(\d*)-(\d*)$/.exec(range);let start=0,end=videoBytes.length-1;
      if(match){start=match[1]?Number(match[1]):Math.max(0,videoBytes.length-Number(match[2]));end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;}
      return route.fulfill({status:range?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'private, no-store',...(range?{'Content-Range':`bytes ${start}-${end}/${videoBytes.length}`}:{})},body:request.method()==='HEAD'?Buffer.alloc(0):videoBytes.subarray(start,end+1)});
    }
    if(pathname==='/api/series')return route.fulfill({json:{series:[series]}});
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Local fixture only'}}});
  });
  return{errors,writes};
}
test('a corrected legacy export produces real frames, seeks, pauses and changes episodes in the phone player',async({page})=>{
  await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto('/watch/safari-drama/safari-1');const video=page.locator('video');
  await expect(video).toBeVisible();await expect(video).toHaveAttribute('playsinline','');await expect(video).toHaveAttribute('controls','');
  await video.evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBe(128);await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0.5);
  await video.evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=4;});await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>!v.seeking&&v.currentTime>=4&&v.videoWidth===128)).toBe(true);
  await video.evaluate(async(v:HTMLVideoElement)=>{await v.play();});await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(4.4);expect(await video.evaluate((v:HTMLVideoElement)=>v.error?.code??null)).toBeNull();
  await video.evaluate((v:HTMLVideoElement)=>v.pause());
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page).toHaveURL('/watch/safari-drama/safari-2');await expect(page.locator('video')).toHaveAttribute('src','/api/episodes/safari-2/stream');
  await page.locator('video').evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBe(128);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await expect(page.locator('.branded-video-icon')).toHaveCSS('pointer-events','none');expect(state.errors).toEqual([]);expect(state.writes.every(p=>p.endsWith('/playback'))).toBe(true);
});
test('the locked episode keeps its sign-in gate and does not request playable media',async({page})=>{
  const state=await fixture(page);await page.goto('/watch/safari-drama/safari-3');await expect(page.locator('video')).toHaveCount(0);await page.getByRole('button',{name:/Unlock episode/}).click();await expect(page).toHaveURL(/\/auth\?next=/);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('blocked Safari storage cannot crash the website or prevent language selection',async({page})=>{
  await page.addInitScript(()=>{for(const key of ['getItem','setItem'] as const)Storage.prototype[key]=()=>{throw new DOMException('Storage blocked','SecurityError');};});
  const state=await fixture(page);await page.goto('/watch/safari-drama/safari-1');await expect(page.locator('video')).toBeVisible();await page.locator('header .header-language').click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:/繁體中文/}).click();await expect(page.locator('html')).toHaveAttribute('lang','zh-TW');expect(state.errors).toEqual([]);
});
