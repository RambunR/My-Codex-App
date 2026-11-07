import {test,expect,type Page} from '@playwright/test';
import {demoAdminSession} from './helpers/admin-session';

const draft={title:'Spoken language fixture',description:'An original short drama with independently declared spoken and subtitle languages.',language:'cmn',genres:['romance'],creation_type:'human',price_cents:10,free_episodes:1};
const subtitleCodes=['zh-TW','zh-CN'];
async function saveDetails(page:Page){
  const saved=page.waitForResponse(response=>/\/api\/studio\/series(?:\/[^/]+)?$/.test(new URL(response.url()).pathname)&&['POST','PATCH'].includes(response.request().method()));
  await page.locator('.editor-heading-actions').getByRole('button',{name:'Save details',exact:true}).click();
  const response=await saved;expect(response.ok()).toBe(true);return response;
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
const spokenFilter=(page:Page)=>page.locator('.browse-controls select').filter({has:page.locator('option[value="cmn"]')});

test('Mandarin and Cantonese save independently of Simplified and Traditional Chinese subtitles',async({page})=>{
  const before=await demoAdminSession(page);await page.goto('/studio/new');
  const select=page.locator('#series-language');await expect(select.locator('option')).toHaveCount(21);
  await expect(select.locator('option[value="cmn"]')).toContainText('Mandarin');await expect(select.locator('option[value="yue"]')).toContainText('Cantonese');
  await expect(select.locator('option[value="zh-TW"],option[value="zh-CN"]')).toHaveCount(0);
  await page.locator('#series-title').fill(`Mandarin draft ${Date.now()}`);await page.locator('#series-description').fill(draft.description);await select.selectOption('cmn');
  await page.locator('.subtitle-language-toggle').click();for(const code of subtitleCodes)await page.locator(`.subtitle-language-option input[value="${code}"]`).check();
  const created=await saveDetails(page);expect(created.request().postDataJSON()).toMatchObject({language:'cmn',subtitle_languages:subtitleCodes});
  await expect(page).toHaveURL(/\/studio\/series\//);const id=new URL(page.url()).pathname.split('/').at(-1)!;
  await page.reload();await expect(select).toHaveValue('cmn');await expect(page.locator('.subtitle-language-chips>li')).toHaveText(['繁體中文','简体中文']);
  await select.selectOption('yue');const updated=await saveDetails(page);expect(updated.request().postDataJSON().language).toBe('yue');expect(updated.request().postDataJSON()).not.toHaveProperty('subtitle_languages');
  await page.reload();await expect(select).toHaveValue('yue');
  const saved=(await(await page.request.get(`/api/studio/series/${id}`)).json()).series;expect(saved).toMatchObject({language:'yue',subtitle_languages:subtitleCodes});
  const after=(await(await page.request.get('/api/auth/me')).json()).user;for(const key of ['language','wallet_micros','earnings_micros','publisher_active'])expect(after[key]).toEqual(before[key]);
});

for(const legacy of ['zh-TW','zh-CN'])test(`editing a legacy ${legacy} series never guesses its spoken variety`,async({page})=>{
  await demoAdminSession(page);const response=await page.request.post('/api/studio/series',{data:{...draft,title:`Legacy Chinese ${legacy} ${Date.now()}`,language:legacy,subtitle_languages:subtitleCodes}});expect(response.status()).toBe(201);const{id}=await response.json();
  await page.goto(`/studio/series/${id}`);const select=page.locator('#series-language');await expect(select).toHaveValue(legacy);await expect(select.locator('option')).toHaveCount(22);
  const retained=select.locator(`option[value="${legacy}"]`);await expect(retained).toContainText('Chinese');await expect(retained).not.toContainText(/Simplified|Traditional|Mandarin|Cantonese/);
  await page.locator('#series-title').fill(`Edited without retagging ${legacy} ${Date.now()}`);const unchanged=await saveDetails(page);expect(unchanged.request().postDataJSON().language).toBe(legacy);await page.reload();await expect(select).toHaveValue(legacy);
  await select.selectOption('yue');await saveDetails(page);await page.reload();await expect(select).toHaveValue('yue');await expect(select.locator('option[value="zh-TW"],option[value="zh-CN"]')).toHaveCount(0);
  expect((await(await page.request.get(`/api/studio/series/${id}`)).json()).series).toMatchObject({language:'yue',subtitle_languages:subtitleCodes});
});

const release={id:'spoken-public-fixture',title:'A Cantonese original story',description:draft.description,language:'yue',genres:['romance'],themes:[],format:'live-action',creation_type:'human',cover:'/images/placeholder.svg',creator_name:'Independent creator',price_cents:10,free_episodes:1,episode_count:1,first_episode_id:'spoken-episode',views:0,saves:0,likes:0,liked:false,status:'published',featured:1,demo:0,created_at:'2026-11-08T00:00:00Z',subtitle_languages:subtitleCodes};
async function publicFixture(page:Page){
  await page.route('**/api/series**',route=>route.fulfill({json:new URL(route.request().url()).pathname===`/api/series/${release.id}`?{series:release,episodes:[{id:release.first_episode_id,series_id:release.id,title:'Episode one',number:1,duration:12,bytes:100,free:false,unlocked:false}]}:{series:[release]}}));
}

for(const[locale,mandarin,cantonese]of [['en','Mandarin','Cantonese'],['zh-TW','普通話','粵語'],['zh-CN','普通话','粤语'],['ar','الماندرين','الكانتونية']] as const)test(`spoken choices use language names while Chinese writing options remain available in ${locale}`,async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  const user={id:'spoken-ui-owner',name:'Creator',email:'spoken-ui@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:locale};await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
  await page.goto('/studio/new');const select=page.locator('#series-language');await expect(select).toHaveValue(locale.startsWith('zh-')?'cmn':locale);
  await expect(select.locator('option')).toHaveCount(21);await expect(select.locator('option[value="cmn"]')).toContainText(mandarin);await expect(select.locator('option[value="yue"]')).toContainText(cantonese);await expect(select.locator('option[value="zh-TW"],option[value="zh-CN"]')).toHaveCount(0);
  await page.locator('.subtitle-language-toggle').click();await expect(page.locator('.subtitle-language-option input')).toHaveCount(21);for(const code of subtitleCodes)await expect(page.locator(`.subtitle-language-option input[value="${code}"]`)).toBeVisible();await noOverflow(page);
  await publicFixture(page);await page.goto('/browse?language=cmn&genre=romance&sort=new');const filter=spokenFilter(page);await expect(filter).toHaveValue('cmn');await expect(filter.locator('option[value="cmn"]')).toHaveText(mandarin);await expect(filter.locator('option[value="yue"]')).toHaveText(cantonese);await expect(filter.locator('option[value="zh-TW"],option[value="zh-CN"]')).toHaveCount(0);
  const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/series'&&new URL(request.url()).searchParams.get('language')==='yue');await filter.selectOption('yue');expect((await request).method()).toBe('GET');await expect(page).toHaveURL(url=>url.searchParams.get('language')==='yue'&&url.searchParams.get('genre')==='romance'&&url.searchParams.get('sort')==='new');await expect(page.locator('.series-card-info p').first()).toContainText(cantonese);await noOverflow(page);
  await page.goto('/browse?language=zh-TW&sort=new');await expect(filter).toHaveValue('zh-TW');await expect(filter.locator('option[value="zh-TW"]')).not.toContainText(/繁體|繁体|Traditional|Cantonese|粵語|粤语/);await noOverflow(page);
});

test('cards, suggested hero, details and watch sidebar show Cantonese with written Chinese subtitle names',async({page})=>{
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));await publicFixture(page);
  await page.goto('/');await expect(page.locator('.hero-pills')).toContainText('Cantonese');await expect(page.locator('.series-card-info p').first()).toContainText('Cantonese');
  await page.goto(`/series/${release.id}`);await expect(page.locator('.detail-meta [aria-label="Drama language: Cantonese"]')).toBeVisible();await expect(page.locator('.subtitle-metadata-inline')).toHaveText('Subtitle languages: 繁體中文, 简体中文');
  await page.goto(`/watch/${release.id}/${release.first_episode_id}`);await expect(page.locator('.watch-series-intro .detail-meta')).toContainText('Cantonese');await expect(page.locator('.watch-sidebar .subtitle-metadata-list')).toContainText('繁體中文');await expect(page.locator('.watch-sidebar .subtitle-metadata-list')).toContainText('简体中文');
});
