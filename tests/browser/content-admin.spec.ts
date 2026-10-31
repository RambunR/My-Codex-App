import {test,expect,type Page} from '@playwright/test';

const admin={id:'content-owner',name:'Owner account',creator_display_name:'LingYingDrama Offical',email:'owner@browser.test',role:'admin',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};
const otherSeries={id:'content-series',title:'A creator’s published drama',description:'A full synopsis for the content administration browser fixture.',language:'en',genres:['drama'],cover:'/images/placeholder.svg',creator_id:'another-creator',creator_name:'Independent creator',creation_type:'human',price_cents:30,free_episodes:1,episode_count:2,views:7,saves:0,likes:0,liked:false,status:'published',featured:0,created_at:'2026-10-30 12:00:00',taken_down:false};
const stats={stats:{users:2,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]};
type FixtureOptions={viewer?:boolean;takenDown?:boolean;total?:number;held?:boolean;owner?:boolean;withEpisode?:boolean;studioSeries?:boolean};

async function fixture(page:Page,options:FixtureOptions={}){
  const account={...admin,...options.viewer?{role:'viewer'}:{},...options.owner?{id:otherSeries.creator_id,role:'publisher',publisher_active:1}:{},payment_review:!!options.held};
  let current={...otherSeries,taken_down:!!options.takenDown,moderation_reason:options.takenDown?'Rights verification is required.':''};
  const writes:{path:string;method:string;body:Record<string,unknown>|null}[]=[];
  const queries:URLSearchParams[]=[];const reads:string[]=[];const seenWrites:string[]=[];page.on('request',request=>{if(!['GET','HEAD'].includes(request.method())&&new URL(request.url()).pathname.startsWith('/api/'))seenWrites.push(new URL(request.url()).pathname);});
  const events:{id:string;action:string;reason:string;actor_id:string;actor_name:string;created_at:string}[]=[];
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:account}}));
  await page.route('**/api/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true}});});
  await page.route('**/api/admin',route=>route.fulfill({json:stats}));
  await page.route('**/api/studio',route=>route.fulfill({json:{user:account,series:options.studioSeries?[current]:[],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}}));
  await page.route('**/api/admin/series**',async route=>{
    const request=route.request(),url=new URL(request.url());reads.push(url.pathname);
    if(request.method()==='POST'){
      const body=request.postDataJSON();writes.push({path:url.pathname,method:'POST',body});
      current={...current,taken_down:body.action==='takedown',moderation_reason:body.reason};
      events.unshift({id:`audit-${events.length+1}`,action:body.action,reason:body.reason,actor_id:admin.id,actor_name:admin.name,created_at:'2026-10-31 12:00:00'});
      await route.fulfill({json:{taken_down:current.taken_down,reason:body.reason,updated_at:'2026-10-31 12:00:00',alreadyApplied:false}});return;
    }
    if(url.pathname.endsWith('/moderation')){await route.fulfill({json:{events}});return;}
    queries.push(url.searchParams);
    await route.fulfill({json:{series:[current],total:options.total||1,page:Number(url.searchParams.get('page')||1),limit:20}});
  });
  await page.route('**/api/studio/series/**',async route=>{
    const request=route.request(),url=new URL(request.url());reads.push(url.pathname);
    if(request.method()==='PATCH'){
      const body=request.postDataJSON();writes.push({path:url.pathname,method:'PATCH',body});current={...current,...body};await route.fulfill({json:{ok:true}});return;
    }
    await route.fulfill({json:{series:current,episodes:options.withEpisode?[{id:'content-episode',series_id:current.id,title:'Episode for review',number:1,duration:12,bytes:5000,free:true,unlocked:true}]:[],owner_storage:{used_bytes:1024**3,quota_bytes:8*1024**3}}});
  });
  await page.route('**/api/admin/episodes/*/stream',route=>{reads.push(new URL(route.request().url()).pathname);return route.fulfill({status:200,contentType:'video/mp4',body:Buffer.from([0])});});
  // Any accidental payment or public detail read is recorded and prevented.
  await page.route('**/api/payments/**',route=>{writes.push({path:new URL(route.request().url()).pathname,method:route.request().method(),body:null});return route.fulfill({status:400,json:{error:{message:'Payment calls are outside this fixture.'}}});});
  await page.route(`**/api/series/${otherSeries.id}`,route=>{reads.push('PUBLIC_DETAIL_FORBIDDEN');return route.fulfill({status:404,json:{error:{message:'This series is not publicly accessible.'}}});});
  return {writes,queries,reads,events,seenWrites};
}

test('viewers cannot open content administration or trigger its API',async({page})=>{
  const state=await fixture(page,{viewer:true});
  await page.goto('/admin?tab=content');
  await expect(page.getByRole('heading',{name:'403',exact:true})).toBeVisible();
  await expect(page.locator('.content-admin-panel')).toHaveCount(0);
  expect(state.reads).toEqual([]);expect(state.writes).toEqual([]);
});

test('administrator can edit another creator privately and upload own drama without buying a pass',async({page})=>{
  const state=await fixture(page);
  await page.goto('/admin?tab=content');
  const row=page.locator('.content-admin-row');
  await expect(row).toContainText('Independent creator');
  await row.getByRole('link',{name:'Edit details',exact:true}).click();
  await expect(page).toHaveURL(/\/studio\/series\/content-series\?from=admin/);
  await expect(page.locator('#series-title')).toHaveValue(otherSeries.title);
  await expect(page.locator('.editor-storage')).toContainText('1.00 GB / 8.00 GB');
  await page.locator('#series-title').fill('Corrected licensed title');
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({path:'/api/studio/series/content-series',method:'PATCH',body:{title:'Corrected licensed title'}});
  await page.getByRole('button',{name:'Content',exact:true}).click();
  await expect(page).toHaveURL(/\/admin\?tab=content/);
  await page.getByRole('link',{name:'Upload own drama',exact:true}).click();
  await expect(page).toHaveURL(/\/studio\/new\?from=admin/);
  await expect(page.locator('#series-title')).toBeEditable();
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeDisabled();
  await expect(page.getByText('No Creator Pass payment is required for administrators.',{exact:false})).toBeVisible();
  await page.goto('/studio');
  await expect(page.getByRole('link',{name:'New series',exact:true}).first()).toBeVisible();
  await expect(page.locator('.content-admin-upload-note')).toContainText('LingYingDrama Offical');
  expect(state.reads).toContain('/api/studio/series/content-series');
  expect(state.reads).not.toContain('PUBLIC_DETAIL_FORBIDDEN');
  expect(state.writes.filter(write=>write.path.startsWith('/api/payments/'))).toEqual([]);
});

test('moderation requires a reason and confirmation, retains the series, and records restoration',async({page})=>{
  const state=await fixture(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/admin?tab=content');
  await page.locator('.content-admin-row').getByRole('button',{name:'Take down',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Take down',exact:true});
  const submit=dialog.getByRole('button',{name:'Take down',exact:true});
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Reason',{exact:true}).fill('Too short');
  await dialog.getByRole('checkbox').check();
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Reason',{exact:true}).fill('Rights owner reported an unauthorized upload.');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(dialog).toContainText('Purchases, payment records and stored files are retained for review.');
  await submit.click();
  await expect(dialog).toHaveCount(0);
  const row=page.locator('.content-admin-row');
  await expect(row).toContainText('Taken down');
  await expect(row).toContainText('Rights owner reported an unauthorized upload.');
  expect(state.writes).toEqual([{path:'/api/admin/series/content-series/moderation',method:'POST',body:{action:'takedown',reason:'Rights owner reported an unauthorized upload.'}}]);
  await row.getByRole('button',{name:'Restore',exact:true}).click();
  const restoreDialog=page.getByRole('dialog',{name:'Restore',exact:true});
  await expect(restoreDialog.locator('.content-admin-history')).toContainText('Rights owner reported an unauthorized upload.');
  await restoreDialog.getByLabel('Reason',{exact:true}).fill('The rights owner supplied a valid distribution license.');
  await restoreDialog.getByRole('checkbox').check();
  await restoreDialog.getByRole('button',{name:'Restore',exact:true}).click();
  await expect(restoreDialog).toHaveCount(0);
  await expect(row).toContainText('Published');
  await expect(row).not.toContainText('Taken down');
  await row.getByRole('button',{name:'Moderation history',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.content-admin-history li')).toHaveCount(2);
  expect(state.events.map(event=>event.action)).toEqual(['restore','takedown']);
  expect(state.writes.every(write=>write.method==='POST'&&write.path.endsWith('/moderation'))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('search, publication filters and pagination use the administrative list contract',async({page})=>{
  const state=await fixture(page,{total:21});
  await page.goto('/admin?tab=content');
  await expect(page.locator('.content-admin-pagination')).toContainText('Page 1 / 2');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.content-admin-pagination')).toContainText('Page 2 / 2');
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.getByLabel('Content status',{exact:true}).selectOption('taken_down');
  await expect.poll(()=>state.queries.at(-1)?.get('status')).toBe('taken_down');
  await expect(page.locator('.content-admin-pagination')).toContainText('Page 1 / 2');
  await page.getByRole('textbox',{name:'Search title or creator',exact:true}).fill('  Independent creator  ');
  await page.getByRole('search').getByRole('button',{name:'Search',exact:true}).click();
  await expect.poll(()=>state.queries.at(-1)?.get('q')).toBe('Independent creator');
  expect(state.queries.at(-1)?.get('limit')).toBe('20');
  expect(state.writes).toEqual([]);
});

test('taken-down editor requires restoration before publishing while allowing admin metadata fixes',async({page})=>{
  const state=await fixture(page,{takenDown:true});
  await page.goto('/studio/series/content-series?from=admin');
  await expect(page.locator('.content-admin-editor-notice')).toContainText('An administrator must restore it before it can be published again.');
  await expect(page.getByRole('button',{name:'Publish series',exact:true})).toBeDisabled();
  await expect(page.getByRole('link',{name:'Watch',exact:true})).toHaveCount(0);
  await expect(page.locator('#series-title')).toBeEditable();
  await page.locator('#series-title').fill('Corrected series awaiting restoration');
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0].method).toBe('PATCH');
  expect(state.reads).not.toContain('PUBLIC_DETAIL_FORBIDDEN');
});

test('taken-down creator can inspect private details but cannot alter moderation or upload',async({page})=>{
  const state=await fixture(page,{takenDown:true,owner:true,withEpisode:true});
  await page.goto('/studio/series/content-series');
  await expect(page.locator('#series-title')).toHaveValue(otherSeries.title);
  await expect(page.locator('#series-title')).toBeDisabled();
  await expect(page.getByRole('button',{name:'Private preview: Episode for review',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save details',exact:true}).first()).toBeDisabled();
  await expect(page.getByRole('button',{name:'Publish series',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeDisabled();
  expect(state.writes).toEqual([]);
});

test('administrator pass exemption preserves the payment account review hold',async({page})=>{
  const state=await fixture(page,{held:true});
  await page.goto('/admin?tab=content');
  await expect(page.getByRole('button',{name:'Upload own drama',exact:true})).toBeDisabled();
  await page.goto('/studio/new?from=admin');
  await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();
  await expect(page.locator('#series-title')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});


test('offline episodes use an authenticated private admin preview without viewer analytics',async({page})=>{
  const state=await fixture(page,{takenDown:true,withEpisode:true,studioSeries:true});
  await page.goto('/studio');
  await expect(page.locator('.studio-series-row')).toContainText('Taken down');
  await expect(page.locator('.studio-series-row').getByRole('link',{name:'Watch',exact:true})).toHaveCount(0);
  await page.goto('/studio/series/content-series?from=admin');
  await page.getByRole('button',{name:'Private preview: Episode for review',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Private preview',exact:true});
  await expect(dialog).toContainText('This does not publish the series or count as a viewer play.');
  const video=dialog.locator('video');
  await expect(video).toHaveAttribute('src','/api/admin/episodes/content-episode/stream');
  await expect(video).toHaveAttribute('preload','none');
  await video.evaluate(element=>{const media=element as HTMLVideoElement;media.muted=true;void media.play().catch(()=>{});});
  await expect.poll(()=>state.reads).toContain('/api/admin/episodes/content-episode/stream');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('video')).toHaveCount(0);
  expect(state.reads).not.toContain('PUBLIC_DETAIL_FORBIDDEN');
  expect(state.seenWrites).toEqual([]);
});
