import {test,expect} from '@playwright/test';

test('wallet Checkout sends the selected interface language even when the account profile is English',async({page})=>{
  const errors:string[]=[],stripeRequests:string[]=[],bodies:Record<string,unknown>[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const user={id:'checkout-language-browser',name:'Checkout language viewer',email:'checkout-language@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{user,ledger:[],payments:[]}}));
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({response,json:{...config,paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false}});
  });
  await page.route('**/api/payments/checkout',async route=>{
    expect(route.request().method()).toBe('POST');bodies.push(route.request().postDataJSON());
    await route.fulfill({json:{url:'/wallet?checkout=cancelled',paymentId:'local-checkout-language-fixture'}});
  });
  await page.route('https://checkout.stripe.com/**',route=>{
    stripeRequests.push(new URL(route.request().url()).origin);return route.abort();
  });
  await page.goto('/wallet');await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.locator('.header-language').click();await page.locator('.language-option').filter({hasText:'繁體中文'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-TW');
  await page.getByRole('button',{name:'US$25',exact:true}).click();
  await expect(page.locator('.topup-panel input[inputmode="decimal"]')).toHaveValue('25.00');
  await page.locator('.topup-panel button.primary').click();
  await expect.poll(()=>bodies).toEqual([{kind:'funding',amount_cents:2500,language:'zh-TW'}]);
  await expect(page).toHaveURL('/wallet');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.balance-card>strong')).toHaveText('$0.00');
  expect(stripeRequests).toEqual([]);expect(errors).toEqual([]);
});
