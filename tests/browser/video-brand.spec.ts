import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const clip=path.resolve('public/demo-preview.mp4');
const creator={id:'brand-creator',name:'Video brand creator',email:'brand-creator@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const series={id:'video-brand-series',title:'Original video remains intact',description:'An original short drama used to verify playback branding without changing its source media.',language:'en',genres:['drama'],cover:'/images/placeholder.svg',creator_id:creator.id,creator_name:creator.name,creation_type:'human',price_cents:10,free_episodes:1,episode_count:3,views:0,saves:0,likes:0,liked:false,status:'published',featured:0,created_at:'2026-11-03 00:00:00'};
const episodes=[1,2,3].map(number=>({id:`brand-episode-${number}`,series_id:series.id,title:`Chapter ${number}`,number,duration:12,bytes:1000,free:number===1,unlocked:number===2}));
async function fixture(page:Page,{admin=false,signedIn=false}:{admin?:boolean;signedIn?:boolean}={}){
  const writes:{path:string;method:string;body:any}[]=[];
  page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method())&&new URL(request.url()).pathname.startsWith('/api/'))writes.push({path:new URL(request.url()).pathname,method:request.method(),body:request.postDataJSON()});});
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:signedIn?{...creator,role:admin?'admin':'publisher'}:null}}));
  await page.route('**/api/series/video-brand-series',route=>route.fulfill({json:{series,episodes}}));
  await page.route('**/api/studio/series/video-brand-series',route=>route.fulfill({json:{series,episodes,episodes_revision:'a'.repeat(64),owner_storage:{used_bytes:0,quota_bytes:creator.quota_bytes}}}));
  await page.route('**/api/episodes/brand-episode-*/stream',route=>route.fulfill({path:clip,contentType:'video/mp4'}));
  await page.route('**/api/studio/episodes/brand-episode-*/stream',route=>route.fulfill({path:clip,contentType:'video/mp4'}));
  await page.route('**/api/admin/episodes/brand-episode-*/stream',route=>route.fulfill({path:clip,contentType:'video/mp4'}));
  await page.route('**/api/episodes/brand-episode-*/playback',route=>route.fulfill({json:{excluded:true}}));
  await page.route('**/api/episodes/brand-episode-*/progress',route=>route.fulfill({json:{ok:true}}));
  return{writes};
}
async function assertIcon(page:Page){
  const icon=page.locator('.branded-video-icon');await expect(icon).toHaveCount(1);await expect(icon).toBeVisible();await expect(icon).toHaveCSS('opacity','0.6');await expect(icon).toHaveCSS('pointer-events','none');await expect(icon).toHaveAttribute('aria-hidden','true');await expect(icon).toHaveAttribute('alt','');await expect(icon).toHaveAttribute('src','/icon-192.png?v=lingying-phoenix-05-v1');
  const bounds=await icon.boundingBox(),container=await page.locator('.branded-video').boundingBox();expect(bounds).not.toBeNull();expect(container).not.toBeNull();expect(bounds!.x).toBeGreaterThan(container!.x+container!.width/2);expect(bounds!.y-container!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y-container!.y).toBeLessThanOrEqual(15);expect(container!.x+container!.width-bounds!.x-bounds!.width).toBeGreaterThanOrEqual(0);expect(container!.x+container!.width-bounds!.x-bounds!.width).toBeLessThanOrEqual(15);expect(bounds!.width).toBeGreaterThanOrEqual(36);expect(bounds!.width).toBeLessThanOrEqual(52);
}

for(const[number,access]of [[1,'free'],[2,'unlocked paid']] as const)test(`${access} viewer video retains original source and native controls with decorative branding`,async({page})=>{
  const state=await fixture(page);await page.goto(`/watch/${series.id}/brand-episode-${number}`);const video=page.locator('video');await expect(video).toBeVisible();await expect(video).toHaveAttribute('src',`/api/episodes/brand-episode-${number}/stream`);await expect(video).toHaveAttribute('controls','');await expect(video).toHaveAttribute('playsinline','');await expect(video).toHaveCSS('object-fit','contain');await assertIcon(page);expect(state.writes).toEqual([]);
});

for(const[locale,width,height]of [['en',320,740],['zh-TW',390,844],['ar',844,390]] as const)test(`icon stays top-right and player fits ${width}x${height} ${locale}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await fixture(page);await page.goto(`/watch/${series.id}/brand-episode-1`);await assertIcon(page);const video=await page.locator('video').boundingBox(),player=await page.locator('.video-player').boundingBox();expect(video!.height).toBeGreaterThan(0);expect(video!.height).toBeLessThanOrEqual(player!.height+1);expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('real wrapper fullscreen keeps icon, media event forwarding, next episode and retry usable',async({page})=>{
  const state=await fixture(page,{signedIn:true});await page.goto(`/watch/${series.id}/brand-episode-1`);const wrapper=page.locator('.branded-video');await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('branded-video'))).toBe(true);await expect(page.getByRole('button',{name:'Exit fullscreen',exact:true})).toBeVisible();await assertIcon(page);
  await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>video.readyState)).toBeGreaterThan(0);await wrapper.evaluate(element=>{(window as any).originalBrandedWrapper=element;});await page.locator('video').evaluate(async(video:HTMLVideoElement)=>{video.muted=true;await video.play();});await expect.poll(()=>state.writes.map(write=>write.path),{timeout:10000}).toContain('/api/episodes/brand-episode-1/progress');await expect.poll(()=>state.writes.map(write=>write.path)).toContain('/api/episodes/brand-episode-1/playback');const saved=state.writes.find(write=>write.path.endsWith('/progress'))?.body.seconds;expect(saved).toBeGreaterThanOrEqual(5);expect(saved).toBeLessThanOrEqual(10);await page.locator('video').evaluate((video:HTMLVideoElement)=>video.pause());
  await page.locator('video').evaluate(video=>video.dispatchEvent(new Event('ended')));await expect(page).toHaveURL(`/watch/${series.id}/brand-episode-2`);await expect(page.locator('video')).toHaveAttribute('src','/api/episodes/brand-episode-2/stream');expect(await wrapper.evaluate(element=>element===(window as any).originalBrandedWrapper)).toBe(true);expect(await page.evaluate(()=>document.fullscreenElement===(window as any).originalBrandedWrapper)).toBe(true);
  await page.locator('video').evaluate(video=>video.dispatchEvent(new Event('error')));await expect(wrapper.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await wrapper.getByRole('button',{name:'Try again',exact:true}).click();await expect(wrapper.locator('.player-lock')).toHaveCount(0);expect(await page.evaluate(()=>document.fullscreenElement===(window as any).originalBrandedWrapper)).toBe(true);await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);await expect(page.getByRole('button',{name:'Enter fullscreen',exact:true})).toBeVisible();
  expect(state.writes.every(write=>/\/(progress|playback)$/.test(write.path))).toBe(true);
});

for(const admin of [false,true])test(`${admin?'administrator':'creator'} private preview is branded without media or analytics writes`,async({page})=>{
  const state=await fixture(page,{signedIn:true,admin});await page.goto(`/studio/series/${series.id}`);await page.getByRole('button',{name:'Private preview: Chapter 1',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Private preview',exact:true});await expect(dialog.locator('video')).toHaveAttribute('src',`/api/${admin?'admin':'studio'}/episodes/brand-episode-1/stream`);await expect(dialog.locator('video')).toHaveAttribute('preload','none');await assertIcon(page);await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.branded-video')).toHaveCount(0);expect(state.writes).toEqual([]);
});

test('unsupported or rejected wrapper fullscreen retains native fallback and inline video',async({page})=>{
  await page.addInitScript(()=>{Element.prototype.requestFullscreen=()=>Promise.reject(new Error('Fullscreen denied by browser policy'));});await fixture(page);await page.goto(`/watch/${series.id}/brand-episode-1`);await expect(page.locator('video')).toHaveAttribute('controlslist',/(?:^|\s)nofullscreen(?:\s|$)/);await expect(page.locator('video')).toHaveAttribute('controlslist',/(?:^|\s)nodownload(?:\s|$)/);await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect(page.getByRole('button',{name:'Enter fullscreen',exact:true})).toHaveCount(0);await expect(page.locator('video')).not.toHaveAttribute('controlslist',/nofullscreen/);await expect(page.locator('video')).toBeVisible();await assertIcon(page);
});

test('locked episode retains sign-in flow and does not render a playable video',async({page})=>{
  const state=await fixture(page);await page.goto(`/watch/${series.id}/brand-episode-3`);await expect(page.locator('video,.branded-video')).toHaveCount(0);await page.getByRole('button',{name:/Unlock episode/}).click();await expect(page).toHaveURL(/\/auth\?next=/);expect(state.writes).toEqual([]);
});


test('browser without container fullscreen keeps native video controls available',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true});Object.defineProperty(document,'webkitFullscreenEnabled',{value:false,configurable:true});});await fixture(page);await page.goto(`/watch/${series.id}/brand-episode-1`);await expect(page.getByRole('button',{name:'Enter fullscreen',exact:true})).toHaveCount(0);await expect(page.locator('video')).not.toHaveAttribute('controlslist',/nofullscreen/);await expect(page.locator('video')).toHaveAttribute('controls','');await assertIcon(page);
});
