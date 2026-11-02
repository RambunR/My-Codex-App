import {test,expect,type Page,type Browser,type BrowserContext,type APIRequestContext} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const baseURL='http://127.0.0.1:3001',password='DemoPass123!';
type Session=Awaited<ReturnType<APIRequestContext['storageState']>>;
let ownerState:Session,buyerState:Session,adminState:Session,temporary:string,video:Buffer,cover:Buffer;

test.beforeAll(async({playwright})=>{
  temporary=await mkdtemp(path.join(tmpdir(),'lingying-lifecycle-browser-'));
  const file=path.join(temporary,'episode.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x96:r=24','-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',file]);
  video=await readFile(file);cover=await readFile('public/images/midnight.jpg');
  for(const[role,email]of [['owner','creator@demo.aidramio.test'],['buyer','viewer@demo.aidramio.test'],['admin','admin@demo.aidramio.test']] as const){
    const request=await playwright.request.newContext({baseURL});
    try{const response=await request.post('/api/auth/login',{data:{email,password}});expect(response.ok()).toBe(true);const session=await request.storageState();if(role==='owner')ownerState=session;else if(role==='buyer')buyerState=session;else adminState=session;}
    finally{await request.dispose();}
  }
});
test.afterAll(async()=>{if(temporary)await rm(temporary,{recursive:true,force:true});});

async function context(browser:Browser,state:Session){return browser.newContext({baseURL,storageState:state});}
async function body(response:{status:()=>number;json:()=>Promise<unknown>},status=200):Promise<any>{const data=await response.json();expect(response.status(),JSON.stringify(data)).toBe(status);return data;}
const title=(prefix:string)=>`${prefix} ${Date.now()}-${Math.random().toString(36).slice(2,7)}`;

async function published(page:Page,browser:Browser,prefix:string,paid=true){
  await page.context().addCookies(ownerState.cookies);
  const before=(await body(await page.request.get('/api/auth/me'))).user;
  const details={title:title(prefix),description:'A complete original local fixture used to verify creator hiding and permanent series deletion.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
  const{id}=await body(await page.request.post('/api/studio/series',{data:details}),201);
  await body(await page.request.post(`/api/studio/series/${id}/cover`,{multipart:{cover:{name:'cover.jpg',mimeType:'image/jpeg',buffer:cover}}}));
  const episodes=[];
  for(const number of [1,2])episodes.push(await body(await page.request.post(`/api/studio/series/${id}/episodes`,{multipart:{title:`Episode ${number}`,number:String(number),video:{name:`episode-${number}.mp4`,mimeType:'video/mp4',buffer:video}}}),201));
  await body(await page.request.post(`/api/studio/series/${id}/status`,{data:{status:'published'}}));
  const buyer=await context(browser,buyerState);
  if(paid){
    await body(await buyer.request.post(`/api/episodes/${episodes[1].id}/unlock`,{data:{}}));
    await body(await buyer.request.put(`/api/series/${id}/like`,{data:{liked:true}}));
    await body(await buyer.request.post(`/api/series/${id}/save`,{data:{}}));
    await body(await buyer.request.post(`/api/episodes/${episodes[1].id}/progress`,{data:{seconds:1}}));
    const playback=await body(await buyer.request.post(`/api/episodes/${episodes[1].id}/playback`,{data:{}}));
    await page.waitForTimeout(2200);
    const watched=await body(await buyer.request.put(`/api/playback/${playback.sessionId}`,{data:{watchedMs:2500}}));expect(watched.viewCounted).toBe(true);
  }
  const detail=await body(await page.request.get(`/api/series/${id}`));
  expect(typeof detail.series.published_at).toBe('string');expect(Number.isFinite(Date.parse(detail.series.published_at))).toBe(true);
  const after=(await body(await page.request.get('/api/auth/me'))).user;
  return{id,details,episodes,buyer,before,after,publishedAt:detail.series.published_at,bytes:after.used_bytes-before.used_bytes};
}
const actions=(page:Page,id:string)=>page.locator(`.series-lifecycle-actions[data-series-id="${id}"]`);
const metric=(page:Page,key:string)=>page.locator(`.series-delete-statistics [data-metric="${key}"] dd`);
async function preview(page:Page,id:string,seriesTitle:string){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/studio/series/${id}/lifecycle`&&r.request().method()==='GET');
  await actions(page,id).getByRole('button',{name:`Delete series: ${seriesTitle}`,exact:true}).click();
  const data=await body(await response);await expect(page.locator('.series-delete-form')).toBeVisible();return data;
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

test('a creator can hide a purchased series and publish it again without losing private statistics or paid access',async({page,browser})=>{
  const fixture=await published(page,browser,'Reversible hidden drama');const{id,details,episodes,buyer}=fixture;
  try{
    const finances=await body(await buyer.request.get('/api/wallet'));
    const analytics=await body(await page.request.get(`/api/studio/series/${id}/analytics?period=all`));
    await page.goto('/studio');const row=page.locator('.studio-series-row').filter({has:page.locator(`a[href="/studio/series/${id}"]`)});
    await actions(page,id).getByRole('button',{name:`Hide from public: ${details.title}`,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Hide this series?',exact:true});await expect(dialog).toContainText('including to viewers who unlocked episodes');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect((await body(await page.request.get(`/api/series/${id}`))).series.status).toBe('published');
    await actions(page,id).getByRole('button',{name:`Hide from public: ${details.title}`,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Hide series',exact:true}).click();
    await expect(row.locator('.status').first()).toHaveText('Hidden');await expect(row.getByRole('link',{name:'Watch',exact:true})).toHaveCount(0);
    for(const request of [page.request,buyer.request])for(const endpoint of [`/api/series/${id}`,`/api/series/${id}/cover`,`/api/episodes/${episodes[0].id}/stream`,`/api/episodes/${episodes[1].id}/stream`])expect((await request.get(endpoint)).status()).toBe(404);
    expect((await body(await buyer.request.get(`/api/series?sort=new&q=${encodeURIComponent(details.title)}`))).series.some((s:any)=>s.id===id)).toBe(false);
    expect((await body(await buyer.request.get('/api/series?saved=true'))).series.some((s:any)=>s.id===id)).toBe(false);
    expect((await body(await buyer.request.get('/api/history'))).history.some((s:any)=>s.id===id)).toBe(false);
    expect((await body(await page.request.get(`/api/studio/series/${id}`))).series.status).toBe('archived');
    const hiddenAnalytics=await body(await page.request.get(`/api/studio/series/${id}/analytics?period=all`));expect(hiddenAnalytics.totals).toEqual(analytics.totals);
    await page.goto(`/studio/series/${id}`);await expect(page.locator('.series-hidden-notice')).toContainText('Hidden');
    expect((await page.request.get(`/api/studio/episodes/${episodes[1].id}/stream`,{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
    await page.getByRole('button',{name:'Private preview: Episode 2',exact:true}).click();const privatePreview=page.getByRole('dialog',{name:'Private preview',exact:true});await expect(privatePreview).toContainText('Private creator preview');await expect(privatePreview.locator('video')).toHaveAttribute('src',`/api/studio/episodes/${episodes[1].id}/stream`);await privatePreview.getByRole('button',{name:'Close',exact:true}).click();
    expect((await body(await page.request.get(`/api/studio/series/${id}/analytics?period=all`))).totals).toEqual(analytics.totals);
    await actions(page,id).getByRole('button',{name:`Show publicly: ${details.title}`,exact:true}).click();await page.getByRole('dialog',{name:'Publish this series again?',exact:true}).getByRole('button',{name:'Publish again',exact:true}).click();
    const restored=await body(await buyer.request.get(`/api/series/${id}`));expect(restored.series.status).toBe('published');expect(restored.series.published_at).toBe(fixture.publishedAt);expect(restored.episodes.find((e:any)=>e.id===episodes[1].id).unlocked).toBe(true);
    expect((await body(await buyer.request.get(`/api/series?sort=new&q=${encodeURIComponent(details.title)}`))).series.find((s:any)=>s.id===id)?.published_at).toBe(fixture.publishedAt);
    expect((await buyer.request.get(`/api/episodes/${episodes[1].id}/stream`,{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
    const after=await body(await buyer.request.get('/api/wallet'));expect(after.user.wallet_micros).toBe(finances.user.wallet_micros);expect(after.ledger).toEqual(finances.ledger);expect(after.payments).toEqual(finances.payments);
  }finally{await buyer.close();}
});

test('whole-series deletion shows real impact, requires title and acknowledgement, frees media quota and keeps financial records',async({page,browser})=>{
  const fixture=await published(page,browser,'Permanent paid drama');const{id,details,episodes,buyer}=fixture;const admin=await context(browser,adminState);
  try{
    const wallet=await body(await buyer.request.get('/api/wallet')),ownerStats=(await body(await page.request.get('/api/studio'))).stats;
    const ownerBefore=(await body(await page.request.get('/api/auth/me'))).user;
    await page.goto(`/studio/series/${id}`);
    const deletes:any[]=[];page.on('request',r=>{if(r.method()==='DELETE'&&new URL(r.url()).pathname===`/api/studio/series/${id}`)deletes.push(r.postDataJSON());});
    await preview(page,id,details.title);await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();expect(deletes).toEqual([]);expect((await page.request.get(`/api/series/${id}`)).status()).toBe(200);
    const shown=await preview(page,id,details.title);expect(shown.summary).toMatchObject({episode_count:2,views:1,likes:1,real_paid_unlocks:1,real_paid_viewers:1,test_paid_unlocks:0,test_paid_viewers:0,affected_paid_viewers:1});expect(shown.summary.total_watch_seconds).toBeGreaterThanOrEqual(2);
    await expect(metric(page,'episode_count')).toHaveText('2');await expect(metric(page,'views')).toHaveText('1');await expect(metric(page,'likes')).toHaveText('1');await expect(metric(page,'affected_paid_viewers')).toHaveText('1');await expect(metric(page,'real_paid_unlocks')).toHaveText('1');
    const dialog=page.getByRole('dialog',{name:'Permanently delete this series?',exact:true});await expect(dialog).toContainText('cannot be recovered');await expect(dialog).toContainText('does not refund purchases or reverse creator earnings');
    const input=dialog.locator('.series-delete-title-input'),ack=dialog.locator('.series-delete-ack input'),submit=dialog.locator('.series-delete-form button[type="submit"]');
    await expect(submit).toBeDisabled();await input.fill('Incorrect title');await ack.check();await expect(submit).toBeDisabled();await input.fill(details.title);await ack.uncheck();await expect(submit).toBeDisabled();expect(deletes).toEqual([]);await ack.check();await expect(submit).toBeEnabled();
    const deleted=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname===`/api/studio/series/${id}`);await submit.click();const result=await body(await deleted);expect(result.deleted).toBe(true);expect(result.cleanup_pending).toBe(false);expect(result.released_bytes).toBe(fixture.bytes);
    await expect(page).toHaveURL('/studio');expect(deletes).toEqual([{confirmation_token:shown.confirmation_token,confirm_title:details.title,acknowledge:true}]);await expect(actions(page,id)).toHaveCount(0);
    for(const request of [page.request,buyer.request,admin.request]){
      expect((await request.get(`/api/series/${id}`)).status()).toBe(404);expect((await request.get(`/api/studio/series/${id}`)).status()).toBe(404);expect((await request.get(`/api/episodes/${episodes[1].id}/stream`)).status()).toBe(404);
    }
    expect((await admin.request.get(`/api/admin/episodes/${episodes[1].id}/stream`)).status()).toBe(404);
    expect((await admin.request.post(`/api/admin/series/${id}/moderation`,{data:{action:'restore',reason:'A deleted series must never be restored from moderation.'}})).status()).toBe(404);
    expect((await body(await admin.request.get(`/api/admin/series?q=${encodeURIComponent(details.title)}`))).series.some((s:any)=>s.id===id)).toBe(false);
    expect((await body(await buyer.request.get(`/api/series?sort=new&q=${encodeURIComponent(details.title)}`))).series.some((s:any)=>s.id===id)).toBe(false);
    const afterWallet=await body(await buyer.request.get('/api/wallet'));expect(afterWallet.ledger).toEqual(wallet.ledger);expect(afterWallet.payments).toEqual(wallet.payments);expect(afterWallet.user.wallet_micros).toBe(wallet.user.wallet_micros);
    const afterOwner=(await body(await page.request.get('/api/auth/me'))).user;expect(afterOwner.used_bytes).toBe(fixture.before.used_bytes);for(const key of ['wallet_micros','earnings_micros','quota_bytes','publisher_active'])expect(afterOwner[key]).toBe(ownerBefore[key]);expect((await body(await page.request.get('/api/studio'))).stats).toEqual(ownerStats);
    expect((await body(await buyer.request.get('/api/history'))).history.some((s:any)=>s.id===id)).toBe(false);expect((await body(await buyer.request.get('/api/series?saved=true'))).series.some((s:any)=>s.id===id)).toBe(false);
  }finally{await buyer.close();await admin.close();}
});

test('non-owners and incomplete deletion confirmations cannot remove another creator’s series',async({page,browser})=>{
  const fixture=await published(page,browser,'Deletion authorization',false);const{id,details,buyer}=fixture;
  try{
    expect((await buyer.request.get(`/api/studio/series/${id}/lifecycle`)).status()).toBe(403);
    expect((await buyer.request.delete(`/api/studio/series/${id}`,{data:{confirmation_token:'0'.repeat(64),confirm_title:details.title,acknowledge:true}})).status()).toBe(403);
    const shown=await body(await page.request.get(`/api/studio/series/${id}/lifecycle`));
    for(const patch of [{acknowledge:false},{confirm_title:'Another title'},{confirmation_token:'0'.repeat(64)}])expect((await page.request.delete(`/api/studio/series/${id}`,{data:{confirmation_token:shown.confirmation_token,confirm_title:details.title,acknowledge:true,...patch}})).status()).toBe(400);
    expect((await page.request.get(`/api/series/${id}`)).status()).toBe(200);expect((await body(await page.request.get(`/api/studio/series/${id}`))).episodes).toHaveLength(2);
  }finally{await buyer.close();}
});

test('a changed series invalidates the deletion warning and requires fresh statistics and renewed acknowledgement',async({page,browser})=>{
  const fixture=await published(page,browser,'Updated confirmation',false);const{id,details,buyer}=fixture;
  try{
    await page.goto(`/studio/series/${id}`);const first=await preview(page,id,details.title);const dialog=page.getByRole('dialog');await dialog.locator('.series-delete-title-input').fill(details.title);await dialog.locator('.series-delete-ack input').check();
    await body(await page.request.patch(`/api/studio/series/${id}`,{data:{...details,description:details.description+' Information changed after the confirmation opened.'}}));
    const failed=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname===`/api/studio/series/${id}`);await dialog.locator('.series-delete-form button[type="submit"]').click();expect((await failed).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toContainText('Review the latest statistics');await expect(dialog.locator('.series-delete-form button[type="submit"]')).toBeDisabled();expect((await page.request.get(`/api/series/${id}`)).status()).toBe(200);
    const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/studio/series/${id}/lifecycle`);await dialog.locator('.series-delete-reload').click();const next=await body(await refreshed);expect(next.confirmation_token).not.toBe(first.confirmation_token);await expect(dialog.locator('.series-delete-title-input')).toHaveValue('');await expect(dialog.locator('.series-delete-ack input')).not.toBeChecked();await expect(dialog.locator('.series-delete-form button[type="submit"]')).toBeDisabled();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  }finally{await buyer.close();}
});

const mockUser={id:'lifecycle-layout-owner',name:'Creator',email:'creator@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:1048576,language:'en',payment_review:false};
const mockSeries={id:'lifecycle-layout',creator_id:mockUser.id,creator_name:'Creator',title:'A very long original short drama—靈映故事の秘密と希望를 담은 이야기',description:'A complete synopsis for the private lifecycle confirmation layout.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1,status:'published',cover:'/images/placeholder.svg',episode_count:8,views:123456,likes:23456,saves:0,featured:0,created_at:'2026-11-01 10:00:00'};
function mockPreview(series=mockSeries){return{series,summary:{episode_count:8,views:123456,likes:23456,paid_unlocks:17,paid_viewers:9,real_paid_unlocks:12,test_paid_unlocks:17,real_paid_viewers:7,test_paid_viewers:9,affected_paid_viewers:12,total_watch_seconds:123456,avg_watch_seconds:93.25,media_bytes:5*1024**3,financial_mode:'test'},confirmation_token:'a'.repeat(64),expires_at:new Date(Date.now()+600000).toISOString()};}
async function editorFixture(page:Page,series=mockSeries){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:mockUser}}));
  await page.route(`**/api/studio/series/${series.id}`,route=>route.fulfill({json:{series,episodes:[],owner_storage:{used_bytes:1048576,quota_bytes:5*1024**3}}}));
}

test('a delayed deletion preview cannot reopen or target another series after editor navigation',async({page})=>{
  await editorFixture(page);const next={...mockSeries,id:'lifecycle-next',title:'The next private series'};await editorFixture(page,next);let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let started!:()=>void;const pending=new Promise<void>(resolve=>{started=resolve;});const deletes:string[]=[];
  await page.route(`**/api/studio/series/${mockSeries.id}/lifecycle`,async route=>{started();await waiting;await route.fulfill({json:mockPreview()}).catch(()=>{});});page.on('request',r=>{if(r.method()==='DELETE')deletes.push(r.url());});
  try{await page.goto(`/studio/series/${mockSeries.id}`);await actions(page,mockSeries.id).getByRole('button',{name:`Delete series: ${mockSeries.title}`,exact:true}).click();await pending;await expect(page.getByRole('dialog')).toBeVisible();await page.goto(`/studio/series/${next.id}`);release();await expect(page.locator('#series-title')).toHaveValue(next.title);await expect(page.getByRole('dialog')).toHaveCount(0);expect(deletes).toEqual([]);await expect(actions(page,next.id)).toBeVisible();}
  finally{release();}
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`permanent deletion statistics and safeguards fit a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await editorFixture(page);await page.route(`**/api/studio/series/${mockSeries.id}/lifecycle`,route=>route.fulfill({json:mockPreview()}));
  const deletes:string[]=[];page.on('request',r=>{if(r.method()==='DELETE')deletes.push(r.url());});await page.goto(`/studio/series/${mockSeries.id}`);await expect(page.locator('html')).toHaveAttribute('lang',locale);await actions(page,mockSeries.id).locator('button.danger-text').click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.series-delete-statistics')).toBeVisible();await expect(dialog.locator('[data-metric="affected_paid_viewers"]')).toBeVisible();await expect(dialog.locator('[data-metric="real_paid_viewers"]')).toBeVisible();await expect(dialog.locator('[data-metric="test_paid_viewers"]')).toBeVisible();await expect(dialog.locator('.series-delete-warning')).not.toContainText('seriesDeleteWarning');if(locale!=='en')await expect(dialog.locator('.series-delete-warning')).not.toContainText('This cannot be undone');if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');await noOverflow(page);
  const input=dialog.locator('.series-delete-title-input');expect(await input.evaluate(node=>getComputedStyle(node).fontSize)).toBe('16px');const submit=dialog.locator('.series-delete-form button[type="submit"]');await expect(submit).toBeDisabled();await input.fill(mockSeries.title);await dialog.locator('.series-delete-ack input').check();await expect(submit).toBeEnabled();await noOverflow(page);expect(deletes).toEqual([]);
});
