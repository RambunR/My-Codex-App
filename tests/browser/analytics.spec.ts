import {test,expect} from '@playwright/test';

const seriesId='after-midnight',episodeId='after-midnight-1';
const password='DemoPass123!';

test('visible guest playback records watch time once and appears in private publisher statistics',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const owner=await browser.newContext({baseURL:'http://127.0.0.1:3001'});
  try{
    const login=await owner.request.post('/api/auth/login',{data:{email:'creator@demo.aidramio.test',password}});expect(login.ok()).toBe(true);
    const original=await (await owner.request.get(`/api/studio/series/${seriesId}/analytics?period=7d`)).json();
    const publicBefore=await (await page.request.get(`/api/series/${seriesId}`)).json();
    const episodeBefore=publicBefore.episodes.find((episode:any)=>episode.id===episodeId).views;

    await page.goto(`/watch/${seriesId}/${episodeId}`);
    const video=page.locator('video');await expect(video).toBeVisible();
    await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThan(0);
    const qualified=page.waitForResponse(async response=>response.request().method()==='PUT'&&/\/api\/playback\//.test(response.url())&&response.ok()&&(await response.json()).viewCounted===true);
    await video.evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();});
    const receipt=await (await qualified).json();expect(receipt.watchedMs).toBeGreaterThanOrEqual(3000);expect(receipt.watchedMs).toBeLessThanOrEqual(12000);
    await video.evaluate((element:HTMLVideoElement)=>element.pause());
    await expect.poll(async()=>{
      const data=await (await page.request.get(`/api/series/${seriesId}`)).json();
      return data.episodes.find((episode:any)=>episode.id===episodeId).views;
    }).toBe(episodeBefore+1);

    // A metadata preload/reload does not create another view; the guest's durable
    // cookie also reuses the qualified session if playback starts again.
    await page.reload();await expect(page.locator('video')).toBeVisible();
    const preloadOnly=await (await page.request.get(`/api/series/${seriesId}`)).json();
    expect(preloadOnly.episodes.find((episode:any)=>episode.id===episodeId).views).toBe(episodeBefore+1);
    const resumed=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/api/episodes/${episodeId}/playback`));
    await page.locator('video').evaluate(async(element:HTMLVideoElement)=>{element.muted=true;await element.play();});
    expect((await (await resumed).json()).sessionId).toBe(receipt.sessionId);
    await page.locator('video').evaluate((element:HTMLVideoElement)=>element.pause());

    const analytics=await (await owner.request.get(`/api/studio/series/${seriesId}/analytics?period=7d`)).json();
    expect(analytics.totals.views).toBe(original.totals.views+1);
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
