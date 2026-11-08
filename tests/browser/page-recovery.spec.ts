import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Vite's CSS-preload helper exists only in a production build. Serve that
// build through browser routes, while the ordinary test server stays isolated.
test.use({serviceWorkers:'block'});
const recoveryKey='lingying-page-recovery-v1';
const account={id:'page-recovery-creator',name:'Recovery Creator',email:'recovery@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:10*1024**3,used_bytes:0,language:'en',payment_review:false};
const contentTypes:Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};

async function fixture(page:Page,kind:'css'|'js',failures:number){
  const directory=path.resolve('dist/client'),html=await readFile(path.join(directory,'index.html'),'utf8');
  const main=html.match(/<script\b[^>]*src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  expect(main,'Run npm run build:cloudflare before compiled page-recovery browser tests').toBeTruthy();
  expect(await readFile(path.join(directory,main!),'utf8'),'Compiled bundle must contain this release’s recovery code').toContain(recoveryKey);
  const state={documents:[] as string[],failed:[] as string[],writes:[] as string[],remaining:failures};
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(request.method()!=='GET'){state.writes.push(request.method()+' '+pathname);await route.abort();return;}
    if(pathname.startsWith('/api/')){
      if(pathname==='/api/auth/me'){await route.fulfill({json:{user:account}});return;}
      if(pathname==='/api/config'){await route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',demo:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,limits:{}}});return;}
      if(pathname==='/api/studio'){await route.fulfill({json:{user:account,series:[],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}});return;}
      if(pathname==='/api/series'){await route.fulfill({json:{series:[]}});return;}
      if(pathname==='/api/history'){await route.fulfill({json:{history:[]}});return;}
      await route.fulfill({status:404,json:{error:{message:'Unexpected recovery fixture read'}}});return;
    }
    if(request.isNavigationRequest()&&request.frame()===page.mainFrame()){
      state.documents.push(pathname+url.search);await route.fulfill({contentType:'text/html',headers:{'Cache-Control':'no-store'},body:html});return;
    }
    if(new RegExp(`^/assets/Studio-[^/]+\\.${kind}$`).test(pathname)&&state.remaining>0){
      state.remaining--;state.failed.push(pathname);await route.fulfill({status:404,contentType:'text/plain',body:'Asset not found.'});return;
    }
    const filename=path.resolve(directory,'.'+pathname);
    if(!filename.startsWith(directory+path.sep)){await route.abort();return;}
    try{await route.fulfill({contentType:contentTypes[path.extname(filename)]||'application/octet-stream',body:await readFile(filename)});}
    catch{await route.fulfill({status:404,contentType:'text/plain',body:'Asset not found.'});}
  });
  await page.goto('/');await expect(page.locator('.main-content a[href="/studio"]').first()).toBeVisible();
  return state;
}

async function openStudio(page:Page){await page.locator('.main-content a[href="/studio"]').first().click();}
async function manualRefresh(page:Page,card:ReturnType<Page['locator']>){await Promise.all([page.waitForEvent('domcontentloaded'),card.getByRole('button',{name:'Refresh page',exact:true}).click()]);}
async function brandedFailure(page:Page){
  const card=page.locator('.page-recovery-card');await expect(card).toBeVisible();await expect(card.getByRole('heading',{name:'This page couldn’t open',exact:true})).toBeVisible();await expect(card.locator('.page-recovery-brand')).toContainText('LingYing');
  await expect(page.locator('pre')).toHaveCount(0);await expect(page.locator('body')).not.toContainText(/Unable to preload CSS|Failed to fetch dynamically imported module|Unexpected Application Error|at loadPageModule|\/assets\/Studio-/);
  return card;
}

test('a real missing lazy CSS file refreshes an old open page once and then opens Studio',async({page})=>{
  const state=await fixture(page,'css',1);await openStudio(page);await expect(page.locator('.studio-page')).toBeVisible();
  expect(state.failed).toHaveLength(1);expect(state.documents).toEqual(['/','/studio']);expect(state.writes).toEqual([]);
  expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).at,recoveryKey)).toBeGreaterThan(0);
  await expect(page.locator('.page-recovery-card')).toHaveCount(0);
});

test('repeated CSS failure stops after one automatic refresh and keeps branded manual recovery usable',async({page})=>{
  await page.setViewportSize({width:320,height:740});const state=await fixture(page,'css',Infinity);await openStudio(page);let card=await brandedFailure(page);
  expect(state.failed).toHaveLength(2);expect(state.documents).toEqual(['/','/studio']);const marker=await page.evaluate(key=>sessionStorage.getItem(key),recoveryKey);
  await expect(card.getByRole('button',{name:'Refresh page',exact:true})).toBeEnabled();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await manualRefresh(page,card);card=await brandedFailure(page);
  expect(state.documents).toEqual(['/','/studio','/studio']);expect(state.failed).toHaveLength(3);expect(await page.evaluate(key=>sessionStorage.getItem(key),recoveryKey)).toBe(marker);
  await card.getByRole('link',{name:'Go to homepage',exact:true}).click();await expect(page).toHaveURL('/');await expect(page.locator('.page-recovery-card')).toHaveCount(0);expect(state.documents).toHaveLength(3);
  await openStudio(page);await brandedFailure(page);expect(state.documents).toHaveLength(3);expect(await page.evaluate(key=>sessionStorage.getItem(key),recoveryKey)).toBe(marker);expect(state.writes).toEqual([]);
});

test('a real dynamic import failure stays put offline and offers a working refresh after reconnection',async({page})=>{
  const state=await fixture(page,'js',Infinity);await page.context().setOffline(true);await openStudio(page);let card=await brandedFailure(page);
  await expect(card).toContainText('You’re offline. Reconnect, then refresh this page.');await expect(card.getByRole('button',{name:'Refresh page',exact:true})).toBeDisabled();expect(state.documents).toEqual(['/']);expect(state.failed.length).toBeGreaterThan(0);expect(await page.evaluate(key=>sessionStorage.getItem(key),recoveryKey)).toBeNull();
  state.remaining=0;await page.context().setOffline(false);await expect(card.getByRole('button',{name:'Refresh page',exact:true})).toBeEnabled();await manualRefresh(page,card);await expect(page.locator('.studio-page')).toBeVisible();expect(state.documents).toEqual(['/','/studio']);expect(state.writes).toEqual([]);
});

test('unavailable session storage leaves a recoverable screen without an unbounded automatic refresh',async({page})=>{
  await page.addInitScript(key=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('Storage is blocked','SecurityError');return set.call(this,name,value);};},recoveryKey);
  const state=await fixture(page,'js',Infinity);await openStudio(page);const card=await brandedFailure(page);expect(state.documents).toEqual(['/']);expect(state.failed.length).toBeGreaterThan(0);
  await expect(card.getByRole('button',{name:'Refresh page',exact:true})).toBeEnabled();state.remaining=0;await manualRefresh(page,card);await expect(page.locator('.studio-page')).toBeVisible();expect(state.documents).toEqual(['/','/studio']);expect(state.writes).toEqual([]);
});
