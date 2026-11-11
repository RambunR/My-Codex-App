import {test,expect,type Page} from '@playwright/test';

// These five glyphs span three real font subsets: 阴 (112), 案 (117),
// and 司/公/录 (118). Do not replace this with a convenient generic CJK sample.
const title='阴司公案录';
const release={id:'original-chinese-title',creator_id:'title-owner',creator_name:'Original creator',title,description:'An original mystery, with the creator’s title preserved exactly.',language:'cmn',genres:['drama'],themes:[],format:'live-action',creation_type:'human',cover:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#302044"/></svg>'),price_cents:10,free_episodes:1,episode_count:1,first_episode_id:'original-chinese-episode',views:0,saves:0,likes:0,liked:false,status:'published',featured:1,demo:0,created_at:'2026-11-08T00:00:00Z',subtitle_languages:['zh-TW','zh-CN'],taken_down:false};
const account={id:'title-owner',name:'Creator',email:'font-title@browser.test',role:'admin',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};

async function fixture(page:Page,locale:string,authenticated=false){
  let current={...release};const writes:string[]=[],fonts=new Set<string>();
  page.on('request',request=>{if(request.url().includes('/fonts/noto-sans-sc/')&&request.url().endsWith('.woff2'))fonts.add(request.url());});
  await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.abort();}
    const detail={series:current,episodes:[{id:release.first_episode_id,series_id:release.id,title,number:1,duration:12,bytes:100,free:true,unlocked:true}],owner_storage:{quota_bytes:account.quota_bytes,used_bytes:0,storage_unlimited:true}};
    if(path==='/api/auth/me')return route.fulfill({json:{user:authenticated?account:null}});
    if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',demo:false,usdToHkd:7.8,payoutsEnabled:false,uploadsEnabled:true,limits:{}}});
    if(path==='/api/studio/title-availability')return route.fulfill({json:{available:true}});
    if(path==='/api/series')return route.fulfill({json:{series:[current],total:1}});
    if(path===`/api/series/${release.id}`||path===`/api/studio/series/${release.id}`)return route.fulfill({json:detail});
    if(path==='/api/studio')return route.fulfill({json:{user:account,series:[current],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}});
    if(path==='/api/admin')return route.fulfill({json:{stats:{users:1,publishers:1,sales:{gross_micros:0,platform_micros:0,n:0},activation_hkd:0},storageRequests:[],withdrawals:[],users:[]}});
    if(path==='/api/admin/series')return route.fulfill({json:{series:[current],total:1,page:1,limit:20}});
    if(path===`/api/admin/series/${release.id}/moderation`)return route.fulfill({json:{events:[]}});
    if(path==='/api/admin/publisher-profiles')return route.fulfill({json:{profiles:[]}});
    if(path==='/api/history')return route.fulfill({json:{history:[]}});
    if(path.endsWith('/stream'))return route.fulfill({status:200,contentType:'video/mp4',body:Buffer.from([0])});
    return route.fulfill({status:404,json:{error:{message:'Unexpected title-font fixture request: '+path}}});
  });
  return{writes,fonts,setSeries:(update:Partial<typeof release>)=>{current={...current,...update};}};
}

type RenderedFont={isCustomFont:boolean;familyName:string;glyphCount:number};
async function renderedFonts(page:Page,selector:string){
  const cdp=await page.context().newCDPSession(page);
  try{await cdp.send('DOM.enable');await cdp.send('CSS.enable');const{root}=await cdp.send('DOM.getDocument');const{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});expect(nodeId,selector).toBeGreaterThan(0);return(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts as RenderedFont[];}
  finally{await cdp.detach();}
}

async function exactTitle(page:Page,selector:string,weight:string){
  const node=page.locator(selector).first();await expect(node).toHaveText(title);await expect(node).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await expect(node).toHaveCSS('font-weight',weight);await expect(node).toHaveCSS('font-synthesis','none');
  const fonts=await renderedFonts(page,selector);
  // An aggregate count of exactly five custom glyphs proves none of the five
  // characters silently falls through to a platform CJK font.
  expect(fonts.reduce((sum,font)=>sum+font.glyphCount,0),selector).toBe(5);
  expect(fonts.every(font=>font.isCustomFont&&font.familyName.startsWith('Noto Sans SC')),JSON.stringify(fonts)).toBe(true);
  expect(await node.getAttribute('lang')).toBeNull();
}

for(const[locale,language]of [['en','cmn'],['zh-TW','yue'],['zh-CN','zh-TW']] as const)test(`the exact original title uses all five custom CJK glyphs at its existing weights in ${locale}`,async({page})=>{
  const state=await fixture(page,locale);state.setSeries({language});
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang',locale);
  await exactTitle(page,'.hero-copy h2 a','650');await exactTitle(page,'.series-card-info h3','550');
  if(locale!=='zh-CN'){
    await expect(page.locator('.home-heading h1')).not.toHaveCSS('font-family',/Noto Sans SC/);
    await expect(page.locator('.hero-copy h2')).toHaveCSS('font-family',/^"?DM Sans"?,/);
  }
  for(const subset of [112,117,118])expect([...state.fonts].some(url=>url.endsWith(`-${subset}.woff2`)),`subset ${subset}`).toBe(true);
  await page.goto(`/series/${release.id}`);await exactTitle(page,'.detail-info>h1','650');
  await expect(page.locator('.subtitle-metadata-inline')).toHaveText(/繁體中文, 简体中文/);
  await expect(page.locator('.subtitle-metadata-inline bdi[lang="zh-TW"]')).toHaveText('繁體中文');await expect(page.locator('.subtitle-metadata-inline bdi[lang="zh-CN"]')).toHaveText('简体中文');
  await page.goto(`/watch/${release.id}/${release.first_episode_id}`);await exactTitle(page,'.watch-series-intro>h1','650');await exactTitle(page,'.watch-heading .back-link','400');
  await page.setViewportSize({width:320,height:740});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(state.writes).toEqual([]);
});

test('creator and admin titles share the fallback while Latin, decorative Latin and unrelated content keep their own families',async({page})=>{
  const state=await fixture(page,'en',true);state.setSeries({language:'zh-CN'});
  await page.goto('/studio');await exactTitle(page,'.studio-series-name h3','550');
  await page.goto(`/studio/series/${release.id}`);await exactTitle(page,'.editor-page .page-heading h1','650');
  await expect(page.locator('#series-title')).toHaveValue(title);await expect(page.locator('#series-title')).toHaveClass(/series-title-cjk/);await expect(page.locator('#series-title')).toHaveCSS('font-family',/DM Sans.*Noto Sans SC/);
  await page.goto('/studio/new');await page.locator('#series-title').fill(title);await page.locator('#series-language').selectOption('cmn');await expect(page.locator('#series-title')).toHaveClass(/series-title-cjk/);await expect(page.locator('#series-title')).toHaveCSS('font-synthesis','none');
  await page.goto('/admin?tab=content');await exactTitle(page,'.content-admin-series h3','650');await page.locator('.content-admin-actions').getByRole('button',{name:'Moderation history',exact:true}).click();await exactTitle(page,'.content-admin-modal-title','650');
  state.setSeries({language:'cmn',title:title+'ABC',demo:1});await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  for(const[selector,latinFamily]of [['.hero-copy h2 a','DM Sans'],['.poster-film-title>strong','Playfair Display']] as const){
    await expect(page.locator(selector).first()).toHaveText(title+'ABC');const fonts=await renderedFonts(page,selector);
    expect(fonts.filter(font=>font.familyName.startsWith('Noto Sans SC')).reduce((sum,font)=>sum+font.glyphCount,0)).toBe(5);
    expect(fonts.filter(font=>font.familyName.startsWith(latinFamily)).reduce((sum,font)=>sum+font.glyphCount,0)).toBe(3);
    expect(fonts.every(font=>font.isCustomFont)).toBe(true);
  }
  for(const language of ['en','ja']){
    state.setSeries({language,title,demo:0});await page.goto('/');await expect(page.locator('.hero-copy h2')).toHaveText(title);await expect(page.locator('.hero-copy .series-title-cjk')).toHaveCount(0);await expect(page.locator('.hero-copy h2')).not.toHaveCSS('font-family',/Noto Sans SC/);
  }
  expect(state.writes).toEqual([]);
});
