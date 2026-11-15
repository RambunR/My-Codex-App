import {test,expect,type Page,type Route,type Locator} from '@playwright/test';
import path from 'node:path';

const clip=path.resolve('public/demo-preview.mp4');
const viewer={id:'watch-transition-viewer',name:'Watch viewer',email:'watch-transition@browser.test',role:'viewer',publisher_active:0,wallet_micros:1000000,earnings_micros:0,quota_bytes:10*1024**3,used_bytes:0,language:'en',payment_review:false};
const series={id:'watch-transition-story',title:'A continuous original story',description:'An original drama used to verify uninterrupted viewing and deliberate paid unlocks.',language:'en',genres:['drama'],cover:'/images/placeholder.svg',creator_id:'watch-transition-creator',creator_name:'Original Studio',creation_type:'human',price_cents:10,free_episodes:2,last_episode_free:true,free_episode_count:3,episode_count:4,views:0,saves:0,likes:0,liked:false,status:'published',featured:0,demo:0,created_at:'2026-11-15T00:00:00Z'};
const other={...series,id:'watch-transition-other',title:'A different original story'};
function episodes(id:string){return[1,2,3,4].map(number=>({id:`${id}-${number}`,series_id:id,title:`Chapter ${number}`,number,duration:12,bytes:1000,free:number!==3,unlocked:false}));}
const watchUrl=(number:number,id=series.id)=>`/watch/${id}/${id}-${number}`;
async function heldReply(route:Route,json:unknown){try{await route.fulfill({json});}catch(error){if(!route.request().failure())throw error;}}

async function fixture(page:Page){
  let user={...viewer};const releases=new Map([series,other].map(release=>[release.id,release])),rows=new Map([series,other].map(release=>[release.id,episodes(release.id)]));
  const writes:Array<{path:string;method:string;body:unknown}>=[],streams:string[]=[],details:string[]=[],errors:string[]=[],unexpected:string[]=[];
  const settlements:Array<{episodeId:string;priceMicros:number}>=[];
  const detailGates=new Map<string,Promise<void>>();let unlockGate:Promise<void>|undefined;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(['GET','HEAD'].includes(request.method())){
      if(pathname==='/api/auth/me')return route.fulfill({json:{user}});
      if(pathname==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{}}});
      if(pathname==='/api/series')return route.fulfill({json:{series:[]}});
      const id=pathname.split('/')[3];
      if(releases.has(id)&&pathname===`/api/series/${id}`){details.push(id);const snapshot={series:releases.get(id),episodes:rows.get(id)!.map(episode=>({...episode}))},gate=detailGates.get(id);if(gate)await gate;return heldReply(route,snapshot);}
      if(releases.has(id)&&pathname===`/api/series/${id}/unlock-quote`){const remaining=rows.get(id)!.filter(episode=>!episode.free&&!episode.unlocked),unit=releases.get(id)!.price_cents*10000;return route.fulfill({json:{series_id:id,episode_ids:remaining.map(episode=>episode.id),episode_count:remaining.length,total_micros:remaining.length*unit,unit_price_micros:unit,revision:'a'.repeat(64)}});}
      if(/^\/api\/episodes\/[^/]+\/stream$/.test(pathname)){
        const episode=[...rows.values()].flat().find(episode=>episode.id===id);streams.push(id);
        if(!episode||!episode.free&&!episode.unlocked){unexpected.push('Locked stream '+id);return route.fulfill({status:403,json:{error:{code:'LOCKED',message:'Episode is locked'}}});}
        return route.fulfill({path:clip,contentType:'video/mp4'});
      }
      unexpected.push(request.method()+' '+pathname);return route.fulfill({status:404,json:{error:{message:'Unexpected watch fixture read'}}});
    }
    const body=request.postDataJSON();writes.push({path:pathname,method:request.method(),body});
    if(request.method()==='POST'&&/^\/api\/episodes\/[^/]+\/playback$/.test(pathname))return route.fulfill({json:{excluded:true}});
    if(request.method()==='POST'&&/^\/api\/episodes\/[^/]+\/progress$/.test(pathname))return route.fulfill({json:{ok:true}});
    if(request.method()==='POST'&&/^\/api\/episodes\/[^/]+\/unlock$/.test(pathname)){
      const episodeId=pathname.split('/')[3],episode=[...rows.values()].flat().find(episode=>episode.id===episodeId);if(!episode){unexpected.push('Unknown unlock '+episodeId);return route.abort();}
      const gate=unlockGate;if(gate)await gate;const alreadyUnlocked=episode.free||episode.unlocked,currentPrice=releases.get(episode.series_id)!.price_cents,expectedPrice=(body as {expected_price_cents?:number}).expected_price_cents;
      if(!alreadyUnlocked&&expectedPrice!==undefined&&expectedPrice!==currentPrice)return route.fulfill({status:409,json:{error:{code:'EPISODE_PRICE_CHANGED',message:'The episode price changed. Review the current price before confirming.'}}});
      episode.unlocked=true;const priceMicros=alreadyUnlocked?0:currentPrice*10000;if(!alreadyUnlocked){user={...user,wallet_micros:user.wallet_micros-priceMicros};settlements.push({episodeId,priceMicros});}return heldReply(route,{user,alreadyUnlocked,paid_micros:priceMicros});
    }
    unexpected.push(request.method()+' '+pathname);return route.abort();
  });
  return{writes,streams,details,settlements,unlocks:()=>writes.filter(write=>write.path.endsWith('/unlock')),balance:()=>user.wallet_micros,episode:(number:number,id=series.id)=>rows.get(id)!.find(episode=>episode.number===number)!,setPrice:(cents:number,id=series.id)=>releases.set(id,{...releases.get(id)!,price_cents:cents}),
    holdDetails:(id=other.id)=>{let release!:()=>void;detailGates.set(id,new Promise<void>(resolve=>{release=resolve;}));return()=>{detailGates.delete(id);release();};},
    holdUnlock:()=>{let release!:()=>void;unlockGate=new Promise<void>(resolve=>{release=resolve;});return()=>{unlockGate=undefined;release();};},
    clean:()=>{expect(unexpected).toEqual([]);expect(errors).toEqual([]);},
  };
}
async function playable(page:Page,number:number,id=series.id){const video=page.locator('.branded-video video');await expect(video).toHaveAttribute('src',`/api/episodes/${id}-${number}/stream`);await expect(video).toBeVisible();await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);return video;}
async function rememberNodes(page:Page){await page.locator('.branded-video').evaluate(element=>{(window as any).watchOriginalWrapper=element;(window as any).watchOriginalVideo=element.querySelector('video');});}
async function sameNodes(page:Page){expect(await page.locator('.branded-video').evaluate(element=>element===(window as any).watchOriginalWrapper)).toBe(true);expect(await page.locator('.branded-video video').evaluate(element=>element===(window as any).watchOriginalVideo)).toBe(true);}
async function navigation(page:Page,url:string){await page.evaluate(value=>{history.pushState({},'',value);window.dispatchEvent(new PopStateEvent('popstate'));},url);}
function settled(page:Page,pathname:string){return new Promise<void>(resolve=>{const done=(request:{url:()=>string})=>{if(new URL(request.url()).pathname===pathname)resolve();};page.on('requestfinished',done);page.on('requestfailed',done);});}
async function renderSettled(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function enterFullscreen(page:Page){await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('branded-video'))).toBe(true);}
async function touchable(locator:Locator){
  await locator.scrollIntoViewIfNeeded();await expect(locator).toBeVisible();
  const hit=await locator.evaluate(element=>{const box=element.getBoundingClientRect(),target=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return{width:box.width,height:box.height,left:box.left,right:box.right,top:box.top,bottom:box.bottom,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,receivesTouch:!!target&&(target===element||element.contains(target))};});
  expect(hit.width).toBeGreaterThanOrEqual(44);expect(hit.height).toBeGreaterThanOrEqual(44);expect(hit.left).toBeGreaterThanOrEqual(0);expect(hit.right).toBeLessThanOrEqual(hit.viewportWidth);expect(hit.top).toBeGreaterThanOrEqual(0);expect(hit.bottom).toBeLessThanOrEqual(hit.viewportHeight);expect(hit.receivesTouch,'The action centre must receive the tap instead of the fullscreen navigation toolbar').toBe(true);await locator.click({trial:true});
}

test('real container fullscreen keeps the same wrapper and media across free, locked, confirmed-paid and retry states',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(1));const video=await playable(page,1);await rememberNodes(page);await enterFullscreen(page);const wrapper=page.locator('.branded-video'),toolbar=wrapper.locator('.fullscreen-player-controls');await expect(toolbar).toBeVisible();await expect(page.locator('.player-column > .player-controls')).toBeHidden();await expect(wrapper.locator('.branded-video-icon')).toBeVisible();await expect(video).not.toHaveAttribute('controlslist',/nofullscreen/);await expect(video).toHaveAttribute('controlslist',/nodownload/);
  await video.evaluate(element=>element.dispatchEvent(new Event('playing')));await expect.poll(()=>state.writes.map(write=>write.path)).toContain(`/api/episodes/${series.id}-1/playback`);await toolbar.getByRole('button',{name:'Next',exact:true}).click();await expect(page).toHaveURL(watchUrl(2));await playable(page,2);await sameNodes(page);await video.evaluate(element=>element.dispatchEvent(new Event('playing')));await expect.poll(()=>state.writes.map(write=>write.path)).toContain(`/api/episodes/${series.id}-2/playback`);
  await toolbar.getByRole('button',{name:'Next',exact:true}).click();await expect(page).toHaveURL(watchUrl(3));await expect(wrapper.getByRole('heading',{name:'Locked episode',exact:true})).toBeVisible();await sameNodes(page);await expect(video).not.toHaveAttribute('src',/.+/);await expect(video).not.toHaveAttribute('controls','');expect(await video.evaluate((element:HTMLVideoElement)=>element.paused)).toBe(true);expect(await page.evaluate(()=>document.fullscreenElement===(window as any).watchOriginalWrapper)).toBe(true);expect(state.unlocks()).toEqual([]);expect(state.streams).not.toContain(series.id+'-3');await video.evaluate(element=>element.dispatchEvent(new Event('playing')));expect(state.writes.some(write=>write.path===`/api/episodes/${series.id}-3/playback`)).toBe(false);
  await wrapper.getByRole('button',{name:/^Unlock (?:next )?episode\b/}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(element=>document.fullscreenElement?.contains(element))).toBe(true);expect(state.unlocks()).toEqual([]);await dialog.getByRole('button',{name:/^Confirm ·/}).click();await expect(dialog).toHaveCount(0);await playable(page,3);await sameNodes(page);expect(await page.evaluate(()=>document.fullscreenElement===(window as any).watchOriginalWrapper)).toBe(true);expect(state.unlocks()).toEqual([{path:`/api/episodes/${series.id}-3/unlock`,method:'POST',body:{expected_price_cents:10}}]);await video.evaluate(element=>element.dispatchEvent(new Event('playing')));await expect.poll(()=>state.writes.map(write=>write.path)).toContain(`/api/episodes/${series.id}-3/playback`);
  await video.evaluate(element=>element.dispatchEvent(new Event('error')));await expect(wrapper.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await wrapper.getByRole('button',{name:'Try again',exact:true}).click();await playable(page,3);await sameNodes(page);expect(await page.evaluate(()=>document.fullscreenElement===(window as any).watchOriginalWrapper)).toBe(true);await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);await expect(page.locator('.player-column > .player-controls')).toBeVisible();expect(state.unlocks()).toHaveLength(1);state.clean();
});

test('ended advances to a playable episode and then the locked gate without an automatic charge',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(1));const video=await playable(page,1);await rememberNodes(page);await video.evaluate((element:HTMLVideoElement)=>{element.muted=true;element.dispatchEvent(new Event('ended'));});await expect(page).toHaveURL(watchUrl(2));await playable(page,2);await sameNodes(page);await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.paused)).toBe(false);await video.evaluate((element:HTMLVideoElement)=>{element.pause();element.dispatchEvent(new Event('ended'));});await expect(page).toHaveURL(watchUrl(3));await expect(page.locator('.branded-video')).toContainText('The next episode requires an unlock. No payment has been taken.');await expect(page.getByRole('button',{name:/^Unlock next episode\b/})).toBeVisible();await sameNodes(page);expect(state.unlocks()).toEqual([]);expect(state.streams).not.toContain(series.id+'-3');state.clean();
});

test('a rejected automatic play offers an explicit working play action on the new episode',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if((window as any).rejectNextWatchPlay){(window as any).rejectNextWatchPlay=false;return Promise.reject(new DOMException('A user gesture is required.','NotAllowedError'));}this.muted=true;return original.call(this);};});
  const state=await fixture(page);await page.goto(watchUrl(1));const video=await playable(page,1);await rememberNodes(page);await video.evaluate(element=>{(window as any).rejectNextWatchPlay=true;element.dispatchEvent(new Event('ended'));});await expect(page).toHaveURL(watchUrl(2));await playable(page,2);const wrapper=page.locator('.branded-video');await expect(wrapper.locator('.watch-playback-blocked')).toContainText('Tap play to continue watching.');await wrapper.getByRole('button',{name:/^(Continue watching|Play next episode)$/}).click();await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.paused)).toBe(false);await expect(wrapper.locator('.watch-playback-blocked')).toHaveCount(0);await sameNodes(page);expect(state.unlocks()).toEqual([]);state.clean();
});

test('the last episode shows a replay action that starts the same video again',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(4));const video=await playable(page,4);await rememberNodes(page);await video.evaluate((element:HTMLVideoElement)=>{element.muted=true;element.dispatchEvent(new Event('ended'));});const end=page.locator('.branded-video .watch-end-card');await expect(end).toContainText('You’ve reached the last available episode.');await expect(page).toHaveURL(watchUrl(4));await end.getByRole('button',{name:'Watch again',exact:true}).click();await expect(end).toHaveCount(0);await sameNodes(page);await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.paused)).toBe(false);await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(0);expect(state.unlocks()).toEqual([]);state.clean();
});

test('an initially locked episode still has a fullscreen container and confirms payment inside it',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(3));const wrapper=page.locator('.branded-video');await expect(wrapper).toBeVisible();await expect(wrapper.locator('video')).toHaveCount(0);await wrapper.evaluate(element=>{(window as any).lockedOriginalWrapper=element;});await enterFullscreen(page);await wrapper.getByRole('button',{name:/^Unlock episode\b/}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(element=>document.fullscreenElement?.contains(element))).toBe(true);expect(state.unlocks()).toEqual([]);await dialog.getByRole('button',{name:/^Confirm ·/}).click();await playable(page,3);expect(await wrapper.evaluate(element=>element===(window as any).lockedOriginalWrapper)).toBe(true);expect(await page.evaluate(()=>document.fullscreenElement===(window as any).lockedOriginalWrapper)).toBe(true);expect(state.unlocks()).toHaveLength(1);state.clean();
});

test('late series reads cannot replace a newer watch selection',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(1));await playable(page,1);const release=state.holdDetails(),done=settled(page,`/api/series/${other.id}`);await navigation(page,watchUrl(1,other.id));await expect.poll(()=>state.details.filter(id=>id===other.id).length).toBeGreaterThanOrEqual(1);await navigation(page,watchUrl(2));await playable(page,2);release();await done;await renderSettled(page);await expect(page.locator('.watch-series-intro h1')).toHaveText(series.title);await playable(page,2);expect(state.streams.some(id=>id.startsWith(other.id))).toBe(false);expect(state.unlocks()).toEqual([]);state.clean();
});

test('a late unlock response cannot reopen a dialog or select its old episode after navigation',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(3));const release=state.holdUnlock(),done=settled(page,`/api/episodes/${series.id}-3/unlock`);await page.locator('.branded-video').getByRole('button',{name:/^Unlock episode\b/}).click();await page.getByRole('dialog').getByRole('button',{name:/^Confirm ·/}).click();await expect.poll(()=>state.unlocks().length).toBe(1);await navigation(page,watchUrl(1));await playable(page,1);await expect(page.getByRole('dialog')).toHaveCount(0);release();await done;await renderSettled(page);await expect(page).toHaveURL(watchUrl(1));await playable(page,1);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.watch-episode-grid a[aria-current="page"]')).toHaveAttribute('href',watchUrl(1));expect(state.unlocks()).toHaveLength(1);state.clean();
});

test('a WebKit native-fullscreen API stub exits when the next selection is locked',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true});Object.defineProperty(document,'webkitFullscreenEnabled',{value:false,configurable:true});Object.defineProperty(Element.prototype,'requestFullscreen',{value:undefined,configurable:true});
    (window as any).nativeFullscreenCalls=[];Object.defineProperty(HTMLVideoElement.prototype,'webkitSupportsFullscreen',{get:()=>true,configurable:true});
    Object.defineProperty(HTMLVideoElement.prototype,'webkitEnterFullscreen',{value:function(){(window as any).nativeFullscreenCalls.push('enter');Object.defineProperty(this,'webkitDisplayingFullscreen',{value:true,writable:true,configurable:true});this.dispatchEvent(new Event('webkitbeginfullscreen'));},configurable:true});
    Object.defineProperty(HTMLVideoElement.prototype,'webkitExitFullscreen',{value:function(){(window as any).nativeFullscreenCalls.push('exit');Object.defineProperty(this,'webkitDisplayingFullscreen',{value:false,writable:true,configurable:true});this.dispatchEvent(new Event('webkitendfullscreen'));},configurable:true});
  });
  const state=await fixture(page);await page.goto(watchUrl(1));await playable(page,1);await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).nativeFullscreenCalls)).toEqual(['enter']);await navigation(page,watchUrl(3));await expect(page.locator('.branded-video').getByRole('heading',{name:'Locked episode',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as any).nativeFullscreenCalls)).toEqual(['enter','exit']);expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();expect(state.unlocks()).toEqual([]);state.clean();
});

test('a prefixed WebKit container-fullscreen API stub targets and exits the branded wrapper',async({page})=>{
  await page.addInitScript(()=>{
    let active:Element|null=null;Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true});Object.defineProperty(document,'webkitFullscreenEnabled',{value:true,configurable:true});Object.defineProperty(document,'webkitFullscreenElement',{get:()=>active,configurable:true});Object.defineProperty(Element.prototype,'requestFullscreen',{value:undefined,configurable:true});Object.defineProperty(Document.prototype,'exitFullscreen',{value:undefined,configurable:true});
    Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{value:function(){active=this;document.dispatchEvent(new Event('webkitfullscreenchange'));},configurable:true});Object.defineProperty(document,'webkitExitFullscreen',{value:()=>{active=null;document.dispatchEvent(new Event('webkitfullscreenchange'));},configurable:true});
  });
  const state=await fixture(page);await page.goto(watchUrl(1));await playable(page,1);await rememberNodes(page);await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(document as any).webkitFullscreenElement===(window as any).watchOriginalWrapper)).toBe(true);await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(document as any).webkitFullscreenElement===null)).toBe(true);await sameNodes(page);expect(state.unlocks()).toEqual([]);state.clean();
});

test('unsupported fullscreen keeps native video controls and explains its disabled fullscreen action',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true});Object.defineProperty(document,'webkitFullscreenEnabled',{value:false,configurable:true});for(const name of ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'])Object.defineProperty(Element.prototype,name,{value:undefined,configurable:true});Object.defineProperty(HTMLVideoElement.prototype,'webkitEnterFullscreen',{value:undefined,configurable:true});});
  const state=await fixture(page);await page.goto(watchUrl(1));const video=await playable(page,1);await expect(video).toHaveAttribute('controls','');await expect(video).toHaveAttribute('controlslist',/nodownload/);await expect(video).not.toHaveAttribute('controlslist',/nofullscreen/);const button=page.locator('.branded-video-fullscreen');await expect(button).toBeVisible();await expect(button).toBeDisabled();await expect(button).toHaveAttribute('title','Fullscreen is unavailable in this browser.');expect(state.unlocks()).toEqual([]);state.clean();
});

test('a changed individual episode price closes confirmation without charging and needs a fresh explicit confirmation',async({page})=>{
  const state=await fixture(page);await page.goto(watchUrl(3));const unlock=page.locator('.watch-locked-gate > button.primary');await unlock.click();let dialog=page.getByRole('dialog');await expect(dialog.locator('.checkout-total')).toContainText('$0.10');expect(state.unlocks()).toEqual([]);state.setPrice(20);await dialog.getByRole('button',{name:/^Confirm ·/}).click();
  await expect(dialog).toHaveCount(0);await expect(page.locator('.toast')).toContainText('Review the updated total before confirming.');await expect(unlock).toContainText('$0.20');expect(state.unlocks().map(write=>write.body)).toEqual([{expected_price_cents:10}]);expect(state.settlements).toEqual([]);expect(state.balance()).toBe(1000000);expect(state.episode(3).unlocked).toBe(false);expect(state.streams).not.toContain(series.id+'-3');
  await unlock.click();dialog=page.getByRole('dialog');await expect(dialog.locator('.checkout-total')).toContainText('$0.20');expect(state.unlocks()).toHaveLength(1);await dialog.getByRole('button',{name:/^Confirm ·/}).click();await expect(dialog).toHaveCount(0);await playable(page,3);expect(state.unlocks().map(write=>write.body)).toEqual([{expected_price_cents:10},{expected_price_cents:20}]);expect(state.settlements).toEqual([{episodeId:series.id+'-3',priceMicros:200000}]);expect(state.balance()).toBe(800000);state.clean();
});

test('both locked-episode actions remain reachable above fullscreen navigation in short landscape',async({page})=>{
  await page.setViewportSize({width:844,height:390});await page.addInitScript(()=>localStorage.setItem('drama-language','de'));const state=await fixture(page);await page.goto(watchUrl(2));const video=await playable(page,2),wrapper=page.locator('.branded-video');await wrapper.locator('.branded-video-fullscreen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('branded-video'))).toBe(true);await video.evaluate(element=>{element.dispatchEvent(new Event('playing'));element.dispatchEvent(new Event('ended'));});await expect(page).toHaveURL(watchUrl(3));const gate=wrapper.locator('.watch-locked-gate');await expect(gate).toBeVisible();await expect(wrapper.locator('.fullscreen-player-controls')).toBeVisible();await renderSettled(page);
  const single=gate.locator(':scope > button.primary'),bundle=gate.locator(':scope > button.secondary');await touchable(single);await touchable(bundle);expect(state.unlocks()).toEqual([]);await single.click();let dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(element=>document.fullscreenElement?.contains(element))).toBe(true);expect(state.unlocks()).toEqual([]);await dialog.locator('.modal-heading button').click();await expect(dialog).toHaveCount(0);
  await touchable(bundle);await bundle.click();dialog=page.getByRole('dialog');await expect(dialog.locator('.series-unlock-dialog')).toBeVisible();expect(await dialog.evaluate(element=>document.fullscreenElement?.contains(element))).toBe(true);await expect(dialog.locator('.series-unlock-total')).toContainText('$0.10');expect(state.unlocks()).toEqual([]);expect(state.settlements).toEqual([]);state.clean();
});
