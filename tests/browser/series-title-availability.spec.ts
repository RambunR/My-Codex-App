import {test,expect,type Page,type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {demoAdminSession} from './helpers/admin-session';

const details=(title:string)=>({title,description:'An original story whose details must survive a duplicate-title refusal.',language:'en',genres:['drama'],creation_type:'human',price_cents:30,free_episodes:1});
const saveButton=(page:Page)=>page.getByRole('button',{name:'Save details',exact:true}).first();
const titleStatus=(page:Page)=>page.locator('#series-title-availability');
async function fillDetails(page:Page,title:string){
  await page.locator('#series-title').fill(title);
  await page.locator('#series-description').fill(details(title).description);
}
async function linkedTitleError(page:Page){
  const input=page.locator('#series-title');await expect(input).toHaveAttribute('aria-invalid','true');
  const text=await input.evaluate(element=>[element.getAttribute('aria-describedby'),element.getAttribute('aria-errormessage')].filter(Boolean).join(' ').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' '));
  expect(text).toMatch(/already in use|different title/i);
}

test('a normalized duplicate is refused before saving, preserves the selected cover, and recovers through a real save and edit',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  await demoAdminSession(page);
  const suffix=randomUUID().slice(0,12),reserved=`Reserved Drama ${suffix}`;
  const seed=await page.request.post('/api/studio/series',{data:details(reserved)});expect(seed.status()).toBe(201);
  const creates:unknown[]=[],patches:unknown[]=[];
  page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(pathname==='/api/studio/series'&&request.method()==='POST')creates.push(request.postDataJSON());if(/^\/api\/studio\/series\/[^/]+$/.test(pathname)&&request.method()==='PATCH')patches.push(request.postDataJSON());});
  await page.goto('/studio/new');
  const duplicate=`  Ｒｅｓｅｒｖｅｄ   DRAMA ${suffix.toUpperCase()}  `;
  await fillDetails(page,duplicate);
  await page.locator('.cover-panel input[type="file"]').setInputFiles('public/images/midnight.jpg');
  const coverPreview=page.locator('.cover-artwork-editor-frame img');await expect(coverPreview).toHaveAttribute('src',/^blob:/);const selectedCoverUrl=await coverPreview.getAttribute('src');
  await expect(titleStatus(page)).toHaveAttribute('data-status','duplicate');
  await saveButton(page).click();await linkedTitleError(page);
  expect(creates).toHaveLength(0);await expect(page.locator('#series-title')).toHaveValue(duplicate);await expect(page.locator('#series-description')).toHaveValue(details(reserved).description);
  await expect(coverPreview).toHaveAttribute('src',selectedCoverUrl!);

  const unique=`A Different Drama ${suffix}`;await page.locator('#series-title').fill(unique);
  await expect(titleStatus(page)).toHaveAttribute('data-status','available');
  const createdResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/studio/series');
  const coverResponse=page.waitForResponse(response=>response.request().method()==='POST'&&/^\/api\/studio\/series\/[^/]+\/cover$/.test(new URL(response.url()).pathname));
  await saveButton(page).click();const response=await createdResponse;expect(response.status()).toBe(201);const{id}=await response.json();
  const uploadedCover=await coverResponse;expect(uploadedCover.status()).toBe(200);
  await expect(page).toHaveURL(`/studio/series/${id}`);await expect(page.locator('#series-title')).toHaveValue(unique);expect(creates).toHaveLength(1);
  const saved=await(await page.request.get(`/api/studio/series/${id}`)).json();expect(saved.series.title).toBe(unique);expect(saved.series.cover).toContain(`/api/studio/series/${id}/cover`);
  const persistedCover=await page.request.get(saved.series.cover);expect(persistedCover.status()).toBe(200);expect(persistedCover.headers()['content-type']).toMatch(/^image\//);
  // The upload is intentionally transcoded to WebP. Decode the persisted
  // image to verify the retained file, rather than compare lossy image bytes.
  const sourceCover=await sharp('public/images/midnight.jpg').metadata(),{info:persistedCoverInfo}=await sharp(await persistedCover.body()).raw().toBuffer({resolveWithObject:true});
  expect(sourceCover.width).toBeLessThanOrEqual(1000);expect(sourceCover.height).toBeLessThanOrEqual(1500);
  expect([persistedCoverInfo.width,persistedCoverInfo.height]).toEqual([sourceCover.width,sourceCover.height]);

  // Keeping this series' own name is valid while other metadata changes.
  const synopsis='A revised synopsis with the same title, cover and ownership.';await page.locator('#series-description').fill(synopsis);
  const editedResponse=page.waitForResponse(value=>value.request().method()==='PATCH'&&new URL(value.url()).pathname===`/api/studio/series/${id}`);
  await saveButton(page).click();expect((await editedResponse).status()).toBe(200);expect(patches).toHaveLength(1);
  expect((await(await page.request.get(`/api/studio/series/${id}`)).json()).series.description).toBe(synopsis);

  // Renaming an existing series cannot take another draft's reserved title.
  await page.locator('#series-title').fill(reserved.toUpperCase());await expect(titleStatus(page)).toHaveAttribute('data-status','duplicate');
  await saveButton(page).click();await linkedTitleError(page);expect(patches).toHaveLength(1);
  const unchanged=(await(await page.request.get(`/api/studio/series/${id}`)).json()).series;expect(unchanged.title).toBe(unique);expect(unchanged.description).toBe(synopsis);
});

const fixtureOwner={id:'title-availability-owner',name:'Title Studio',email:'title-owner@browser.test',role:'publisher',publisher_active:1,payment_review:false,wallet_micros:0,earnings_micros:0,used_bytes:0,quota_bytes:10*1024**3,language:'en'};
type FixtureOptions={availability?:(title:string,route:Route)=>Promise<void>;create?:(body:Record<string,any>,route:Route)=>Promise<void>};
async function fixture(page:Page,options:FixtureOptions={}){
  const writes:{method:string;path:string;body:Record<string,any>}[]=[],unexpected:string[]=[],errors:string[]=[];
  let series:Record<string,any>|undefined;
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(request.method()==='GET'){
      if(pathname==='/api/auth/me')return route.fulfill({json:{user:fixtureOwner}});
      if(pathname==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{activationHkd:88},auth:{google:false,apple:false,wechat:false,email:false}}});
      if(pathname==='/api/display-currency')return route.fulfill({json:{quote:{country:null,currency:'HKD',ratePerHkd:1,asOf:null}}});
      if(pathname==='/api/studio/title-availability')return options.availability?options.availability(url.searchParams.get('title')||'',route):route.fulfill({json:{available:true}});
      if(pathname==='/api/studio/series/title-created'&&series)return route.fulfill({json:{series,episodes:[],episodes_revision:'title-fixture',owner_storage:{used_bytes:0,quota_bytes:fixtureOwner.quota_bytes}}});
    }else if(request.method()==='POST'&&pathname==='/api/studio/series'){
      const body=request.postDataJSON();writes.push({method:'POST',path:pathname,body});
      if(options.create)return options.create(body,route);
      series={...body,id:'title-created',creator_id:fixtureOwner.id,creator_name:fixtureOwner.name,status:'draft',cover:'/images/placeholder.svg',cover_aspect_ratio:'9:16',episode_count:0,views:0,likes:0,saves:0,featured:0,created_at:'2026-11-11 00:00:00'};
      return route.fulfill({status:201,json:{id:'title-created'}});
    }
    unexpected.push(request.method()+' '+pathname);return route.abort();
  });
  return{writes,assertClean(){expect(unexpected,'The isolated fixture must intercept every API request').toEqual([]);expect(errors).toEqual([]);}};
}

test('a late duplicate response for an older title cannot overwrite the current title check',async({page})=>{
  let releaseOld!:()=>void,oldSeen!:()=>void,oldServed!:()=>void;
  const oldPending=new Promise<void>(resolve=>{releaseOld=resolve;}),seen=new Promise<void>(resolve=>{oldSeen=resolve;}),served=new Promise<void>(resolve=>{oldServed=resolve;});
  const transportSettled=new Promise<void>(resolve=>{
    const settled=(request:{url:()=>string})=>{
      const url=new URL(request.url());
      if(url.pathname!=='/api/studio/title-availability'||url.searchParams.get('title')!=='Earlier Taken Title')return;
      page.off('requestfinished',settled);page.off('requestfailed',settled);resolve();
    };
    page.on('requestfinished',settled);page.on('requestfailed',settled);
  });
  const state=await fixture(page,{availability:async(title,route)=>{
    if(title==='Earlier Taken Title'){oldSeen();await oldPending;try{await route.fulfill({json:{available:false}});}catch{/* The obsolete request may already be aborted by the browser. */}finally{oldServed();}return;}
    return route.fulfill({json:{available:true}});
  }});
  await page.goto('/studio/new');await fillDetails(page,'Earlier Taken Title');await seen;
  await page.locator('#series-title').fill('Current Available Title');await expect(titleStatus(page)).toHaveAttribute('data-status','available');
  releaseOld();await served;await transportSettled;
  // Assert only after the obsolete transport has completed or been cancelled
  // and the browser has had a render opportunity to process its callback.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.locator('#series-title')).toHaveValue('Current Available Title');await expect(titleStatus(page)).toHaveAttribute('data-status','available');
  expect(state.writes).toHaveLength(0);state.assertClean();
});

test('a title-check failure blocks saving but preserves the form and allows an explicit retry',async({page})=>{
  let reachable=false;
  const state=await fixture(page,{availability:async(_title,route)=>route.fulfill(reachable?{json:{available:true}}:{status:503,json:{error:{code:'UNAVAILABLE',message:'Temporarily unavailable'}}})});
  await page.goto('/studio/new');await fillDetails(page,'A Network Recovery Story');await expect(titleStatus(page)).toHaveAttribute('data-status','error');
  await saveButton(page).click();await expect(titleStatus(page)).toHaveAttribute('data-status','error');await expect(page.locator('#series-title')).toBeFocused();
  expect(state.writes).toHaveLength(0);await expect(page.locator('#series-title')).toHaveValue('A Network Recovery Story');await expect(page.locator('#series-description')).toHaveValue(details('').description);
  reachable=true;await saveButton(page).click();await expect(page).toHaveURL('/studio/series/title-created');expect(state.writes).toHaveLength(1);state.assertClean();
});

test('a server-side title conflict after an available check is shown inline without losing the form',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  const state=await fixture(page,{create:async(_body,route)=>route.fulfill({status:409,json:{error:{code:'SERIES_TITLE_EXISTS',message:'A series with this title already exists. Choose a different title.'}}})});
  await page.goto('/studio/new');await fillDetails(page,'A Concurrent Title Conflict');await expect(titleStatus(page)).toHaveAttribute('data-status','available');
  await saveButton(page).click();await expect(titleStatus(page)).toHaveAttribute('data-status','duplicate');await linkedTitleError(page);await expect(page.locator('#series-title')).toBeFocused();
  await expect(page).toHaveURL('/studio/new');await expect(page.locator('#series-title')).toHaveValue('A Concurrent Title Conflict');await expect(page.locator('#series-description')).toHaveValue(details('').description);
  expect(state.writes).toHaveLength(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);state.assertClean();
});
