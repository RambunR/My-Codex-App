import {test,expect,type Page,type Locator} from '@playwright/test';
import {demoAdminSession} from './helpers/admin-session';
import path from 'node:path';
import {STORY_THEMES,STANDARD_GENRES,type StoryTheme} from '../../shared/taxonomy';

const draft={title:'Legacy classification fixture',description:'A complete original synopsis for checking classification compatibility.',language:'en',genres:['animation','sci-fi'],creation_type:'human',price_cents:10,free_episodes:1};
const addedThemes=['entrepreneurship','business-rivalry','inheritance-succession','family-feud','love-triangle','redemption','friendship','self-discovery','survival','found-family'] as const;

async function signInAdmin(page:Page){
  const user=await demoAdminSession(page);expect(user.role).toBe('admin');return user;
}
function theme(page:Page,id:StoryTheme){return page.locator('#series-themes button').nth(STORY_THEMES.indexOf(id));}
async function saveDetails(page:Page){
  const saved=page.waitForResponse(response=>/\/api\/studio\/series(?:\/[^/]+)?$/.test(new URL(response.url()).pathname)&&['POST','PATCH'].includes(response.request().method()));
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  const response=await saved;expect(response.ok()).toBe(true);return response;
}
function axisSelect(page:Page,example:string){
  return page.locator('.browse-controls select').filter({has:page.locator(`option[value="${example}"]`)});
}
async function noOverflow(page:Page){
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function usableSelect(select:Locator){
  await expect(select).toBeVisible();const bounds=await select.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeGreaterThanOrEqual(44);
}
const publicFixture={id:'taxonomy-public-fixture',title:'An animated mystery with a secret identity',description:'A creator-selected animation with a distinct production method and story themes.',creator_id:'taxonomy-author',creator_name:'An independent storyteller',language:'en',genres:['thriller'],themes:['revenge','hidden-identity'],format:'animation',creation_type:'ai-assisted',cover:'/images/placeholder.svg',price_cents:10,free_episodes:1,episode_count:1,views:0,saves:0,likes:0,liked:false,status:'published',featured:0,created_at:'2026-11-02 00:00:00'};

test('publisher saves all classification axes, uploads an episode and finds the published series with matching filters',async({page})=>{
  const before=await signInAdmin(page);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/studio/new');
  await expect(page.locator('#series-format')).toHaveValue('live-action');
  await expect(page.locator('#series-creation option[value="human"]')).toHaveText('Human-created');
  await expect(page.locator('#series-genres button')).toHaveCount(STANDARD_GENRES.length);
  await expect(page.locator('#series-genres').getByRole('button',{name:'Animation',exact:true})).toHaveCount(0);
  const title=`Taxonomy original ${Date.now()}`;
  await page.locator('#series-title').fill(title);await page.locator('#series-description').fill('A complete animated psychological drama about revenge, created with human direction and AI assistance.');
  await page.locator('#series-genres').getByRole('button',{name:'Romance',exact:true}).click();
  await page.locator('#series-genres').getByRole('button',{name:'Psychological Drama',exact:true}).click();
  await page.locator('#series-themes').getByRole('button',{name:'Entrepreneurship',exact:true}).click();await theme(page,'revenge').click();await theme(page,'baby-sweetheart').click();
  await page.locator('#series-format').selectOption('animation');await page.locator('#series-creation').selectOption('ai-assisted');
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles(path.resolve('public/images/midnight.jpg'));
  const created=await saveDetails(page);const createBody=created.request().postDataJSON();expect(createBody).toMatchObject({genres:['psychological'],themes:['entrepreneurship','revenge','baby-sweetheart'],format:'animation',creation_type:'ai-assisted'});
  await expect(page).toHaveURL(/\/studio\/series\//);const id=new URL(page.url()).pathname.split('/').at(-1)!;
  await page.reload();await expect(page.locator('#series-format')).toHaveValue('animation');await expect(page.locator('#series-creation')).toHaveValue('ai-assisted');await expect(theme(page,'entrepreneurship')).toHaveAttribute('aria-pressed','true');await expect(theme(page,'revenge')).toHaveAttribute('aria-pressed','true');await expect(theme(page,'baby-sweetheart')).toHaveAttribute('aria-pressed','true');
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose video files',exact:true}).click();await(await chooser).setFiles(path.resolve('public/demo-preview.mp4'));
  await expect(page.locator('.queue-row small')).toHaveText(['Uploaded'],{timeout:30000});
  await page.getByRole('button',{name:'Publish series',exact:true}).click();
  await expect(page).toHaveURL(url=>url.pathname==='/browse'&&url.searchParams.get('sort')==='new'&&url.searchParams.get('genre')==='psychological'&&url.searchParams.get('theme')==='entrepreneurship'&&url.searchParams.get('format')==='animation'&&url.searchParams.get('creation')==='ai-assisted'&&url.searchParams.get('language')==='en');
  await expect(axisSelect(page,'entrepreneurship')).toHaveValue('entrepreneurship');await expect(axisSelect(page,'motion-comic')).toHaveValue('animation');
  const card=page.locator('.series-card').filter({has:page.getByRole('heading',{name:title,exact:true})});await expect(card).toBeVisible();
  await axisSelect(page,'motion-comic').selectOption('live-action');await expect(page.locator('.series-card').filter({has:page.getByRole('heading',{name:title,exact:true})})).toHaveCount(0);
  await axisSelect(page,'motion-comic').selectOption('animation');await expect(card).toBeVisible();
  await card.locator('.poster-link').click();await expect(page).toHaveURL(`/series/${id}`);
  await expect(page.locator('main a[href="/browse?theme=entrepreneurship"]')).toHaveText('Entrepreneurship');await expect(page.locator('main a[href="/browse?theme=revenge"]')).toBeVisible();await expect(page.locator('.series-classification a[href="/browse?format=animation"]')).toBeVisible();await expect(page.locator('main a[href="/browse?creation=ai-assisted"]')).toBeVisible();
  const detail=await(await page.request.get(`/api/series/${id}`)).json();expect(detail.series).toMatchObject({genres:['psychological'],themes:['entrepreneurship','revenge','baby-sweetheart'],format:'animation',creation_type:'ai-assisted'});expect(detail.episodes).toHaveLength(1);
  await page.setViewportSize({width:390,height:844});await page.goto(`/watch/${id}/${detail.episodes[0].id}`);await expect(page.locator('.watch-series-intro>.eyebrow')).toHaveText('Psychological Drama');await expect(page.locator('video')).toBeVisible();await noOverflow(page);
  await page.evaluate(()=>localStorage.setItem('drama-language','zh-TW'));await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','zh-TW');await expect(page.locator('.watch-series-intro>.eyebrow')).toHaveText('心理劇');await noOverflow(page);
  const after=(await(await page.request.get('/api/auth/me')).json()).user;for(const key of ['wallet_micros','earnings_micros','publisher_active','dramio_pass'])expect(after[key]).toEqual(before[key]);expect(errors).toEqual([]);
});

test('legacy Animation remains editable and an explicitly cleared format stays unspecified after reload',async({page})=>{
  await signInAdmin(page);
  const response=await page.request.post('/api/studio/series',{data:{...draft,title:`Legacy animation ${Date.now()}`}});expect(response.status()).toBe(201);const{id}=await response.json();
  await page.goto(`/studio/series/${id}`);await expect(page.locator('#series-format')).toHaveValue('animation');
  const oldGenre=page.locator('#series-genres').getByRole('button',{name:'Animation',exact:true});await expect(oldGenre).toHaveAttribute('aria-pressed','true');
  await page.locator('#series-format').selectOption('');await saveDetails(page);await page.reload();await expect(page.locator('#series-format')).toHaveValue('');
  const cleared=(await(await page.request.get(`/api/studio/series/${id}`)).json()).series;expect(cleared.format).toBeNull();expect(cleared.genres).toEqual(['animation','sci-fi']);
  await oldGenre.click();await page.locator('#series-format').selectOption('anime-donghua');await saveDetails(page);await page.reload();
  await expect(page.locator('#series-format')).toHaveValue('anime-donghua');await expect(oldGenre).toHaveCount(0);
  const updated=(await(await page.request.get(`/api/studio/series/${id}`)).json()).series;expect(updated.genres).toEqual(['sci-fi']);expect(updated.format).toBe('anime-donghua');
  await page.locator('#series-format').selectOption('motion-comic');await saveDetails(page);await page.reload();await expect(page.locator('#series-format')).toHaveValue('motion-comic');
});

test('story-theme controls enforce five selections while allowing an ordinary draft with no themes or format',async({page})=>{
  await signInAdmin(page);await page.goto('/studio/new');await page.locator('#series-title').fill(`Optional taxonomy ${Date.now()}`);await page.locator('#series-description').fill('A completed draft whose optional classification controls can be cleared without blocking uploads.');
  for(const id of STORY_THEMES.slice(0,5))await theme(page,id).click();
  await expect(page.locator('#series-themes button[aria-pressed="true"]')).toHaveCount(5);await expect(theme(page,'entrepreneurship')).toBeDisabled();
  await theme(page,STORY_THEMES[0]).click();await expect(theme(page,'entrepreneurship')).toBeEnabled();await theme(page,'entrepreneurship').click();
  const selected=[...STORY_THEMES.slice(1,5),'entrepreneurship'] as StoryTheme[];
  const created=await saveDetails(page);expect(created.request().postDataJSON().themes).toEqual(selected);await expect(page).toHaveURL(/\/studio\/series\//);await page.reload();
  await expect(page.locator('#series-themes button[aria-pressed="true"]')).toHaveCount(5);
  for(const id of selected){await expect(theme(page,id)).toHaveAttribute('aria-pressed','true');await theme(page,id).click();await expect(theme(page,id)).toHaveAttribute('aria-pressed','false');}
  await expect(page.locator('#series-themes button[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#series-format').selectOption('');const updated=await saveDetails(page);expect(updated.request().postDataJSON()).toMatchObject({themes:[],format:null});await page.reload();
  await expect(page.locator('#series-themes button[aria-pressed="true"]')).toHaveCount(0);await expect(page.locator('#series-format')).toHaveValue('');await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();
});

test('rapid theme, format and existing filter changes merge into the latest URL and Clear filters resets every axis',async({page})=>{
  const queries:string[]=[];
  await page.route('**/api/series?**',route=>{queries.push(new URL(route.request().url()).search);return route.fulfill({json:{series:[publicFixture]}});});
  await page.goto('/browse?q=secret&sort=new');await expect(axisSelect(page,'revenge')).toBeVisible();
  await page.evaluate(()=>{
    const changes=[['Drama language','en'],['Genre','thriller'],['Story themes','revenge'],['Format','animation'],['How was it made?','ai-assisted']];
    for(const[label,value]of changes){const select=document.querySelector(`.browse-controls select[aria-label="${label}"]`) as HTMLSelectElement|null;if(!select)throw Error('Missing filter '+label);select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  await expect(page).toHaveURL(url=>url.pathname==='/browse'&&url.searchParams.get('q')==='secret'&&url.searchParams.get('sort')==='new'&&url.searchParams.get('language')==='en'&&url.searchParams.get('genre')==='thriller'&&url.searchParams.get('theme')==='revenge'&&url.searchParams.get('format')==='animation'&&url.searchParams.get('creation')==='ai-assisted');
  await expect.poll(()=>{const q=new URLSearchParams(queries.at(-1));return['q','sort','language','genre','theme','format','creation'].every(key=>q.get(key)===new URL(page.url()).searchParams.get(key));}).toBe(true);
  await expect(axisSelect(page,'revenge')).toHaveValue('revenge');await expect(axisSelect(page,'motion-comic')).toHaveValue('animation');
  await page.getByRole('button',{name:'Clear filters',exact:true}).first().click();await expect(page).toHaveURL('/browse');
  for(const example of ['revenge','motion-comic','medical','ai-assisted','ja'])await expect(axisSelect(page,example)).toHaveValue('');await expect(page.locator('main').getByRole('searchbox')).toHaveValue('');await expect(page.getByLabel('Sort by',{exact:true})).toHaveValue('popular');
});

for(const[locale,width,entrepreneurshipLabel,donghuaLabel]of [['en',320,'Entrepreneurship','Donghua'],['zh-TW',320,'創業','中國動畫'],['zh-CN',320,'创业','中国动画'],['ar',320,'ريادة الأعمال','دونغهوا']] as const)test(`classification filters are translated and fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/series?**',route=>route.fulfill({json:{series:[publicFixture]}}));
  await page.goto('/browse?genre=psychological&theme=against-all-odds&format=motion-comic&creation=human');await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
  const genres=axisSelect(page,'medical'),themes=axisSelect(page,'revenge'),formats=axisSelect(page,'motion-comic');
  await expect(genres.locator('option')).toHaveCount(STANDARD_GENRES.length+1);await expect(themes.locator('option')).toHaveCount(27);await expect(formats.locator('option')).toHaveCount(5);
  expect(await themes.locator('option').evaluateAll(options=>options.slice(-10).map(option=>(option as HTMLOptionElement).value))).toEqual([...addedThemes]);
  for(const id of addedThemes)await expect(themes.locator(`option[value="${id}"]`)).not.toHaveText('');
  await expect(themes.locator('option[value="entrepreneurship"]')).toHaveText(entrepreneurshipLabel);
  await expect(formats.locator('option[value="anime-donghua"]')).toHaveText(donghuaLabel);
  for(const select of [genres,themes,formats]){await usableSelect(select);expect(await select.getAttribute('aria-label')).toBeTruthy();expect(await select.textContent()).not.toMatch(/(?:genre_|theme_|format_|taxonomy)/);}
  if(locale!=='en'){expect(await formats.locator('option[value="live-action"]').textContent()).not.toBe('Live-action');expect(await themes.locator('option[value="revenge"]').textContent()).not.toBe('Revenge');}
  await noOverflow(page);await themes.selectOption('entrepreneurship');await formats.selectOption('anime-donghua');await expect(page).toHaveURL(url=>url.searchParams.get('format')==='anime-donghua'&&url.searchParams.get('theme')==='entrepreneurship'&&url.searchParams.get('genre')==='psychological'&&url.searchParams.get('creation')==='human');await noOverflow(page);
});

test('legacy series distinguish animation format from an unknown format and human production',async({page})=>{
  await page.goto('/series/after-midnight');await expect(page.locator('.detail-info h1')).toHaveText('After Midnight');await expect(page.locator('main a[href="/browse?format=live-action"]')).toHaveCount(0);
  await page.goto('/series/tokyo-tomorrow');await expect(page.locator('.detail-info h1')).toHaveText('Tokyo, Tomorrow');await expect(page.locator('.series-classification a[href="/browse?format=animation"]')).toBeVisible();
  await page.goto('/series/seoul-searching');await expect(page.locator('.detail-info h1')).toHaveText('Seoul Searching');await expect(page.locator('main a[href="/browse?creation=human"]')).toHaveText('Human-created');await expect(page.locator('main a[href="/browse?format=live-action"]')).toHaveCount(0);
});
