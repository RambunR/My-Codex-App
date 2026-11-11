import {test,expect,type APIRequestContext} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {demoAdminSession} from './helpers/admin-session';

type State=Awaited<ReturnType<APIRequestContext['storageState']>>;
let ownerState:State;
let published:{id:string;title:string;description:string;publisherId:string};
let privateDraft:{id:string;title:string;description:string};
const privateMarker='A private draft synopsis that search crawlers must never receive';
const regexEscape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function data(response:{status:()=>number;json:()=>Promise<any>},status=200){const body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(status);return body;}

test.beforeAll(async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3001'}),page=await context.newPage();
  try{
    await demoAdminSession(page);ownerState=await context.storageState();
    const suffix=randomUUID().slice(0,12);
    const common={language:'en',genres:['drama'],creation_type:'ai-assisted',price_cents:30,free_episodes:1};
    const title=`Search <em>Story</em> ${suffix}`,description='A creator-written synopsis with literal markup: </script><script>window.__searchInjection=true</script>. This story remains plain text for viewers and crawlers.';
    const{id}=await data(await context.request.post('/api/studio/series',{data:{...common,title,description}}),201);
    await data(await context.request.post(`/api/studio/series/${id}/cover`,{multipart:{cover:{name:'search-cover.jpg',mimeType:'image/jpeg',buffer:await readFile('public/images/midnight.jpg')}}}));
    await data(await context.request.post(`/api/studio/series/${id}/episodes`,{multipart:{title:'Search fixture episode',number:'1',video:{name:'episode.mp4',mimeType:'video/mp4',buffer:await readFile('public/demo-preview.mp4')}}}),201);
    await data(await context.request.post(`/api/studio/series/${id}/status`,{data:{status:'published'}}));
    const detail=await data(await context.request.get(`/api/series/${id}`));
    published={id,title,description,publisherId:detail.series.publisher_id};
    const draftTitle=`Private Search Draft ${suffix}`,draftDescription=`${privateMarker} ${suffix}`;
    const draft=await data(await context.request.post('/api/studio/series',{data:{...common,title:draftTitle,description:draftDescription}}),201);
    privateDraft={id:draft.id,title:draftTitle,description:draftDescription};
  }finally{await context.close();}
});

test.afterAll(async({playwright})=>{
  if(!published)return;
  const context=await playwright.request.newContext({baseURL:'http://127.0.0.1:3001',storageState:ownerState});
  try{await data(await context.post(`/api/studio/series/${published.id}/status`,{data:{status:'archived'}}));}
  finally{await context.dispose();}
});

test('a public story is readable and linked before JavaScript while private drafts stay out of the sitemap',async({browser,request})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3001',javaScriptEnabled:false}),page=await context.newPage();
  try{
    const home=await page.goto('/');expect(home?.status()).toBe(200);
    const canonicalOrigin=new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!).origin;
    await expect(page.locator('[data-search-snapshot]')).toBeVisible();
    await expect(page.locator('body')).toContainText('LingYing');
    expect(await page.locator('body').textContent()).toMatch(/靈映|灵映/);
    await expect(page.locator('[data-search-snapshot] a[href^="/series/"]').first()).toBeVisible();

    const response=await page.goto(`/series/${published.id}`);expect(response?.status()).toBe(200);
    const snapshot=page.locator('[data-search-snapshot]');await expect(snapshot).toBeVisible();await expect(snapshot).toContainText(published.title);await expect(snapshot).toContainText('creator-written synopsis');
    await expect(page).toHaveTitle(new RegExp(regexEscape(published.title)));
    const canonical=await page.locator('link[rel="canonical"]').getAttribute('href');expect(new URL(canonical!).pathname).toBe(`/series/${published.id}`);expect(new URL(canonical!).search).toBe('');
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toContain('creator-written synopsis');
    await expect(snapshot.locator(`a[href="/publishers/${published.publisherId}"]`)).toBeVisible();
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).not.toContain('noindex');
    const schema=JSON.parse((await page.locator('#lingying-search-schema').textContent())!);expect(JSON.stringify(schema)).toContain(published.title);
    expect(await page.locator('script').evaluateAll(elements=>elements.some(element=>element.textContent==='window.__searchInjection=true'))).toBe(false);
    await expect(page.locator('body')).not.toContainText(privateDraft.title);await expect(page.locator('body')).not.toContainText(privateMarker);

    const sitemap=await request.get('/sitemap.xml');expect(sitemap.status()).toBe(200);expect(sitemap.headers()['content-type']).toContain('xml');const xml=await sitemap.text();
    expect(xml).toContain(`/series/${published.id}`);expect(xml).toContain(`/publishers/${published.publisherId}`);expect(xml).not.toContain(privateDraft.id);expect(xml).not.toContain('/studio');expect(xml).not.toContain('/account');
    const robots=await request.get('/robots.txt');expect(robots.status()).toBe(200);expect(robots.headers()['content-type']).toContain('text/plain');expect(await robots.text()).toContain('Sitemap: '+canonicalOrigin+'/sitemap.xml');
  }finally{await context.close();}
});

test('React replaces the search snapshot without executing creator text and keeps series metadata on navigation',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  // Google can fetch public page resources while private authentication APIs
  // remain robots-blocked. Public rendering must not depend on that request.
  await page.route('**/api/auth/me',route=>route.abort());
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/series/${published.id}`);
  await expect(page.locator('.detail-info > h1')).toHaveText(published.title);
  await expect(page.locator('[data-search-snapshot]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);await expect(page.locator('#lingying-search-schema')).toHaveCount(1);
  await expect(page).toHaveTitle(new RegExp(regexEscape(published.title)));
  expect(await page.evaluate(()=>Object.hasOwn(window,'__searchInjection'))).toBe(false);

  const creator=page.locator(`.detail-info a[href="/publishers/${published.publisherId}"]`);
  await expect(creator).toBeVisible();await creator.click();
  await expect(page).toHaveURL('/publishers/'+published.publisherId);
  await expect.poll(async()=>new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!).pathname).toBe('/publishers/'+published.publisherId);
  const card=page.locator(`.publisher-public-series a.poster-link[href="/series/${published.id}"]`);await expect(card).toBeVisible();await card.click();
  await expect(page).toHaveURL('/series/'+published.id);await expect(page).toHaveTitle(new RegExp(regexEscape(published.title)));
  await expect.poll(async()=>new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!).pathname).toBe('/series/'+published.id);
  expect(errors).toEqual([]);
});

test('private application routes are noindex and missing or unpublished series return a real nonindexable404',async({browser,request})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3001',javaScriptEnabled:false}),page=await context.newPage();
  try{
    const privateResponse=await page.goto('/studio/new');expect(privateResponse?.status()).toBe(200);expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    await expect(page.locator('body')).not.toContainText(privateDraft.title);await expect(page.locator('body')).not.toContainText(privateMarker);await expect(page.locator('body')).not.toContainText('admin@demo.aidramio.test');
    for(const id of [privateDraft.id,'a-missing-public-story']){
      const response=await page.goto(`/series/${id}`);expect(response?.status()).toBe(404);expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
      await expect(page.locator('body')).not.toContainText(privateDraft.title);await expect(page.locator('body')).not.toContainText(privateMarker);
    }
    const document=await request.get('/api/discovery/document?'+new URLSearchParams({path:`/series/${privateDraft.id}`}));expect(document.status()).toBe(404);expect(await document.text()).not.toContain(privateMarker);
  }finally{await context.close();}
});
