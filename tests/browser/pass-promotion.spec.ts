import {test,expect,type Page} from '@playwright/test';
import {agreeToCreatorPass,creatorConsent} from './helpers/creator-pass-consent';

// Keep existing price/receipt journeys deterministic; country-specific display
// and HKD fallback behavior are exercised in display-currency.spec.ts.
test.beforeEach(async({page})=>{await page.route('**/api/display-currency',route=>route.fulfill({json:{quote:{country:'US',currency:'USD',ratePerHkd:1/7.8,asOf:'2026-11-04'}}}));});

const quote={code:'LINGYING58',amountHkdCents:5800,regularAmountHkdCents:8800,currency:'hkd',revision:1};
const viewer={id:'pass-promo-browser',name:'Promo viewer',email:'promo-viewer@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};
const activate=(page:Page)=>page.locator('.activation-card>button.primary');
async function fixture(page:Page,changes:Record<string,unknown>={}){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:viewer}}));
  await page.route('**/api/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,passPromotion:{enabled:true},paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false,...changes}});});
  await page.route('**/api/payments/promotion/quote',route=>route.fulfill(route.request().postDataJSON().promo_code.trim().toUpperCase()==='LINGYING58'?{json:{promotion:quote}}:{status:400,json:{error:{code:'INVALID_PROMOTION',message:'This promo code is invalid or unavailable.'}}}));
}
async function apply(page:Page,code='LINGYING58'){await page.locator('#pass-promo-code').fill(code);await page.locator('.pass-promo-form button').click();await expect(page.locator('.pass-promo-applied')).toContainText('LINGYING58');}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

test('public pages never advertise or prefill a social code, even from an old promotional URL',async({page})=>{
  const config=await(await page.request.get('/api/config')).json();expect(config.passPromotion).toEqual({enabled:true});expect(JSON.stringify(config.passPromotion)).not.toContain('LINGYING58');
  const quoteRequests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/payments/promotion/quote')quoteRequests.push(request.url());});
  await page.goto('/studio?promo=LINGYING58');await expect(page).toHaveURL('/studio');await expect(page.locator('#pass-promo-code')).toHaveValue('');await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.locator('.publisher-landing')).not.toContainText('LINGYING58');await expect(page.locator('.publisher-landing')).not.toContainText('7.44');await expect(page.locator('.publisher-landing')).not.toContainText('Creator launch offer');await expect(page.locator('.pass-promo-applied')).toHaveCount(0);expect(quoteRequests).toEqual([]);
  const registered=await page.request.post('/api/auth/register',{data:{name:'Private offer viewer',email:`private-offer-${Date.now()}@browser.test`,password:'BrowserPass123!'}});expect(registered.status()).toBe(201);await page.goto('/account');const card=page.locator('.dramio-pass-card');await expect(card).toContainText('11.28');await expect(card).not.toContainText('LINGYING58');await expect(card).not.toContainText('7.44');await expect(card.getByRole('link',{name:'Get Dramio Pass',exact:true})).toHaveAttribute('href','/studio');
});

test('a manually entered social code survives registration privately and purchases one exact HK$58 Pass',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/studio');await page.locator('#pass-promo-code').fill('lingying58');await page.locator('.pass-promo-form button').click();await expect(page).toHaveURL(url=>url.pathname==='/auth'&&url.searchParams.get('mode')==='register'&&url.searchParams.get('next')==='/studio'&&!url.href.includes('LINGYING58'));
  await page.getByLabel('Name',{exact:true}).fill('Social offer creator');await page.getByLabel('Email address',{exact:true}).fill(`private-promo-${Date.now()}@browser.test`);await page.getByLabel('Password',{exact:true}).fill('BrowserPass123!');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();
  await expect(page).toHaveURL('/studio');await expect(page.locator('.pass-promo-applied')).toContainText('LINGYING58');await expect(page.locator('.pass-usd-price')).toContainText('7.44');await expect(page.locator('.pass-billing-note')).toContainText('HK$58.00');expect(await page.evaluate(()=>sessionStorage.getItem('lingying-pass-promo-entry'))).toBeNull();
  const checkout=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/payments/checkout'&&response.request().method()==='POST');await agreeToCreatorPass(page);await activate(page).click();const response=await checkout;expect(response.ok()).toBe(true);expect(response.request().postDataJSON()).toMatchObject({kind:'activation',promo_code:'LINGYING58',promo_revision:1});const payment=await response.json();expect(payment.amount_cents).toBe(5800);expect(payment.currency).toBe('hkd');
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('HK$58.00');await dialog.getByRole('button',{name:'Confirm test payment',exact:true}).click();await expect(page.getByRole('link',{name:'New series',exact:true}).first()).toBeVisible();
  await page.goto('/account');const card=page.locator('.dramio-pass-card');await expect(card).toContainText('Active');await expect(card).toContainText('Purchased on');await expect(card).not.toContainText('11.28');await page.goto('/wallet');const row=page.locator('.ledger-row').filter({hasText:'Dramio Pass'});await expect(row).toContainText('HK$58.00');await expect(row).not.toContainText('HK$88');await expect(page.locator('.balance-card>strong')).toHaveText('$0.00');
  const wallet=await(await page.request.get('/api/wallet')).json();expect(wallet.user.wallet_micros).toBe(0);expect(wallet.user.publisher_active).toBe(1);expect(wallet.payments.filter((item:any)=>item.kind==='activation'&&item.status==='paid')).toEqual([expect.objectContaining({id:payment.paymentId,amount_cents:5800,currency:'hkd'})]);expect(wallet.ledger.filter((item:any)=>item.kind==='activation')).toHaveLength(1);expect(wallet.ledger.filter((item:any)=>item.kind==='funding')).toHaveLength(0);
  const duplicate=await page.request.post('/api/payments/checkout',{data:{kind:'activation',promo_code:'LINGYING58',promo_revision:1,creator_consent:creatorConsent}});expect(duplicate.status()).toBe(409);expect((await duplicate.json()).error.code).toBe('ALREADY_ACTIVE');expect(errors).toEqual([]);
});

test('authenticated code validation makes a private quote without opening Checkout or exposing unknown codes',async({page})=>{
  await fixture(page);const writes:Array<{path:string;body:unknown}>=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/payments/'))writes.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});});
  await page.goto('/studio');await page.locator('#pass-promo-code').fill('FREEPASS');await page.locator('.pass-promo-form button').click();await expect(page.locator('#pass-promo-error')).toHaveText('This promo code is invalid or unavailable.');await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.getByRole('dialog')).toHaveCount(0);
  await apply(page,'  lingying58  ');await expect(page.locator('.pass-usd-price')).toContainText('7.44');await expect(page.locator('#pass-promo-code')).toHaveValue('LINGYING58');await page.locator('.pass-promo-applied').getByRole('button',{name:'Remove',exact:true}).click();await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.locator('.pass-original-price')).toHaveCount(0);expect(writes.map(item=>item.path)).toEqual(['/api/payments/promotion/quote','/api/payments/promotion/quote']);
});

test('a changed promotion requires a new quote before Checkout can continue at the updated price',async({page})=>{
  await fixture(page);let revision=1;const submitted:any[]=[];await page.route('**/api/payments/promotion/quote',route=>route.fulfill({json:{promotion:{...quote,revision,amountHkdCents:revision===1?5800:6800}}}));
  await page.route('**/api/payments/checkout',route=>{submitted.push(route.request().postDataJSON());if(submitted.length===1){revision=2;return route.fulfill({status:409,json:{error:{code:'PROMOTION_CHANGED',message:'Apply the code again.'}}});}return route.fulfill({json:{demo:true,paymentId:'changed-local-promo',amount_cents:6800,currency:'hkd'}});});
  await page.goto('/studio');await apply(page);await agreeToCreatorPass(page);await activate(page).click();await expect(page.locator('#pass-promo-error')).toContainText('This code changed.');await expect(page.locator('.pass-promo-applied')).toHaveCount(0);await expect(page.locator('.pass-usd-price')).toContainText('11.28');await expect(page.getByRole('dialog')).toHaveCount(0);
  await apply(page);await expect(page.locator('.pass-usd-price')).toContainText('8.72');await agreeToCreatorPass(page);await activate(page).click();await expect(page.getByRole('dialog')).toContainText('HK$68.00');expect(submitted.map(body=>body.promo_revision)).toEqual([1,2]);
});

test('changing an existing checkout price requires explicit owner cancellation before using a private code',async({page})=>{
  await fixture(page);const calls:Array<{path:string;body:any}>=[];let cancelled=false;
  await page.route('**/api/payments/checkout',route=>{calls.push({path:'/checkout',body:route.request().postDataJSON()});return route.fulfill(cancelled?{json:{demo:true,paymentId:'new-promotional-fixture',amount_cents:5800,currency:'hkd'}}:{status:409,json:{error:{code:'ACTIVATION_CHECKOUT_CONFLICT',message:'Existing unpaid checkout.',details:{paymentId:'old-unpaid-fixture'}}}});});
  await page.route('**/api/payments/old-unpaid-fixture/cancel',route=>{calls.push({path:'/cancel',body:route.request().postDataJSON()});cancelled=true;return route.fulfill({json:{cancelled:true}});});
  await page.goto('/studio');await apply(page);await agreeToCreatorPass(page);await activate(page).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Replace your previous checkout?');await expect(dialog).toContainText('HK$58.00');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(calls.map(call=>call.path)).toEqual(['/checkout']);
  await agreeToCreatorPass(page);await activate(page).click();await dialog.getByRole('button',{name:'Close previous checkout and continue',exact:true}).click();await expect(dialog).toContainText('HK$58.00');await expect(dialog).toContainText('Test payment');expect(calls.map(call=>call.path)).toEqual(['/checkout','/checkout','/cancel','/checkout']);for(const call of calls.filter(call=>call.path==='/checkout'))expect(call.body).toEqual({kind:'activation',amount_cents:8800,promo_code:'LINGYING58',promo_revision:1,language:'en',creator_consent:creatorConsent});
});

test('financial review holds block private quote application and new payment creation',async({page})=>{
  await fixture(page);await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{...viewer,payment_review:true}}}));const writes:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/payments/'))writes.push(new URL(request.url()).pathname);});
  await page.goto('/studio');await page.locator('#pass-promo-code').fill('LINGYING58');await expect(page.locator('.pass-promo-form button')).toBeDisabled();await expect(activate(page)).toBeDisabled();await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();expect(writes).toEqual([]);
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`a manually applied code is readable on a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await fixture(page);await page.goto('/studio');await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.locator('#pass-promo-code')).toHaveValue('');await expect(page.locator('.publisher-landing')).not.toContainText('LINGYING58');await apply(page);await expect(page.locator('.pass-usd-price')).toContainText('7.44');await expect(page.locator('.pass-billing-note')).toContainText('HK$58.00');await noOverflow(page);const input=page.locator('#pass-promo-code');expect(await input.evaluate(node=>getComputedStyle(node).fontSize)).toBe('16px');const bounds=await page.locator('.pass-promo-input-row>button').boundingBox();expect(bounds).not.toBeNull();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeGreaterThanOrEqual(44);
});


test('Pass activation and Account keep the processing-fee note next to the creator share without opening Checkout',async({page})=>{
  await fixture(page);const writes:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/payments/'))writes.push(new URL(request.url()).pathname);});
  await page.goto('/studio');
  await expect(page.locator('.activation-card li').filter({hasText:'You keep 70%'})).toContainText('(excluding Stripe transaction fees)');
  await expect(page.locator('.activation-card .provider-fee-estimate-note')).toContainText('creator’s 70% share');
  await page.goto('/account');
  await expect(page.locator('.dramio-pass-benefits')).toContainText('70% creator share (excluding Stripe transaction fees)');
  await expect(page.locator('.dramio-pass-card .provider-fee-estimate-note')).toContainText('Stripe fees vary by amount, destination and currency');
  expect(writes).toEqual([]);
});
