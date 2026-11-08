import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {localeMessages} from '../../src/i18n';

const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#302044"/><rect width="120" height="120" fill="#ef86c0"/></svg>');
const base={description:'An original drama with a complete publisher-provided synopsis and full artwork.',language:'en',genres:['romance'],themes:[],format:'live-action',creation_type:'human',cover:art,cover_aspect_ratio:'9:16',creator_id:'suggestion-creator',creator_name:'Suggestion Studio',price_cents:30,free_episodes:1,episode_count:2,views:0,saves:0,likes:0,liked:false,status:'published',demo:0,created_at:'2026-11-04T00:00:00Z',taken_down:false};
const first={...base,id:'suggested-first',title:'The first suggested original',first_episode_id:'suggested-first-001',featured:1};
const second={...base,id:'suggested-second',title:'The second suggested original',description:'A different original drama about the promise that changed a family forever.',cover:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#103d45"/><circle cx="600" cy="250" r="150" fill="#ffd16f"/></svg>'),first_episode_id:'suggested-second-001',featured:1};
const popular={...base,id:'popular-unselected',title:'Popular but not selected',first_episode_id:'popular-001',featured:0,views:99999};
const admin={id:'suggestion-admin',name:'Editorial administrator',email:'editor@browser.test',role:'admin',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const stats={stats:{users:2,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]};
const config={brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{}};

async function publicFixture(page:Page,selected=[first,second],locale='en'){
  const writes:string[]=[],errors:string[]=[],queries:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/**',route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.abort();}
    if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:null}});
    if(url.pathname==='/api/config')return route.fulfill({json:config});
    if(url.pathname==='/api/series'){queries.push(url.search);return route.fulfill({json:{series:url.searchParams.get('featured')==='true'?selected:[popular]}});}
    const release=[...selected,popular].find(series=>url.pathname==='/api/series/'+series.id);
    if(release)return route.fulfill({json:{series:release,episodes:[]}});
    return route.abort();
  });
  return{queries,clean:()=>{expect(writes,'A slideshow must not make payment or playback writes').toEqual([]);expect(errors).toEqual([]);}};
}
async function frozenClock(page:Page){await page.clock.install({time:new Date('2026-11-04T00:00:00Z')});await page.clock.pauseAt(new Date('2026-11-04T00:05:00Z'));}
async function settledSwitch(page:Page){await page.clock.runFor(400);await expect(page.locator('section.hero')).toHaveAttribute('data-carousel-phase','idle');}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
async function titleIs(hero:Locator,title:string){await expect(hero.locator('h2')).toHaveText(title);}
async function phoneActions(hero:Locator,compact=false){
  await hero.locator('.hero-buttons').scrollIntoViewIfNeeded();
  const metrics=await hero.evaluate(element=>{
    const box=element.getBoundingClientRect(),copy=element.querySelector('.hero-copy')!,style=getComputedStyle(copy);
    return{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,available:copy.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),buttons:Array.from(element.querySelectorAll('.hero-buttons a')).map(link=>{const rect=link.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,font:parseFloat(getComputedStyle(link).fontSize),clientWidth:link.clientWidth,scrollWidth:link.scrollWidth,clientHeight:link.clientHeight,scrollHeight:link.scrollHeight};})};
  });
  expect(metrics.buttons).toHaveLength(2);
  for(const button of metrics.buttons){
    expect(button.width).toBeGreaterThanOrEqual(44);expect(button.height).toBeGreaterThanOrEqual(44);expect(button.font).toBeGreaterThanOrEqual(13);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth+1);expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight+1);
    expect(button.left).toBeGreaterThanOrEqual(metrics.left-1);expect(button.right).toBeLessThanOrEqual(metrics.right+1);expect(button.top).toBeGreaterThanOrEqual(metrics.top-1);expect(button.bottom).toBeLessThanOrEqual(metrics.bottom+1);
  }
  if(compact){
    expect(Math.abs(metrics.buttons[0].top-metrics.buttons[1].top)).toBeLessThanOrEqual(1);
    if(metrics.width>=340)expect(Math.max(...metrics.buttons.map(button=>button.right))-Math.min(...metrics.buttons.map(button=>button.left))).toBeLessThan(metrics.available-8);
  }
  await hero.locator('.hero-play').click({trial:true});await hero.locator('.hero-details').click({trial:true});
}

async function noPagination(hero:Locator){
  await expect(hero.locator('button')).toHaveCount(0);await expect(hero.locator('.hero-rotation-toggle')).toHaveCount(0);
  await expect(hero.locator('.hero-pagination')).toHaveCount(0);
  await expect(hero.getByRole('button',{name:'Previous',exact:true})).toHaveCount(0);await expect(hero.getByRole('button',{name:'Next',exact:true})).toHaveCount(0);
  await expect(hero.locator('.lucide-chevron-left,.lucide-chevron-right')).toHaveCount(0);await expect(hero.getByText(/^0[12]\s*\/\s*02$/)).toHaveCount(0);
}
async function activeRelease(hero:Locator,release:typeof first){
  await titleIs(hero,release.title);await expect(hero).toHaveAttribute('aria-label',release.title);await expect(hero.locator('.hero-art img')).toHaveAttribute('src',release.cover);await expect(hero.locator('.hero-synopsis p')).toHaveText(release.description);for(const selector of ['h2 a','.hero-details'])await expect(hero.locator(selector)).toHaveAttribute('href',`/series/${release.id}`);await expect(hero.locator('.hero-play')).toHaveAttribute('href',`/watch/${release.id}/${release.first_episode_id}`);
}

test('selected releases automatically fade artwork and copy together with matching title, synopsis and links and no navigation bar',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');
  await activeRelease(hero,first);await expect(hero.locator('.spotlight')).toHaveText('Suggested by LingYing');await expect(hero).toHaveAttribute('data-autoplay','running');expect(state.queries.some(query=>new URLSearchParams(query).get('featured')==='true')).toBe(true);await noPagination(hero);
  await page.clock.runFor(8000);await expect(hero).toHaveAttribute('data-carousel-phase','out');await activeRelease(hero,first);
  for(const layer of ['.hero-art','.hero-copy']){await expect(hero.locator(layer)).toHaveCSS('transition-property','opacity');await expect(hero.locator(layer)).toHaveCSS('transition-duration','0.28s');await expect(hero.locator(layer)).toHaveAttribute('inert','');await expect(hero.locator(layer)).toHaveAttribute('aria-hidden','true');}
  await expect(hero.getByRole('link',{name:'Watch now',exact:true})).toHaveCount(0);
  const layers=await hero.locator('.hero-art,.hero-copy').evaluateAll(elements=>elements.map(element=>({opacity:Number(getComputedStyle(element).opacity),transition:getComputedStyle(element).transition})));
  expect(Math.abs(layers[0].opacity-layers[1].opacity)).toBeLessThan(.02);expect(layers[0].transition).toBe(layers[1].transition);
  await settledSwitch(page);await activeRelease(hero,second);await expect(hero.locator('.hero-copy')).not.toHaveAttribute('inert','');await noPagination(hero);
  await page.clock.runFor(8400);await activeRelease(hero,first);await expect(hero.locator('h2')).not.toHaveText(popular.title);expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(631);await noOverflow(page);state.clean();
});

test('a pointer resting on artwork or panel background does not stop automatic fading and series changes',async({page})=>{
  await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,first);
  await hero.locator('.hero-art').hover();await expect(hero).toHaveAttribute('data-autoplay','running');
  await page.clock.runFor(8000);await expect(hero).toHaveAttribute('data-carousel-phase','out');await settledSwitch(page);await activeRelease(hero,second);
  await expect(hero).toHaveAttribute('data-autoplay','running');
  await hero.locator('.hero-copy').hover({position:{x:5,y:5}});await expect(hero).toHaveAttribute('data-autoplay','running');
  await page.clock.runFor(8400);await activeRelease(hero,first);await noPagination(hero);state.clean();
});

test('hovering actions or the synopsis, keyboard reading and hidden tabs pause changes until interaction ends',async({page})=>{
  await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');await titleIs(hero,first.title);
  for(const selector of ['h2 a','.hero-play','.hero-details','.hero-synopsis']){
    await hero.locator(selector).hover();await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await activeRelease(hero,first);await page.mouse.move(0,0);
  }
  await hero.locator('h2 a').focus();await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await activeRelease(hero,first);await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur());
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await activeRelease(hero,first);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(hero).toHaveAttribute('data-autoplay','running');await page.clock.runFor(8400);await activeRelease(hero,second);await noPagination(hero);state.clean();
});

test('interaction during fade cancels the swap before artwork or action links can change under the reader',async({page})=>{
  await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,first);await page.clock.runFor(8000);await expect(hero).toHaveAttribute('data-carousel-phase','out');
  const action=(await hero.locator('.hero-play').boundingBox())!;await page.mouse.move(action.x+action.width/2,action.y+action.height/2);
  await expect(hero).toHaveAttribute('data-carousel-phase','idle');await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await activeRelease(hero,first);await page.mouse.move(0,0);await page.clock.runFor(8400);await activeRelease(hero,second);state.clean();
});

test('reduced motion keeps suggested releases static without slideshow controls or transitions',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,first);await expect(hero.getByRole('button')).toHaveCount(0);await noPagination(hero);await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(30000);await activeRelease(hero,first);await expect(hero).toHaveAttribute('data-carousel-phase','idle');for(const selector of ['.hero-art','.hero-copy'])await expect(hero.locator(selector)).toHaveCSS('transition-duration','0s');state.clean();
});

for(const selected of [[],[first]])test(`${selected.length} selected releases remain static without any slideshow controls or footer bar`,async({page})=>{
  await frozenClock(page);const state=await publicFixture(page,selected);await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,selected.length?first:popular);await noPagination(hero);await expect(hero.getByRole('button')).toHaveCount(0);await page.clock.runFor(30000);await activeRelease(hero,selected.length?first:popular);if(!selected.length)await expect(hero.locator('.spotlight')).toHaveText('Fresh off the reel');state.clean();
});

for(const size of [{name:'desktop',width:1440,height:900,portrait:false,locale:'en'},{name:'narrow phone',width:320,height:568,portrait:true,locale:'en'},{name:'Traditional Chinese phone',width:390,height:844,portrait:true,locale:'zh-TW'},{name:'short landscape',width:844,height:390,portrait:false,locale:'en'}])test(`automatic hero fills its ${size.name} grid without a blank navigation footer and stays below 70% height`,async({page})=>{
  await page.setViewportSize({width:size.width,height:size.height});await frozenClock(page);const state=await publicFixture(page,[first,second],size.locale);await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,first);await noPagination(hero);await page.evaluate(()=>document.fonts.ready);
  const bounds=await hero.evaluate(element=>{const hero=element.getBoundingClientRect(),art=element.querySelector('.hero-art')!.getBoundingClientRect(),copy=element.querySelector('.hero-copy')!.getBoundingClientRect();return{hero:{top:hero.top,bottom:hero.bottom,height:hero.height},art:{top:art.top,bottom:art.bottom},copy:{top:copy.top,bottom:copy.bottom},rows:getComputedStyle(element).gridTemplateRows.split(' ').filter(Boolean).length};});
  expect(bounds.hero.height).toBeLessThanOrEqual(size.height*.7+1);expect(bounds.rows).toBe(size.portrait?2:1);expect(Math.abs((size.portrait?bounds.copy.bottom:bounds.art.bottom)-bounds.hero.bottom)).toBeLessThanOrEqual(2);await expect(hero.locator('.hero-art img')).toHaveCSS('object-fit','contain');await expect(hero.locator('.hero-art img')).toHaveCSS('transform','none');await noOverflow(page);state.clean();
  if(size.portrait)await phoneActions(hero,true);
  if(size.name!=='short landscape'){await page.route('**/api/series?featured=true',route=>route.fulfill({json:{series:[{...first,cover:'/images/hero.jpg'},second]}}));await page.reload();await expect(hero.locator('.hero-art img')).toHaveAttribute('src','/images/hero.jpg');await hero.locator('.hero-art img').evaluate((image:HTMLImageElement)=>image.decode());await mkdir('/workspace/exports',{recursive:true});await hero.screenshot({path:`/workspace/exports/lingying-hero-fade-${size.portrait?'mobile':'desktop'}.png`});state.clean();}
});

test.describe('Traditional Chinese touch layout',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('holding artwork pauses suggestions and releasing or cancelling touch resumes without a play control',async({page})=>{
    await frozenClock(page);const state=await publicFixture(page,[first,second],'zh-TW');await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,first);await expect(hero.locator('.spotlight')).toHaveText('靈映推薦');await noPagination(hero);
    const input=await page.context().newCDPSession(page);let active=first;
    try{
      for(const release of ['touchEnd','touchCancel'] as const){
        const box=(await hero.locator('.hero-art').boundingBox())!;await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await activeRelease(hero,active);
        await input.send('Input.dispatchTouchEvent',{type:release,touchPoints:[]});await expect(hero).toHaveAttribute('data-autoplay','running');await page.clock.runFor(8400);active=active.id===first.id?second:first;await activeRelease(hero,active);
      }
      await hero.locator('.hero-synopsis').tap();await expect(hero.locator('.hero-synopsis')).toBeFocused();await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await activeRelease(hero,active);await page.locator('.header-language').focus();await expect(hero).toHaveAttribute('data-autoplay','running');await page.clock.runFor(8400);await activeRelease(hero,second);
      await noPagination(hero);await expect(hero.locator('.hero-art img')).toHaveCSS('object-fit','contain');expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(844*.7+1);await noOverflow(page);state.clean();
      await phoneActions(hero,true);await hero.locator('.hero-details').tap();await expect(page).toHaveURL('/series/'+second.id);await expect(page.getByRole('heading',{level:1,name:second.title,exact:true})).toBeVisible();state.clean();
    }finally{await input.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}).catch(()=>{});await input.detach();}
  });
});

test('long German action labels remain readable and tappable on a narrow phone',async({page})=>{
  await page.setViewportSize({width:320,height:740});await frozenClock(page);const state=await publicFixture(page,[first],'de');await page.goto('/');const hero=page.locator('section.hero');await activeRelease(hero,first);await page.evaluate(()=>document.fonts.ready);
  await expect(hero.locator('.hero-play')).toHaveText(localeMessages.de.watchNow!);await expect(hero.locator('.hero-details')).toHaveText(localeMessages.de.aboutSeries!);await phoneActions(hero);await noOverflow(page);state.clean();
});

async function adminFixture(page:Page){
  let rows=[{...first,featured:0},{...base,id:'suggest-draft',title:'Unpublished draft',featured:0,status:'draft'},{...base,id:'suggest-empty',title:'Empty release',featured:0,episode_count:0},{...base,id:'suggest-offline',title:'Hidden previous suggestion',featured:1,taken_down:true}];
  const writes:{path:string;body:any}[]=[],unexpected:string[]=[],errors:string[]=[];let listReads=0,reply:'success'|'error'|'malformed'='success',gate:Promise<void>|null=null;
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET'){
      if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:admin}});if(url.pathname==='/api/config')return route.fulfill({json:config});if(url.pathname==='/api/admin')return route.fulfill({json:stats});
      if(url.pathname==='/api/admin/series'){listReads++;return route.fulfill({json:{series:rows,total:rows.length,page:1,limit:20}});}
    }
    if(request.method()==='PUT'&&url.pathname.endsWith('/featured')){const body=request.postDataJSON();writes.push({path:url.pathname,body});if(gate)await gate;if(reply==='error')return route.fulfill({status:500,json:{error:{message:'Suggestion update failed.'}}});if(reply==='malformed')return route.fulfill({json:{featured:body.featured?0:1,alreadyApplied:false}});const id=url.pathname.split('/')[4];rows=rows.map(row=>row.id===id?{...row,featured:body.featured?1:0}:row);return route.fulfill({json:{featured:body.featured?1:0,alreadyApplied:false}});}
    unexpected.push(request.method()+' '+url.pathname);return route.abort();
  });
  return{writes,reads:()=>listReads,setReply:(value:typeof reply)=>{reply=value;},setGate:(value:Promise<void>|null)=>{gate=value;},clean:()=>{expect(unexpected).toEqual([]);expect(errors).toEqual([]);}};
}

test('administrators explicitly select and remove suggestions, wait for acknowledgement and can clear hidden selections',async({page})=>{
  const state=await adminFixture(page);await page.goto('/admin?tab=content');const firstRow=page.locator('.content-admin-row').filter({has:page.getByRole('heading',{name:first.title,exact:true})});const toggle=firstRow.locator('.content-admin-suggestion');await expect(toggle).toHaveAttribute('aria-pressed','false');await expect(toggle).toBeEnabled();
  let release!:()=>void;state.setGate(new Promise<void>(resolve=>{release=resolve;}));await toggle.click();await expect(toggle).toHaveAttribute('aria-busy','true');await expect(toggle).toBeDisabled();await expect(firstRow.locator('.content-admin-suggested')).toHaveCount(0);await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes).toEqual([{path:`/api/admin/series/${first.id}/featured`,body:{featured:true}}]);release();state.setGate(null);
  await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(firstRow.locator('.content-admin-suggested')).toHaveText('Suggested by LingYing');await expect.poll(state.reads).toBeGreaterThanOrEqual(2);await expect(toggle).toBeEnabled();await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');await expect(firstRow.locator('.content-admin-suggested')).toHaveCount(0);
  for(const title of ['Unpublished draft','Empty release'])await expect(page.locator('.content-admin-row').filter({has:page.getByRole('heading',{name:title,exact:true})}).locator('.content-admin-suggestion')).toBeDisabled();
  const hidden=page.locator('.content-admin-row').filter({has:page.getByRole('heading',{name:'Hidden previous suggestion',exact:true})});await expect(hidden.locator('.content-admin-suggestion')).toBeEnabled();await hidden.locator('.content-admin-suggestion').click();await expect(hidden.locator('.content-admin-suggestion')).toHaveAttribute('aria-pressed','false');await expect(hidden.locator('.content-admin-suggested')).toHaveCount(0);state.clean();
});

test('failed or contradictory acknowledgements do not falsely mark an administrator suggestion as saved',async({page})=>{
  const state=await adminFixture(page);await page.goto('/admin?tab=content');const row=page.locator('.content-admin-row').filter({has:page.getByRole('heading',{name:first.title,exact:true})}),toggle=row.locator('.content-admin-suggestion');
  for(const mode of ['error','malformed'] as const){state.setReply(mode);await expect(toggle).toBeEnabled();await toggle.click();await expect(row.locator('.content-admin-suggestion-error')).toBeVisible();await expect(toggle).toHaveAttribute('aria-pressed','false');await expect(row.locator('.content-admin-suggested')).toHaveCount(0);}
  state.setReply('success');await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(row.locator('.content-admin-suggestion-error')).toHaveCount(0);state.clean();
});
