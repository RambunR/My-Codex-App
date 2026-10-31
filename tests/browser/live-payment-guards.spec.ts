import {test,expect,type Page} from '@playwright/test';

const user={id:'review-browser-user',name:'Review creator',email:'review@browser.test',role:'publisher',publisher_active:1,wallet_micros:5_000_000,earnings_micros:100_000_000,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:true,test:false,purchased_at:null}};

async function configureLive(page:Page,held=false){
  const account={...user,payment_review:held};const writes:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
  await page.route('**/api/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false}});});
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:account}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{user:account,ledger:[],payments:[]}}));
  await page.route('**/api/studio',route=>route.fulfill({json:{user:account,series:[],stats:{sales:0,lifetime_micros:100_000_000},withdrawals:[],storageRequests:[]}}));
  return writes;
}

test('live financial review holds retain balances and block new funding and publishing controls',async({page})=>{
  const writes=await configureLive(page,true);
  await page.goto('/wallet');
  await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();
  await expect(page.locator('.balance-card')).toContainText('$5.00');
  await expect(page.getByRole('button',{name:/Add funds.*5\.00/})).toBeDisabled();
  await expect(page.locator('.sandbox-notice')).toHaveCount(0);
  await page.goto('/studio');
  await expect(page.getByRole('button',{name:'New series',exact:true})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();
  await page.goto('/studio/new');
  await expect(page.getByRole('heading',{name:'Payment account under review',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save details',exact:true})).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('live Checkout can be available while creator payout controls remain paused without a test-money notice',async({page})=>{
  const writes=await configureLive(page);
  await page.goto('/wallet');
  await expect(page.getByRole('button',{name:/Add funds.*5\.00/})).toBeEnabled();
  await expect(page.locator('.sandbox-notice')).toHaveCount(0);
  await expect(page.getByText('Stripe test payments.',{exact:false})).toHaveCount(0);
  await page.goto('/studio');
  await page.getByRole('button',{name:'Earnings & payouts',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Creator payouts temporarily unavailable',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Set up payout account',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Request payout',exact:true})).toBeDisabled();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});

test('admin payment review requires mapped evidence, notes and explicit accounting confirmation',async({page})=>{
  await configureLive(page);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{...user,role:'admin'}}}));
  await page.route('**/api/admin',route=>route.fulfill({json:{stats:{users:1,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]}}));
  let resolved=false;const submitted:unknown[]=[];
  const review={id:'review-mapped',mode:'live',user_id:'held-viewer',user_name:'Held viewer',email:'held@browser.test',payment_id:'payment-fixture',payment_kind:'funding',kind:'refund',amount_cents:200,currency:'usd',remaining_cents:200,wallet_debit_cents:0,platform_loss_cents:0,provider_status:'refunded',created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'};
  await page.route('**/api/admin/payment-reviews',route=>route.fulfill({json:{reviews:[{...review,status:resolved?'resolved':'open',note:resolved?'Verified refund evidence and allocation.':''},{...review,id:'review-unmapped',user_id:null,user_name:'Unmatched event',payment_id:null,status:'open'}]}}));
  await page.route('**/api/admin/payment-reviews/review-mapped/resolve',async route=>{submitted.push(route.request().postDataJSON());resolved=true;await route.fulfill({json:{review:{...review,status:'resolved'}}});});
  await page.goto('/admin');
  await page.getByRole('button',{name:'Payment reviews',exact:true}).click();
  const panel=page.locator('.payment-reviews-panel');
  await panel.locator('.payment-review-row').filter({hasText:'Unmatched event'}).getByRole('button',{name:'Payment reviews',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('This event is not matched to a local payment.');
  await expect(dialog.getByRole('button',{name:'Resolve review',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await panel.locator('.payment-review-row').filter({hasText:'Held viewer'}).getByRole('button',{name:'Payment reviews',exact:true}).click();
  const resolve=dialog.getByRole('button',{name:'Resolve review',exact:true});
  await expect(resolve).toBeDisabled();
  await dialog.getByLabel('Resolution',{exact:true}).selectOption('platform_loss');
  await dialog.getByLabel('Wallet debit (USD)',{exact:true}).fill('1.25');
  await dialog.getByLabel('Review notes',{exact:true}).fill('Verified refund evidence and allocation.');
  await expect(resolve).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await resolve.click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.locator('.payment-review-row').filter({hasText:'Held viewer'})).toContainText('Resolved');
  expect(submitted).toEqual([{decision:'platform_loss',note:'Verified refund evidence and allocation.',wallet_debit_cents:125}]);
});

test('terminal disputes require a newer provider outcome for conflicts and only restore verified wins',async({page})=>{
  await configureLive(page);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{...user,role:'admin'}}}));
  await page.route('**/api/admin',route=>route.fulfill({json:{stats:{users:1,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]}}));
  let resolved=false;const submitted:unknown[]=[];
  const review={id:'review-won',mode:'live',user_id:'winning-viewer',user_name:'Winning viewer',user_email:'won@browser.test',payment_id:'payment-won-fixture',payment_kind:'funding',kind:'dispute',amount_cents:500,currency:'usd',remaining_cents:0,wallet_debit_cents:300,platform_loss_cents:200,provider_status:'won',created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'};
  await page.route('**/api/admin/payment-reviews',route=>route.fulfill({json:{reviews:[{...review,status:resolved?'resolved':'open'},{...review,id:'review-conflict',user_name:'Conflicting viewer',provider_status:'conflicting',status:'open'}]}}));
  await page.route('**/api/admin/payment-reviews/review-won/resolve',async route=>{submitted.push(route.request().postDataJSON());resolved=true;await route.fulfill({json:{review:{...review,status:'resolved'}}});});
  await page.goto('/admin');
  await page.getByRole('button',{name:'Payment reviews',exact:true}).click();
  const panel=page.locator('.payment-reviews-panel');
  await panel.locator('.payment-review-row').filter({hasText:'Conflicting viewer'}).getByRole('button',{name:'Payment reviews',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('A newer provider update is needed before this review can be resolved.');
  await expect(dialog.getByRole('button',{name:'Resolve review',exact:true})).toHaveCount(0);
  await expect(dialog.locator('form')).toHaveCount(0);
  expect(submitted).toEqual([]);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await panel.locator('.payment-review-row').filter({hasText:'Winning viewer'}).getByRole('button',{name:'Payment reviews',exact:true}).click();
  const resolution=dialog.getByLabel('Resolution',{exact:true});
  await expect(resolution).toHaveValue('provider_reversed');
  await expect(resolution.locator('option')).toHaveCount(1);
  await expect(resolution.locator('option')).toHaveText('Provider reversed the dispute');
  await expect(dialog).toContainText('A previous wallet debit is restored once.');
  await expect(dialog.getByLabel('Wallet debit (USD)',{exact:true})).toHaveCount(0);
  await dialog.getByLabel('Review notes',{exact:true}).fill('Verified the signed dispute-won outcome.');
  await expect(dialog.getByRole('button',{name:'Resolve review',exact:true})).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Resolve review',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toEqual([{decision:'provider_reversed',note:'Verified the signed dispute-won outcome.',wallet_debit_cents:0}]);
});
