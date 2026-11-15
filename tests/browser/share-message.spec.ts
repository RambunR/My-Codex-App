import {test,expect,type Page} from '@playwright/test';
import {type Locale} from '../../shared/config';
import {localeMessages} from '../../src/i18n';

// Native sharing and clipboard access are browser-only fixtures. No operating
// system share sheet, authentication, analytics write or payment is required.
test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
const series={id:'share-message-original',title:'An Original Love Story',description:'An original romance used to verify the public series sharing experience.',language:'en',genres:['romance','drama'],themes:[],format:'live-action',cover:'/brand-mark.png',cover_aspect_ratio:'1:1',creator_name:'Share Message Studio',creation_type:'human',price_cents:10,free_episodes:1,episode_count:1,views:0,saves:0,status:'published',featured:0,created_at:'2026-11-15T00:00:00Z',likes:0,liked:false,demo:0};
const episode={id:'share-message-episode',series_id:series.id,title:'Episode 1',number:1,duration:10,bytes:100,free:true,unlocked:true};
type ShareCapture={native:Array<{title?:string;text?:string;url?:string}>;clipboard:string[]};
type ShareMode='native'|'clipboard'|'abort'|'failure';
const copy=(locale:Locale)=>localeMessages[locale];
const promotion=(locale:Locale)=>copy(locale).seriesSharePromo!.replace('{genre}',copy(locale).genre_romance!);
const cleanPath='/series/'+series.id;
async function capture(page:Page){return page.evaluate(()=>(window as unknown as {__seriesShareCapture:ShareCapture}).__seriesShareCapture);}
function expectedText(page:Page,locale:Locale){return new URL(cleanPath,page.url()).href+'\n\n'+promotion(locale);}

async function fixture(page:Page,locale:Locale,mode:ShareMode='native'){
  const writes:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({language,shareMode})=>{
    localStorage.setItem('drama-language',language);
    const state={native:[] as ShareData[],clipboard:[] as string[]};Object.defineProperty(window,'__seriesShareCapture',{value:state});
    Object.defineProperty(navigator,'share',{configurable:true,value:shareMode==='clipboard'?undefined:async(data:ShareData)=>{state.native.push({...data});if(shareMode==='abort')throw new DOMException('The visitor cancelled sharing.','AbortError');if(shareMode==='failure')throw new DOMException('Native sharing is unavailable.','NotAllowedError');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{state.clipboard.push(text);}}});
  },{language:locale,shareMode:mode});
  await page.route('**/api/**',route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.fulfill({status:409,json:{error:{message:'This sharing fixture is read-only.'}}});}
    if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:null}});
    if(url.pathname==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,limits:{},auth:{google:false,apple:false,email:false}}});
    if(url.pathname===cleanPath.replace('/series/','/api/series/'))return route.fulfill({json:{series,episodes:[episode]}});
    if(url.pathname==='/api/series')return route.fulfill({json:{series:[]}});
    return route.fulfill({status:404,json:{error:{message:'Unexpected sharing fixture read.'}}});
  });
  await page.goto(cleanPath+'?campaign=private-preview#episodes');await expect(page.locator('.detail-info>h1')).toHaveText(series.title);
  return{writes,errors};
}
async function share(page:Page,locale:Locale){await page.locator('.detail-actions').getByRole('button',{name:copy(locale).share!,exact:true}).click();}

for(const locale of ['en','zh-TW','zh-CN','ar'] as const)test(`${locale} native share puts one clean series link before the localized genre invitation`,async({page})=>{
  const state=await fixture(page,locale);await share(page,locale);await expect.poll(async()=>(await capture(page)).native.length).toBe(1);
  const result=await capture(page),payload=result.native[0],url=new URL(cleanPath,page.url()).href;
  expect(payload).toEqual({title:series.title,text:expectedText(page,locale)});expect(Object.hasOwn(payload,'url')).toBe(false);expect(payload.text!.split('\n\n')).toEqual([url,promotion(locale)]);expect(payload.text!.split(url)).toHaveLength(2);expect(payload.text).not.toContain('campaign=');expect(payload.text).not.toContain('#episodes');expect(result.clipboard).toEqual([]);
  if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

for(const locale of ['en','zh-TW'] as const)test(`${locale} clipboard fallback copies the complete link and localized invitation`,async({page})=>{
  const state=await fixture(page,locale,'clipboard');await share(page,locale);await expect.poll(async()=>(await capture(page)).clipboard.length).toBe(1);
  expect(await capture(page)).toEqual({native:[],clipboard:[expectedText(page,locale)]});await expect(page.locator('.toast')).toContainText(copy(locale).copied!);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test('changing the website language immediately changes the next share invitation and genre',async({page})=>{
  const state=await fixture(page,'en');await share(page,'en');await expect.poll(async()=>(await capture(page)).native.length).toBe(1);const english=expectedText(page,'en');
  await page.locator('header .header-language').click();await page.getByRole('dialog').getByRole('button',{name:/繁體中文/}).click();await expect(page.locator('html')).toHaveAttribute('lang','zh-TW');await share(page,'zh-TW');await expect.poll(async()=>(await capture(page)).native.length).toBe(2);
  const result=await capture(page);expect(result.native.map(item=>item.text)).toEqual([english,expectedText(page,'zh-TW')]);expect(result.native[1].text).toContain(copy('zh-TW').genre_romance!);expect(result.native[1].text).not.toBe(english);expect(result.clipboard).toEqual([]);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test('cancelling native sharing does not copy a message or show an error',async({page})=>{
  const state=await fixture(page,'en','abort');await share(page,'en');await expect.poll(async()=>(await capture(page)).native.length).toBe(1);expect((await capture(page)).clipboard).toEqual([]);await expect(page.locator('.toast')).toHaveCount(0);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test('an unavailable native share falls back to the same complete clipboard message',async({page})=>{
  const state=await fixture(page,'zh-CN','failure');await share(page,'zh-CN');await expect.poll(async()=>(await capture(page)).clipboard.length).toBe(1);expect(await capture(page)).toEqual({native:[{title:series.title,text:expectedText(page,'zh-CN')}],clipboard:[expectedText(page,'zh-CN')]});await expect(page.locator('.toast')).toContainText(copy('zh-CN').copied!);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
