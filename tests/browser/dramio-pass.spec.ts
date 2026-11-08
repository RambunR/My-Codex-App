import {test,expect} from '@playwright/test';
import {agreeToCreatorPass} from './helpers/creator-pass-consent';
import {LANGUAGES} from '../../shared/config';
import {localeMessages} from '../../src/i18n';

test('Dramio Pass purchase appears on Account and persists without another payment',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/auth?mode=register&next=/account');
  await page.getByLabel('Name',{exact:true}).fill('Dramio Pass Viewer');
  await page.getByLabel('Email address',{exact:true}).fill(`pass-${Date.now()}@browser.test`);
  await page.getByLabel('Password',{exact:true}).fill('BrowserPass123!');
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();
  await expect(page).toHaveURL('/account');
  const card=page.locator('.dramio-pass-card');await expect(card).toBeVisible();await expect(card).toContainText('Dramio Pass');await expect(card).toContainText('Not purchased');await expect(card.locator('.dramio-pass-benefits')).toContainText('10 GB storage');
  await card.getByRole('link',{name:'Get Dramio Pass',exact:true}).click();await expect(page).toHaveURL('/studio');
  await expect(page.locator('#pass-promo-code')).toHaveValue('');await expect(card).toHaveCount(0);
  await expect(page.locator('.activation-card')).toContainText('10 GB included storage');await expect(page.locator('.activation-card')).toContainText('200 MiB per episode');
  await agreeToCreatorPass(page);await page.getByRole('button',{name:/Get Dramio Pass.*HK\$88/}).click();
  await expect(page.getByRole('dialog')).toContainText('HK$88.00');await page.getByRole('button',{name:'Confirm test payment'}).click();
  await expect(page.getByRole('link',{name:'New series',exact:true}).first()).toBeVisible();
  await page.goto('/account');await expect(card).toContainText('Dramio Pass');await expect(card).toContainText('Active');await expect(card).toContainText('Test pass');
  await expect(card.getByRole('link',{name:'Open Creator studio',exact:true})).toBeVisible();await expect(card.getByRole('link',{name:'Get Dramio Pass',exact:true})).toHaveCount(0);
  const icon=card.locator('img').first();await expect(icon).toBeVisible();expect(await icon.evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
  await page.reload();await expect(card).toContainText('Active');await expect(card).toContainText('Purchased on');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const me=await(await page.request.get('/api/auth/me')).json();expect(me.user.dramio_pass.active).toBe(true);expect(me.user.dramio_pass.test).toBe(true);expect(me.user.quota_bytes).toBe(10*1024**3);await expect(card.locator('.dramio-pass-benefits')).toContainText('10 GB storage');
  const wallet=await(await page.request.get('/api/wallet')).json();expect(wallet.payments.filter((payment:any)=>payment.kind==='activation'&&payment.status==='paid')).toHaveLength(1);
  expect(errors).toEqual([]);
});

for(const {code} of LANGUAGES)test(`${code} advertises 10 GB on Pass, account and help without changing per-episode limits`,async({page})=>{
  const messages=localeMessages[code],writes:string[]=[],unexpected:string[]=[],errors:string[]=[];
  await page.setViewportSize({width:320,height:900});await page.addInitScript(locale=>localStorage.setItem('drama-language',locale),code);page.on('pageerror',error=>errors.push(error.message));
  const user={id:'storage-benefit-viewer',name:'Storage Benefit Viewer',email:'storage-benefit@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:10*1024**3,used_bytes:0,language:code,payment_review:false,email_verified:true,dramio_pass:{active:false,test:false,purchased_at:null}};
  await page.route('**/api/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.abort();}if(path==='/api/auth/me')return route.fulfill({json:{user}});if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,uploadsEnabled:true,payoutsEnabled:false,usdToHkd:7.8,demo:false,limits:{quotaBytes:10*1024**3,maxEpisodeBytes:200*1024**2,maxEpisodeSeconds:300,activationHkd:88},auth:{google:false,apple:false,email:false}}});if(path==='/api/display-currency')return route.fulfill({json:{quote:null}});unexpected.push(path);return route.fulfill({status:404,json:{error:{message:'Unexpected benefit fixture request'}}});});
  await page.goto('/account');const benefit=page.locator('.dramio-pass-benefits');await expect(benefit).toContainText(messages.passBenefits!);await expect(benefit).toContainText('10 GB');await expect(benefit).not.toContainText(/(?<!\d)5\s*GB/);
  await page.goto('/studio');const card=page.locator('.activation-card');await expect(card.locator('li').filter({hasText:messages.storageIncluded!})).toContainText('10 GB');await expect(card).toContainText(messages.limits!);await expect(card).toContainText(/200\s*MiB/);await expect(card.locator('input[name="creator_pass_consent"]')).not.toBeChecked();
  await page.goto('/help');const storageHelp=page.locator('.faq-item').filter({has:page.getByText(messages.storageBody!,{exact:true})});await expect(storageHelp).toHaveCount(1);await storageHelp.locator('summary').click();await expect(storageHelp.locator('p')).toBeVisible();await expect(storageHelp.locator('p')).toContainText('10 GB');await expect(page.locator('.info-sections')).not.toContainText(/(?<!\d)5\s*GB/);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);expect(writes).toEqual([]);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});

test('storage requests open above the current allowance and preserve a valid previously entered total',async({page})=>{
  let quotaGiB=10;const writes:string[]=[];
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  await page.route('**/api/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.abort();}const user={id:'storage-request-publisher',name:'Storage Request Publisher',email:'storage-request@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:quotaGiB*1024**3,used_bytes:0,language:'en',payment_review:false};if(path==='/api/auth/me')return route.fulfill({json:{user}});if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',uploadsEnabled:true,payoutsEnabled:false,usdToHkd:7.8,demo:false,limits:{quotaBytes:10*1024**3}}});if(path==='/api/studio')return route.fulfill({json:{user,series:[],stats:{sales:0,lifetime_micros:0},storageRequests:[],withdrawals:[]}});return route.fulfill({status:404,json:{error:{message:'Unexpected storage fixture request'}}});});
  for(const allowance of [10,25]){
    quotaGiB=allowance;await page.goto('/studio');await page.getByRole('button',{name:'Storage',exact:true}).click();await page.getByRole('button',{name:localeMessages.en.requestStorage!,exact:true}).click();const dialog=page.getByRole('dialog'),amount=dialog.locator('input[type="number"]');await expect(amount).toHaveAttribute('min',String(allowance+1));await expect(amount).toHaveValue(String(allowance+5));expect(await amount.evaluate((input:HTMLInputElement)=>input.validity.valid)).toBe(true);await amount.fill(String(allowance+10));await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:localeMessages.en.requestStorage!,exact:true}).click();await expect(page.getByRole('dialog').locator('input[type="number"]')).toHaveValue(String(allowance+10));await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  }
  expect(writes).toEqual([]);
});
