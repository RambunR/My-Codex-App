import {test,expect,type Page} from '@playwright/test';

const gib=1024**3;
const admin={id:'unlimited-storage-admin',name:'Storage administrator',email:'storage-admin@browser.test',role:'admin',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*gib,used_bytes:12*gib,storage_unlimited:true,language:'en',payment_review:false};
const publisher={...admin,id:'limited-publisher',name:'Limited publisher',role:'publisher',publisher_active:1,used_bytes:gib,storage_unlimited:false};
const series={id:'storage-display-series',creator_id:admin.id,title:'Storage display drama',description:'An original series used to verify the storage allowance shown in the creator editor.',language:'en',genres:['drama'],themes:[],format:null,creation_type:'human',cover:'/images/placeholder.svg',price_cents:10,free_episodes:1,episode_count:0,views:0,saves:0,likes:0,status:'draft',featured:0,created_at:'2026-11-03 00:00:00'};
async function identity(page:Page,user=admin){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
  await page.route('**/api/studio',route=>route.fulfill({json:{user,series:[],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}}));
  await page.route('**/api/admin/publishers',route=>route.fulfill({json:{publishers:[],default_publisher_id:null}}));
}

for(const[locale,label]of [['en','Unlimited'],['zh-TW','無上限'],['ar','غير محدود']] as const)test(`administrator storage is unlimited beyond 5 GB on a ${locale} phone`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await identity(page);
  await page.goto('/studio');await expect(page.locator('html')).toHaveAttribute('lang',locale);
  const stat=page.locator('.stat-card').last();await expect(stat).toContainText('12.00 GB');await expect(stat).toContainText(label);await expect(stat.locator('.progress-line')).toHaveCount(0);
  // The storage tab is the final Studio tab, independent of translated navigation labels.
  await page.locator('.studio-page>.tab-bar button').last().click();const panel=page.locator('.storage-panel');await expect(panel).toContainText(label);await expect(panel).toContainText('12.00 GB');await expect(panel.locator('.progress-line,button')).toHaveCount(0);await expect(panel).not.toContainText('5.00 GB');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('publisher storage keeps its quota, progress and request control',async({page})=>{
  await identity(page,publisher);await page.goto('/studio');const stat=page.locator('.stat-card').last();await expect(stat).toContainText('1.00 GB');await expect(stat).toContainText('5.00 GB');await expect(stat.locator('.progress-line')).toHaveCount(1);
  await page.getByRole('button',{name:'Storage',exact:true}).click();const panel=page.locator('.storage-panel');await expect(panel).toContainText('5.00 GB');await expect(panel.getByRole('button',{name:'Request more storage',exact:true})).toBeVisible();await expect(panel.locator('.progress-line')).toHaveCount(1);
});

for(const owner of [admin,publisher])test(`editor uses ${owner.role} owner's storage instead of administrator actor`,async({page})=>{
  await identity(page);await page.route('**/api/studio/series/storage-display-series',route=>route.fulfill({json:{series:{...series,creator_id:owner.id},episodes:[],episodes_revision:'storage-fixture',owner_storage:{used_bytes:owner.used_bytes,quota_bytes:owner.quota_bytes,storage_unlimited:owner.storage_unlimited}}}));
  await page.goto('/studio/series/storage-display-series');const storage=page.locator('.editor-storage');await expect(storage).toBeVisible();
  if(owner.storage_unlimited){await expect(storage).toContainText('12.00 GB / Unlimited');await expect(storage.locator('.progress-line,a')).toHaveCount(0);}
  else{await expect(storage).toContainText('1.00 GB / 5.00 GB');await expect(storage).not.toContainText('Unlimited');await expect(storage.locator('.progress-line')).toHaveCount(1);await expect(storage.getByRole('link',{name:'Request more storage',exact:true})).toBeVisible();}
});

test('administrator members list distinguishes unlimited accounts from ordinary publisher quotas',async({page})=>{
  await identity(page);await page.route('**/api/admin',route=>route.fulfill({json:{stats:{users:2,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},users:[admin,publisher],storageRequests:[],withdrawals:[]}}));
  await page.goto('/admin?tab=members');await expect(page.locator('.member-row').filter({hasText:admin.name})).toContainText('12.00 GB / Unlimited');await expect(page.locator('.member-row').filter({hasText:publisher.name})).toContainText('1.00 GB / 5.00 GB');
});
