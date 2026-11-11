import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {localeMessages} from '../../src/i18n';
import {MAX_EPISODE_BYTES,MAX_EPISODE_SECONDS,type Locale} from '../../shared/config';

const owner={id:'long-episode-owner',name:'Platform owner',email:'owner@browser.test',role:'admin',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:10*1024**3,used_bytes:0,storage_unlimited:true,max_episode_seconds:null,language:'en',payment_review:false};
const ordinaryAdmin={...owner,id:'another-admin',name:'Another administrator',email:'admin@browser.test',max_episode_seconds:MAX_EPISODE_SECONDS};
const publisher={...owner,id:'normal-publisher',name:'Publisher',email:'publisher@browser.test',role:'publisher',max_episode_seconds:MAX_EPISODE_SECONDS,storage_unlimited:false};
const profiles=[{id:'managed-one',display_name:'DreamShortDrama',registered_at:'2026-01-01',is_official:false,managed:true},{id:'managed-two',display_name:'Another publisher name',registered_at:'2026-02-01',is_official:false,managed:true}];
const series={id:'owner-policy-series',creator_id:owner.id,creator_name:profiles[0].display_name,publisher_profile_id:profiles[0].id,title:'Publisher policy story',description:'An original drama whose upload limit follows its actual owner, rather than the displayed publisher name.',language:'en',genres:['drama'],themes:[],format:'live-action',creation_type:'human',cover:'',cover_aspect_ratio:'9:16',price_cents:10,free_episodes:1,episode_count:0,views:0,saves:0,likes:0,status:'draft',featured:0,created_at:'2026-11-11 00:00:00'};
type Account=Omit<typeof owner,'max_episode_seconds'>&{max_episode_seconds:number|null};
async function editorFixture(page:Page,{actor=owner,creatorId=actor.id,limit=null,includeLimits=true,locale='en'}:{actor?:Account;creatorId?:string;limit?:number|null;includeLimits?:boolean;locale?:Locale}={}){
  const unexpected:string[]=[],writes:string[]=[],errors:string[]=[];
  await page.addInitScript(language=>localStorage.setItem('drama-language',language),locale);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.abort();}
    if(path==='/api/auth/me')return route.fulfill({json:{user:actor}});
    if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,uploadsEnabled:true,payoutsEnabled:false,demo:false,usdToHkd:7.8,runtime:'cloudflare',limits:{maxEpisodeSeconds:300,maxEpisodeBytes:MAX_EPISODE_BYTES},auth:{google:false,apple:false,email:false}}});
    if(path==='/api/display-currency')return route.fulfill({json:{quote:null}});
    if(path==='/api/admin/publishers')return route.fulfill({json:{publishers:profiles,default_publisher_id:profiles[0].id}});
    if(path==='/api/studio/title-availability')return route.fulfill({json:{available:true}});
    if(path==='/api/studio/series/'+series.id)return route.fulfill({json:{series:{...series,creator_id:creatorId},episodes:[],episodes_revision:'owner-policy',owner_storage:{used_bytes:0,quota_bytes:10*1024**3,storage_unlimited:creatorId===owner.id||creatorId===ordinaryAdmin.id},...(includeLimits?{owner_upload_limits:{maxEpisodeSeconds:limit,maxEpisodeBytes:MAX_EPISODE_BYTES}}:{})}});
    unexpected.push(request.method()+' '+path);return route.abort();
  });
  return{assertClean(){expect(unexpected).toEqual([]);expect(writes).toEqual([]);expect(errors).toEqual([]);}};
}
async function guide(page:Page,unlimited:boolean,locale:Locale='en'){
  await page.locator('.upload-guide-trigger').click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  const copy=localeMessages[locale],duration=unlimited?copy.ownerEpisodeUnlimitedDuration!:copy.uploadGuideDuration!.replace('{minutes}','5');
  await expect(dialog.locator('.upload-guide-limits')).toContainText(duration);await expect(dialog.locator('.upload-guide-limits')).toContainText('200 MiB');
  return dialog;
}

test('owner-managed publisher names retain the unlimited duration policy without changing file limits',async({page})=>{
  const state=await editorFixture(page);await page.goto('/studio/series/'+series.id);
  const policy=page.locator('.episode-duration-policy');await expect(policy).toHaveAttribute('data-max-episode-seconds','unlimited');await expect(policy).toContainText(localeMessages.en.ownerEpisodeLimits!.replace('{size}','200'));
  await guide(page,true);await page.keyboard.press('Escape');await page.locator('#series-publisher-profile').selectOption(profiles[1].id);
  await expect(policy).toHaveAttribute('data-max-episode-seconds','unlimited');await guide(page,true);state.assertClean();
});

test('another administrator retains the five-minute limit even with unlimited storage',async({page})=>{
  const state=await editorFixture(page,{actor:ordinaryAdmin,limit:MAX_EPISODE_SECONDS});await page.goto('/studio/series/'+series.id);
  await expect(page.locator('.episode-duration-policy')).toHaveAttribute('data-max-episode-seconds','300');await expect(page.locator('.editor-storage')).toContainText('Unlimited');await guide(page,false);state.assertClean();
});

test('the platform owner editing another creator uses that creator’s five-minute limit',async({page})=>{
  const state=await editorFixture(page,{creatorId:publisher.id,limit:MAX_EPISODE_SECONDS});await page.goto('/studio/series/'+series.id);
  await expect(page.locator('.episode-duration-policy')).toHaveAttribute('data-max-episode-seconds','300');await expect(page.locator('#series-publisher-profile')).toHaveCount(0);await guide(page,false);state.assertClean();
});

test('an existing series without confirmed owner limits conservatively keeps five-minute guidance',async({page})=>{
  const state=await editorFixture(page,{includeLimits:false});await page.goto('/studio/series/'+series.id);
  await expect(page.locator('.episode-duration-policy')).toHaveAttribute('data-max-episode-seconds','300');await guide(page,false);state.assertClean();
});

for(const actor of [owner,ordinaryAdmin])test(`${actor.name} receives its own duration policy for a new draft`,async({page})=>{
  const state=await editorFixture(page,{actor});await page.goto('/studio/new');await guide(page,actor.max_episode_seconds===null);state.assertClean();
});

for(const locale of ['en','zh-TW'] as const)test(`unlimited owner guidance and the file limit fit a 320px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width:320,height:740});const state=await editorFixture(page,{locale});await page.goto('/studio/series/'+series.id);
  const dialog=await guide(page,true,locale);await expect.poll(()=>dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);state.assertClean();
});

test('ordinary viewers retain watch time and saved progress beyond five minutes on an allowed long episode',async({page})=>{
  const heartbeats:number[]=[],progress:number[]=[],unexpected:string[]=[],errors:string[]=[];
  const episode={id:'allowed-long-episode',series_id:series.id,title:'A longer published episode',number:1,duration:600,bytes:1037034,free:true,unlocked:true};
  const viewer={...publisher,id:'ordinary-long-viewer',role:'viewer',publisher_active:0};const preview=await readFile('public/demo-preview.mp4');
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='GET'){
      if(path==='/api/auth/me')return route.fulfill({json:{user:viewer}});
      if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,demo:false,usdToHkd:7.8,limits:{maxEpisodeSeconds:300}}});
      if(path==='/api/display-currency')return route.fulfill({json:{quote:null}});
      if(path==='/api/series/'+series.id)return route.fulfill({json:{series:{...series,status:'published',episode_count:1},episodes:[episode]}});
      if(path==='/api/episodes/'+episode.id+'/stream')return route.fulfill({contentType:'video/mp4',body:preview});
    }
    if(request.method()==='POST'&&path==='/api/episodes/'+episode.id+'/playback')return route.fulfill({json:{sessionId:'long-view-session',viewCounted:true,watchedMs:299500,reportedMs:299500}});
    if(request.method()==='PUT'&&path==='/api/playback/long-view-session'){const{watchedMs}=request.postDataJSON();heartbeats.push(watchedMs);return route.fulfill({json:{sessionId:'long-view-session',viewCounted:true,watchedMs,reportedMs:watchedMs}});}
    if(request.method()==='POST'&&path==='/api/episodes/'+episode.id+'/progress'){progress.push(request.postDataJSON().seconds);return route.fulfill({json:{ok:true}});}
    unexpected.push(request.method()+' '+path);return route.abort();
  });
  await page.goto(`/watch/${series.id}/${episode.id}`);const video=page.locator('video');await expect(video).toBeVisible();await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);
  const started=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/episodes/${episode.id}/playback`);
  await video.evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();});await started;await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(1.2);
  await video.evaluate((element:HTMLVideoElement)=>element.pause());await expect.poll(()=>heartbeats.some(value=>value>300000)).toBe(true);expect(Math.max(...heartbeats)).toBeLessThanOrEqual(600000);
  // A seek updates resume progress but is excluded from measured watch time.
  await video.evaluate((element:HTMLVideoElement)=>{Object.defineProperty(element,'currentTime',{value:355,writable:true,configurable:true});element.dispatchEvent(new Event('timeupdate'));});
  await expect.poll(()=>progress.includes(355)).toBe(true);
  await video.evaluate((element:HTMLVideoElement)=>{element.currentTime=900;element.dispatchEvent(new Event('timeupdate'));});await expect.poll(()=>progress.includes(600)).toBe(true);
  expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
