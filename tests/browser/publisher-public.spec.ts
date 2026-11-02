import {test,expect,type Page} from '@playwright/test';

const profileId='pub-profile-browser';
const series={id:'publisher-browser-series',title:'A publisher’s first release',description:'A complete original short drama for the public publisher profile.',language:'en',genres:['romance'],cover:'/brand-mark.png',creator_name:'Moonlight Studio',publisher_id:profileId,publisher_profile_id:profileId,creation_type:'human',price_cents:10,free_episodes:1,episode_count:1,views:4321,saves:0,status:'published',featured:0,created_at:'2024-03-12T00:00:00Z',likes:17,liked:false};
const episode={id:'publisher-browser-episode',series_id:series.id,title:'Episode 001',number:1,duration:10,bytes:100,free:true,unlocked:false,views:4321};
const profile={publisher:{id:profileId,display_name:series.creator_name,registered_at:'2024-03-12',managed:true,is_official:false},stats:{series_count:1,episode_count:1,views:4321,likes:17,total_watch_seconds:3672,avg_watch_seconds:94.5},series:[series],pagination:{page:1,page_size:24,total:1,total_pages:1}};

async function guestRoutes(page:Page){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));
  await page.route(`**/api/series/${series.id}`,route=>route.fulfill({json:{series,episodes:[episode]}}));
}

test('guest follows the public series byline to a dated publisher profile and opens a released series',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await guestRoutes(page);await page.route(`**/api/publishers/${profileId}**`,route=>route.fulfill({json:profile}));
  await page.goto(`/series/${series.id}`);
  const byline=page.locator('a.creator-byline');await expect(byline).toHaveAttribute('href',`/publishers/${profileId}`);await byline.click();
  await expect(page).toHaveURL(`/publishers/${profileId}`);await expect(page.getByRole('heading',{name:series.creator_name,exact:true})).toBeVisible();
  await expect(page.locator('.publisher-public-date time')).toHaveAttribute('datetime','2024-03-12');await expect(page.locator('.publisher-public-date')).toContainText('Profile registered');
  await expect(page.locator('.publisher-public-stats dd')).toHaveText(['1','4,321','17','1 hr 1 min']);
  await expect(page.locator('.publisher-public-stats-note')).toContainText('currently public series');
  await expect(page.locator('.publisher-official-badge')).toHaveCount(0);
  await expect(page.locator('.publisher-public-series .series-card')).toHaveCount(1);
  await page.locator('.publisher-public-series .series-card h3').click();await expect(page).toHaveURL(`/series/${series.id}`);
  expect(errors).toEqual([]);
});

test('the watch screen also links to the same public publisher identity',async({page})=>{
  await guestRoutes(page);await page.route(`**/api/publishers/${profileId}**`,route=>route.fulfill({json:profile}));
  await page.goto(`/watch/${series.id}/${episode.id}`);
  const byline=page.locator('a.watch-creator');await expect(byline).toHaveAttribute('href',`/publishers/${profileId}`);await byline.click();
  await expect(page.getByRole('heading',{name:series.creator_name,exact:true})).toBeVisible();
});

test('public release pagination keeps profile totals and moves between clickable series',async({page})=>{
  await guestRoutes(page);
  await page.route(`**/api/publishers/${profileId}**`,route=>{
    const current=new URL(route.request().url()).searchParams.get('page')==='2'?2:1;
    return route.fulfill({json:{...profile,stats:{...profile.stats,series_count:25},series:[{...series,id:`public-page-${current}`,title:`Release on page ${current}`}],pagination:{page:current,page_size:24,total:25,total_pages:2}}});
  });
  await page.goto(`/publishers/${profileId}`);
  const pagination=page.locator('.publisher-public-pagination');await expect(pagination.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();
  await pagination.getByRole('button',{name:'Next',exact:true}).click();await expect(page).toHaveURL(`/publishers/${profileId}?page=2`);
  await expect(page.locator('.publisher-public-series .series-card h3')).toHaveText('Release on page 2');await expect(page.locator('.publisher-public-stats dd').first()).toHaveText('25');
  await expect(pagination.getByRole('button',{name:'Next',exact:true})).toBeDisabled();await expect(pagination.getByRole('status')).toHaveText('Page 2 of 2');
  await pagination.getByRole('button',{name:'Previous',exact:true}).click();await expect(page).toHaveURL(`/publishers/${profileId}`);await expect(page.locator('.publisher-public-series .series-card h3')).toHaveText('Release on page 1');
});

test('an empty managed publisher is honest about zero activity and an unavailable profile has a retry state',async({page})=>{
  await guestRoutes(page);
  await page.route(`**/api/publishers/${profileId}**`,route=>route.fulfill({json:{...profile,publisher:{...profile.publisher,is_official:true},stats:{series_count:0,episode_count:0,views:0,likes:0,total_watch_seconds:0,avg_watch_seconds:0},series:[],pagination:{page:1,page_size:24,total:0,total_pages:0}}}));
  await page.goto(`/publishers/${profileId}`);await expect(page.getByRole('heading',{name:'No series released yet',exact:true})).toBeVisible();await expect(page.locator('.publisher-official-badge')).toHaveText('Official profile');await expect(page.locator('.publisher-public-stats dd')).toHaveText(['0','0','0','0 sec']);
  await page.route('**/api/publishers/unavailable-profile**',route=>route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Publisher profile not found.'}}}));
  await page.goto('/publishers/unavailable-profile');await expect(page.getByRole('heading',{name:'Publisher profile not found.',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await expect(page.locator('.publisher-public-stats')).toHaveCount(0);
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`a public publisher and long multilingual name fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await guestRoutes(page);
  const name='Moonlight Studio 靈映物語 아주 긴 이름 <script>neverRun()</script>';
  await page.route(`**/api/publishers/${profileId}**`,route=>route.fulfill({json:{...profile,publisher:{...profile.publisher,display_name:name},stats:{...profile.stats,views:123456789,total_watch_seconds:987654321}}}));
  await page.goto(`/publishers/${profileId}`);await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang',locale);
  if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  if(locale!=='en')await expect(page.locator('.publisher-public-stats-note')).not.toContainText('Totals include');
  expect(await page.evaluate(()=>typeof(window as any).neverRun)).toBe('undefined');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
