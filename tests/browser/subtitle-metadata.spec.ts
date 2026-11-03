import {test,expect,type Page} from '@playwright/test';
import {LANGUAGES} from '../../shared/config';

const series={id:'declared-subtitle-series',title:'A multilingual original',description:'Original spoken dialogue with subtitles supplied by the publisher.',language:'ko',genres:['drama'],cover:'/brand-mark.png',cover_aspect_ratio:'1:1',creator_name:'Multilingual Studio',creation_type:'human',price_cents:10,free_episodes:0,episode_count:1,views:0,saves:0,status:'published',featured:0,created_at:'2026-11-02T00:00:00Z',likes:0,liked:false,demo:0};
const episode={id:'declared-subtitle-episode',series_id:series.id,title:'Episode 001',number:1,duration:10,bytes:100,free:false,unlocked:false};

async function publicSeries(page:Page,languages:()=>unknown){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/series?**',route=>route.fulfill({json:{series:[]}}));
  await page.route(`**/api/series/${series.id}`,route=>route.fulfill({json:{series:{...series,subtitle_languages:languages()},episodes:[episode]}}));
}

test('series and watch pages show only supported declared subtitle languages without inventing player tracks',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const hostile='<script>window.subtitleScriptRan=true</script>';
  await publicSeries(page,()=>['ja','en','zh-TW','ja',hostile,null,42,{ar:true},['ar']]);await page.goto(`/series/${series.id}`);
  const summary=page.locator('.detail-meta'),inline=summary.getByRole('group',{name:'Subtitle languages',exact:true});
  await expect(summary.getByRole('group',{name:'Drama language: 한국어',exact:true})).toBeVisible();await expect(inline).toHaveText('Subtitle languages: English, 繁體中文, 日本語');
  await expect(inline.locator('bdi')).toHaveText(['English','繁體中文','日本語']);await expect(inline.locator('svg')).toHaveAttribute('aria-hidden','true');
  expect(await inline.evaluate(element=>({spokenBefore:element.previousElementSibling?.getAttribute('aria-label'),episodesAfter:element.nextElementSibling?.textContent}))).toEqual({spokenBefore:'Drama language: 한국어',episodesAfter:'1 Episodes'});
  const spokenBounds=(await summary.getByRole('group',{name:'Drama language: 한국어',exact:true}).boundingBox())!,subtitleBounds=(await inline.boundingBox())!;expect(subtitleBounds.x).toBeGreaterThanOrEqual(spokenBounds.x+spokenBounds.width);expect(Math.abs((subtitleBounds.y+subtitleBounds.height/2)-(spokenBounds.y+spokenBounds.height/2))).toBeLessThanOrEqual(2);
  await expect(inline.locator('a,button')).toHaveCount(0);await expect(inline).not.toContainText(hostile);
  const metadata=page.locator('.subtitle-metadata');await expect(metadata.locator('dt')).toHaveText('Subtitle languages');
  await expect(metadata.locator('li')).toHaveText(['English','繁體中文','日本語']);await expect(metadata).not.toContainText(hostile);
  await expect(metadata.locator('.subtitle-metadata-hint')).toContainText('Languages declared by the publisher');
  await expect(metadata.locator('li a,li button')).toHaveCount(0);
  expect(await page.evaluate(()=>typeof(window as any).subtitleScriptRan)).toBe('undefined');
  await page.goto(`/watch/${series.id}/${episode.id}`);await expect(page.locator('.watch-subtitle-metadata .subtitle-metadata li')).toHaveText(['English','繁體中文','日本語']);
  await expect(page.locator('track')).toHaveCount(0);await expect(page.locator('.watch-subtitle-metadata button,.watch-subtitle-metadata input')).toHaveCount(0);
});

test('empty, missing and unsupported declarations show unspecified in the summary and omit detailed metadata',async({page})=>{
  let languages:unknown=[];await publicSeries(page,()=>languages);
  for(const value of [[],undefined,null,['unknown','<img src=x onerror=alert(1)>'],{en:true}]){
    languages=value;await page.goto(`/series/${series.id}`);await expect(page.locator('.detail-info h1')).toHaveText(series.title);await expect(page.locator('.subtitle-metadata')).toHaveCount(0);const inline=page.locator('.detail-meta .subtitle-metadata-inline');await expect(inline).toHaveText('Subtitle languages: Not specified');await expect(inline.locator('bdi')).toHaveCount(0);
    await page.goto(`/watch/${series.id}/${episode.id}`);await expect(page.locator('.watch-series-intro h1')).toHaveText(series.title);await expect(page.locator('.watch-subtitle-metadata')).toHaveCount(0);
  }
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`all declared subtitle names wrap on a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);let declarations:unknown=LANGUAGES.map(language=>language.code);await publicSeries(page,()=>declarations);
  for(const url of [`/series/${series.id}`,`/watch/${series.id}/${episode.id}`]){
    await page.goto(url);await expect(page.locator('.subtitle-metadata li')).toHaveCount(LANGUAGES.length);await expect(page.locator('html')).toHaveAttribute('lang',locale);
    if(url.startsWith('/series/')){
      const inline=page.locator('.detail-meta .subtitle-metadata-inline');await expect(inline).toBeVisible();await expect(inline.locator('bdi')).toHaveText(LANGUAGES.map(language=>language.name));
      if(locale!=='en')await expect(inline).not.toContainText('Subtitle languages');
      expect(await inline.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
    }
    if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    if(locale!=='en')await expect(page.locator('.subtitle-metadata-hint')).not.toContainText('Languages declared by the publisher');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  declarations=[];await page.goto(`/series/${series.id}`);const unspecified=page.locator('.detail-meta .subtitle-metadata-inline');await expect(unspecified).toBeVisible();await expect(unspecified.locator('bdi')).toHaveCount(0);if(locale!=='en')await expect(unspecified).not.toContainText('Not specified');await expect(page.locator('.subtitle-metadata')).toHaveCount(0);
});
