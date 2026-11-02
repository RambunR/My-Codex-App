import {test,expect,type Page} from '@playwright/test';

const offer={enabled:true,code:'LINGYING58',amountHkdCents:5800,regularAmountHkdCents:8800,currency:'hkd'};
const viewer={id:'pass-promo-browser',name:'Promo viewer',email:'promo-viewer@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};

async function fixture(page:Page,changes:Record<string,unknown>={}){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:viewer}}));
  await page.route('**/api/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,passPromotion:offer,paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false,...changes}});});
}
const activate=(page:Page)=>page.locator('.activation-card>button.primary');
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

test('a launch link survives registration and purchases one exact HK$58 Pass without funding the wallet',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const config=await(await page.request.get('/api/config')).json();expect(config.passPromotion).toEqual(offer);
  await page.goto('/studio?promo=LINGYING58');await expect(page.locator('.pass-usd-price')).toContainText('7.44');
  await expect(page.locator('.pass-original-price')).toContainText('11.28');await expect(page.locator('.pass-billing-note')).toContainText('HK$58.00');
  await activate(page).click();await expect(page).toHaveURL(url=>url.pathname==='/auth'&&url.searchParams.get('mode')==='register'&&url.searchParams.get('next')==='/studio?promo=LINGYING58');
  await page.getByLabel('Name',{exact:true}).fill('Launch offer creator');await page.getByLabel('Email address',{exact:true}).fill(`promo-${Date.now()}@browser.test`);await page.getByLabel('Password',{exact:true}).fill('BrowserPass123!');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();
  await expect(page).toHaveURL('/studio?promo=LINGYING58');await expect(page.locator('.pass-promo-applied')).toContainText('LINGYING58');
  await page.goto('/account');const card=page.locator('.dramio-pass-card');await expect(card).toContainText('7.44');await expect(card).toContainText('LINGYING58');await card.getByRole('link',{name:'Get Dramio Pass',exact:true}).click();await expect(page).toHaveURL('/studio?promo=LINGYING58');
  const checkout=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/payments/checkout'&&response.request().method()==='POST');await activate(page).click();const response=await checkout;expect(response.ok()).toBe(true);expect(response.request().postDataJSON()).toMatchObject({kind:'activation',promo_code:'LINGYING58'});const payment=await response.json();expect(payment.amount_cents).toBe(5800);expect(payment.currency).toBe('hkd');
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('HK$58.00');await dialog.getByRole('button',{name:'Confirm test payment',exact:true}).click();await expect(page.getByRole('link',{name:'New series',exact:true}).first()).toBeVisible();
  await page.goto('/account');await expect(card).toContainText('Active');await expect(card).toContainText('Purchased on');await expect(card).toContainText('Test pass');await expect(card).not.toContainText('11.28');await expect(card.getByRole('link',{name:'Get Dramio Pass',exact:true})).toHaveCount(0);
  await page.goto('/wallet');const row=page.locator('.ledger-row').filter({hasText:'Dramio Pass'});await expect(row).toContainText('HK$58.00');await expect(row).not.toContainText('HK$88');await expect(page.locator('.balance-card>strong')).toHaveText('$0.00');
  const wallet=await(await page.request.get('/api/wallet')).json();expect(wallet.user.wallet_micros).toBe(0);expect(wallet.user.publisher_active).toBe(1);expect(wallet.user.dramio_pass.active).toBe(true);expect(wallet.payments.filter((item:any)=>item.kind==='activation'&&item.status==='paid')).toEqual([expect.objectContaining({id:payment.paymentId,amount_cents:5800,currency:'hkd'})]);expect(wallet.ledger.filter((item:any)=>item.kind==='activation')).toHaveLength(1);expect(wallet.ledger.filter((item:any)=>item.kind==='funding')).toHaveLength(0);
  const duplicate=await page.request.post('/api/payments/checkout',{data:{kind:'activation',promo_code:'LINGYING58'}});expect(duplicate.status()).toBe(409);expect((await duplicate.json()).error.code).toBe('ALREADY_ACTIVE');expect(errors).toEqual([]);
});

test('manual promo validation changes only the activation quote and never starts Checkout',async({page})=>{
  const writes:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/payments/'))writes.push(new URL(request.url()).pathname);});
  await page.goto('/studio');await expect(page.locator('.pass-usd-price')).toContainText('11.28');
  await page.getByLabel('Promo code',{exact:true}).fill('FREEPASS');await page.getByRole('button',{name:'Apply code',exact:true}).click();await expect(page.locator('#pass-promo-error')).toHaveText('This promo code is invalid or unavailable.');await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Promo code',{exact:true}).fill('  lingying58  ');await page.getByRole('button',{name:'Apply code',exact:true}).click();await expect(page.locator('.pass-usd-price')).toContainText('7.44');await expect(page.locator('.pass-promo-applied')).toContainText('Code LINGYING58 applied');await expect(page.getByLabel('Promo code',{exact:true})).toHaveValue('LINGYING58');
  await page.locator('.pass-promo-applied').getByRole('button',{name:'Remove',exact:true}).click();await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.locator('.pass-billing-note')).toContainText('HK$88.00');await expect(page.locator('.pass-original-price')).toHaveCount(0);expect(writes).toEqual([]);
});

test('an unavailable launch offer cannot be activated through a stale promotional URL',async({page})=>{
  await fixture(page,{passPromotion:{...offer,enabled:false}});const submitted:unknown[]=[];
  await page.route('**/api/payments/checkout',async route=>{submitted.push(route.request().postDataJSON());await route.fulfill({json:{demo:true,paymentId:'regular-price-local-fixture',amount_cents:8800,currency:'hkd'}});});
  await page.goto('/studio?promo=LINGYING58');await expect(page.locator('.pass-promo-panel')).toHaveCount(0);await expect(page.locator('.publisher-landing')).not.toContainText('LINGYING58');await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.locator('.pass-billing-note')).toContainText('HK$88.00');await activate(page).click();await expect(page.getByRole('dialog')).toContainText('HK$88.00');expect(submitted).toEqual([{kind:'activation',amount_cents:8800,language:'en'}]);
});

test('changing an old checkout price requires explicit owner cancellation before retrying the promoted quote',async({page})=>{
  await fixture(page);const calls:Array<{path:string;body:unknown}>=[];let cancelled=false;
  await page.route('**/api/payments/checkout',async route=>{calls.push({path:'/checkout',body:route.request().postDataJSON()});await route.fulfill(cancelled?{json:{demo:true,paymentId:'new-promotional-fixture',amount_cents:5800,currency:'hkd'}}:{status:409,json:{error:{code:'ACTIVATION_CHECKOUT_CONFLICT',message:'Existing unpaid checkout.',details:{paymentId:'old-unpaid-fixture'}}}});});
  await page.route('**/api/payments/old-unpaid-fixture/cancel',async route=>{expect(route.request().method()).toBe('POST');calls.push({path:'/cancel',body:route.request().postDataJSON()});cancelled=true;await route.fulfill({json:{cancelled:true}});});
  await page.goto('/studio?promo=LINGYING58');await activate(page).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Replace your previous checkout?');await expect(dialog).toContainText('HK$58.00');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(calls.map(call=>call.path)).toEqual(['/checkout']);
  await activate(page).click();await expect(dialog).toContainText('Replace your previous checkout?');await dialog.getByRole('button',{name:'Close previous checkout and continue',exact:true}).click();await expect(dialog).toContainText('HK$58.00');await expect(dialog).toContainText('Test payment');expect(calls.map(call=>call.path)).toEqual(['/checkout','/checkout','/cancel','/checkout']);for(const call of calls.filter(call=>call.path==='/checkout'))expect(call.body).toEqual({kind:'activation',amount_cents:8800,promo_code:'LINGYING58',language:'en'});
});

test('payment holds keep an applied launch code from opening a payment',async({page})=>{
  await fixture(page);await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{...viewer,payment_review:true}}}));const writes:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/payments/'))writes.push(new URL(request.url()).pathname);});
  await page.goto('/studio?promo=LINGYING58');await expect(page.locator('.pass-usd-price')).toContainText('7.44');await expect(activate(page)).toBeDisabled();await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();expect(writes).toEqual([]);
});

for(const[locale,width,applied]of [['en',320,'Code LINGYING58 applied'],['zh-TW',390,'已套用優惠碼 LINGYING58'],['ar',320,'LINGYING58']] as const)test(`launch offer is readable without horizontal scrolling on a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await page.goto('/studio?promo=LINGYING58');await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.locator('.pass-usd-price')).toContainText('7.44');await expect(page.locator('.pass-original-price')).toContainText('11.28');await expect(page.locator('.pass-promo-applied')).toContainText(applied);await noOverflow(page);const input=page.locator('#pass-promo-code');await expect(input).toBeVisible();expect(await input.evaluate(node=>getComputedStyle(node).fontSize)).toBe('16px');const button=page.locator('.pass-promo-input-row>button');const bounds=await button.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeGreaterThanOrEqual(44);
});
