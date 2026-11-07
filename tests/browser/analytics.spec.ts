import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const seriesId='after-midnight',episodeId='after-midnight-1';
const password='DemoPass123!';
type Session=Awaited<ReturnType<APIRequestContext['storageState']>>;
let ownerState:Session;

test.beforeAll(async({playwright})=>{
  const owner=await playwright.request.newContext({baseURL:'http://127.0.0.1:3001'});
  try{
    const login=await owner.post('/api/auth/login',{data:{email:'creator@demo.aidramio.test',password}});expect(login.ok()).toBe(true);
    ownerState=await owner.storageState();
  }finally{await owner.dispose();}
});

async function startAndPause(page:Page,id:string){
  const started=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/api/episodes/${id}/playback`));
  const video=page.locator('video');await expect(video).toBeVisible();
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);
  // Start real media and pause immediately. A true/zero-ms start receipt proves
  // counting does not wait for a later three-second watch-time heartbeat.
  await video.evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();element.pause();});
  const response=await started;expect(response.ok()).toBe(true);
  const receipt=await response.json();expect(receipt.viewCounted).toBe(true);expect(receipt.watchedMs).toBe(0);
  return receipt;
}

test('guest playback counts immediately, stays deduplicated and records separate episode watch time',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  const owner=await browser.newContext({baseURL:'http://127.0.0.1:3001',storageState:ownerState});
  try{
    const original=await (await owner.request.get(`/api/studio/series/${seriesId}/analytics?period=7d`)).json();
    const publicBefore=await (await page.request.get(`/api/series/${seriesId}`)).json();
    const episodeBefore=publicBefore.episodes.find((episode:any)=>episode.id===episodeId).views;
    const secondId='after-midnight-2',secondBefore=publicBefore.episodes.find((episode:any)=>episode.id===secondId).views;
    const starts:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&/\/api\/episodes\/[^/]+\/playback$/.test(new URL(request.url()).pathname))starts.push(request.url());});

    await page.goto(`/series/${seriesId}`);
    await expect(page.locator('.detail-info > .series-engagement > span').first()).toHaveAttribute('title',`${new Intl.NumberFormat('en').format(publicBefore.series.views)} Views`);

    await page.goto(`/watch/${seriesId}/${episodeId}`);
    const video=page.locator('video');await expect(video).toBeVisible();
    await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);
    expect(starts).toEqual([]);
    const preloadOnly=await (await page.request.get(`/api/series/${seriesId}`)).json();
    expect(preloadOnly.series.views).toBe(publicBefore.series.views);expect(preloadOnly.episodes.find((episode:any)=>episode.id===episodeId).views).toBe(episodeBefore);

    const receipt=await startAndPause(page,episodeId);
    const immediate=await (await page.request.get(`/api/series/${seriesId}`)).json();
    expect(immediate.series.views).toBe(publicBefore.series.views+1);
    expect(immediate.episodes.find((episode:any)=>episode.id===episodeId).views).toBe(episodeBefore+1);

    // Watch time still comes from advancing media, independently of the view
    // already counted at start. Pausing flushes a sub-three-second interval.
    await video.evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();});
    await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(0.5);
    const watchTime=page.waitForResponse(async response=>response.request().method()==='PUT'&&response.url().endsWith(`/api/playback/${receipt.sessionId}`)&&response.ok()&&(await response.json()).watchedMs>0);
    await video.evaluate((element:HTMLVideoElement)=>element.pause());
    const measured=await (await watchTime).json();expect(measured.viewCounted).toBe(true);expect(measured.watchedMs).toBeGreaterThan(0);expect(measured.watchedMs).toBeLessThanOrEqual(12000);
    expect(starts).toHaveLength(1);

    // A metadata preload/reload does not create another view; the guest's durable
    // cookie also reuses the counted session if playback starts again.
    await page.reload();await expect(page.locator('video')).toBeVisible();
    const reloaded=await (await page.request.get(`/api/series/${seriesId}`)).json();
    expect(reloaded.series.views).toBe(publicBefore.series.views+1);expect(reloaded.episodes.find((episode:any)=>episode.id===episodeId).views).toBe(episodeBefore+1);
    const resumed=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/api/episodes/${episodeId}/playback`));
    await page.locator('video').evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();element.pause();});
    expect((await (await resumed).json()).sessionId).toBe(receipt.sessionId);

    await page.goto(`/series/${seriesId}`);
    await expect(page.locator('.detail-info > .series-engagement > span').first()).toHaveAttribute('title',`${new Intl.NumberFormat('en').format(publicBefore.series.views+1)} Views`);
    await expect(page.locator(`.episode-tile[href="/watch/${seriesId}/${episodeId}"] .episode-view-count`)).toHaveAttribute('title',`${new Intl.NumberFormat('en').format(episodeBefore+1)} Views`);

    await page.goto(`/watch/${seriesId}/${secondId}`);
    const secondReceipt=await startAndPause(page,secondId);expect(secondReceipt.sessionId).not.toBe(receipt.sessionId);
    const afterSecond=await (await page.request.get(`/api/series/${seriesId}`)).json();
    expect(afterSecond.series.views).toBe(publicBefore.series.views+2);expect(afterSecond.episodes.find((episode:any)=>episode.id===secondId).views).toBe(secondBefore+1);

    const analytics=await (await owner.request.get(`/api/studio/series/${seriesId}/analytics?period=7d`)).json();
    expect(analytics.totals.views).toBe(original.totals.views+2);
    const episode=analytics.episodes.find((entry:any)=>entry.id===episodeId);
    expect(episode.views).toBe(episodeBefore+1);expect(episode.avgWatchSeconds).toBeGreaterThan(0);expect(episode.avgWatchSeconds).toBeLessThanOrEqual(12);

    const studio=await owner.newPage();await studio.goto(`/studio/series/${seriesId}`);
    await studio.locator('.analytics-editor-toggle').click();
    const panel=studio.locator('.series-analytics');await expect(panel).toBeVisible();
    await expect(panel.locator('.analytics-episodes tbody tr')).toHaveCount(8);
    await panel.locator('.analytics-filters select').selectOption('7d');
    await expect(panel.locator('.analytics-summary strong').first()).toHaveText(String(analytics.totals.views));
    await studio.setViewportSize({width:390,height:844});
    expect(await studio.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await owner.close();}
});

test('a creator public play counts immediately while Studio private playback remains excluded',async({page})=>{
  await page.context().addCookies(ownerState.cookies);
  const details={title:`Owner playback ${Date.now()}`,description:'A fresh local series to verify owner plays without reusing prior analytics sessions.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
  const create=await page.request.post('/api/studio/series',{data:details});expect(create.status()).toBe(201);const{id}=await create.json();
  const cover=await page.request.post(`/api/studio/series/${id}/cover`,{multipart:{cover:{name:'cover.jpg',mimeType:'image/jpeg',buffer:await readFile('public/images/midnight.jpg')}}});expect(cover.ok()).toBe(true);
  const upload=await page.request.post(`/api/studio/series/${id}/episodes`,{multipart:{title:'Owner play fixture',number:'1',video:{name:'episode.mp4',mimeType:'video/mp4',buffer:await readFile('public/demo-preview.mp4')}}});expect(upload.status()).toBe(201);const episode=await upload.json();
  const publish=await page.request.post(`/api/studio/series/${id}/status`,{data:{status:'published'}});expect(publish.ok()).toBe(true);

  const starts:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&/\/api\/episodes\/[^/]+\/playback$/.test(new URL(request.url()).pathname))starts.push(request.url());});
  await page.goto(`/watch/${id}/${episode.id}`);await startAndPause(page,episode.id);
  const counted=await (await page.request.get(`/api/series/${id}`)).json();expect(counted.series.views).toBe(1);expect(counted.episodes[0].views).toBe(1);expect(starts).toHaveLength(1);

  await page.goto(`/studio/series/${id}`);
  await page.getByRole('button',{name:'Private preview: Owner play fixture',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Private preview',exact:true}).locator('video');
  await expect(preview).toHaveAttribute('src',`/api/studio/episodes/${episode.id}/stream`);
  await preview.evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();element.pause();});
  expect(starts).toHaveLength(1);
  const statistics=await (await page.request.get(`/api/studio/series/${id}/analytics?period=7d`)).json();expect(statistics.totals.views).toBe(1);expect(statistics.episodes[0].views).toBe(1);
});

test('series likes require login, persist after reload and remain independent from saved series',async({page})=>{
  await page.goto(`/series/${seriesId}`);await page.locator('.series-like-button').click();
  await expect(page).toHaveURL(/\/auth\?next=%2Fseries%2Fafter-midnight/);
  const login=await page.request.post('/api/auth/login',{data:{email:'viewer@demo.aidramio.test',password}});expect(login.ok()).toBe(true);
  const before=await (await page.request.get(`/api/series/${seriesId}`)).json();
  await page.goto(`/series/${seriesId}`);
  const button=page.locator('.series-like-button');await expect(button).toHaveAttribute('aria-pressed',String(before.series.liked));
  const firstResponse=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith(`/api/series/${seriesId}/like`));
  await button.click();
  const changed=await (await firstResponse).json();expect(changed.liked).toBe(!before.series.liked);expect(changed.likes).toBe(before.series.likes+(before.series.liked?-1:1));
  await expect(button).toHaveAttribute('aria-pressed',String(changed.liked));
  await page.reload();await expect(page.locator('.series-like-button')).toHaveAttribute('aria-pressed',String(changed.liked));
  const restoredResponse=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith(`/api/series/${seriesId}/like`));
  await page.locator('.series-like-button').click();
  expect((await (await restoredResponse).json()).likes).toBe(before.series.likes);
  const after=await (await page.request.get(`/api/series/${seriesId}`)).json();
  expect(after.series.liked).toBe(before.series.liked);expect(after.series.saved).toBe(before.series.saved);
});
