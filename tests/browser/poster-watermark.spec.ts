import {test,expect,type Locator,type Page} from '@playwright/test';

const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="white"/><rect width="120" height="120" fill="red"/><rect x="680" y="330" width="120" height="120" fill="yellow"/></svg>');
const account={id:'poster-owner',name:'Cover Studio',email:'cover-studio@browser.test',role:'admin',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,storage_unlimited:true,language:'en',payment_review:false};
const series={id:'poster-original',title:'A whole original cover',description:'The complete publisher artwork stays intact while LingYing displays a separate decorative brand mark.',language:'en',genres:['romance'],themes:[],format:'live-action',creation_type:'ai-assisted',cover:art,cover_aspect_ratio:'9:16',creator_id:account.id,creator_name:account.name,publisher_id:'poster-public-publisher',publisher_profile_id:null,price_cents:10,free_episodes:0,episode_count:1,first_episode_id:'poster-episode',views:1,saves:0,likes:0,liked:false,status:'published',featured:1,demo:0,created_at:'2026-11-04T00:00:00Z',taken_down:false};
const episode={id:'poster-episode',series_id:series.id,title:'Episode 001',number:1,duration:60,bytes:1024,views:0,free:false,unlocked:false};
const config={brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{activationHkd:88}};
const stats={stats:{users:1,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]};

async function covers(page:Page,locale='en'){
  const writes:string[]=[],unexpected:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/**',route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.abort();}
    if(path==='/api/auth/me')return route.fulfill({json:{user:account}});if(path==='/api/config')return route.fulfill({json:config});
    if(path==='/api/display-currency')return route.fulfill({json:{quote:{country:null,currency:'HKD',ratePerHkd:1,asOf:null}}});
    if(path==='/api/series')return route.fulfill({json:{series:[series]}});
    if(path==='/api/series/'+series.id||path==='/api/studio/series/'+series.id)return route.fulfill({json:{series,episodes:[episode],episodes_revision:'poster-fixture',owner_storage:{used_bytes:0,quota_bytes:5*1024**3,storage_unlimited:true}}});
    if(path==='/api/history')return route.fulfill({json:{history:[{...series,episode_id:episode.id,episode_number:1,seconds:10,duration:60}]}});
    if(path==='/api/studio')return route.fulfill({json:{user:account,series:[series],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}});
    if(path==='/api/admin')return route.fulfill({json:stats});if(path==='/api/admin/series')return route.fulfill({json:{series:[series],total:1,page:1,limit:20}});if(path==='/api/admin/publishers')return route.fulfill({json:{publishers:[]}});
    if(path==='/api/publishers/'+series.publisher_id)return route.fulfill({json:{publisher:{id:series.publisher_id,display_name:account.name,registered_at:'2026-01-01',managed:true,is_official:false},stats:{series_count:1,episode_count:1,views:1,likes:0,total_watch_seconds:0,avg_watch_seconds:0},series:[series],pagination:{page:1,page_size:24,total:1,total_pages:1}}});
    unexpected.push(path);return route.abort();
  });
  return()=>{expect(writes,'Poster presentation must not write uploads, analytics or payments').toEqual([]);expect(unexpected).toEqual([]);expect(errors).toEqual([]);};
}
async function wholeMarkedFrame(frame:Locator,{thumbnail=false}:{thumbnail?:boolean}={}){
  await expect(frame).toBeVisible();const image=frame.locator('img.cover-artwork-image'),mark=frame.locator('.cover-watermark');await expect(image).toHaveCount(1);await expect(mark).toHaveCount(1);await expect(mark).toBeVisible();await expect(mark).toHaveAttribute('aria-hidden','true');await expect(mark).toHaveCSS('opacity','0.6');await expect(mark).toHaveCSS('pointer-events','none');await expect(image).toHaveCSS('object-fit','contain');await expect(image).toHaveCSS('object-position','50% 50%');await expect(image).toHaveCSS('transform','none');await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>[element.naturalWidth,element.naturalHeight])).toEqual([800,450]);
  const style=await mark.evaluate(element=>({background:getComputedStyle(element).backgroundImage,position:getComputedStyle(element).position,tabIndex:(element as HTMLElement).tabIndex}));expect(style.background).toContain('brand-mark.png?v=lingying-phoenix-05-v1');expect(style.position).toBe('absolute');expect(style.tabIndex).toBe(-1);
  const box=(await frame.boundingBox())!,icon=(await mark.boundingBox())!;expect(icon.x).toBeGreaterThanOrEqual(box.x);expect(icon.y).toBeGreaterThanOrEqual(box.y);expect(icon.x+icon.width).toBeLessThanOrEqual(box.x+box.width+1);expect(icon.y+icon.height).toBeLessThanOrEqual(box.y+box.height+1);const inset=thumbnail?3:8;expect(Math.abs(box.x+box.width-icon.x-icon.width-inset)).toBeLessThanOrEqual(2);expect(Math.abs(icon.y-box.y-inset)).toBeLessThanOrEqual(2);
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

for(const[locale,width]of [['en',1440],['zh-TW',390],['ar',320]]as const)test(`poster branding stays top-right and clear of accessible save controls at ${width}px ${locale}`,async({page})=>{
  await page.setViewportSize({width,height:900});const clean=await covers(page,locale);await page.goto('/browse');await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');const card=page.locator('.series-card').first(),poster=card.locator('.poster'),mark=poster.locator('.cover-watermark'),save=card.locator('.poster-save');await wholeMarkedFrame(poster);
  const icon=(await mark.boundingBox())!,button=(await save.boundingBox())!;expect(button.width).toBeGreaterThanOrEqual(44);expect(button.height).toBeGreaterThanOrEqual(44);const intersects=button.x<icon.x+icon.width&&button.x+button.width>icon.x&&button.y<icon.y+icon.height&&button.y+button.height>icon.y;expect(intersects,'The save control must not cover the requested icon').toBe(false);await save.click({trial:true});
  const frame=(await poster.boundingBox())!;await card.locator('.poster-link').click({position:{x:frame.width-16,y:16}});await expect(page).toHaveURL('/series/'+series.id);await wholeMarkedFrame(page.locator('.detail-cover'));await noOverflow(page);clean();
});

test('hero, rankings, history, publisher cards and private studio covers use the same separate icon layer',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});const clean=await covers(page);const icon=await page.request.get('/brand-mark.png?v=lingying-phoenix-05-v1');expect(icon.status()).toBe(200);
  await page.goto('/');await wholeMarkedFrame(page.locator('.hero-art'));await wholeMarkedFrame(page.locator('.continue-card>.cover-thumbnail'),{thumbnail:true});await noOverflow(page);
  await page.goto('/rankings');await wholeMarkedFrame(page.locator('.ranking-row>.cover-thumbnail'),{thumbnail:true});await noOverflow(page);
  await page.goto('/library?tab=history');await wholeMarkedFrame(page.locator('.series-card .poster').first());
  await page.goto('/publishers/'+series.publisher_id);await wholeMarkedFrame(page.locator('.publisher-public-series .poster').first());
  await page.goto('/studio');await wholeMarkedFrame(page.locator('.studio-series-image'),{thumbnail:true});
  await page.goto('/admin?tab=content');await wholeMarkedFrame(page.locator('.content-admin-row>.cover-thumbnail'),{thumbnail:true});
  await page.goto('/studio/series/'+series.id);await wholeMarkedFrame(page.locator('.cover-artwork-editor-frame'));await noOverflow(page);clean();
});

test('a paid episode cover and unlock preview stay branded without creating a payment',async({page})=>{
  const clean=await covers(page);await page.goto(`/watch/${series.id}/${episode.id}`);await expect(page.locator('.player-lock')).toBeVisible();const mark=page.locator('.video-player>.cover-watermark');await expect(mark).toBeVisible();await expect(mark).toHaveCSS('opacity','0.6');await expect(mark).toHaveCSS('pointer-events','none');await page.locator('.player-lock').getByRole('button').click();await wholeMarkedFrame(page.locator('.unlock-preview>.cover-thumbnail'),{thumbnail:true});await noOverflow(page);clean();
});
