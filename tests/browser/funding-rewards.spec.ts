import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const viewer={id:'funding-reward-browser',name:'Reward viewer',email:'reward-viewer@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};
const input=(page:Page)=>page.locator('.topup-panel input[inputmode="decimal"]');
const summary=(page:Page)=>page.locator('.topup-panel .funding-reward-summary');
async function mockWallet(page:Page,user:typeof viewer|null=viewer){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{user,ledger:[],payments:[]}}));
}

test('wallet presets replace US$5 with US$100 and exact custom amounts display the matching gift and total',async({page})=>{
  await mockWallet(page);const writes:unknown[]=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/payments/checkout'))writes.push(request.postDataJSON());});
  await page.goto('/wallet');await expect(input(page)).toHaveValue('10');
  await expect(page.locator('.funding-option-amount')).toHaveText(['US$10','US$25','US$50','US$100']);
  await expect(page.getByRole('button',{name:'US$5',exact:true})).toHaveCount(0);
  await expect(page.locator('.wallet-funding-options .funding-option-gift svg')).toHaveCount(2);
  await expect(summary(page)).toHaveCount(0);
  await page.locator('.wallet-funding-options>button').nth(2).click();
  await expect(input(page)).toHaveValue('50.00');await expect(summary(page).locator('.funding-reward-gift dd')).toHaveText('+$5.00');await expect(summary(page).locator('.funding-reward-total dd')).toHaveText('$55.00');
  await expect(page.locator('.topup-panel button.primary')).toContainText('$50.00');
  await page.locator('.wallet-funding-options>button').nth(3).click();
  await expect(input(page)).toHaveValue('100.00');await expect(summary(page).locator('.funding-reward-gift dd')).toHaveText('+$15.00');await expect(summary(page).locator('.funding-reward-total dd')).toHaveText('$115.00');
  await input(page).fill('49.99');await expect(summary(page)).toHaveCount(0);
  await input(page).fill('50');await expect(summary(page).locator('.funding-reward-total dd')).toHaveText('$55.00');
  await input(page).fill('100.00');await expect(summary(page).locator('.funding-reward-total dd')).toHaveText('$115.00');
  await input(page).fill('5.00');await expect(page.locator('.topup-panel button.primary')).toBeEnabled();await expect(summary(page)).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('local confirmed US$50 and US$100 deposits credit US$55 and US$115 exactly once with separate gift ledger entries',async({page})=>{
  const registered=await page.request.post('/api/auth/register',{data:{name:'Funding reward buyer',email:`funding-reward-${randomUUID()}@example.test`,password:'RewardPass123!',language:'en'}});expect(registered.status()).toBe(201);
  await page.goto('/wallet');await input(page).fill('50.00');
  await page.locator('.topup-panel button.primary').click();let dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(dialog.locator('.checkout-total strong')).toHaveText('US$50.00');await expect(dialog.locator('.funding-reward-total dd')).toHaveText('$55.00');
  expect((await(await page.request.get('/api/wallet')).json()).user.wallet_micros).toBe(0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect((await(await page.request.get('/api/wallet')).json()).ledger).toEqual([]);
  for(const [amount,total,balance]of [[50,55,55],[100,115,170]] as const){
    await input(page).fill(amount.toFixed(2));
    const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/payments/checkout');
    await page.locator('.topup-panel button.primary').click();const payment=await(await created).json();
    expect(payment.amount_cents).toBe(amount*100);expect(payment.funding.totalCreditCents).toBe(total*100);
    dialog=page.getByRole('dialog');await expect(dialog.locator('.funding-reward-total dd')).toHaveText(`$${total}.00`);
    const before=(await(await page.request.get('/api/wallet')).json()).user.wallet_micros;expect(before).toBe(amount===50?0:55_000_000);
    await dialog.getByRole('button',{name:'Confirm test payment',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.locator('.balance-card>strong')).toHaveText(`$${balance}.00`);
    const repeated=await page.request.post(`/api/payments/${payment.paymentId}/demo-confirm`,{data:{}});expect(repeated.ok()).toBe(true);
    const wallet=await(await page.request.get('/api/wallet')).json();expect(wallet.user.wallet_micros).toBe(balance*1_000_000);
    expect(wallet.ledger.filter((row:any)=>row.kind==='funding_bonus')).toHaveLength(amount===50?1:2);
    expect(wallet.ledger.filter((row:any)=>row.kind==='funding')).toHaveLength(amount===50?1:2);
  }
  await expect(page.locator('.ledger-icon.funding-bonus svg')).toHaveCount(2);await expect(page.locator('.ledger-row').filter({hasText:'Funding gift'})).toHaveCount(2);
});

test('wallet funding requires sign-in and financial review holds disable the rewarded payment',async({page})=>{
  let current:typeof viewer|null=null;const writes:string[]=[];
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:current}}));await page.route('**/api/wallet',route=>route.fulfill({json:{user:current,ledger:[],payments:[]}}));
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/payments/checkout'))writes.push(request.url());});
  await page.goto('/wallet');await expect(page.getByRole('link',{name:'Sign in',exact:true}).last()).toBeVisible();await expect(page.locator('.topup-panel')).toHaveCount(0);
  current={...viewer,payment_review:true};await page.goto('/wallet');await input(page).fill('100.00');
  await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();await expect(page.locator('.topup-panel button.primary')).toBeDisabled();
  await expect(summary(page).locator('.funding-reward-total dd')).toHaveText('$115.00');expect(writes).toEqual([]);
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`wallet gift choices and totals fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await mockWallet(page);
  await page.goto('/wallet');await expect(page.locator('html')).toHaveAttribute('lang',locale);await page.locator('.wallet-funding-options>button').nth(3).click();
  await expect(summary(page).locator('.funding-reward-gift dd')).toHaveText('+$15.00');await expect(summary(page).locator('.funding-reward-total dd')).toHaveText('$115.00');
  if(locale!=='en')await expect(summary(page)).not.toContainText('Total wallet credit');if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  expect(await input(page).evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  for(const button of await page.locator('.wallet-funding-options>button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
