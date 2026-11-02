import {test,expect,type Page} from '@playwright/test';
import type {Genre,StoryTheme} from '../../shared/taxonomy';

type Access='all-free'|'all-paid'|'free-then-paid'|null;
const publisher={id:'access-fixture-publisher',name:'Access Creator',email:'access@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const base={description:'An original multilingual short drama whose access classification comes from its existing episodes.',language:'ja',genres:['thriller'] satisfies Genre[],themes:['revenge'] satisfies StoryTheme[],format:'animation',creation_type:'ai-assisted',cover:'/images/placeholder.svg',cover_aspect_ratio:'9:16',creator_name:publisher.name,price_cents:49,free_episodes:3,episode_count:3,views:0,saves:0,likes:0,liked:false,status:'published',featured:0,demo:0,created_at:'2026-11-02T00:00:00Z'};
const entry=(id:string,title:string,access_type:Access,values:Record<string,unknown>={})=>({...base,id,title,access_type,...values});
const free=entry('access-free','Nightfall: a complete free series','all-free');
const paid=entry('access-paid','Nightfall: every episode is paid','all-paid',{free_episodes:0,price_cents:125});
const mixed=entry('access-mixed','Nightfall: free episodes before paid chapters','free-then-paid',{free_episodes:1,price_cents:99});
const empty=entry('access-empty','A draft with a planned free allowance',null,{status:'draft',episode_count:0,free_episodes:5,price_cents:35});
const publicSeries=[free,paid,mixed,
  entry('access-other-language','Nightfall: an English free series','all-free',{language:'en'}),
  entry('access-other-genre','Nightfall: a free romance','all-free',{genres:['romance']}),
  entry('access-other-theme','Nightfall: another free story theme','all-free',{themes:['secret-baby']}),
  entry('access-other-format','Nightfall: a free live-action series','all-free',{format:'live-action'}),
  entry('access-other-creation','Nightfall: a human-created free series','all-free',{creation_type:'human'}),
  entry('access-other-search','Another complete free story','all-free'),
];
const axes={q:'Nightfall',language:'ja',genre:'thriller',theme:'revenge',format:'animation',creation:'ai-assisted',sort:'new'};
const browse=(extra:Record<string,string>={})=>'/browse?'+new URLSearchParams({...axes,...extra});
async function fixtures(page:Page,{studio=false,locale='en'}={}){
  const writes:string[]=[],errors:string[]=[],queries:URLSearchParams[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:studio?publisher:null}}));
  await page.route('**/api/config',route=>route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{activationHkd:88}}}));
  await page.route('**/api/studio',route=>route.fulfill({json:{user:publisher,series:[free,paid,mixed,empty].map(row=>({...row,creator_id:publisher.id})),stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}}));
  await page.route('**/api/series**',route=>{
    const query=new URL(route.request().url()).searchParams;queries.push(query);const rows=publicSeries.filter(row=>(!query.get('access')||row.access_type===query.get('access'))&&(!query.get('q')||(row.title+' '+row.description+' '+row.creator_name).toLowerCase().includes(query.get('q')!.toLowerCase()))&&(!query.get('language')||row.language===query.get('language'))&&(!query.get('genre')||row.genres.some(value=>value===query.get('genre')))&&(!query.get('theme')||row.themes.some(value=>value===query.get('theme')))&&(!query.get('format')||row.format===query.get('format'))&&(!query.get('creation')||row.creation_type===query.get('creation')));return route.fulfill({json:{series:rows}});
  });
  return{queries,clean:()=>{expect(writes,'Read-only browsing and Studio price display must not start payments or mutate records').toEqual([]);expect(errors).toEqual([]);}};
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
async function cards(page:Page,titles:string[]){await expect(page.locator('.browse-page .series-card h3')).toHaveText(titles);}
function expectAxes(url:URL,access:string|null){for(const[key,value]of Object.entries(axes))expect(url.searchParams.get(key)).toBe(value);expect(url.searchParams.get('access')).toBe(access);}
function axesMatch(url:URL,access:string|null){return Object.entries(axes).every(([key,value])=>url.searchParams.get(key)===value)&&url.searchParams.get('access')===access;}

test('access filters compose with search, language, genre, theme, format, creation and sort while displaying matching releases',async({page})=>{
  const state=await fixtures(page);await page.goto(browse());const access=page.getByRole('combobox',{name:'Free or paid',exact:true});await expect(access).toHaveValue('');await expect(access.locator('option')).toHaveCount(4);await cards(page,[free.title,paid.title,mixed.title]);
  for(const[selected,title]of [['all-free',free.title],['all-paid',paid.title],['free-then-paid',mixed.title]]){await access.selectOption(selected);await expect(page).toHaveURL(url=>axesMatch(url,selected));await cards(page,[title]);expectAxes(new URL('http://fixture.test/?'+state.queries.at(-1)),selected);}
  await page.reload();await expect(access).toHaveValue('free-then-paid');await cards(page,[mixed.title]);await access.selectOption('all-free');await page.getByRole('combobox',{name:'Drama language',exact:true}).selectOption('en');await expect(page).toHaveURL(url=>url.searchParams.get('access')==='all-free'&&url.searchParams.get('language')==='en'&&url.searchParams.get('theme')==='revenge'&&url.searchParams.get('sort')==='new');await cards(page,['Nightfall: an English free series']);state.clean();
});

test('clearing only access preserves other filters and clearing all filters removes the access constraint too',async({page})=>{
  const state=await fixtures(page);await page.goto(browse({access:'all-paid'}));const access=page.getByRole('combobox',{name:'Free or paid',exact:true});await expect(access).toHaveValue('all-paid');await cards(page,[paid.title]);await access.selectOption('');await expect(page).toHaveURL(url=>axesMatch(url,null));await cards(page,[free.title,paid.title,mixed.title]);
  await access.selectOption('all-free');await cards(page,[free.title]);await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page).toHaveURL('/browse');await expect(access).toHaveValue('');await expect(page.locator('.browse-page .series-card')).toHaveCount(publicSeries.length);await expect(page.locator('main').getByRole('searchbox')).toHaveValue('');state.clean();
});

for(const width of [1440,390])test(`Studio shows Free only for an actual all-free series and retains configured paid, mixed and empty prices at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await fixtures(page,{studio:true});await page.goto('/studio');await expect(page.locator('.studio-series-row')).toHaveCount(4);
  for(const[row,price]of [[free,'Free'],[paid,'$1.25'],[mixed,'$0.99'],[empty,'$0.35']]as const){const item=page.locator('.studio-series-row').filter({has:page.getByRole('heading',{name:row.title,exact:true})});await expect(item.locator('.studio-series-price strong')).toHaveText(price);await expect(item.getByRole('link',{name:'Manage',exact:true})).toHaveAttribute('href','/studio/series/'+row.id);}
  await noOverflow(page);state.clean();
});

for(const[locale,width,label]of [['zh-TW',390,'免費或付費'],['ar',320,'مجاني أو مدفوع']]as const)test(`the access filter is readable, operable and localized on a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});const state=await fixtures(page,{locale});await page.goto(browse());await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');const access=page.getByRole('combobox',{name:label,exact:true});await expect(access).toBeVisible();const box=(await access.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);await expect(access).toHaveCSS('font-size','16px');await expect(access.locator('option[value="all-free"]')).not.toHaveText('All free');await access.selectOption('free-then-paid');await expect(page).toHaveURL(url=>url.searchParams.get('access')==='free-then-paid'&&url.searchParams.get('format')==='animation');await cards(page,[mixed.title]);await noOverflow(page);state.clean();
});
