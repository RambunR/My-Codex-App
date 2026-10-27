import {test,expect} from '@playwright/test';
import path from 'node:path';
test('desktop catalogue, search, genre and language filters navigate to real series',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Little episodes. Big obsessions.'})).toBeVisible();await expect(page.locator('.series-card')).toHaveCount(12);
  await page.getByRole('link',{name:'Explore',exact:true}).first().click();await page.getByLabel('Drama language').selectOption('ko');await expect(page.locator('.series-card')).toHaveCount(2);
  await page.locator('.series-card').first().click();await expect(page.locator('.episode-tile')).toHaveCount(8);expect(errors).toEqual([]);
});
test('guest watches free previews, encounters the paywall, and is prompted to register',async({page})=>{
  await page.goto('/watch/after-midnight/after-midnight-1');await expect(page.locator('video')).toBeVisible();await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThan(0);
  await page.goto('/watch/after-midnight/after-midnight-3');await expect(page.getByRole('heading',{name:'Locked episode'})).toBeVisible();await page.getByRole('button',{name:/Unlock episode/}).click();await expect(page).toHaveURL(/\/auth\?/);
});
test('registration, test wallet funding and a paid unlock persist across reload',async({page})=>{
  await page.goto('/auth?mode=register&next=/wallet');await page.getByLabel('Name',{exact:true}).fill('Browser Viewer');await page.getByLabel('Email address',{exact:true}).fill(`viewer-${Date.now()}@browser.test`);await page.getByLabel('Password',{exact:true}).fill('BrowserPass123!');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();await expect(page).toHaveURL('/wallet');
  await page.getByRole('button',{name:'US$5',exact:true}).click();await page.getByRole('button',{name:/Add funds ·/}).click();await expect(page.getByRole('dialog')).toContainText('No real money');await page.getByRole('button',{name:'Confirm test payment'}).click();await expect(page.locator('.balance-card>strong')).toHaveText('$5.00');
  await page.goto('/watch/after-midnight/after-midnight-3');await page.getByRole('button',{name:/Unlock episode/}).click();await page.getByRole('button',{name:/Confirm ·/}).click();await expect(page.locator('video')).toBeVisible();await page.reload();await expect(page.locator('video')).toBeVisible();
  await page.goto('/wallet');await expect(page.locator('.balance-card>strong')).toHaveText('$4.70');
});
test('publisher pays activation, creates a series, uploads a folder, edits and publishes',async({page})=>{
  await page.goto('/auth?mode=register&next=/studio');await page.getByLabel('Name',{exact:true}).fill('Browser Creator');await page.getByLabel('Email address',{exact:true}).fill(`creator-${Date.now()}@browser.test`);await page.getByLabel('Password',{exact:true}).fill('BrowserPass123!');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();await expect(page).toHaveURL('/studio');
  await page.getByRole('button',{name:'Get Dramio Pass · HK$88'}).click();await expect(page.getByRole('dialog')).toContainText('HK$88.00');await page.getByRole('button',{name:'Confirm test payment'}).click();await page.getByRole('link',{name:'New series',exact:true}).first().click();
  await page.getByLabel('Series title',{exact:true}).fill(`A Browser Original ${Date.now()}`);await page.getByLabel('Synopsis',{exact:true}).fill('A short original story published through the complete creator workflow.');await page.getByLabel('Drama language',{exact:false}).selectOption('zh-TW');
  await page.locator('input[type=file][accept="image/jpeg,image/png,image/webp"]').setInputFiles(path.resolve('public/images/midnight.jpg'));
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect(page).toHaveURL(/\/studio\/series\//);
  const fs=await import('node:fs/promises');const folder=await fs.mkdtemp('/tmp/aidramio-folder-');await fs.copyFile('/tmp/aidramio-browser-tests/objects/demo/preview.mp4',path.join(folder,'02 A second encounter.mp4'));await fs.copyFile('/tmp/aidramio-browser-tests/objects/demo/preview.mp4',path.join(folder,'01 Opening.mp4'));const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose a folder',exact:true}).click();await (await chooser).setFiles(folder);
  await expect(page.locator('.queue-row small')).toHaveText(['Uploaded','Uploaded'],{timeout:30000});await fs.rm(folder,{recursive:true,force:true});await page.getByRole('button',{name:'Publish series',exact:true}).click();await expect(page.locator('.editor-details .status')).toHaveText('Published');
  await page.getByRole('link',{name:'Watch',exact:true}).click();await expect(page.locator('.detail-info h1')).toContainText('A Browser Original');await expect(page.locator('.episode-tile')).toHaveCount(2);
});
test('all 21 language options work and Arabic has right-to-left layout',async({page})=>{
  await page.goto('/');await page.locator('.header-language').click();await expect(page.locator('.language-option')).toHaveCount(21);await page.locator('.language-option').filter({hasText:'繁體中文'}).click();await expect(page.locator('html')).toHaveAttribute('lang','zh-TW');await expect(page.locator('.home-heading h1')).toHaveText('小小篇幅。 大大心動。');
  await page.locator('.header-language').click();await page.locator('.language-option').filter({hasText:'العربية'}).click();await expect(page.locator('html')).toHaveAttribute('dir','rtl');await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','ar');
});
test('phone layout has native-style navigation with no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.mobile-nav')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.mobile-nav').getByRole('link',{name:'Explore',exact:true}).click();await expect(page).toHaveURL('/browse');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
