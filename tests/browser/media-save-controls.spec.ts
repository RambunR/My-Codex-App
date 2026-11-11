import {test,expect,type Locator,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const clip=readFileSync(path.resolve('public/demo-preview.mp4'));
const cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#613f83"/></svg>');
const creator={id:'media-save-creator',name:'Media controls studio',email:'media-controls@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const series={id:'media-save-series',title:'A story still opens normally',description:'This ordinary synopsis remains selectable and copyable while saving controls apply only to the poster and video.',language:'en',genres:['drama'],themes:[],format:'live-action',creation_type:'human',cover,creator_id:creator.id,creator_name:creator.name,price_cents:10,free_episodes:1,episode_count:2,first_episode_id:'media-save-episode-1',views:0,saves:0,likes:0,liked:false,status:'published',featured:0,demo:0,created_at:'2026-11-04 00:00:00'};
const episodes=[1,2].map(number=>({id:`media-save-episode-${number}`,series_id:series.id,title:`Chapter ${number}`,number,duration:12,bytes:1000,free:number===1,unlocked:false}));

async function fixture(page:Page,{signedIn=false}:{signedIn?:boolean}={}){
  const writes:{path:string;body:any}[]=[],unexpected:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  // Every API request is intercepted; playback may exercise callbacks, but it
  // cannot update a real account, analytics database, upload or payment.
  await page.route('**/api/**',route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    if(request.method()!=='GET'){
      if(request.method()==='POST'&&/^\/api\/episodes\/media-save-episode-[12]\/(playback|progress)$/.test(pathname)){
        writes.push({path:pathname,body:request.postDataJSON()});
        return route.fulfill({json:pathname.endsWith('/playback')?{excluded:true}:{ok:true}});
      }
      unexpected.push(request.method()+' '+pathname);return route.abort();
    }
    if(pathname==='/api/auth/me')return route.fulfill({json:{user:signedIn?creator:null}});
    if(pathname==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{activationHkd:88}}});
    if(pathname==='/api/studio/title-availability')return route.fulfill({json:{available:true}});
    if(pathname==='/api/series')return route.fulfill({json:{series:[series]}});
    if(pathname===`/api/series/${series.id}`)return route.fulfill({json:{series,episodes}});
    if(pathname===`/api/studio/series/${series.id}`)return route.fulfill({json:{series,episodes,episodes_revision:'a'.repeat(64),owner_storage:{used_bytes:0,quota_bytes:creator.quota_bytes}}});
    if(/^\/api\/(?:studio\/)?episodes\/media-save-episode-[12]\/stream$/.test(pathname)){
      // Match the real stream's byte-range transport. A plain 200 mock can
      // decode metadata yet expose no seekable range to Chromium.
      const range=request.headers().range,match=range?.match(/^bytes=(\d+)-(\d*)$/);
      if(!range)return route.fulfill({body:clip,contentType:'video/mp4',headers:{'accept-ranges':'bytes'}});
      if(match){
        const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),clip.length-1):clip.length-1;
        if(start<=end&&start<clip.length)return route.fulfill({status:206,body:clip.subarray(start,end+1),contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${clip.length}`}});
      }
      unexpected.push('Invalid fixture media range: '+range);
      return route.fulfill({status:416,headers:{'content-range':`bytes */${clip.length}`}});
    }
    unexpected.push(request.method()+' '+pathname);return route.abort();
  });
  return{writes,assertClean(){expect(unexpected,'No API request may escape the isolated fixture').toEqual([]);expect(errors).toEqual([]);}};
}

async function eventResult(target:Locator,type:'contextmenu'|'dragstart'|'copy'){
  return target.evaluate((element,type)=>{
    const options={bubbles:true,cancelable:true};
    const event=type==='contextmenu'?new MouseEvent(type,{...options,button:2}):type==='dragstart'?new DragEvent(type,options):new ClipboardEvent(type,options);
    const dispatched=element.dispatchEvent(event);
    return{prevented:event.defaultPrevented,dispatched};
  },type);
}

async function assertMediaEvents(target:Locator){
  await expect(target).toHaveAttribute('draggable','false');
  for(const type of ['contextmenu','dragstart']as const)expect(await eventResult(target,type)).toEqual({prevented:true,dispatched:false});
}

test('posters deter context saving and dragging while links and ordinary text remain usable',async({page})=>{
  const state=await fixture(page);await page.goto('/browse');
  const card=page.locator('.series-card').first();
  await assertMediaEvents(card.locator('.poster img.cover-artwork-image'));
  await card.locator('.poster-link').click();
  await expect(page).toHaveURL(`/series/${series.id}`);
  await assertMediaEvents(page.locator('.detail-cover img.cover-artwork-image'));

  const synopsis=page.locator('.detail-description');
  await expect(synopsis).toHaveText(series.description);
  for(const type of ['contextmenu','copy']as const)expect(await eventResult(synopsis,type)).toEqual({prevented:false,dispatched:true});
  const selected=await synopsis.evaluate(element=>{
    const selection=window.getSelection(),range=document.createRange();
    range.selectNodeContents(element);selection?.removeAllRanges();selection?.addRange(range);
    return{text:selection?.toString(),userSelect:getComputedStyle(element).userSelect};
  });
  expect(selected.text).toBe(series.description);expect(selected.userSelect).not.toBe('none');
  expect(state.writes).toEqual([]);state.assertClean();
});

test('viewer video deters casual saving without disabling playback, seeking or picture-in-picture',async({page})=>{
  const state=await fixture(page,{signedIn:true});await page.goto(`/watch/${series.id}/${episodes[0].id}`);
  const video=page.locator('video');
  await expect(video).toBeVisible();await expect(video).toHaveAttribute('src',`/api/episodes/${episodes[0].id}/stream`);
  await expect(video).toHaveAttribute('controls','');await expect(video).toHaveAttribute('playsinline','');
  await expect(video).toHaveAttribute('controlslist',/\bnodownload\b/);
  await assertMediaEvents(video);
  expect(await video.evaluate((element:HTMLVideoElement)=>element.disablePictureInPicture)).toBe(false);
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.seekable.length?element.seekable.end(element.seekable.length-1):0)).toBeGreaterThan(6);
  await video.evaluate((element:HTMLVideoElement)=>{element.currentTime=6;});
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThanOrEqual(6);
  await expect.poll(()=>state.writes.some(write=>write.path.endsWith('/progress')&&write.body.seconds>=6)).toBe(true);
  await video.evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();});
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(6.1);
  await video.evaluate((element:HTMLVideoElement)=>element.pause());
  expect(await video.evaluate((element:HTMLVideoElement)=>element.paused)).toBe(true);
  state.assertClean();
});

test('native fullscreen remains available when the branded container cannot enter fullscreen',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true});
    Object.defineProperty(document,'webkitFullscreenEnabled',{value:false,configurable:true});
  });
  const state=await fixture(page);await page.goto(`/watch/${series.id}/${episodes[0].id}`);
  const video=page.locator('video');
  await expect(page.getByRole('button',{name:'Enter fullscreen',exact:true})).toHaveCount(0);
  await expect(video).toHaveAttribute('controlslist',/\bnodownload\b/);
  await expect(video).not.toHaveAttribute('controlslist',/\bnofullscreen\b/);
  await expect(video).toHaveAttribute('controls','');
  expect(await video.evaluate((element:HTMLVideoElement)=>typeof element.requestFullscreen)).toBe('function');
  await assertMediaEvents(video);
  expect(state.writes).toEqual([]);state.assertClean();
});

test('creator private previews use the same media controls without changing original files or writing analytics',async({page})=>{
  const state=await fixture(page,{signedIn:true});await page.goto(`/studio/series/${series.id}`);
  await page.getByRole('button',{name:'Private preview: Chapter 1',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Private preview',exact:true}),video=dialog.locator('video');
  await expect(video).toHaveAttribute('src',`/api/studio/episodes/${episodes[0].id}/stream`);
  await expect(video).toHaveAttribute('preload','none');await expect(video).toHaveAttribute('controls','');
  await expect(video).toHaveAttribute('controlslist',/\bnodownload\b/);
  await assertMediaEvents(video);
  expect(await video.evaluate((element:HTMLVideoElement)=>element.disablePictureInPicture)).toBe(false);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.branded-video')).toHaveCount(0);
  expect(state.writes).toEqual([]);state.assertClean();
});
