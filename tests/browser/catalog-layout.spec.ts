import {test,expect,type Locator,type Page} from '@playwright/test';
import type {Genre,StoryTheme} from '../../shared/taxonomy';

const title='The Godfather’s Caged Bird — 靈映の約束 — ForeverBoundByAnUnbreakablePromiseForeverBoundByAnUnbreakablePromise';
const finalSentence='At last, she chooses her own future, and every secret is revealed in the complete final chapter.';
const description=[
  'When a quiet archivist discovers that her family has been protecting a dangerous secret, she must choose between the life she knows and a promise she never made.',
  ...Array.from({length:5},(_,index)=>`Chapter ${index+1} follows her through unfamiliar cities, unexpected friendships, and a mystery that reaches further into the past. Each clue changes what she believes about the people closest to her. She learns to trust her own judgment while searching for the truth behind a forgotten letter.`),
  finalSentence,
].join('\n\n');
const artwork='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#302044"/><rect width="100" height="450" fill="#ff6699"/><rect x="700" width="100" height="450" fill="#b197fc"/></svg>');
const release={id:'catalog-layout-regression',title,description,language:'en',genres:['romance','thriller','mystery'] satisfies Genre[],themes:['hidden-identity','revenge','forbidden-romance'] satisfies StoryTheme[],format:'live-action',creation_type:'ai-assisted',cover:artwork,cover_aspect_ratio:'9:16',creator_name:'DreamShortDrama',publisher_id:'publisher-layout-regression',publisher_profile_id:'publisher-layout-regression',price_cents:10,free_episodes:1,episode_count:35,first_episode_id:'layout-episode-001',views:12345,saves:0,likes:345,liked:false,status:'published',featured:1,demo:0,created_at:'2026-11-02T00:00:00Z',subtitle_languages:['en','zh-TW','zh-CN','ja','ko','hi','ar','es','id']};
const episode={id:release.first_episode_id,series_id:release.id,title:'Episode 001',number:1,duration:240,bytes:123456,views:123,free:true,unlocked:true};
const sizes=[{name:'desktop',width:1440,height:900},{name:'phone',width:390,height:844},{name:'small phone',width:320,height:568},{name:'short landscape',width:844,height:390}];

async function guestCatalogue(page:Page,locale='en'){
  const writes:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/series**',route=>{const pathname=new URL(route.request().url()).pathname;return route.fulfill({json:pathname==='/api/series/'+release.id?{series:release,episodes:[episode]}:{series:[release,{...release,id:'second-layout-release',title:'A second original story',description:'Another complete original short drama.',featured:1}]}});});
  return()=>{expect(writes,'Browsing layout fixtures must not write account, viewing or payment records').toEqual([]);expect(errors).toEqual([]);};
}
async function stableLayout(page:Page){await page.evaluate(()=>document.fonts.ready);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
async function completeText(locator:Locator,expected:string){
  await expect(locator).toHaveText(expected);const metrics=await locator.evaluate(element=>{
    const range=document.createRange();range.selectNodeContents(element);const rects=Array.from(range.getClientRects()),box=element.getBoundingClientRect(),next=element.nextElementSibling?.getBoundingClientRect();const clippers=[];
    for(let ancestor:Element|null=element;ancestor;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor),bounds=ancestor.getBoundingClientRect();if(bounds.width&&bounds.height&&(['hidden','clip'].includes(style.overflowX)||['hidden','clip'].includes(style.overflowY)))clippers.push({x:['hidden','clip'].includes(style.overflowX),y:['hidden','clip'].includes(style.overflowY),left:bounds.left+ancestor.clientLeft,right:bounds.left+ancestor.clientLeft+ancestor.clientWidth,top:bounds.top+ancestor.clientTop,bottom:bounds.top+ancestor.clientTop+ancestor.clientHeight});}
    return{clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,left:box.left,right:box.right,inkLeft:Math.min(...rects.map(rect=>rect.left)),inkRight:Math.max(...rects.map(rect=>rect.right)),inkTop:Math.min(...rects.map(rect=>rect.top)),inkBottom:Math.max(...rects.map(rect=>rect.bottom)),lastHeight:rects.at(-1)?.height,nextTop:next?.height?next.top:null,clippers};
  });
  // Font ink can legitimately extend beyond a short line box. Assert actual
  // clipping and neighboring content instead of equating ink with clientHeight.
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth+1);expect(metrics.lastHeight).toBeGreaterThan(0);expect(metrics.inkLeft).toBeGreaterThanOrEqual(metrics.left-1);expect(metrics.inkRight).toBeLessThanOrEqual(metrics.right+1);
  if(metrics.nextTop!==null)expect(metrics.inkBottom).toBeLessThanOrEqual(metrics.nextTop+1);
  for(const clip of metrics.clippers){if(clip.x){expect(metrics.inkLeft).toBeGreaterThanOrEqual(clip.left-1);expect(metrics.inkRight).toBeLessThanOrEqual(clip.right+1);}if(clip.y){expect(metrics.inkTop).toBeGreaterThanOrEqual(clip.top-1);expect(metrics.inkBottom).toBeLessThanOrEqual(clip.bottom+1);}}
}
async function reachable(link:Locator){await link.scrollIntoViewIfNeeded();await expect(link).toBeVisible();await link.click({trial:true});}
async function detailLayout(page:Page,width:number){
  const hero=page.locator('.series-detail-hero'),cover=hero.locator('.detail-cover'),image=cover.locator('img');await completeText(hero.locator('h1'),title);await completeText(hero.locator('.detail-description'),description);
  await expect(image).toHaveCSS('object-fit','contain');await expect(image).toHaveCSS('transform','none');await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>[element.naturalWidth,element.naturalHeight])).toEqual([800,450]);
  if(width>=1100){const heroBox=(await hero.boundingBox())!,coverBox=(await cover.boundingBox())!;expect(coverBox.width/heroBox.width).toBeGreaterThanOrEqual(.3);expect(coverBox.width/heroBox.width).toBeLessThanOrEqual(.35);}
  const metadata=hero.locator('.series-classification'),groups=metadata.locator(':scope > div:not(.subtitle-metadata)');await expect(groups).toHaveCount(4);const labels=await groups.locator('dt').evaluateAll(elements=>elements.map(element=>({x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y})));const columns=width>=1100?4:2;
  for(let offset=0;offset<4;offset+=columns){const row=labels.slice(offset,offset+columns);expect(Math.max(...row.map(item=>item.y))-Math.min(...row.map(item=>item.y))).toBeLessThanOrEqual(1);expect(new Set(row.map(item=>Math.round(item.x))).size).toBe(columns);}
  if(columns===2)expect(labels[2].y).toBeGreaterThan(labels[0].y+10);
  const subtitles=metadata.locator('.subtitle-metadata');await expect(subtitles.locator('li')).toHaveCount(release.subtitle_languages.length);const metaBox=(await metadata.boundingBox())!,subtitleBox=(await subtitles.boundingBox())!;expect(subtitleBox.width).toBeGreaterThanOrEqual(metaBox.width-2);expect(subtitleBox.y).toBeGreaterThan(labels.at(-1)!.y);
  await reachable(hero.locator('.detail-actions a').first());await stableLayout(page);
}

for(const size of sizes)test(`full series title, synopsis, artwork and classification fit ${size.name} ${size.width}×${size.height}`,async({page})=>{
  await page.setViewportSize({width:size.width,height:size.height});const clean=await guestCatalogue(page);await page.goto('/series/'+release.id);await expect(page.locator('.detail-page h1')).toBeVisible();await stableLayout(page);await detailLayout(page,size.width);clean();
});

for(const size of sizes)test(`featured story stays within 70% of ${size.name} height while the complete synopsis and actions remain reachable`,async({page})=>{
  await page.setViewportSize({width:size.width,height:size.height});const clean=await guestCatalogue(page);await page.goto('/');const hero=page.locator('section.hero').first();await expect(hero).toBeVisible();await stableLayout(page);expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(size.height*.7+1);
  await expect(hero.locator('h2')).toHaveText(title);const synopsis=hero.locator('.hero-synopsis');await expect(synopsis).toHaveAttribute('role','region');await expect(synopsis).toHaveAttribute('tabindex','0');await expect(synopsis).toHaveAccessibleName(/.+/);await expect(synopsis.locator('p')).toHaveText(description);await synopsis.focus();await expect(synopsis).toBeFocused();await synopsis.press('End');
  await expect.poll(()=>synopsis.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(2);const endVisible=await synopsis.evaluate(element=>{const node=element.querySelector('p')!.firstChild!,range=document.createRange();range.setStart(node,Math.max(0,node.textContent!.length-8));range.setEnd(node,node.textContent!.length);const text=range.getBoundingClientRect(),viewport=element.getBoundingClientRect();return text.height>0&&text.top>=viewport.top-1&&text.bottom<=viewport.bottom+1;});expect(endVisible,'Keyboard scrolling must reveal the end of the synopsis, beyond the former 140-character cut').toBe(true);
  await reachable(hero.locator('.hero-play'));await reachable(hero.locator('.hero-details'));await hero.locator('.hero-details').click();await expect(page).toHaveURL('/series/'+release.id);await completeText(page.locator('.detail-description'),description);await stableLayout(page);clean();
});

test('long mixed-language text and complete classification remain readable on a narrow RTL phone',async({page})=>{
  await page.setViewportSize({width:320,height:568});const clean=await guestCatalogue(page,'ar');await page.goto('/series/'+release.id);await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.locator('html')).toHaveAttribute('lang','ar');await detailLayout(page,320);clean();
});
