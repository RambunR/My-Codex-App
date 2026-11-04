import {test,expect,type Page} from '@playwright/test';
const account={id:'owner-test-browser',name:'Owner administrator',email:'owner@browser.test',role:'admin',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5368709120,used_bytes:0,language:'en',payment_review:false,test_withdrawal_unlimited:true};
async function fixture(page:Page,unlimited=true,testMode=true,currency:'hkd'|'usd'='hkd'){
 const user={...account,test_withdrawal_unlimited:unlimited};let rows:any[]=[];const submissions:any[]=[];
 await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
 await page.route('**/api/config',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,paymentsMode:'stripe',paymentsTestMode:testMode,paymentsReady:true,payoutsEnabled:false}});});
 await page.route('**/api/studio',route=>route.fulfill({json:{user,series:[],withdrawals:[],storageRequests:[],stats:{sales:0,lifetime_micros:0}}}));
 await page.route('**/api/studio/test-withdrawals',async route=>{
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();submissions.push(body);
   const exchange=currency==='usd'?1:7.8;
   const r={id:'test-withdrawal-fixture',gross_cents:body.amount_cents,fee_cents:0,net_cents:body.amount_cents,currency,provider_amount:Math.round(body.amount_cents*exchange),exchange_rate:exchange,status:'pending',transfer_id:null,payout_id:null,error_code:'',created_at:'2026-11-04 00:00:00',updated_at:'2026-11-04 00:00:00'};
   rows=[r];await route.fulfill({status:201,json:{request:r}});return;
  }
  await route.fulfill({json:{unlimited:true,ready:true,connectedAccount:'acct_browser_test',platformAccount:'acct_platform_test',currency,exchangeRate:currency==='usd'?1:7.8,minimumCents:1000,feeCents:0,maxCents:10000000,requests:rows}});
 });
 await page.route('**/api/studio/test-withdrawals/test-withdrawal-fixture/process',async route=>{rows[0]={...rows[0],status:'payout_pending',transfer_id:'tr_browser',payout_id:'po_browser'};await route.fulfill({json:{request:rows[0]}});});
 await page.route('**/api/studio/test-withdrawals/test-withdrawal-fixture/sync',async route=>{rows[0]={...rows[0],status:'paid'};await route.fulfill({json:{request:rows[0]}});});
 return{submissions,setCurrency:(next:'hkd'|'usd')=>{currency=next;}};
}

test('owner has unlimited simulated earnings and can request, process and reconcile a test payout with zero earnings',async({page})=>{
 const f=await fixture(page);await page.goto('/studio');await page.getByRole('button',{name:'Earnings & payouts',exact:true}).click();
 const panel=page.getByRole('region',{name:'Administrator sandbox withdrawals'});
 await expect(panel.getByRole('heading',{name:'Unlimited test allowance'})).toBeVisible();
 await expect(panel).toContainText('real earnings are unchanged');await expect(panel).toContainText('No platform withdrawal fee.');await expect(panel.locator('.balance-row').filter({hasText:'Withdrawal fee'})).toContainText('$0.00');await expect(panel.locator('.test-bank-currency')).toContainText('Hong Kong Dollar (HKD)');await expect(panel.locator('output')).toHaveText('~ HK$78.00 HKD');
 const formBounds=await panel.locator('form').boundingBox(),calloutBounds=await panel.locator('.earnings-callout').boundingBox();expect(formBounds).not.toBeNull();expect(calloutBounds).not.toBeNull();expect(Math.abs(formBounds!.width-calloutBounds!.width)).toBeLessThanOrEqual(1);
 await expect(panel.locator('.payout-fee-notice')).toContainText('creator’s 70% share');
 const amount=panel.getByLabel('Amount to withdraw (USD)');await amount.fill('9.99');await expect(panel.getByRole('button',{name:'Request payout',exact:true})).toBeDisabled();
 await amount.fill('10.00');await panel.getByRole('button',{name:'Request payout',exact:true}).click();
 await expect(panel.locator('.test-withdrawal-history')).toContainText('$10.00');
 await expect(panel.locator('.test-withdrawal-history .status')).toHaveText('Pending');
 await expect(panel).toContainText('No money is sent to a real bank.');
 await panel.getByRole('button',{name:'Process test withdrawal',exact:true}).click();
 await expect(panel.locator('.test-withdrawal-history')).toContainText('Test bank payout pending');
 await expect(panel.locator('.test-withdrawal-history .status')).not.toHaveText('Test payout completed');
 await panel.getByRole('button',{name:'Refresh payout status',exact:true}).click();await expect(panel.locator('.test-withdrawal-history .status')).toHaveText('Test payout completed');
 expect(f.submissions).toHaveLength(1);expect(f.submissions[0].amount_cents).toBe(1000);expect(f.submissions[0].request_key).toMatch(/^[a-f0-9-]{36}$/);
});

test('a Japanese interface keeps a USD receiving bank in USD and submits the gross USD withdrawal',async({page})=>{
 const f=await fixture(page,true,true,'usd');await page.addInitScript(()=>localStorage.setItem('drama-language','ja'));
 await page.goto('/studio');await page.getByRole('button',{name:'収益と出金',exact:true}).click();
 const panel=page.locator('.admin-test-withdrawals');await expect(panel.locator('.test-bank-currency')).toContainText('米ドル (USD)');
 await panel.getByRole('spinbutton').fill('20.00');await expect(panel.locator('output')).toHaveText('~ $20.00 USD');
 await panel.locator('button[type=submit]').click();await expect(panel.locator('.test-withdrawal-history')).toContainText('$20.00 USD');
 expect(f.submissions[0].amount_cents).toBe(2000);
});

test('saved bank amounts retain their original currency when the receiving currency changes',async({page})=>{
 const f=await fixture(page);await page.goto('/studio');await page.getByRole('button',{name:'Earnings & payouts',exact:true}).click();
 const panel=page.locator('.admin-test-withdrawals');await panel.getByRole('spinbutton').fill('20.00');await expect(panel.locator('output')).toHaveText('~ HK$156.00 HKD');
 await panel.locator('button[type=submit]').click();await expect(panel.locator('.test-withdrawal-history')).toContainText('HK$156.00 HKD');
 f.setCurrency('usd');await page.reload();await page.getByRole('button',{name:'Earnings & payouts',exact:true}).click();
 await expect(panel.locator('.test-bank-currency')).toContainText('US Dollar (USD)');await expect(panel.locator('output')).toHaveText('~ $10.00 USD');
 await expect(panel.locator('.test-withdrawal-history')).toContainText('HK$156.00 HKD');
 expect(f.submissions).toHaveLength(1);
});

test('receiving currency and the largest bank estimate wrap on an Arabic phone',async({page})=>{
 await fixture(page);await page.addInitScript(()=>localStorage.setItem('drama-language','ar'));await page.setViewportSize({width:320,height:740});
 await page.goto('/studio');await page.locator('.tab-bar button').filter({hasText:'الأرباح'}).click();
 const panel=page.locator('.admin-test-withdrawals');await expect(panel.locator('.test-bank-currency')).toContainText('HKD');
 await panel.getByRole('spinbutton').fill('100000.00');await expect(panel.locator('output .bank-currency-code')).toHaveText('HKD');
 await expect(panel.locator('button[type=submit]')).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('other administrators and the live-mode UI do not receive an unlimited payout panel',async({page})=>{
 await fixture(page,false);await page.goto('/studio');await page.getByRole('button',{name:'Earnings & payouts',exact:true}).click();
 await expect(page.locator('.admin-test-withdrawals')).toHaveCount(0);await expect(page.getByRole('button',{name:'Request payout',exact:true})).toBeDisabled();
});

test('a stale owner test flag does not reveal the sandbox controls in live mode',async({page})=>{
 await fixture(page,true,false);await page.goto('/studio');await page.getByRole('button',{name:'Earnings & payouts',exact:true}).click();await expect(page.locator('.admin-test-withdrawals')).toHaveCount(0);
});

test('Traditional Chinese administrator testing fits a phone viewport and shows the finite request limit',async({page})=>{
 await fixture(page);await page.addInitScript(()=>localStorage.setItem('drama-language','zh-TW'));await page.setViewportSize({width:390,height:844});
 await page.goto('/studio');await page.getByRole('button',{name:'收益與提款',exact:true}).click();
 const panel=page.locator('.admin-test-withdrawals');await expect(panel).toContainText('無限測試額度');await expect(panel).toContainText('不影響真實收益');await expect(panel).toContainText('不收取平台提領手續費');await expect(panel.locator('.balance-row').filter({hasText:'提領手續費'})).toContainText('$0.00');
 const input=panel.getByRole('spinbutton');await expect(input).toHaveAttribute('max','100000.00');await input.fill('100000.01');await expect(panel.locator('button[type=submit]')).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
