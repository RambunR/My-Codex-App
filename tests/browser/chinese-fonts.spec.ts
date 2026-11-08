import {test,expect,type Page} from '@playwright/test';

const title='创业与友情，故事ABC123。';
const release={id:'chinese-font-fixture',creator_name:'字体测试',title,description:'发布原创故事，探索创业与友情。观看短剧，分享创作与收入。',language:'cmn',genres:['drama'],themes:['entrepreneurship'],format:'live-action',creation_type:'human',cover:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#302044"/></svg>'),price_cents:10,free_episodes:1,episode_count:1,views:0,saves:0,likes:0,status:'published',featured:1,demo:0,created_at:'2026-11-07T00:00:00Z'};

async function fixture(page:Page,locale:string,series=release){
  const fonts=new Set<string>(),writes:string[]=[];
  page.on('request',request=>{if(request.url().includes('/fonts/noto-sans-sc/')&&request.url().endsWith('.woff2'))fonts.add(request.url());});
  await page.addInitScript(locale=>localStorage.setItem('drama-language',locale),locale);
  await page.route('**/api/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push(request.method()+' '+path);return route.abort();}if(path==='/api/auth/me')return route.fulfill({json:{user:null}});if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',demo:false,usdToHkd:7.8,limits:{}}});if(path==='/api/series')return route.fulfill({json:{series:[series],total:1}});return route.fulfill({status:404,json:{error:{message:'Unexpected typography fixture request'}}});});
  await page.goto('/');await expect(page.locator('.hero-copy h2')).toHaveText(series.title);await page.evaluate(()=>document.fonts.ready);
  return{fonts,writes};
}

async function renderedFonts(page:Page,selector:string){
  const cdp=await page.context().newCDPSession(page);try{await cdp.send('DOM.enable');await cdp.send('CSS.enable');const{root}=await cdp.send('DOM.getDocument');const{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});return(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts as Array<{isCustomFont:boolean;familyName:string;glyphCount:number}>;}finally{await cdp.detach();}
}

test('Simplified Chinese uses one self-hosted variable family for Han, Latin and punctuation while preserving body and heading weights',async({page})=>{
  const state=await fixture(page,'zh-CN');
  for(const selector of ['.home-heading h1','.hero-copy h2 a','.hero-synopsis p']){
    await expect(page.locator(selector)).toHaveCSS('font-family',/Noto Sans SC/);const fonts=await renderedFonts(page,selector);expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(font=>font.isCustomFont&&font.familyName.startsWith('Noto Sans SC'))).toBe(true);
  }
  await expect(page.locator('.hero-copy h2')).toHaveCSS('font-weight','650');await expect(page.locator('.hero-synopsis p')).toHaveCSS('font-weight','400');
  const ink=await page.evaluate(async text=>{await document.fonts.load('400 40px "Noto Sans SC"',text);await document.fonts.load('650 40px "Noto Sans SC"',text);const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=90;const context=canvas.getContext('2d')!;return[400,650].map(weight=>{context.clearRect(0,0,1000,90);context.font=weight+' 40px "Noto Sans SC"';context.fillText(text,0,60);const pixels=context.getImageData(0,0,1000,90).data;let ink=0;for(let i=3;i<pixels.length;i+=4)ink+=pixels[i];return ink;});},title);
  expect(ink[0]).toBeGreaterThan(0);expect(ink[1]).toBeGreaterThan(ink[0]*1.02);expect(state.fonts.size).toBeGreaterThan(0);expect(state.fonts.size).toBeLessThan(101);expect(state.writes).toEqual([]);
  await page.setViewportSize({width:320,height:700});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);expect((await page.locator('section.hero').boundingBox())!.height).toBeLessThanOrEqual(491);
});

for(const locale of ['en','zh-TW'])test(`${locale} retains its typography and does not download Simplified Chinese font subsets`,async({page})=>{
  const state=await fixture(page,locale,{...release,title:'An original story ABC123.',description:'A story of entrepreneurship and friendship.',creator_name:'Independent creator',language:'en'});await expect(page.locator('.hero-copy h2')).toHaveCSS('font-family',/DM Sans/);expect(state.fonts.size).toBe(0);expect(state.writes).toEqual([]);
});

test('Simplified Chinese remains readable when its font download is unavailable',async({page})=>{
  await page.route('**/fonts/noto-sans-sc/*.woff2',route=>route.abort());const state=await fixture(page,'zh-CN');await expect(page.locator('.hero-copy h2')).toHaveText(title);await expect(page.locator('.hero-copy h2')).toBeVisible();const fonts=await renderedFonts(page,'.hero-copy h2 a');expect(fonts.some(font=>font.glyphCount>0)).toBe(true);await expect(page.locator('.hero-copy h2')).toHaveCSS('font-weight','650');expect(state.writes).toEqual([]);
});
