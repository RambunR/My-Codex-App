import {test,expect,type Page,type Locator} from '@playwright/test';
import sharp from 'sharp';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {demoAdminSession} from './helpers/admin-session';

const layouts=[['9:16',540,960],['1:1',720,360],['16:9',360,720]] as const;
let directory:string,video:Buffer;
async function json(response:{status:()=>number;json:()=>Promise<unknown>},status=200):Promise<any>{const body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(status);return body;}
async function artwork(width:number,height:number){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><rect width="25%" height="25%" fill="#ff0000"/><rect x="75%" width="25%" height="25%" fill="#00ff00"/><rect y="75%" width="25%" height="25%" fill="#0000ff"/><rect x="75%" y="75%" width="25%" height="25%" fill="#ffff00"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
test.beforeAll(async()=>{directory=await mkdtemp(path.join(tmpdir(),'lingying-cover-layout-'));const file=path.join(directory,'episode.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x96:r=12','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',file]);video=await readFile(file);});
test.afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
async function fullImage(frame:Locator,width:number,height:number){
  const image=frame.locator('img');await expect(image).toHaveCSS('object-fit','contain');await expect(image).toHaveCSS('object-position','50% 50%');await expect(image).toHaveCSS('transform','none');await expect(frame).toHaveCSS('background-color','rgb(0, 0, 0)');
  await expect.poll(()=>image.evaluate(element=>{const img=element as HTMLImageElement;return[img.naturalWidth,img.naturalHeight];})).toEqual([width,height]);
  // Test original cover pixels separately from the intentionally overlaid brand icon.
  const{data,info}=await sharp(await frame.screenshot({style:'.cover-watermark{visibility:hidden!important}'})).removeAlpha().raw().toBuffer({resolveWithObject:true}),scale=Math.min(info.width/width,info.height/height),artWidth=width*scale,artHeight=height*scale,offsetX=(info.width-artWidth)/2,offsetY=(info.height-artHeight)/2;
  const pixel=(x:number,y:number)=>{const start=(Math.floor(y)*info.width+Math.floor(x))*info.channels;return Array.from(data.subarray(start,start+3));};
  for(const[x,y,color]of [[.12,.12,[255,0,0]],[.88,.12,[0,255,0]],[.12,.88,[0,0,255]],[.88,.88,[255,255,0]]] as const){const actual=pixel(offsetX+artWidth*x,offsetY+artHeight*y);for(let channel=0;channel<3;channel++)expect(Math.abs(actual[channel]-color[channel])).toBeLessThanOrEqual(35);}
  if(offsetX>5)expect(pixel(offsetX/2,info.height/2).every(channel=>channel<8)).toBe(true);
  if(offsetY>5)expect(pixel(info.width/2,offsetY/2).every(channel=>channel<8)).toBe(true);
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

for(const[ratio,width,height]of layouts)test(`${ratio} artwork keeps every source corner in Studio and persists its selected public layout`,async({page})=>{
  await demoAdminSession(page);const image=await artwork(width,height),title=`Whole cover ${ratio} ${Date.now()}`;await page.goto('/studio/new');
  const selector=page.getByRole('combobox',{name:'Cover layout',exact:true});await expect(selector).toHaveValue('9:16');await expect(selector.locator('option')).toHaveCount(3);await selector.selectOption(ratio);
  await page.locator('#series-title').fill(title);await page.locator('#series-description').fill('An original drama whose cover keeps its complete image, including all four colored corners.');
  await page.locator('.cover-panel input[type="file"]').setInputFiles({name:'whole-artwork.png',mimeType:'image/png',buffer:image});
  const preview=page.locator('.cover-artwork-editor-frame');await expect(preview).toHaveCSS('aspect-ratio',ratio.replace(':',' / '));await expect(page.locator('.cover-source-dimensions')).toHaveText(`Source image: ${width} × ${height} pixels`);await fullImage(preview,width,height);
  const previewBox=await preview.boundingBox(),chooseBox=await page.locator('.cover-choose-action').boundingBox();expect(chooseBox!.y).toBeGreaterThanOrEqual(previewBox!.y+previewBox!.height);
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/series'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save details',exact:true}).first().click();const{id}=await json(await saved,201);await expect(page).toHaveURL(`/studio/series/${id}`);
  await expect(selector).toHaveValue(ratio);expect((await json(await page.request.get(`/api/studio/series/${id}`))).series.cover_aspect_ratio).toBe(ratio);
  const episode=await json(await page.request.post(`/api/studio/series/${id}/episodes`,{multipart:{title:'Episode 001',number:'1',video:{name:'episode.mp4',mimeType:'video/mp4',buffer:video}}}),201);expect(episode.id).toBeTruthy();await json(await page.request.post(`/api/studio/series/${id}/status`,{data:{status:'published'}}));
  const publicData=await json(await page.request.get(`/api/series/${id}`));expect(publicData.series.cover_aspect_ratio).toBe(ratio);const served=await page.request.get(publicData.series.cover),metadata=await sharp(await served.body()).metadata();expect([metadata.width,metadata.height]).toEqual([width,height]);
  await page.goto(`/series/${id}`);const detail=page.locator('.detail-cover');await expect(detail).toHaveAttribute('data-cover-aspect-ratio',ratio);await expect(detail).toHaveCSS('aspect-ratio',ratio.replace(':',' / '));await fullImage(detail,width,height);await expect(detail.locator('.poster-film-title,.poster-shade')).toHaveCount(0);
});

test('an existing 2:3 cover remains unchanged until its creator chooses a new layout',async({page})=>{
  const user=await demoAdminSession(page),source=`data:image/png;base64,${(await artwork(400,400)).toString('base64')}`;
  const series={id:'legacy-cover-fixture',title:'Existing cover layout',description:'The original two-to-three cover frame remains valid while other details are edited.',language:'en',genres:['drama'],themes:[],format:null,cover:source,creator_id:user.id,creator_name:user.name,creation_type:'human',price_cents:10,free_episodes:1,episode_count:0,views:0,saves:0,likes:0,status:'draft',featured:0,created_at:'2026-10-01 12:00:00',cover_aspect_ratio:'2:3',publisher_profile_id:null};
  const writes:Record<string,unknown>[]=[];await page.route('**/api/studio/series/legacy-cover-fixture',route=>{if(route.request().method()==='PATCH'){writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}return route.fulfill({json:{series,episodes:[],episodes_revision:'cover-fixture',owner_storage:{used_bytes:0,quota_bytes:5*1024**3}}});});
  await page.goto('/studio/series/legacy-cover-fixture');const selector=page.getByRole('combobox',{name:'Cover layout',exact:true});await expect(selector).toHaveValue('2:3');await expect(selector.locator('option[value="2:3"]')).toHaveJSProperty('disabled',true);await fullImage(page.locator('.cover-artwork-editor-frame'),400,400);
  await page.locator('#series-title').fill('Edited details keep the existing cover');await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).not.toHaveProperty('cover_aspect_ratio');
  await selector.selectOption('16:9');await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1].cover_aspect_ratio).toBe('16:9');
});

for(const[locale,width]of [['zh-TW',390],['ar',320]] as const)test(`cover layouts, source dimensions and full artwork fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  const image=await artwork(360,720),account={id:'cover-phone-owner',name:'Local creator',email:'cover-phone@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:locale,payment_review:false};
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:account}}));await page.goto('/studio/new');await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  const selector=page.locator('#series-cover-layout');await expect(selector).toHaveValue('9:16');await selector.selectOption('16:9');await page.locator('.cover-panel input[type="file"]').setInputFiles({name:'portrait-in-landscape.png',mimeType:'image/png',buffer:image});await fullImage(page.locator('.cover-artwork-editor-frame'),360,720);await expect(selector).toHaveCSS('font-size','16px');await expect(page.locator('.cover-source-dimensions')).toBeVisible();await noOverflow(page);await expect(page.locator('.cover-panel')).not.toContainText('Your entire image stays visible.');
  const preview=await page.locator('.cover-artwork-editor-frame').boundingBox(),button=await page.locator('.cover-choose-action').boundingBox();expect(button!.y).toBeGreaterThanOrEqual(preview!.y+preview!.height);
});
