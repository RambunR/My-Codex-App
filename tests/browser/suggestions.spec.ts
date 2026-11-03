import {test,expect,type Page,type Locator} from '@playwright/test';

const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#302044"/><rect width="120" height="120" fill="#ef86c0"/></svg>');
const base={description:'An original drama with a complete publisher-provided synopsis and full artwork.',language:'en',genres:['romance'],themes:[],format:'live-action',creation_type:'human',cover:art,cover_aspect_ratio:'9:16',creator_id:'suggestion-creator',creator_name:'Suggestion Studio',price_cents:30,free_episodes:1,episode_count:2,views:0,saves:0,likes:0,liked:false,status:'published',demo:0,created_at:'2026-11-04T00:00:00Z',taken_down:false};
const first={...base,id:'suggested-first',title:'The first suggested original',first_episode_id:'suggested-first-001',featured:1};
const second={...base,id:'suggested-second',title:'The second suggested original',first_episode_id:'suggested-second-001',featured:1};
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
    return route.abort();
  });
  return{queries,clean:()=>{expect(writes,'A slideshow must not make payment or playback writes').toEqual([]);expect(errors).toEqual([]);}};
}
async function frozenClock(page:Page){await page.clock.install({time:new Date('2026-11-04T00:00:00Z')});await page.clock.pauseAt(new Date('2026-11-04T00:05:00Z'));}
async function settledSwitch(page:Page){await page.clock.runFor(400);await expect(page.locator('section.hero')).toHaveAttribute('data-carousel-phase','idle');}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
async function titleIs(hero:Locator,title:string){await expect(hero.locator('h2')).toHaveText(title);}

test('only selected releases rotate with a fade and matching active artwork, description and links',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await frozenClock(page);const state=await publicFixture(page);await page.goto('/');
  const hero=page.locator('section.hero');await titleIs(hero,first.title);await expect(hero.locator('.spotlight')).toHaveText('Suggested by LingYing');await expect(hero).toHaveAttribute('data-autoplay','running');expect(state.queries.some(query=>new URLSearchParams(query).get('featured')==='true')).toBe(true);
  await expect(hero.locator('.hero-play')).toHaveAttribute('href',`/watch/${first.id}/${first.first_episode_id}`);
  await page.clock.runFor(8000);await expect(hero).toHaveAttribute('data-carousel-phase','out');await titleIs(hero,first.title);await expect(hero.locator('.hero-art')).toHaveCSS('transition-property','opacity');await expect(hero.getByRole('link',{name:'Watch now',exact:true})).toHaveCount(0);
  await settledSwitch(page);await titleIs(hero,second.title);await expect(hero.locator('.hero-details')).toHaveAttribute('href',`/series/${second.id}`);await expect(hero.locator('.hero-play')).toHaveAttribute('href',`/watch/${second.id}/${second.first_episode_id}`);await expect(hero.locator('.hero-synopsis p')).toHaveText(second.description);await expect(hero.locator('.hero-pagination [aria-current="true"]')).toHaveAttribute('title',second.title);
  await page.clock.runFor(8400);await titleIs(hero,first.title);await expect(hero.locator('h2')).not.toHaveText(popular.title);
  await hero.getByRole('button',{name:'Next',exact:true}).click();await settledSwitch(page);await titleIs(hero,second.title);await hero.getByRole('button',{name:'Previous',exact:true}).click();await settledSwitch(page);await titleIs(hero,first.title);
  expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(631);await noOverflow(page);state.clean();
});

test('reading, hidden tabs and the explicit pause control stop automatic changes',async({page})=>{
  await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');await titleIs(hero,first.title);
  await hero.hover();await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await titleIs(hero,first.title);await page.mouse.move(0,0);
  await hero.locator('h2 a').focus();await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await titleIs(hero,first.title);await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur());
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await titleIs(hero,first.title);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await hero.getByRole('button',{name:'Pause slideshow',exact:true}).click();await expect(hero.getByRole('button',{name:'Resume slideshow',exact:true})).toHaveAttribute('aria-pressed','true');await page.mouse.move(0,0);await page.clock.runFor(20000);await titleIs(hero,first.title);
  await hero.getByRole('button',{name:'Resume slideshow',exact:true}).click();await expect(hero).toHaveAttribute('data-autoplay','running');await page.mouse.move(0,0);await page.clock.runFor(8400);await titleIs(hero,second.title);state.clean();
});

test('reduced motion keeps suggestions still and manual navigation switches instantly',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await frozenClock(page);const state=await publicFixture(page);await page.goto('/');const hero=page.locator('section.hero');await titleIs(hero,first.title);await expect(hero.locator('.hero-rotation-toggle')).toHaveCount(0);await page.clock.runFor(30000);await titleIs(hero,first.title);
  await hero.getByRole('button',{name:'Next',exact:true}).click();await titleIs(hero,second.title);await expect(hero).toHaveAttribute('data-carousel-phase','idle');await expect(hero.locator('.hero-art')).toHaveCSS('transition-duration','0s');state.clean();
});

for(const selected of [[],[first]])test(`${selected.length} selected releases remain static without unnecessary slideshow controls`,async({page})=>{
  await frozenClock(page);const state=await publicFixture(page,selected);await page.goto('/');const hero=page.locator('section.hero');await titleIs(hero,selected.length?first.title:popular.title);await expect(hero.locator('.hero-pagination')).toHaveCount(0);await page.clock.runFor(30000);await titleIs(hero,selected.length?first.title:popular.title);if(!selected.length)await expect(hero.locator('.spotlight')).toHaveText('Fresh off the reel');state.clean();
});

test.describe('Traditional Chinese touch layout',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('touching a suggestion pauses rotation while manual controls and full artwork remain available',async({page})=>{
    await frozenClock(page);const state=await publicFixture(page,[first,second],'zh-TW');await page.goto('/');const hero=page.locator('section.hero');await titleIs(hero,first.title);await expect(hero.locator('.spotlight')).toHaveText('靈映推薦');await hero.locator('.hero-story-meta').tap();await expect(hero).toHaveAttribute('data-autoplay','paused');await page.clock.runFor(20000);await titleIs(hero,first.title);
    const next=hero.getByRole('button',{name:'下一集',exact:true});const fallback=hero.locator('.hero-pagination>button').last();const control=await next.count()?next:fallback;const box=(await control.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);await control.tap();await settledSwitch(page);await titleIs(hero,second.title);await expect(hero.locator('.hero-art img')).toHaveCSS('object-fit','contain');expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(844*.7+1);await noOverflow(page);state.clean();
  });
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
