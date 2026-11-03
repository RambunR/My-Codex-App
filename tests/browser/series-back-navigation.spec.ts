import {test,expect,type Page} from '@playwright/test';
import type {Series,Episode} from '../../shared/config';

const seriesId='after-midnight',episodeId='after-midnight-1';
const seriesPath=`/series/${seriesId}`,watchPath=`/watch/${seriesId}/${episodeId}`;
const cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#302044"/></svg>');
const series={id:seriesId,title:'After Midnight',description:'Two strangers miss the last train and discover a story worth staying for.',language:'en',genres:['romance'],themes:[],format:'live-action',creation_type:'human',cover,creator_name:'Navigation Creator',price_cents:10,free_episodes:0,episode_count:1,first_episode_id:episodeId,access_type:'all-paid',views:0,saves:0,likes:0,liked:false,status:'published',featured:0,demo:0,created_at:'2026-11-03T00:00:00Z'} satisfies Series;
const episode={id:episodeId,series_id:seriesId,title:'The last train',number:1,duration:60,bytes:1024,views:0,free:false,unlocked:false} satisfies Episode;

async function readOnlyCatalogue(page:Page,locale:string){
  const unexpected:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  // A locked fixture exercises both screens without video, playback analytics,
  // authentication mutations or payment requests reaching any server.
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='GET'){
      if(path==='/api/auth/me')return route.fulfill({json:{user:null}});
      if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,payoutsEnabled:false,usdToHkd:7.8,demo:false,limits:{}}});
      if(path==='/api/series/'+seriesId)return route.fulfill({json:{series,episodes:[episode]}});
      if(path==='/api/series')return route.fulfill({json:{series:[series]}});
    }
    unexpected.push(request.method()+' '+path);
    return route.abort();
  });
  return()=>{expect(unexpected,'Navigation must use only the mocked catalogue reads').toEqual([]);expect(errors).toEqual([]);};
}

const displays=[
  {name:'English desktop',locale:'en',width:1440,height:900,back:'Back',watch:'Watch now'},
  {name:'Traditional Chinese phone',locale:'zh-TW',width:390,height:844,back:'返回',watch:'立即觀看'},
  {name:'Traditional Chinese small phone',locale:'zh-TW',width:320,height:568,back:'返回',watch:'立即觀看'},
] as const;

for(const display of displays)test.describe(display.name,()=>{
  test.use({viewport:{width:display.width,height:display.height},isMobile:display.width<600,hasTouch:display.width<600});

  test('series Back returns to Browse after the first episode returns to its series',async({page})=>{
    const clean=await readOnlyCatalogue(page,display.locale);
    await page.goto('/browse');
    await expect(page).toHaveURL('/browse');
    await page.locator('.browse-page .series-card .poster-link').click();
    await expect(page).toHaveURL(seriesPath);
    await expect(page.locator('html')).toHaveAttribute('lang',display.locale);
    await expect(page.locator('.detail-page h1')).toHaveText(series.title);
    await page.locator('.detail-actions').getByRole('link',{name:display.watch,exact:true}).click();
    await expect(page).toHaveURL(watchPath);
    await expect(page.locator('.watch-episode-grid [aria-current="page"]')).toHaveAttribute('href',watchPath);
    await page.locator('.watch-heading').getByRole('button',{name:series.title,exact:true}).click();
    await expect(page).toHaveURL(seriesPath);
    await page.locator('.detail-page').getByRole('button',{name:display.back,exact:true}).click();
    await expect(page).toHaveURL('/browse');
    await expect(page.locator('.browse-page .series-card h3')).toHaveText(series.title);
    clean();
  });

  test('a directly opened series has a working Back destination without prior app history',async({page})=>{
    const clean=await readOnlyCatalogue(page,display.locale);
    await page.goto(seriesPath);
    await expect(page).toHaveURL(seriesPath);
    await expect(page.locator('html')).toHaveAttribute('lang',display.locale);
    await expect(page.locator('.detail-page h1')).toHaveText(series.title);
    await page.locator('.detail-page').getByRole('button',{name:display.back,exact:true}).click();
    await expect(page).toHaveURL('/browse');
    await expect(page.locator('.browse-page .series-card h3')).toHaveText(series.title);
    clean();
  });
});
