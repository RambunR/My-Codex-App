import {test,expect,type Locator,type Page} from '@playwright/test';
import sharp from 'sharp';

function cornerArtwork(width:number,height:number){
  const size=Math.min(width,height)*.18;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><rect width="${size}" height="${size}" fill="#ff0000"/><rect x="${width-size}" width="${size}" height="${size}" fill="#00ff00"/><rect y="${height-size}" width="${size}" height="${size}" fill="#0000ff"/><rect x="${width-size}" y="${height-size}" width="${size}" height="${size}" fill="#ffff00"/></svg>`)}`;
}

const releases=[
  {id:'whole-landscape-art',title:'Landscape original',cover_aspect_ratio:'16:9',cover:cornerArtwork(800,450)},
  {id:'whole-portrait-art',title:'Portrait original',cover_aspect_ratio:'9:16',cover:cornerArtwork(450,800)},
  {id:'whole-square-art',title:'Square original',cover_aspect_ratio:'1:1',cover:cornerArtwork(600,600)},
].map((art,index)=>({...art,description:'An original drama with publisher-provided full artwork.',language:'en',genres:['drama'],creator_name:'Artwork Studio',creation_type:'human',price_cents:10,free_episodes:1,episode_count:1,views:1,saves:0,status:'published',featured:index===0?1:0,created_at:'2026-11-02T00:00:00Z',likes:0,liked:false,demo:0}));

async function publicCatalogue(page:Page){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/series**',route=>route.fulfill({json:{series:releases}}));
}

async function wholeImagePixels(image:Locator){
  await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
  const natural=await image.evaluate((element:HTMLImageElement)=>({width:element.naturalWidth,height:element.naturalHeight}));
  const{data,info}=await sharp(await image.screenshot({animations:'disabled'})).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const scale=Math.min(info.width/natural.width,info.height/natural.height),width=natural.width*scale,height=natural.height*scale;
  const left=(info.width-width)/2,top=(info.height-height)/2;
  const rgb=(x:number,y:number)=>{const offset=(Math.min(info.height-1,Math.max(0,Math.floor(y)))*info.width+Math.min(info.width-1,Math.max(0,Math.floor(x))))*info.channels;return [...data.subarray(offset,offset+3)];};
  // Both opposite corner markers must survive letterboxing. A cropped/zoomed
  // landscape image in a portrait card loses these pixels entirely.
  expect(rgb(left+width*.04,top+height*.04)).toEqual([255,0,0]);
  expect(rgb(left+width*.96,top+height*.96)).toEqual([255,255,0]);
  if(top>5)expect(rgb(info.width/2,2)).toEqual([0,0,0]);
}

for(const width of [1280,390])test(`uploaded covers remain whole, black-letterboxed and unobscured in cards and featured art at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await publicCatalogue(page);await page.goto('/');
  const hero=page.locator('.hero-user-artwork');await expect(hero).toBeVisible();
  await expect(hero.locator('.hero-art-title,.hero-art-credit,.hero-art-tint,.hero-fade')).toHaveCount(0);
  const art=hero.locator('.hero-art'),heroImage=art.locator('img');
  await expect(art).toHaveCSS('mask-image','none');await expect(heroImage).toHaveCSS('object-fit','contain');await expect(heroImage).toHaveCSS('transform','none');
  const artBounds=(await art.boundingBox())!,copyBounds=(await hero.locator('.hero-copy').boundingBox())!;
  if(width>640)expect(artBounds.x).toBeGreaterThanOrEqual(copyBounds.x+copyBounds.width-1);
  else expect(artBounds.y+artBounds.height).toBeLessThanOrEqual(copyBounds.y+1);
  await wholeImagePixels(heroImage);
  const cards=page.locator('.catalog-section').filter({has:page.getByRole('heading',{name:'Trending now',exact:true})}).locator('.series-card');
  await expect(cards).toHaveCount(3);await expect(cards.locator('.poster-film-title,.poster-shade')).toHaveCount(0);
  for(const card of await cards.all()){
    const poster=card.locator('.poster'),image=poster.locator('img');
    await expect(image).toHaveCSS('object-fit','contain');await expect(image).toHaveCSS('background-color','rgb(0, 0, 0)');await expect(image).toHaveCSS('transform','none');
    const box=(await poster.boundingBox())!;expect(box.width/box.height).toBeCloseTo(2/3,2);
  }
  await wholeImagePixels(cards.first().locator('.poster img'));
  if(width>640){
    for(const card of await cards.all()){
      await card.hover();await expect(card.locator('.poster img')).toHaveCSS('transform','none');await expect(card.locator('.poster img')).toHaveCSS('object-fit','contain');
    }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
