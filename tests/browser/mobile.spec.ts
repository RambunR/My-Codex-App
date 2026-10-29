import {test,expect,type Locator,type Page} from '@playwright/test';

test.use({hasTouch:true,isMobile:true});

async function noHorizontalOverflow(page:Page){
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const viewport=page.viewportSize();
  if(viewport)expect(await page.evaluate(()=>document.documentElement.clientWidth)).toBe(viewport.width);
}

async function touchTarget(locator:Locator){
  await expect(locator).toBeVisible();
  const box=await locator.boundingBox();
  expect(box,'The control needs a rendered touch target').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

for(const width of [320,390,430])test(`phone discovery, filters and free playback work at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Little episodes. Big obsessions.'})).toBeVisible();
  await expect(page.locator('.series-card').first()).toBeVisible();
  await noHorizontalOverflow(page);
  const navigation=page.locator('.mobile-nav');
  const explore=navigation.getByRole('link',{name:'Explore',exact:true});
  await touchTarget(explore);
  await explore.tap();
  await expect(page).toHaveURL('/browse');
  const main=page.locator('main');
  const search=main.getByRole('searchbox');
  await search.fill('After Midnight');
  await search.press('Enter');
  await page.getByLabel('Drama language',{exact:true}).selectOption('en');
  await page.getByLabel('Genre',{exact:true}).selectOption('romance');
  await expect(page).toHaveURL(url=>url.pathname==='/browse'&&url.searchParams.get('q')==='After Midnight'&&url.searchParams.get('language')==='en'&&url.searchParams.get('genre')==='romance');
  await expect(page.locator('.series-card')).toHaveCount(1);
  await expect(page.locator('.series-card').first()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.locator('.series-card .poster-link').tap();
  await expect(page).toHaveURL('/series/after-midnight');
  await expect(page.getByRole('heading',{level:1,name:'After Midnight',exact:true})).toBeVisible();
  const watch=page.locator('main').getByRole('link',{name:'Watch now',exact:true});
  await touchTarget(watch);
  await touchTarget(page.getByRole('button',{name:'Save to my list',exact:true}));
  await touchTarget(page.getByRole('button',{name:'Like this series',exact:true}));
  await touchTarget(page.getByRole('button',{name:'Share',exact:true}));
  await noHorizontalOverflow(page);
  await watch.tap();
  await expect(page).toHaveURL('/watch/after-midnight/after-midnight-1');
  // HTML video has no implicit ARIA role; use its explicit accessible name.
  const player=page.locator('video[aria-label="After Midnight — Episode 1"]');
  await expect(player).toBeVisible();
  await expect.poll(()=>player.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('phone header search opens with focus, closes accessibly and submits a trimmed query',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  await page.goto('/');
  const toggle=page.locator('header .mobile-search-toggle');
  const form=page.locator('#site-search');
  const search=form.getByRole('searchbox');
  await touchTarget(toggle);
  await expect(toggle).toHaveAttribute('aria-controls','site-search');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(form).toBeHidden();
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(search).toBeFocused();
  await search.fill('After Midnight');
  await search.press('Escape');
  await expect(form).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).toBeFocused();
  await toggle.tap();
  const close=form.getByRole('button',{name:'Close',exact:true});
  await touchTarget(close);
  await close.tap();
  await expect(form).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.tap();
  await expect(search).toBeFocused();
  await search.fill('  After Midnight  ');
  await search.press('Enter');
  await expect(page).toHaveURL(url=>url.pathname==='/browse'&&url.searchParams.get('q')==='After Midnight');
  await expect(form).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(form.locator('input[type="search"]')).not.toBeFocused();
  await expect(page.locator('main .series-card')).toHaveCount(1);
  await noHorizontalOverflow(page);
});

test('a small phone can select the last language and retain right-to-left browsing',async({page})=>{
  await page.setViewportSize({width:320,height:640});
  await page.goto('/');
  const language=page.locator('header').getByRole('button',{name:'Language',exact:true});
  await touchTarget(language);
  await language.tap();
  let dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bounds=await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(321);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(641);
  const tamil=dialog.getByRole('button',{name:/தமிழ்/});
  await tamil.scrollIntoViewIfNeeded();
  await touchTarget(tamil);
  await tamil.tap();
  await expect(page.locator('html')).toHaveAttribute('lang','ta');
  await page.locator('header .header-language').tap();
  dialog=page.getByRole('dialog');
  const arabic=dialog.getByRole('button',{name:/العربية/});
  await arabic.scrollIntoViewIfNeeded();
  await arabic.tap();
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await expect(page.locator('.series-card').first()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto('/browse?language=ar&genre=fantasy');
  await expect(page.locator('.series-card')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Sand & Stars',exact:true})).toBeVisible();
  await noHorizontalOverflow(page);
});

test('phone episode navigation stays usable in portrait and short landscape',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/watch/after-midnight/after-midnight-1');
  await expect(page.locator('video')).toBeVisible();
  const next=page.getByRole('button',{name:'Next',exact:true});
  await touchTarget(next);
  await touchTarget(page.getByRole('button',{name:'Previous',exact:true}));
  const episodeTwo=page.getByRole('link',{name:/^Episode 2(?: Free)?$/});
  await touchTarget(episodeTwo);
  await next.tap();
  await expect(page).toHaveURL('/watch/after-midnight/after-midnight-2');
  await page.setViewportSize({width:844,height:390});
  await expect(page.locator('video')).toBeVisible();
  await noHorizontalOverflow(page);
  const videoBox=await page.locator('video').boundingBox();
  expect(videoBox!.height).toBeLessThanOrEqual(390);
  const previous=page.getByRole('button',{name:'Previous',exact:true});
  await touchTarget(previous);
  await previous.tap();
  await expect(page).toHaveURL('/watch/after-midnight/after-midnight-1');
  await noHorizontalOverflow(page);
});

test('maximum-length uploaded story text does not push the phone player off screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const title='W'.repeat(120);
  await page.route('**/api/series/after-midnight',async route=>{
    const response=await route.fetch();const data=await response.json();
    await route.fulfill({response,json:{...data,series:{...data.series,title,description:'D'.repeat(4000),creator_name:'C'.repeat(60)},episodes:data.episodes.map((episode:Record<string,unknown>)=>({...episode,title:'E'.repeat(120)}))}});
  });
  await page.goto('/watch/after-midnight/after-midnight-1');
  await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
  await noHorizontalOverflow(page);
  await touchTarget(page.getByRole('button',{name:'Next',exact:true}));
  await page.setViewportSize({width:844,height:390});
  await noHorizontalOverflow(page);
  await touchTarget(page.getByRole('button',{name:'Next',exact:true}));
});

test('phone registration fields stay readable and company contact is reachable above navigation',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  await page.goto('/auth?mode=register');
  for(const name of ['Name','Email address','Password']){
    const input=page.getByLabel(name,{exact:true});
    await expect(input).toBeVisible();
    expect(await input.evaluate(element=>Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await touchTarget(page.getByRole('button',{name:'Create account',exact:true}).last());
  await noHorizontalOverflow(page);
  await page.goto('/help');
  await expect(page.locator('main')).toContainText('HK NovaXR Production');
  const contact=page.locator('footer').getByRole('link',{name:'contactus@hknovaxrproduction.com',exact:true});
  await expect(contact).toHaveAttribute('href','mailto:contactus@hknovaxrproduction.com');
  await contact.scrollIntoViewIfNeeded();
  await touchTarget(contact);
  await contact.click({trial:true});
  await noHorizontalOverflow(page);
});
