import {test,expect,type Page} from '@playwright/test';

const administrator={id:'admin-account-browser',name:'Platform owner',email:'platform.owner@browser.test',role:'admin',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',email_verified:true,payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null as string|null}};
type AccountFixture=Partial<Omit<typeof administrator,'dramio_pass'>>&{dramio_pass?:typeof administrator.dramio_pass};

async function fixture(page:Page,changes:AccountFixture={},uploadsEnabled=true){
  const account={...administrator,...changes};const paymentWrites:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/payments/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))paymentWrites.push(new URL(request.url()).pathname);});
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:account}}));
  await page.route('**/api/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled,auth:{google:false,apple:false,email:false}}});});
  await page.route('**/api/studio',route=>route.fulfill({json:{user:account,series:[],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}}));
  return{account,paymentWrites};
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

test('a signed-in real administrator sees upload access and can create a draft without a checkout',async({page})=>{
  const login=await page.request.post('/api/auth/login',{data:{email:'admin@demo.aidramio.test',password:'DemoPass123!'}});expect(login.ok()).toBe(true);
  const before=(await login.json()).user;expect(before.role).toBe('admin');const paymentWrites:string[]=[];const errors:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/payments/')&&!['GET','HEAD'].includes(request.method()))paymentWrites.push(new URL(request.url()).pathname);});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/account');await expect(page.locator('.account-admin-role')).toHaveText('Administrator');
  const access=page.locator('.admin-account-access');await expect(access).toHaveAttribute('data-upload-status','enabled');await expect(access).toContainText('Uploads enabled');
  await expect(page.getByRole('link',{name:'Get Dramio Pass',exact:true})).toHaveCount(0);
  await access.getByRole('link',{name:'Upload drama',exact:true}).click();await expect(page).toHaveURL('/studio/new');await expect(page.locator('#series-title')).toBeEditable();
  const title=`Administrator draft ${Date.now()}`;await page.locator('#series-title').fill(title);await page.locator('#series-description').fill('A complete administrator draft created without buying another creator pass.');
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/series'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save details',exact:true}).first().click();expect((await saved).status()).toBe(201);await expect(page).toHaveURL(/\/studio\/series\//);
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();
  const after=(await(await page.request.get('/api/auth/me')).json()).user;for(const key of ['role','publisher_active','wallet_micros','earnings_micros','dramio_pass'])expect(after[key]).toEqual(before[key]);
  expect(paymentWrites).toEqual([]);expect(errors).toEqual([]);
});

test('administrator upload access is explicit without an invented Pass purchase or HK$88 upsell',async({page})=>{
  const state=await fixture(page);await page.goto('/account');
  await expect(page.locator('.account-admin-role')).toHaveText('Administrator');const access=page.locator('.admin-account-access');await expect(access).toHaveAttribute('data-upload-status','enabled');
  await expect(access).toContainText('Upload access is included with your administrator role.');await expect(page.locator('.dramio-pass-card')).toHaveCount(0);await expect(page.locator('.dramio-pass-purchased')).toHaveCount(0);
  await expect(access.getByRole('link',{name:'Manage content',exact:true})).toHaveAttribute('href','/admin?tab=content');await expect(access.getByRole('link',{name:'Open Creator Studio',exact:true})).toHaveAttribute('href','/studio');
  await access.getByRole('link',{name:'Upload drama',exact:true}).click();await expect(page).toHaveURL('/studio/new');await expect(page.locator('#series-title')).toBeEditable();expect(state.account.dramio_pass.active).toBe(false);expect(state.paymentWrites).toEqual([]);
});

test('an administrator who really owns a Pass retains its actual receipt alongside admin access',async({page})=>{
  await fixture(page,{publisher_active:1,dramio_pass:{active:true,test:false,purchased_at:'2026-10-27T10:00:00Z'}});await page.goto('/account');
  await expect(page.locator('.admin-account-access')).toHaveAttribute('data-upload-status','enabled');await expect(page.locator('.dramio-pass-card')).toHaveCount(1);await expect(page.locator('.dramio-pass-status')).toHaveText('Active');await expect(page.locator('.dramio-pass-purchased')).toContainText('Purchased on');await expect(page.locator('.dramio-pass-purchased')).toContainText('2026');await expect(page.getByRole('link',{name:'Get Dramio Pass',exact:true})).toHaveCount(0);
});

test('a viewer using the same display name and email never receives an administrator badge from the frontend',async({page})=>{
  const state=await fixture(page,{role:'viewer'});await page.goto('/account');
  await expect(page.locator('.profile-intro')).toContainText(administrator.email);await expect(page.locator('.admin-account-access')).toHaveCount(0);await expect(page.locator('.account-admin-role')).toHaveCount(0);await expect(page.locator('.account-links a[href="/admin"]')).toHaveCount(0);
  await expect(page.locator('.dramio-pass-card')).toContainText('Not purchased');await expect(page.getByRole('link',{name:'Get Dramio Pass',exact:true})).toBeVisible();expect(state.paymentWrites).toEqual([]);
});

test('a regular publisher keeps the ordinary active Pass and test receipt presentation',async({page})=>{
  await fixture(page,{role:'publisher',publisher_active:1,dramio_pass:{active:true,test:true,purchased_at:'2026-10-28T10:00:00Z'}});await page.goto('/account');
  await expect(page.locator('.admin-account-access')).toHaveCount(0);await expect(page.locator('.account-admin-role')).toHaveCount(0);await expect(page.locator('.dramio-pass-card')).toContainText('Active');await expect(page.locator('.dramio-pass-card')).toContainText('Test pass');await expect(page.locator('.dramio-pass-purchased')).toContainText('Purchased on');await expect(page.getByRole('link',{name:'Open Creator studio',exact:true})).toBeVisible();
});

for(const mode of ['held','disabled'] as const)test(`administrator identity stays visible when uploads are ${mode}`,async({page})=>{
  const state=await fixture(page,{payment_review:mode==='held'},mode!=='disabled');await page.goto('/account');
  const access=page.locator('.admin-account-access');await expect(page.locator('.account-admin-role')).toHaveText('Administrator');await expect(access).toHaveAttribute('data-upload-status',mode);await expect(access).toContainText('Uploads paused');await expect(access.getByRole('button',{name:'Upload drama',exact:true})).toBeDisabled();await expect(access.getByRole('link',{name:'Upload drama',exact:true})).toHaveCount(0);
  await expect(access.getByRole('link',{name:'Manage content',exact:true})).toBeVisible();await expect(access.getByRole('link',{name:'Open Creator Studio',exact:true})).toBeVisible();await expect(page.locator('.dramio-pass-card')).toHaveCount(0);if(mode==='held')await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();expect(state.paymentWrites).toEqual([]);
});

for(const[locale,width,role,enabled]of [['en',320,'Administrator','Uploads enabled'],['zh-TW',390,'管理員','已開放上傳'],['ar',320,'المسؤول','الرفع مفعّل']] as const)test(`admin upload access is usable on a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);const state=await fixture(page);await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('.account-admin-role')).toHaveText(role);await expect(page.locator('.admin-account-upload-status')).toHaveText(enabled);await noOverflow(page);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  for(const link of await page.locator('.admin-account-actions a').all()){await expect(link).toBeVisible();const bounds=await link.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeGreaterThanOrEqual(44);}
  await expect(page.locator('.dramio-pass-card')).toHaveCount(0);expect(state.paymentWrites).toEqual([]);
});

test('signed-out visitors must authenticate before seeing Account or administrator upload controls',async({page})=>{
  await page.goto('/account');await expect(page.getByRole('heading',{name:'Make this story yours.',exact:true})).toBeVisible();await expect(page.locator('.admin-account-access')).toHaveCount(0);await expect(page.locator('.account-admin-role')).toHaveCount(0);await expect(page.getByRole('link',{name:'Sign in',exact:true}).last()).toHaveAttribute('href','/auth?next=%2Faccount');
});
