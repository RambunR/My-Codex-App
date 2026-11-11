import {test,expect,type Page} from '@playwright/test';
import {demoAdminSession} from './helpers/admin-session';

const administrator={id:'publisher-ui-admin',name:'Platform account',email:'publisher-ui@browser.test',role:'admin',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const administration={stats:{users:2,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]};
const official={id:'official',display_name:'LingYingDrama Offical',registered_at:'2026-10-01',managed:true,is_official:true,series_count:2};
async function json(response:{status:()=>number;json:()=>Promise<unknown>},status=200):Promise<any>{const data=await response.json();expect(response.status(),JSON.stringify(data)).toBe(status);return data;}
async function login(page:Page){return demoAdminSession(page);}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
async function createProfile(page:Page,name:string,date:string){
  await page.getByRole('button',{name:'Create publisher profile',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Create publisher profile',exact:true});
  await dialog.getByRole('textbox',{name:'Public publisher name',exact:true}).fill(name);await dialog.locator('input[type="date"]').fill(date);
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/publishers'&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save profile',exact:true}).click();const body=await json(await saved,201);await expect(dialog).toHaveCount(0);return body.publisher;
}

test('administrator creates and edits separate public profiles without creating login accounts or changing money',async({page})=>{
  const before=await login(page),statsBefore=await json(await page.request.get('/api/admin')),writes:string[]=[];
  page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
  await page.goto('/admin?tab=publishers');await expect(page.locator('.publisher-management')).toBeVisible();
  await expect(page.locator('.publisher-attribution-hint')).toHaveText('Public attribution only. Account access and earnings do not change.');
  const name=`<img src=x onerror=window.publisherInjected=1> ${Date.now()}`;
  const first=await createProfile(page,name,'2023-04-15'),second=await createProfile(page,`Independent channel ${Date.now()}`,'2021-09-03');
  expect(first.id).not.toBe(second.id);const card=page.locator(`[data-publisher-id="${first.id}"]`);await expect(card.locator('h3')).toHaveText(name);await expect(card.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).publisherInjected)).toBeUndefined();
  await expect(card.getByRole('link',{name:'View publisher profile',exact:true})).toHaveAttribute('href',`/publishers/${first.id}`);
  await card.getByRole('button').click();const dialog=page.getByRole('dialog',{name:'Edit publisher profile',exact:true});
  await expect(dialog.getByRole('textbox',{name:'Public publisher name',exact:true})).toHaveValue(name);await expect(dialog.locator('input[type="date"]')).toHaveValue('2023-04-15');
  const updatedName=`Updated public channel ${Date.now()}`;await dialog.getByRole('textbox',{name:'Public publisher name',exact:true}).fill(updatedName);await dialog.locator('input[type="date"]').fill('2020-02-29');
  const update=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/admin/publishers/${first.id}`&&response.request().method()==='PATCH');
  await dialog.getByRole('button',{name:'Save profile',exact:true}).click();await json(await update);await expect(dialog).toHaveCount(0);await expect(card.locator('h3')).toHaveText(updatedName);
  const list=await json(await page.request.get('/api/admin/publishers'));expect(list.publishers.find((profile:any)=>profile.id===first.id)).toMatchObject({display_name:updatedName,registered_at:'2020-02-29'});expect(list.publishers.find((profile:any)=>profile.id===second.id)).toMatchObject({display_name:second.display_name,registered_at:'2021-09-03'});
  const after=(await json(await page.request.get('/api/auth/me'))).user;for(const key of ['id','name','role','publisher_active','wallet_micros','earnings_micros','used_bytes','dramio_pass'])expect(after[key]).toEqual(before[key]);
  expect((await json(await page.request.get('/api/admin'))).stats.users).toBe(statsBefore.stats.users);expect(writes).toEqual(['/api/admin/publishers','/api/admin/publishers',`/api/admin/publishers/${first.id}`]);
});

test('own-series publisher selection defaults to official and changes attribution without changing ownership',async({page})=>{
  const before=await login(page),profile=(await json(await page.request.post('/api/admin/publishers',{data:{display_name:`Publisher selection ${Date.now()}`,registered_at:'2022-08-12'}}),201)).publisher;
  const list=await json(await page.request.get('/api/admin/publishers'));await page.goto('/studio/new');
  const selector=page.getByRole('combobox',{name:'Publisher profile',exact:true});await expect(selector).toHaveValue(list.default_publisher_id);await expect(selector.locator('option:checked')).toContainText('Official profile');
  await page.locator('#series-title').fill(`Default official attribution ${Date.now()}`);await page.locator('#series-description').fill('A new administrator drama with public attribution separate from the account that owns it.');
  const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/series'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save details',exact:true}).first().click();const response=await created,id=(await json(response,201)).id;expect(response.request().postDataJSON()).not.toHaveProperty('publisher_profile_id');
  await expect(page).toHaveURL(`/studio/series/${id}`);await expect(selector).toBeEnabled();await expect(selector).toHaveValue(list.default_publisher_id);
  let stored=await json(await page.request.get(`/api/studio/series/${id}`));expect(stored.series.creator_id).toBe(before.id);expect(stored.series.publisher_id).toBe(list.default_publisher_id);
  await selector.selectOption(profile.id);const patched=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/studio/series/${id}`&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save details',exact:true}).first().click();const patch=await patched;await json(patch);expect(patch.request().postDataJSON().publisher_profile_id).toBe(profile.id);
  stored=await json(await page.request.get(`/api/studio/series/${id}`));expect(stored.series).toMatchObject({creator_id:before.id,publisher_id:profile.id,publisher_profile_id:profile.id,creator_name:profile.display_name});await page.reload();await expect(selector).toHaveValue(profile.id);
  await page.goto('/studio/new');await expect(selector).toBeEnabled();await selector.selectOption(profile.id);await page.locator('#series-title').fill(`Chosen attribution ${Date.now()}`);await page.locator('#series-description').fill('An administrator can also choose a public profile while first creating their own drama series.');
  const second=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/series'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save details',exact:true}).first().click();const secondResponse=await second;await json(secondResponse,201);expect(secondResponse.request().postDataJSON().publisher_profile_id).toBe(profile.id);
  const after=(await json(await page.request.get('/api/auth/me'))).user;for(const key of ['id','name','role','wallet_micros','earnings_micros','used_bytes','dramio_pass'])expect(after[key]).toEqual(before[key]);
});

async function mockEditor(page:Page,role:'admin'|'publisher'){
  const account={...administrator,role},series={id:'profile-editor-series',title:'Independent original drama',description:'A complete synopsis for the publisher attribution permission browser fixture.',language:'en',genres:['drama'],themes:[],format:null,cover:'/images/placeholder.svg',creator_id:role==='admin'?'another-creator':account.id,creator_name:'Independent creator',creation_type:'human',price_cents:10,free_episodes:1,episode_count:0,views:0,saves:0,likes:0,status:'draft',featured:0,created_at:'2026-10-30 12:00:00',publisher_profile_id:null};
  const writes:Record<string,unknown>[]=[],profileReads:string[]=[];
  await page.route('**/api/studio/title-availability**',route=>route.request().method()==='GET'?route.fulfill({json:{available:true}}):route.abort());
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:account}}));await page.route('**/api/admin/publishers',route=>{profileReads.push(route.request().method());return route.fulfill({json:{publishers:[official],default_publisher_id:official.id}});});
  await page.route('**/api/studio/series/profile-editor-series',route=>{if(route.request().method()==='PATCH'){writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}return route.fulfill({json:{series,episodes:[],episodes_revision:'fixture-revision',owner_storage:{used_bytes:0,quota_bytes:5*1024**3}}});});
  return{writes,profileReads};
}
for(const role of ['publisher','admin'] as const)test(`${role==='admin'?'administrator editing another owner':'ordinary creator'} cannot assign managed publisher profiles`,async({page})=>{
  const state=await mockEditor(page,role);await page.goto('/studio/series/profile-editor-series');await expect(page.locator('#series-title')).toBeEditable();await expect(page.locator('.publisher-profile-select')).toHaveCount(0);
  await page.locator('#series-title').fill('Metadata correction only');await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0]).not.toHaveProperty('publisher_profile_id');expect(state.profileReads).toEqual([]);
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`publisher management and public-date editor fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:administrator}}));await page.route('**/api/admin',route=>route.fulfill({json:administration}));
  await page.route('**/api/admin/publishers',route=>route.fulfill({json:{publishers:[official,{...official,id:'long-profile',display_name:'A very long public publisher name — 靈映出版社 神秘故事 창작자',is_official:false}],default_publisher_id:official.id}}));
  await page.goto('/admin?tab=publishers');await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.locator('.publisher-management-card')).toHaveCount(2);await noOverflow(page);
  await page.locator('.publisher-management-heading>.button').click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await dialog.locator('#publisher-profile-name').fill('國際神秘故事出版社 International Drama Channel');await dialog.locator('#publisher-profile-date').fill('2020-02-29');
  for(const input of await dialog.locator('input').all())await expect(input).toHaveCSS('font-size','16px');await noOverflow(page);
  if(locale!=='en')await expect(dialog).not.toContainText('Public attribution only.');await dialog.locator('.button.ghost').click();await page.locator('.publisher-management-card').last().getByRole('button').click();await expect(dialog.locator('#publisher-profile-name')).toHaveValue('A very long public publisher name — 靈映出版社 神秘故事 창작자');await noOverflow(page);
});
