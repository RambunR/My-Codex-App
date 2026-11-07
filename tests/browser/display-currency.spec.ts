import {test,expect,type Page} from '@playwright/test';
import {agreeToCreatorPass,creatorConsent} from './helpers/creator-pass-consent';
const viewer={id:'display-currency-viewer',name:'Currency Viewer',email:'currency@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};
async function quote(page:Page,country:string,currency:string,ratePerHkd:number){await page.route('**/api/display-currency',route=>route.fulfill({json:{quote:{country,currency,ratePerHkd,asOf:'2026-11-04'}}}));}

test('a Taiwan visitor sees NT$ estimates in the Pass header, CTA, regular/discount prices and account card while Checkout stays HKD',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('drama-language','zh-TW'));
  await quote(page,'TW','TWD',4.169);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:viewer}}));
  await page.route('**/api/payments/promotion/quote',route=>route.fulfill({json:{promotion:{code:'PRIVATE58',amountHkdCents:5800,regularAmountHkdCents:8800,currency:'hkd',revision:1}}}));
  const writes:any[]=[];await page.route('**/api/payments/checkout',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{demo:true,paymentId:'local-currency-only',amount_cents:5800,currency:'hkd'}});});
  await page.goto('/studio');await expect(page.locator('.pass-local-price')).toHaveAttribute('data-currency','TWD');await expect(page.locator('.pass-local-price')).toContainText('366.87');
  await expect(page.locator('.activation-card>button.primary')).toContainText('≈ NT$366.87');await expect(page.locator('.pass-billing-note')).toContainText('HK$88.00');
  await page.locator('#pass-promo-code').fill('PRIVATE58');await page.locator('.pass-promo-form button').click();
  await expect(page.locator('.pass-local-price')).toContainText('241.80');await expect(page.locator('.pass-original-price')).toContainText('≈ NT$366.87');await expect(page.locator('.pass-billing-note')).toContainText('HK$58.00');
  await agreeToCreatorPass(page);await page.locator('.activation-card>button.primary').click();await expect(page.getByRole('dialog')).toContainText('HK$58.00');expect(writes).toEqual([{kind:'activation',amount_cents:8800,language:'zh-TW',promo_code:'PRIVATE58',promo_revision:1,creator_consent:creatorConsent}]);
  await page.goto('/account');await expect(page.locator('.dramio-pass-price>strong')).toHaveAttribute('data-currency','TWD');await expect(page.locator('.dramio-pass-price')).toContainText('≈ NT$366.87');await expect(page.locator('.dramio-pass-billing-note')).toContainText('HK$88.00');
});

test('an English interface in Japan uses yen rather than choosing a currency from the interface language',async({page})=>{
  await quote(page,'JP','JPY',20);await page.goto('/studio');await expect(page.locator('.pass-local-price')).toHaveAttribute('data-currency','JPY');await expect(page.locator('.activation-card>button.primary')).toContainText('≈ ¥1,760');await expect(page.locator('.pass-billing-note')).toContainText('HK$88.00');
});
test('failed or malformed location/rate responses keep exact HKD usable and never invent a local amount',async({page})=>{
  for(const response of [{status:503,json:{error:'unavailable'}},{json:{quote:{country:'TW',currency:'TWD',ratePerHkd:-5,asOf:'2026-11-04'}}}]){
    await page.route('**/api/display-currency',route=>route.fulfill(response));await page.goto('/studio');await expect(page.locator('.pass-local-price')).toHaveAttribute('data-currency','HKD');await expect(page.locator('.activation-card>button.primary')).toContainText('HK$88');await expect(page.locator('.activation-card>button.primary')).not.toContainText('≈');
  }
});
for(const [locale,width,country,currency,rate]of [['zh-TW',320,'TW','TWD',4.169],['ar',320,'AE','AED',0.47],['vi',320,'VN','VND',3400]] as const)test(`${currency} estimates and HKD disclosure fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.addInitScript(locale=>localStorage.setItem('drama-language',locale),locale);await quote(page,country,currency,rate);
  await page.goto('/studio');await expect(page.locator('.pass-local-price')).toHaveAttribute('data-currency',currency);await expect(page.locator('.pass-billing-note')).toContainText('HK$88.00');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
