import {test,expect} from '@playwright/test';

test('Dramio Pass purchase appears on Account and persists without another payment',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/auth?mode=register&next=/account');
  await page.getByLabel('Name',{exact:true}).fill('Dramio Pass Viewer');
  await page.getByLabel('Email address',{exact:true}).fill(`pass-${Date.now()}@browser.test`);
  await page.getByLabel('Password',{exact:true}).fill('BrowserPass123!');
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();
  await expect(page).toHaveURL('/account');
  const card=page.locator('.dramio-pass-card');await expect(card).toBeVisible();await expect(card).toContainText('Dramio Pass');await expect(card).toContainText('Not purchased');
  await card.getByRole('link',{name:'Get Dramio Pass',exact:true}).click();await expect(page).toHaveURL('/studio');
  await page.getByRole('button',{name:/Get Dramio Pass.*HK\$88/}).click();
  await expect(page.getByRole('dialog')).toContainText('HK$88.00');await page.getByRole('button',{name:'Confirm test payment'}).click();
  await expect(page.getByRole('link',{name:'New series',exact:true}).first()).toBeVisible();
  await page.goto('/account');await expect(card).toContainText('Dramio Pass');await expect(card).toContainText('Active');await expect(card).toContainText('Test pass');
  await expect(card.getByRole('link',{name:'Open Creator studio',exact:true})).toBeVisible();await expect(card.getByRole('link',{name:'Get Dramio Pass',exact:true})).toHaveCount(0);
  const icon=card.locator('img').first();await expect(icon).toBeVisible();expect(await icon.evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
  await page.reload();await expect(card).toContainText('Active');await expect(card).toContainText('Purchased on');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const me=await(await page.request.get('/api/auth/me')).json();expect(me.user.dramio_pass.active).toBe(true);expect(me.user.dramio_pass.test).toBe(true);
  const wallet=await(await page.request.get('/api/wallet')).json();expect(wallet.payments.filter((payment:any)=>payment.kind==='activation'&&payment.status==='paid')).toHaveLength(1);
  expect(errors).toEqual([]);
});
