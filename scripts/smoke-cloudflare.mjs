import ts from 'typescript';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,createHmac,createHash} from 'node:crypto';

// Entirely local: Miniflare emulates Durable Objects and R2. Never deploys or charges money.
const dir=await mkdtemp(path.join(tmpdir(),'aidramio-cloudflare-test-'));
const runtimeConfigPath=path.join(dir,'wrangler.runtime.json');
const port=Number(process.env.CLOUDFLARE_TEST_PORT||8789),base=`http://127.0.0.1:${port}`;
const bootstrap=randomBytes(32).toString('hex');
const password='LocalSmokePassword123!';
const maxEpisodeBytes=200*1024**2,chunkBytes=5*1024**2;
let child,logs='';
async function start(production=false,testStripe=false,publicOrigin=base,missingTestPair=false,wechatLogin=false){
  logs='';
  const args=['node_modules/wrangler/bin/wrangler.js','dev','--config',runtimeConfigPath,'--tsconfig',path.resolve('tsconfig.cloudflare.json'),'--local','--port',String(port),'--local-upstream',new URL(base).host,'--upstream-protocol','http','--inspector-port',String(port+400),'--persist-to',path.join(dir,'state'),
    '--var',`ENVIRONMENT:${production?'production':'development'}`,'--var',`PAYMENTS_MODE:${testStripe?'stripe':production?'disabled':'demo'}`,'--var',`STRIPE_TEST_MODE:${testStripe}`,'--var',`APP_URL:${base}`,'--var',`PUBLIC_APP_URL:${publicOrigin}`,'--var',`STRIPE_SITE_ORIGIN:${base}`,'--var',`BOOTSTRAP_TOKEN:${bootstrap}`];
  if(!production||testStripe)args.push('--var','GOOGLE_CLIENT_ID:local-test.apps.googleusercontent.com','--var','GOOGLE_CLIENT_SECRET:local-test-only-google-secret');
  if(testStripe){
    args.push('--var','STRIPE_SECRET_KEY:rk_live_local_cloudflare_fixture_only','--var','STRIPE_WEBHOOK_SECRET:whsec_local_cloudflare_live_fixture_only');
    if(!missingTestPair)args.push('--var','STRIPE_TEST_SECRET_KEY:rk_test_local_cloudflare_fixture_only','--var','STRIPE_TEST_WEBHOOK_SECRET:whsec_local_cloudflare_fixture_only');
    else args.push('--var','STRIPE_TEST_SECRET_KEY:','--var','STRIPE_TEST_WEBHOOK_SECRET:');
  }
  if(wechatLogin)args.push('--var','WECHAT_APP_ID:wx1111111111111111','--var','WECHAT_APP_SECRET:11111111111111111111111111111111');
  args.push('--var',`PAYOUTS_ENABLED:${!production}`);
  // These disposable local fixtures exercise the catalogue and playback paths.
  // The production canonical host separately retires samples and never seeds.
  args.push('--var','SEED_CATALOG:true');
  args.push('--var',`STRIPE_AUTO_CONFIGURE_WEBHOOK:${testStripe}`,'--var','PASS_PROMOTION_ENABLED:true');
  // A matching but unverified local address must never gain admin access.
  args.push('--var','PLATFORM_ADMIN_EMAIL_SHA256:'+createHash('sha256').update('viewer@example.test').digest('hex'));
  child=spawn(process.execPath,args,{env:{...process.env,XDG_CONFIG_HOME:path.join(dir,'config'),WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(dir,'wrangler.log')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  const startupDeadline=Date.now()+Number(process.env.CLOUDFLARE_TEST_STARTUP_TIMEOUT_MS||30_000);
  while(Date.now()<startupDeadline){
    if(child.exitCode!==null)throw new Error(`Local Cloudflare server exited: ${logs}`);
    try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).database)return;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error(`Local Cloudflare startup timed out: ${logs}`);
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const stopped=once(child,'exit');child.kill('SIGINT');
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  await stopped;clearTimeout(timer);child=undefined;
}
async function request(route,body,cookie='',status=200,method=body===undefined?'GET':'POST',headers={}){
  const r=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw new Error(`${route}: non-JSON response ${r.status}: ${text.slice(0,300)}`);}
  assert.equal(r.status,status,`${route}: ${JSON.stringify(data)}`);
  return{data,cookie:r.headers.get('set-cookie')?.split(';')[0]||'',headers:r.headers};
}
async function upload(route,bytes,name,cookie,fields={},field='video',status=201){
  const form=new FormData();for(const[k,v]of Object.entries(fields))form.append(k,String(v));form.append(field,new Blob([bytes]),name);
  const r=await fetch(base+route,{method:'POST',headers:{Cookie:cookie},body:form});const data=await r.json();assert.equal(r.status,status,`${route}: ${JSON.stringify(data)}`);return data;
}
async function chunkedEpisode(route,size,read,name,cookie,fields,{restartAfterPart=0}={}){
  const session=(await request(route,{...fields,filename:name,size},cookie,201)).data;
  assert.equal(session.chunkBytes,chunkBytes);assert.equal(session.partCount,Math.ceil(size/chunkBytes));
  const sessionPath=route+'/'+session.id,expected=createHash('sha256');
  for(let index=0;index<session.partCount;index++){
    const offset=index*chunkBytes,bytes=read(offset,Math.min(chunkBytes,size-offset));expected.update(bytes);
    const response=await fetch(base+`${sessionPath}/parts/${index+1}`,{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/octet-stream'},body:bytes});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.partNumber,index+1);
    if(restartAfterPart===index+1){await stop();await start();}
  }
  const completed=(await request(sessionPath+'/complete',{},cookie,201)).data;
  const replay=(await request(sessionPath+'/complete',{},cookie,200)).data;
  assert.equal(replay.id,completed.id);assert.equal(replay.owner_storage.used_bytes,completed.owner_storage.used_bytes);
  return{episode:completed,sha256:expected.digest('hex'),sessionPath};
}
try{
  // The required build runs before this suite. Re-running its typechecks and
  // asset rotation on every emulator restart is both slow and changes the build
  // under test. Keep deployment config intact; omit only this hook locally.
  await readFile('dist/cloudflare/server/app.ts');await readFile('dist/client/index.html');
  const parsed=ts.parseConfigFileTextToJson('wrangler.jsonc',await readFile('wrangler.jsonc','utf8'));assert.ok(!parsed.error);
  const runtimeConfig={...parsed.config,main:path.resolve(parsed.config.main),assets:{...parsed.config.assets,directory:path.resolve(parsed.config.assets.directory)}};
  delete runtimeConfig.build;delete runtimeConfig.$schema;
  await writeFile(runtimeConfigPath,JSON.stringify(runtimeConfig),{mode:0o600});
  const primary='https://primary.example';
  await start(false,false,primary,false,true);
  for(const route of ['/','/browse?sort=newest','/account','/manifest.webmanifest']){
    for(const method of ['GET','HEAD']){
      const response=await fetch(base+route,{method,redirect:'manual'});
      assert.equal(response.status,308,`${method} ${route}: assets must not bypass canonical routing`);
      assert.equal(response.headers.get('location'),primary+route);
      assert.equal(response.headers.get('cache-control'),'no-store');
      await response.body?.cancel();
    }
  }
  console.log('PASS: Cloudflare canonical redirects run before SPA and static asset serving on alias hosts.');
  const wechatStart=await fetch(base+'/api/auth/wechat/start?next=%2Fwallet&language=zh-TW',{redirect:'manual'});
  assert.equal(wechatStart.status,302);assert.match(wechatStart.headers.get('cache-control'),/no-store/);
  const wechatLocation=new URL(wechatStart.headers.get('location'));
  assert.equal(wechatLocation.origin,'https://open.weixin.qq.com');assert.equal(wechatLocation.searchParams.get('appid'),'wx1111111111111111');
  assert.equal(wechatLocation.searchParams.get('scope'),'snsapi_login');assert.equal(wechatLocation.searchParams.get('redirect_uri'),base+'/api/auth/wechat/callback');
  const wechatCookie=wechatStart.headers.getSetCookie().find(value=>value.startsWith('drama_wechat='))?.split(';')[0];assert.ok(wechatCookie);
  const wechatCancelPath='/api/auth/wechat/callback?'+new URLSearchParams({state:wechatLocation.searchParams.get('state'),error:'access_denied'});
  for(const expected of ['wechat_cancelled','wechat_expired']){const cancelled=await fetch(base+wechatCancelPath,{redirect:'manual',headers:{Cookie:wechatCookie}});assert.equal(cancelled.status,303);assert.equal(new URL(cancelled.headers.get('location')).searchParams.get('error'),expected);assert.ok(!cancelled.headers.getSetCookie().some(value=>value.startsWith('drama_session=')));}
  console.log('PASS: configured WeChat website authorization uses Durable Object SQL, the exact callback, browser binding and single-use cancellation without contacting WeChat or granting a session.');

  await stop();
  await start();
  const currencyResponse=await fetch(base+'/api/display-currency?country=TW',{headers:{'CF-IPCountry':'TW','Accept-Language':'zh-TW'}});
  assert.equal(currencyResponse.status,200);assert.equal(currencyResponse.headers.get('cache-control'),'private, no-store');
  assert.deepEqual((await currencyResponse.json()).quote,{country:null,currency:'HKD',ratePerHkd:1,asOf:null});
  const currencyWrite=await fetch(base+'/api/display-currency',{method:'POST'});assert.equal(currencyWrite.status,405);await currencyWrite.body.cancel();
  console.log('PASS: local display-currency fallback is private, read-only, ignores spoofed country inputs and does not call an external provider.');
  for(const route of ['/','/?search-source=fixture']){
    const home=await fetch(base+route);
    assert.equal(home.status,200);assert.equal(home.headers.get('link'),`<${base}/>; rel="canonical"`);
    const html=await home.text();assert.match(html,/href="\/favicon\.ico"/);assert.match(html,/sizes="192x192" href="\/icon-192\.png"/);
    assert.match(html,/LingYing/);assert.match(html,/data-search-snapshot/);assert.match(html,/application\/ld\+json/);
  }
  for(const [route,status]of [['/browse',200],['/series/fixture',404]]){
    const page=await fetch(base+route);assert.equal(page.status,status);assert.equal(page.headers.get('link'),`<${base}${route}>; rel="canonical"`,'Each public page must retain its own canonical identity.');
    if(status===404)assert.match(page.headers.get('x-robots-tag'),/noindex/);await page.body.cancel();
  }
  const favicon=await fetch(base+'/favicon.ico');assert.equal(favicon.status,200);assert.match(favicon.headers.get('content-type'),/^image\//);
  const ico=Buffer.from(await favicon.arrayBuffer());assert.deepEqual([...ico.subarray(0,6)],[0,0,1,0,2,0]);
  const icon=await fetch(base+'/icon-192.png');assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/^image\/png/);
  const png=Buffer.from(await icon.arrayBuffer());assert.equal(png.readUInt32BE(16),192);assert.equal(png.readUInt32BE(20),192);
  const robots=await fetch(base+'/robots.txt');assert.equal(robots.status,200);assert.match(robots.headers.get('content-type'),/^text\/plain/);assert.ok((await robots.text()).includes(`Sitemap: ${base}/sitemap.xml`));
  const sitemap=await fetch(base+'/sitemap.xml');assert.equal(sitemap.status,200);assert.match(sitemap.headers.get('content-type'),/xml/);assert.ok((await sitemap.text()).includes(`<loc>${base}/</loc>`));
  for(const asset of ['/assets/Studio-retired-release.css','/assets/Studio-retired-release.js']){
    const missing=await fetch(base+asset);assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/^text\/plain/);assert.equal(missing.headers.get('cache-control'),'no-store');assert.doesNotMatch(await missing.text(),/id="root"|<!doctype/i);
  }
  const studioPage=await fetch(base+'/studio');assert.equal(studioPage.status,200);assert.match(studioPage.headers.get('cache-control'),/no-store/);await studioPage.body.cancel();
  console.log('PASS: homepage canonical stays scoped; favicon, crawler instructions and sitemap serve real assets instead of SPA fallback HTML.');
  const cfg=(await request('/api/config')).data;assert.equal(cfg.runtime,'cloudflare');assert.equal(cfg.paymentsMode,'demo');assert.equal(cfg.auth.google,true);assert.equal(cfg.auth.wechat,false);
  await request('/api/auth/wechat/start',undefined,'',503);
  await request('/api/auth/wechat/registration',undefined,'',503);
  await request('/api/auth/wechat/link',{password:'NoExistingAccount'},'',401);
  const spokenCodes=cfg.spokenLanguages.map(item=>item.code),interfaceCodes=cfg.languages.map(item=>item.code);
  assert.equal(spokenCodes.length,21);assert.ok(spokenCodes.includes('cmn')&&spokenCodes.includes('yue'));assert.ok(!spokenCodes.includes('zh-TW')&&!spokenCodes.includes('zh-CN'));
  assert.equal(interfaceCodes.length,21);assert.ok(interfaceCodes.includes('zh-TW')&&interfaceCodes.includes('zh-CN'));assert.ok(!interfaceCodes.includes('cmn')&&!interfaceCodes.includes('yue'));
  assert.deepEqual(cfg.creatorPassConsent,{policyVersion:'2026-11-09',disclosureVersion:'creator-pass-ack-v2'});
  const creatorConsent={accepted:true,policy_version:cfg.creatorPassConsent.policyVersion,disclosure_version:cfg.creatorPassConsent.disclosureVersion};
  assert.equal(cfg.limits.quotaBytes,10*1024**3);
  assert.equal(cfg.limits.minimumPriceUsd,0.1);assert.equal(cfg.limits.maximumPriceUsd,1);
  assert.equal(cfg.limits.maxEpisodeBytes,maxEpisodeBytes);assert.equal(cfg.limits.maxEpisodeSeconds,300);assert.deepEqual(cfg.episodeUpload,{mode:'chunked',chunkBytes});
  assert.deepEqual(cfg.walletFunding.presetAmountsCents,[1000,2500,5000,10000]);assert.deepEqual(cfg.walletFunding.rewards,[{amountCents:5000,bonusCents:500},{amountCents:10000,bonusCents:1500}]);
  assert.ok(cfg.standardGenres.includes('romantic-comedy'));assert.ok(cfg.standardGenres.includes('medical'));
  assert.ok(cfg.storyThemes.includes('revenge'));assert.deepEqual(cfg.formats,['live-action','animation','anime-donghua','motion-comic']);
  assert.deepEqual(cfg.creationTypes,['human','ai-assisted','ai-generated']);
  assert.equal(cfg.auth.apple,false);assert.equal(cfg.auth.email,false);
  const authPage=await fetch(base+'/auth?mode=forgot');assert.equal(authPage.status,200);assert.equal(authPage.headers.get('referrer-policy'),'no-referrer');assert.match(authPage.headers.get('cache-control'),/no-store/);
  assert.equal(authPage.headers.get('x-frame-options'),'DENY');assert.equal(authPage.headers.get('x-content-type-options'),'nosniff');assert.match(authPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const protectedPage=await fetch(base+'/studio');assert.equal(protectedPage.status,200);assert.equal(protectedPage.headers.get('x-frame-options'),'DENY');assert.equal(protectedPage.headers.get('referrer-policy'),'strict-origin-when-cross-origin');await protectedPage.body.cancel();
  await request('/api/auth/apple/start',undefined,'',503);
  await request('/api/auth/forgot-password',{email:'viewer@example.test'},'',503);
  await request('/api/auth/resend-verification',{email:'viewer@example.test'},'',503);
  await request('/api/auth/reset-password',{token:'0'.repeat(64),password:'LocalResetPassword123!'},'',400);
  await request('/api/auth/verify-email',{token:'0'.repeat(64)},'',400);
  const appleCallback=await fetch(base+'/api/auth/apple/callback',{method:'POST',redirect:'manual',headers:{Origin:'https://appleid.apple.com','Sec-Fetch-Site':'cross-site','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({state:'0'.repeat(64),error:'user_cancelled_authorize'})});
  assert.equal(appleCallback.status,303);assert.equal(new URL(appleCallback.headers.get('location'),base).pathname,'/auth');
  console.log('PASS: honest Apple/email availability, private recovery pages, invalid token rejection and scoped Apple form_post origin handling.');
  const oauth=await fetch(base+'/api/auth/google/start?next=%2Fwallet&language=zh-TW',{redirect:'manual'});assert.equal(oauth.status,302);const authorization=new URL(oauth.headers.get('location'));assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  const binding=oauth.headers.getSetCookie().find(c=>c.startsWith('drama_google='))?.split(';')[0];assert.ok(binding);const callback=base+'/api/auth/google/callback?'+new URLSearchParams({state:authorization.searchParams.get('state'),error:'access_denied'});
  const cancelled=await fetch(callback,{redirect:'manual',headers:{Cookie:binding}});assert.equal(cancelled.status,303);assert.equal(new URL(cancelled.headers.get('location'),base).searchParams.get('error'),'google_cancelled');
  const replay=await fetch(callback,{redirect:'manual',headers:{Cookie:binding}});assert.equal(new URL(replay.headers.get('location'),base).searchParams.get('error'),'google_expired');
  console.log('PASS: Cloudflare Google authorization, private browser binding, durable OAuth state, cancellation and replay protection.');
  const series=(await request('/api/series')).data.series;assert.equal(series.length,20);
  assert.equal(series.find(item=>item.id==='blue-hour').language,'zh-TW');assert.equal(series.find(item=>item.id==='neon-promises').language,'zh-CN');
  for(const language of ['cmn','yue'])assert.equal((await request('/api/series?'+new URLSearchParams({language}))).data.series.length,0,'Legacy Chinese script tags must not imply a spoken variety.');
  const legacyAnimated=(await request('/api/series/tokyo-tomorrow')).data.series;
  assert.equal(legacyAnimated.format,'animation');assert.deepEqual(legacyAnimated.themes,[]);
  assert.equal(legacyAnimated.cover_aspect_ratio,'2:3');assert.ok(series.every(item=>item.cover_aspect_ratio==='2:3'),'Existing seeded cover layouts must retain their legacy ratio.');
  assert.deepEqual(legacyAnimated.subtitle_languages,[]);assert.ok(series.every(item=>Array.isArray(item.subtitle_languages)&&item.subtitle_languages.length===0));
  assert.ok((await request('/api/series?format=animation')).data.series.some(s=>s.id==='tokyo-tomorrow'));
  assert.equal((await request('/api/series/after-midnight')).data.series.format,null);
  await request('/api/series?format=not-a-format',undefined,'',400);
  await request('/api/series?theme=not-a-theme',undefined,'',400);
  const sample=(await request('/api/series/'+series[0].id)).data;assert.ok(sample.episodes.every(e=>e.unlocked),'Public samples must all be free.');
  const previewUrl=base+`/api/episodes/${sample.episodes[0].id}/stream`;
  const sampleVideo=await fetch(previewUrl,{headers:{Origin:base}});assert.equal(sampleVideo.status,200);assert.equal(sampleVideo.redirected,false);assert.equal(sampleVideo.headers.get('access-control-allow-origin'),base);assert.equal(sampleVideo.headers.get('access-control-allow-credentials'),'true');assert.equal(sampleVideo.headers.get('cache-control'),'private, no-store');assert.equal((await sampleVideo.arrayBuffer()).byteLength,1037034);
  const previewRange=await fetch(previewUrl,{headers:{Origin:base,Range:'bytes=0-31'}});assert.equal(previewRange.status,206);assert.equal(previewRange.redirected,false);assert.equal(previewRange.headers.get('content-range'),'bytes 0-31/1037034');assert.equal((await previewRange.arrayBuffer()).byteLength,32);
  const previewHead=await fetch(previewUrl,{method:'HEAD',headers:{Origin:base,Range:'bytes=0-31'}});assert.equal(previewHead.status,206);assert.equal(previewHead.headers.get('content-length'),'32');assert.equal((await previewHead.arrayBuffer()).byteLength,0);
  console.log('PASS: Cloudflare runtime, public catalogue, and free sample playback.');

  await request('/api/admin/bootstrap',{email:'admin@example.test',name:'Local Admin',password},'',403);
  await request('/api/admin/bootstrap',{email:'admin@example.test',name:'Local Admin',password},'',201,'POST',{'x-bootstrap-token':bootstrap});
  await request('/api/admin/bootstrap',{email:'second@example.test',name:'Second Admin',password},'',409,'POST',{'x-bootstrap-token':bootstrap});
  const admin=(await request('/api/auth/login',{email:'admin@example.test',password})).cookie;
  const p=await request('/api/auth/register',{email:'publisher@example.test',name:'Local Publisher',password,role:'admin',publisher_active:1},'',201);const publisher=p.cookie;
  assert.equal(p.data.user.role,'viewer');assert.equal(p.data.user.publisher_active,0);
  assert.deepEqual(p.data.user.dramio_pass,{active:false,test:false,purchased_at:null});
  const viewer=(await request('/api/auth/register',{email:'viewer@example.test',name:'Local Viewer',password},'',201)).cookie;
  const claimed=(await request('/api/account',{name:'Local Viewer',language:'en',role:'admin',publisher_active:1,email_verified:true},viewer,200,'PATCH')).data.user;
  assert.equal(claimed.role,'viewer');assert.equal(claimed.publisher_active,0);assert.equal(claimed.email_verified,false);
  await request('/api/admin',undefined,viewer,403);await request('/api/studio/series',{},viewer,403);
  assert.deepEqual((await request('/api/account/identities',undefined,viewer)).data,{google:{linked:false},apple:{linked:false},wechat:{linked:false},password:true});
  await request('/api/auth/login',{email:'viewer@example.test',password:'wrong'},'',401);
  await request('/api/admin',undefined,publisher,403);
  await request('/api/studio/series',{},publisher,403);
  assert.equal((await request('/api/payments/checkout',{kind:'activation'},publisher,400)).data.error.code,'CREATOR_CONSENT_REQUIRED');
  assert.equal((await request('/api/payments/checkout',{kind:'activation',creator_consent:{...creatorConsent,policy_version:'2026-11-07'}},publisher,409)).data.error.code,'CREATOR_POLICY_CHANGED');
  assert.deepEqual((await request('/api/wallet',undefined,publisher)).data.payments,[],'Rejected acknowledgement must not create an unpaid payment.');
  const activation=(await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent},publisher)).data;assert.equal(activation.amount_cents,8800);assert.equal(activation.currency,'hkd');
  assert.equal((await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent},publisher)).data.paymentId,activation.paymentId,'An explicit acknowledgement retry must reuse the original unpaid checkout.');
  await request(`/api/payments/${activation.paymentId}/demo-confirm`,{},viewer,404);
  await Promise.all([0,1].map(()=>request(`/api/payments/${activation.paymentId}/demo-confirm`,{},publisher)));
  const activated=(await request('/api/auth/me',undefined,publisher)).data.user;assert.equal(activated.publisher_active,1);assert.equal(activated.quota_bytes,10*1024**3);
  assert.equal(activated.dramio_pass.active,true);assert.equal(activated.dramio_pass.test,true);assert.match(activated.dramio_pass.purchased_at,/^\d{4}-\d{2}-\d{2}T/);
  const funding=(await request('/api/payments/checkout',{kind:'funding',amount_cents:1000},viewer)).data;
  await Promise.all([0,1].map(()=>request(`/api/payments/${funding.paymentId}/demo-confirm`,{},viewer)));
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,10_000_000);
  console.log('PASS: scrypt authentication, first-admin bootstrap, authorization, activation, and replay-safe funding.');

  // Public publisher profiles are attribution records under the same admin
  // login, never additional authentication accounts or financial owners.
  await request('/api/admin/publishers',undefined,'',403);
  await request('/api/admin/publishers',undefined,viewer,403);
  await request('/api/admin/publishers',undefined,publisher,403);
  const adminBeforeProfiles=(await request('/api/auth/me',undefined,admin)).data.user;
  assert.equal(adminBeforeProfiles.storage_unlimited,true);
  assert.equal(adminBeforeProfiles.quota_bytes,10*1024**3,'Unlimited access must not inflate the persisted quota.');
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.storage_unlimited,false);
  const profileUsersBefore=(await request('/api/admin',undefined,admin)).data.users.length;
  const initialPublishers=(await request('/api/admin/publishers',undefined,admin)).data;
  const officialPublisher=initialPublishers.publishers.find(profile=>profile.id===initialPublishers.default_publisher_id);
  assert.ok(officialPublisher);assert.equal(officialPublisher.is_official,true);assert.equal(officialPublisher.managed,true);
  assert.equal(officialPublisher.display_name,'LingYingDrama Offical');
  await request('/api/admin/publishers',{display_name:'Unauthorized Publisher',registered_at:'2020-04-23'},publisher,403);
  await request('/api/admin/publishers',{display_name:'Invalid Date Publisher',registered_at:'2020-02-30'},admin,400);
  const managedPublisher=(await request('/api/admin/publishers',{display_name:'Local Managed Publisher',registered_at:'2020-04-23'},admin,201)).data.publisher;
  await request(`/api/admin/publishers/${managedPublisher.id}`,{display_name:'Unauthorized Edit'},viewer,403,'PATCH');
  const editedPublisher=(await request(`/api/admin/publishers/${managedPublisher.id}`,{display_name:'Local Managed Publisher Revised',registered_at:'2021-05-24'},admin,200,'PATCH')).data.publisher;
  assert.equal(editedPublisher.id,managedPublisher.id);assert.equal(editedPublisher.display_name,'Local Managed Publisher Revised');assert.equal(editedPublisher.registered_at,'2021-05-24');
  assert.deepEqual((await request('/api/auth/me',undefined,admin)).data.user,adminBeforeProfiles);
  assert.equal((await request('/api/admin',undefined,admin)).data.users.length,profileUsersBefore);
  const emptyPublisher=(await request(`/api/publishers/${managedPublisher.id}`)).data;
  assert.deepEqual(Object.keys(emptyPublisher.publisher).sort(),['display_name','id','is_official','managed','registered_at']);
  assert.equal(emptyPublisher.stats.series_count,0);assert.equal(emptyPublisher.stats.total_watch_seconds,0);assert.deepEqual(emptyPublisher.series,[]);
  assert.equal(JSON.stringify(emptyPublisher).includes('admin@example.test'),false);
  console.log('PASS: administrator publisher profiles validate public dates, deny non-admin edits, expose no login data, and never create accounts or change balances.');

  assert.deepEqual(cfg.passPromotion,{enabled:true});
  await request('/api/admin/promotions',undefined,viewer,403);
  await request('/api/payments/promotion/quote',{promo_code:'LINGYING58'},'',401);
  const initialPromotions=(await request('/api/admin/promotions',undefined,admin)).data;
  const initialLaunch=initialPromotions.promotions.find(row=>row.code==='LINGYING58');assert.equal(initialLaunch.enabled,true);assert.equal(initialLaunch.max_redemptions,null);assert.equal(initialLaunch.amount_hkd_cents,5800);
  const promotion=(await request('/api/auth/register',{email:'promotion@example.test',name:'Local Promotion Creator',password},'',201)).cookie;
  await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:'INVALID'},promotion,400);
  await request('/api/payments/checkout',{kind:'funding',amount_cents:500,promo_code:'LINGYING58'},promotion,400);
  const promotionQuote=(await request('/api/payments/promotion/quote',{promo_code:' lingying58 '},promotion)).data.promotion;assert.equal(promotionQuote.amountHkdCents,5800);
  const promoted=(await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:promotionQuote.code,promo_revision:promotionQuote.revision,amount_cents:1},promotion)).data;
  assert.equal(promoted.amount_cents,5800);assert.equal(promoted.currency,'hkd');
  assert.equal((await request('/api/auth/me',undefined,promotion)).data.user.publisher_active,0);
  await Promise.all([0,1].map(()=>request(`/api/payments/${promoted.paymentId}/demo-confirm`,{},promotion)));
  const promotedUser=(await request('/api/auth/me',undefined,promotion)).data.user;
  assert.equal(promotedUser.publisher_active,1);assert.equal(promotedUser.wallet_micros,0);assert.equal(promotedUser.dramio_pass.active,true);assert.ok(promotedUser.dramio_pass.purchased_at);
  const promotedWallet=(await request('/api/wallet',undefined,promotion)).data;
  assert.equal(promotedWallet.ledger.filter(row=>row.kind==='activation').length,1);
  assert.equal(promotedWallet.ledger.find(row=>row.kind==='activation').payment_amount_cents,5800);
  await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:'LINGYING58'},promotion,409);
  console.log('PASS: Cloudflare HK$58 promotion validates code, preserves exact receipt, activates once, and never funds a wallet.');

  const managedPromotion=(await request('/api/admin/promotions',{code:'RUNTIME25',discount_type:'percent',discount_value:25},admin,201)).data.promotion;
  assert.equal(managedPromotion.amount_hkd_cents,6600);assert.equal(managedPromotion.max_redemptions,null);
  await request(`/api/admin/promotions/${managedPromotion.id}`,{enabled:false},admin,200,'PATCH');
  await request('/api/payments/promotion/quote',{promo_code:'RUNTIME25'},viewer,400);
  await request(`/api/admin/promotions/${managedPromotion.id}`,{enabled:true,discount_type:'amount',discount_value:2000,max_redemptions:2},admin,200,'PATCH');
  const changedQuote=(await request('/api/payments/promotion/quote',{promo_code:'RUNTIME25'},viewer)).data.promotion;assert.equal(changedQuote.amountHkdCents,6800);
  await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:'RUNTIME25',promo_revision:managedPromotion.revision},viewer,409);
  const managedState=(await request('/api/admin/promotions',undefined,admin)).data;assert.ok(managedState.events.some(event=>event.promotion_id===managedPromotion.id));
  console.log('PASS: Cloudflare private-code discovery, administrator CRUD/audit, disable/re-enable, exact quotes and stale-revision rejection.');



  const body={title:'Cloudflare Published Drama',description:'A real upload used to validate durable financial and media storage.',language:'cmn',genres:['romance'],themes:['revenge','hidden-identity','entrepreneurship'],format:'animation',creation_type:'human',price_cents:51,free_episodes:1};
  await request('/api/studio/series',{...body,price_cents:101},publisher,400);
  const sid=(await request('/api/studio/series',body,publisher,201)).data.id;
  const duplicateName='  '+body.title.toUpperCase().replaceAll(' ','   ')+'  ';
  const availability=title=>'/api/studio/title-availability?'+new URLSearchParams({title});
  await request(availability(body.title),undefined,'',401);
  assert.deepEqual((await request(availability(duplicateName),undefined,publisher)).data,{available:false});
  assert.deepEqual((await request(availability(body.title)+'&exclude='+sid,undefined,publisher)).data,{available:true});
  const duplicate=(await request('/api/studio/series',{...body,title:duplicateName},publisher,409)).data;
  assert.equal(duplicate.error.code,'SERIES_TITLE_EXISTS');
  assert.ok(!(await(await fetch(base+'/sitemap.xml')).text()).includes(`/series/${sid}`),'A private draft must not appear in the public sitemap.');
  console.log('PASS: global normalized duplicate titles are refused atomically while the current series retains its own name and private drafts stay out of discovery.');
  await request(`/api/studio/series/${sid}`,{...body,price_cents:101},publisher,400,'PATCH');
  const privateClassification=(await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series;
  assert.deepEqual(privateClassification.themes,body.themes);assert.equal(privateClassification.format,body.format);
  assert.equal(privateClassification.cover_aspect_ratio,'9:16','New series default to a portrait layout.');
  assert.deepEqual(privateClassification.subtitle_languages,[]);
  const selectedSubtitles=['en','zh-TW','ja'],allSubtitleLanguages=cfg.languages.map(item=>item.code);
  assert.equal(allSubtitleLanguages.length,21);
  await request(`/api/studio/series/${sid}`,{...body,subtitle_languages:selectedSubtitles},publisher,200,'PATCH');
  assert.deepEqual((await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series.subtitle_languages,selectedSubtitles);
  await request('/api/studio/series',{...body,title:'Invalid Subtitle Language',subtitle_languages:['unknown-language']},publisher,400);
  await request('/api/studio/series',{...body,title:'Spoken Variety Is Not a Subtitle Script',subtitle_languages:['yue']},publisher,400);
  await request('/api/studio/series',{...body,title:'Invalid Cover Layout',cover_aspect_ratio:'2:3'},publisher,400);
  const {themes:omittedThemes,format:omittedFormat,...legacyBody}=body;
  await request(`/api/studio/series/${sid}`,legacyBody,publisher,200,'PATCH');
  assert.deepEqual((await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series.themes,body.themes);
  assert.deepEqual((await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series.subtitle_languages,selectedSubtitles,'An older editor omitting subtitles must retain the selection.');
  const video=await readFile('public/demo-preview.mp4');
  const cover=await readFile('public/images/midnight.jpg');
  const profileSeriesBody={...body,title:'Managed Publisher Showcase',language:'en',genres:['comedy'],themes:[],format:'live-action',free_episodes:1};
  const profileSeriesId=(await request('/api/studio/series',{...profileSeriesBody,subtitle_languages:allSubtitleLanguages},admin,201)).data.id;
  const profileSeriesPath=`/api/studio/series/${profileSeriesId}`;
  assert.equal((await request(profileSeriesPath,undefined,admin)).data.owner_storage.storage_unlimited,true);
  assert.equal((await request(`/api/studio/series/${sid}`,undefined,admin)).data.owner_storage.storage_unlimited,false,'Storage follows the publisher owner, not the administrator actor.');
  const defaultAttribution=(await request(profileSeriesPath,undefined,admin)).data.series;
  assert.equal(defaultAttribution.publisher_id,officialPublisher.id);assert.equal(defaultAttribution.creator_name,officialPublisher.display_name);assert.equal(defaultAttribution.creator_id,adminBeforeProfiles.id);
  assert.equal(defaultAttribution.cover_aspect_ratio,'9:16');
  assert.deepEqual(defaultAttribution.subtitle_languages,allSubtitleLanguages);
  await request(profileSeriesPath,{...profileSeriesBody,publisher_profile_id:managedPublisher.id},admin,200,'PATCH');
  const selectedAttribution=(await request(profileSeriesPath,undefined,admin)).data.series;
  assert.equal(selectedAttribution.publisher_id,managedPublisher.id);assert.equal(selectedAttribution.publisher_profile_id,managedPublisher.id);assert.equal(selectedAttribution.creator_name,editedPublisher.display_name);assert.equal(selectedAttribution.creator_id,adminBeforeProfiles.id);
  await request('/api/studio/series',{...body,title:'Forged Managed Publisher',publisher_profile_id:managedPublisher.id},publisher,403);
  await request(`/api/studio/series/${sid}`,{...body,publisher_profile_id:managedPublisher.id},publisher,403,'PATCH');
  await request(`/api/studio/series/${sid}`,{...body,publisher_profile_id:managedPublisher.id},admin,403,'PATCH');
  const adminCoverUpload=await upload(profileSeriesPath+'/cover',cover,'profile-cover.jpg',admin,{},'cover',200);
  assert.equal(adminCoverUpload.owner_storage.storage_unlimited,true);
  const adminVideoUpload=await upload(profileSeriesPath+'/episodes',video,'Profile 001.mp4',admin,{title:'Profile episode 001',number:1});
  assert.equal(adminVideoUpload.owner_storage.storage_unlimited,true);
  await request(profileSeriesPath+'/status',{status:'published'},admin);
  const profilePublished=(await request(`/api/series/${profileSeriesId}`)).data.series;
  assert.equal(profilePublished.creator_name,editedPublisher.display_name);assert.equal(profilePublished.publisher_id,managedPublisher.id);assert.equal('creator_id' in profilePublished,false);
  const managedPublicProfile=(await request(`/api/publishers/${managedPublisher.id}`)).data;
  assert.equal(managedPublicProfile.publisher.registered_at,editedPublisher.registered_at);assert.equal(managedPublicProfile.stats.series_count,1);assert.equal(managedPublicProfile.stats.episode_count,1);assert.equal(managedPublicProfile.stats.likes,0);assert.equal(managedPublicProfile.stats.views,0);
  assert.equal(managedPublicProfile.series[0].id,profileSeriesId);assert.equal(managedPublicProfile.pagination.total,1);
  assert.deepEqual(profilePublished.subtitle_languages,allSubtitleLanguages);assert.deepEqual(managedPublicProfile.series[0].subtitle_languages,allSubtitleLanguages);
  const adminChunk=await chunkedEpisode(profileSeriesPath+'/episode-uploads',video.length,(offset,length)=>video.subarray(offset,offset+length),'Profile 002.mp4',admin,{title:'Profile episode 002',number:2});
  assert.equal(adminChunk.episode.owner_storage.storage_unlimited,true);
  assert.equal(adminChunk.episode.owner_storage.used_bytes,cover.length+video.length*2);
  assert.equal(adminChunk.episode.owner_storage.quota_bytes,10*1024**3);
  console.log('PASS: administrator storage policy is serialized for covers, direct/chunked episodes and replays, tracks actual bytes, and follows the owner.');
  await request(profileSeriesPath,{...profileSeriesBody,subtitle_languages:[]},admin,200,'PATCH');
  assert.deepEqual((await request(profileSeriesPath,undefined,admin)).data.series.subtitle_languages,[]);
  assert.deepEqual((await request(`/api/series/${profileSeriesId}`)).data.series.subtitle_languages,[]);
  for(const invalidSubtitles of [['en','en'],['unknown-language'],[...allSubtitleLanguages,'en'],null])await request(profileSeriesPath,{...profileSeriesBody,subtitle_languages:invalidSubtitles},admin,400,'PATCH');
  const profileSubtitles=['zh-CN','ko','pt-BR'];
  await request(profileSeriesPath,{...profileSeriesBody,subtitle_languages:['ko','zh-CN','pt-BR']},admin,200,'PATCH');
  await request(profileSeriesPath,profileSeriesBody,admin,200,'PATCH');
  assert.deepEqual((await request(profileSeriesPath,undefined,admin)).data.series.subtitle_languages,profileSubtitles);
  assert.deepEqual((await request(`/api/series/${profileSeriesId}`)).data.series.subtitle_languages,profileSubtitles);
  assert.deepEqual((await request(`/api/publishers/${managedPublisher.id}`)).data.series[0].subtitle_languages,profileSubtitles);
  console.log('PASS: subtitle metadata accepts all 21 supported languages, round-trips multiple selections, clears explicitly, preserves omitted values and rejects invalid lists.');
  const layoutQuotaBefore=(await request('/api/auth/me',undefined,admin)).data.user.used_bytes;
  for(const coverAspectRatio of ['1:1','16:9','9:16']){
    await request(profileSeriesPath,{...profileSeriesBody,cover_aspect_ratio:coverAspectRatio},admin,200,'PATCH');
    assert.equal((await request(profileSeriesPath,undefined,admin)).data.series.cover_aspect_ratio,coverAspectRatio);
    assert.equal((await request(`/api/series/${profileSeriesId}`)).data.series.cover_aspect_ratio,coverAspectRatio);
    assert.equal((await request(`/api/publishers/${managedPublisher.id}`)).data.series[0].cover_aspect_ratio,coverAspectRatio);
    const layoutCover=await fetch(base+`/api/series/${profileSeriesId}/cover`);
    assert.equal(layoutCover.status,200);assert.deepEqual(Buffer.from(await layoutCover.arrayBuffer()),cover,'Layout changes must not crop or rewrite the original cover.');
  }
  await request(profileSeriesPath,{...profileSeriesBody,cover_aspect_ratio:'16:9'},admin,200,'PATCH');
  await request(profileSeriesPath,profileSeriesBody,admin,200,'PATCH');
  assert.equal((await request(profileSeriesPath,undefined,admin)).data.series.cover_aspect_ratio,'16:9','An older editor omitting the field must retain the selected layout.');
  for(const invalidCoverRatio of ['2:3','4:3',null])await request(profileSeriesPath,{...profileSeriesBody,cover_aspect_ratio:invalidCoverRatio},admin,400,'PATCH');
  assert.equal((await request(`/api/series/${profileSeriesId}`)).data.series.cover_aspect_ratio,'16:9');
  assert.equal((await request('/api/auth/me',undefined,admin)).data.user.used_bytes,layoutQuotaBefore);
  const unmodifiedLayoutCover=await fetch(base+`/api/series/${profileSeriesId}/cover`);assert.deepEqual(Buffer.from(await unmodifiedLayoutCover.arrayBuffer()),cover);
  console.log('PASS: portrait, square and landscape cover layouts persist in private/public profiles without changing original image bytes or quota.');
  assert.ok((await request('/api/series?'+new URLSearchParams({q:editedPublisher.display_name}))).data.series.some(series=>series.id===profileSeriesId));
  await request(profileSeriesPath+'/status',{status:'archived'},admin);
  const archivedPublicProfile=(await request(`/api/publishers/${managedPublisher.id}`)).data;
  assert.equal(archivedPublicProfile.stats.series_count,0);assert.deepEqual(archivedPublicProfile.series,[]);
  await request(profileSeriesPath+'/status',{status:'published'},admin);
  assert.equal((await request(`/api/publishers/${managedPublisher.id}`)).data.stats.series_count,1);
  console.log('PASS: Cloudflare publisher selection keeps financial ownership, blocks impersonation, updates public attribution/search and excludes hidden releases.');
  await upload(`/api/studio/series/${sid}/cover`,cover,'cover.jpg',publisher,{},'cover',200);
  const first=await upload(`/api/studio/series/${sid}/episodes`,video,'Episode 01.mp4',publisher,{title:'First episode',number:1});
  const second=await upload(`/api/studio/series/${sid}/episodes`,video,'Episode 02.mp4',publisher,{title:'Second episode',number:2});
  assert.equal(first.bytes,video.length);assert.ok(first.duration>0&&first.duration<=300);
  const used=(await request('/api/auth/me',undefined,publisher)).data.user.used_bytes;assert.equal(used,video.length*2+cover.length);
  const longfile=path.join(dir,'long.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=1:d=301','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',longfile]);
  const rejected=await upload(`/api/studio/series/${sid}/episodes`,await readFile(longfile),'long.mp4',publisher,{title:'Too long',number:3},'video',422);assert.equal(rejected.error.code,'VIDEO_TOO_LONG');
  const large=(await request(`/api/studio/series/${sid}/episode-uploads`,{title:'Too large',number:3,filename:'oversized.mp4',size:maxEpisodeBytes+1},publisher,413)).data;assert.equal(large.error.code,'FILE_TOO_LARGE');
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.used_bytes,used);
  await request(`/api/studio/series/${sid}/status`,{status:'published'},publisher);
  const newestPath='/api/series?'+new URLSearchParams({sort:'new',language:body.language,genre:body.genres[0],theme:'entrepreneurship',format:body.format,creation:body.creation_type});
  const newest=(await request(newestPath)).data.series;assert.equal(newest[0].id,sid);
  assert.equal(newest[0].language,'cmn');
  await request(`/api/studio/series/${sid}`,{...body,language:'yue'},publisher,200,'PATCH');
  const cantonese=(await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series;assert.equal(cantonese.language,'yue');assert.deepEqual(cantonese.subtitle_languages,selectedSubtitles);
  assert.ok((await request('/api/series?'+new URLSearchParams({language:'yue',genre:body.genres[0]}))).data.series.some(item=>item.id===sid));assert.equal((await request(newestPath)).data.series.some(item=>item.id===sid),false);
  await request(`/api/studio/series/${sid}`,body,publisher,200,'PATCH');
  assert.equal((await request('/api/series?language=zh-TW')).data.series.some(item=>item.id===sid),false);assert.ok((await request('/api/series?language=zh-TW')).data.series.some(item=>item.id==='blue-hour'));
  assert.deepEqual(newest[0].themes,body.themes);assert.equal(newest[0].format,body.format);
  assert.equal((await request('/api/series?theme=revenge&format=live-action')).data.series.some(s=>s.id===sid),false);
  assert.ok((await request('/api/series?genre=animation')).data.series.some(s=>s.id===sid));
  const publishedAt=newest[0].published_at;assert.ok(Number.isFinite(Date.parse(publishedAt)));
  await request(`/api/studio/series/${sid}/status`,{status:'published'},publisher);
  assert.equal((await request(newestPath)).data.series[0].published_at,publishedAt);
  const publishedSearchPage=await fetch(base+'/series/'+sid);assert.equal(publishedSearchPage.status,200);
  assert.equal(publishedSearchPage.headers.get('link'),`<${base}/series/${sid}>; rel="canonical"`);
  assert.equal(publishedSearchPage.headers.get('cache-control'),'private, no-store');
  const searchHtml=await publishedSearchPage.text();assert.ok(searchHtml.includes(body.title));assert.match(searchHtml,/TVSeries/);assert.match(searchHtml,/data-search-snapshot/);
  assert.ok((await(await fetch(base+'/sitemap.xml')).text()).includes(`/series/${sid}`));
  assert.equal((await request(`/api/series/${sid}`)).headers.get('x-robots-tag'),'noindex','Public JSON is available for rendering, but the HTML series page is the indexable document.');
  const privateSearchPage=await fetch(base+'/account');assert.equal(privateSearchPage.status,200);assert.match(privateSearchPage.headers.get('x-robots-tag'),/noindex/);await privateSearchPage.body.cancel();
  console.log('PASS: published series receive crawlable HTML, unique canonical metadata and JSON-LD; the live sitemap updates without exposing private account pages.');
  const image=await fetch(base+`/api/series/${sid}/cover`);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(image.headers.get('x-robots-tag'),null,'Public poster images must remain crawlable.');assert.deepEqual(Buffer.from(await image.arrayBuffer()),cover);
  const free=await fetch(base+`/api/episodes/${first.id}/stream`,{headers:{Range:'bytes=0-31'}});assert.equal(free.status,206);assert.equal((await free.arrayBuffer()).byteLength,32);
  await request(`/api/episodes/${second.id}/stream`,undefined,'',403);
  console.log('PASS: R2 covers and videos, quota accounting, publication, byte ranges, 301-second and over-200 MiB rejection.');

  // A separate local series verifies optional finale pricing without changing
  // the paid episodes, sales totals or engagement assertions below.
  const finaleDetails={...profileSeriesBody,title:'Optional Free Finale Runtime',free_episodes:0,last_episode_free:true};
  const finaleId=(await request('/api/studio/series',finaleDetails,admin,201)).data.id,finalePath=`/api/studio/series/${finaleId}`;
  await upload(finalePath+'/cover',cover,'finale-cover.jpg',admin,{},'cover',200);
  const finaleEpisodes=[];
  for(const number of [1,3,9])finaleEpisodes.push(await upload(finalePath+'/episodes',video,`Finale ${number}.mp4`,admin,{title:`Finale chapter ${number}`,number}));
  const finaleDraftPreview=(await request(`/api/episodes/${finaleEpisodes[0].id}/playback`,{},admin)).data;
  assert.equal(finaleDraftPreview.excluded,true,'An owner draft preview must not manufacture a public view.');
  assert.equal((await request(finalePath+'/analytics?period=7d',undefined,admin)).data.totals.views,0);
  await request(finalePath+'/status',{status:'published'},admin);
  const readFinale=async()=>(await request(`/api/series/${finaleId}`)).data;
  const finalePublic=await readFinale();assert.equal(finalePublic.series.last_episode_free,true);assert.equal(finalePublic.series.free_episode_count,1);assert.equal(finalePublic.series.access_type,'free-then-paid');
  assert.deepEqual(finalePublic.episodes.map(episode=>episode.free),[false,false,true]);assert.equal(finalePublic.episodes.at(-1).unlocked,true);
  assert.equal((await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series.last_episode_free,false,'Existing series remain opted out.');
  await request(`/api/episodes/${finaleEpisodes[1].id}/stream`,undefined,'',403);
  const finaleRange=await fetch(base+`/api/episodes/${finaleEpisodes[2].id}/stream`,{headers:{Range:'bytes=0-31'}});assert.equal(finaleRange.status,206);assert.equal((await finaleRange.arrayBuffer()).byteLength,32);
  const finalePlayback=(await request(`/api/episodes/${finaleEpisodes[2].id}/playback`,{})).data;assert.ok(finalePlayback.sessionId);assert.equal(finalePlayback.viewCounted,true);assert.equal(finalePlayback.watchedMs,0);
  const finaleViewsBeforePrivatePreview=(await readFinale()).series.views;
  for(const previewPath of [`/api/studio/episodes/${finaleEpisodes[0].id}/stream`,`/api/admin/episodes/${finaleEpisodes[0].id}/stream`]){
    const preview=await fetch(base+previewPath,{headers:{Cookie:admin,Range:'bytes=0-15'}});
    assert.equal(preview.status,206);assert.equal((await preview.arrayBuffer()).byteLength,16);
  }
  assert.equal((await readFinale()).series.views,finaleViewsBeforePrivatePreview,'Private Studio/admin preview streams must not count public views.');
  const finaleOwnerPlayback=(await request(`/api/episodes/${finaleEpisodes[0].id}/playback`,{},admin)).data;
  assert.equal(finaleOwnerPlayback.viewCounted,true,'A publisher watching a published episode publicly must count.');assert.equal(finaleOwnerPlayback.watchedMs,0);
  const finaleOwnerReplay=(await request(`/api/episodes/${finaleEpisodes[0].id}/playback`,{},admin)).data;
  assert.equal(finaleOwnerReplay.sessionId,finaleOwnerPlayback.sessionId);assert.equal(finaleOwnerReplay.viewCounted,true);
  const finaleOwnerZeroTime=(await request(`/api/playback/${finaleOwnerPlayback.sessionId}`,{watchedMs:0},admin,200,'PUT')).data;
  assert.equal(finaleOwnerZeroTime.viewCounted,true);assert.equal(finaleOwnerZeroTime.watchedMs,0);
  const finaleNextPlayback=(await request(`/api/episodes/${finaleEpisodes[1].id}/playback`,{},admin)).data;
  assert.notEqual(finaleNextPlayback.sessionId,finaleOwnerPlayback.sessionId);assert.equal(finaleNextPlayback.viewCounted,true);
  const finaleStarted=await readFinale();assert.equal(finaleStarted.series.views,3);assert.deepEqual(finaleStarted.episodes.map(episode=>episode.views),[1,1,1]);
  const finaleImmediateAnalytics=(await request(finalePath+'/analytics?period=7d',undefined,admin)).data;
  assert.equal(finaleImmediateAnalytics.totals.views,3);assert.equal(finaleImmediateAnalytics.totals.watchSeconds,0);assert.equal(finaleImmediateAnalytics.totals.avgWatchSeconds,0);
  const finaleWalletBefore=(await request('/api/wallet',undefined,viewer)).data;
  const finaleUnlock=(await request(`/api/episodes/${finaleEpisodes[2].id}/unlock`,{},viewer)).data;assert.equal(finaleUnlock.alreadyUnlocked,true);
  assert.deepEqual((await request('/api/wallet',undefined,viewer)).data,finaleWalletBefore,'A free finale must not debit a wallet or create ledger entries.');
  await request(finalePath,{...finaleDetails,last_episode_free:false},admin,200,'PATCH');assert.equal((await readFinale()).series.access_type,'all-paid');
  await request(`/api/episodes/${finaleEpisodes[2].id}/stream`,undefined,'',403);
  await request(finalePath,finaleDetails,admin,200,'PATCH');
  const{last_episode_free:omittedFinale,...olderFinaleDetails}=finaleDetails;await request(finalePath,olderFinaleDetails,admin,200,'PATCH');assert.equal((await readFinale()).series.last_episode_free,true);
  const finaleRevision=(await request(finalePath,undefined,admin)).data.episodes_revision,finaleOrder=finaleEpisodes.map(episode=>episode.id).reverse();
  await request(finalePath+'/episodes/batch',{action:'reorder',revision:finaleRevision,episode_ids:finaleOrder},admin,409);
  await request(finalePath+'/episodes/batch',{action:'reorder',revision:finaleRevision,episode_ids:finaleOrder,acknowledge_access_change:true},admin);
  assert.equal((await readFinale()).episodes.find(episode=>episode.free).id,finaleEpisodes[0].id);
  const finaleNewRevision=(await request(finalePath,undefined,admin)).data.episodes_revision;
  await request(finalePath+'/episodes/batch',{action:'reorder',revision:finaleNewRevision,episode_ids:finaleEpisodes.map(episode=>episode.id),acknowledge_access_change:true},admin);
  assert.equal((await readFinale()).episodes.find(episode=>episode.free).id,finaleEpisodes[2].id);
  console.log('PASS: optional final-episode pricing handles sparse order, guest playback, no-charge unlocks, opt-out/default/omitted metadata and acknowledged reorders.');

  const liked=(await request(`/api/series/${sid}/like`,{liked:true},viewer,200,'PUT')).data;assert.equal(liked.likes,1);
  const duplicateLike=(await request(`/api/series/${sid}/like`,{liked:true},viewer,200,'PUT')).data;assert.equal(duplicateLike.likes,1);
  const publicSeries=(await request(`/api/series/${sid}`,undefined,viewer)).data;
  assert.equal(publicSeries.series.likes,1);assert.equal(publicSeries.series.liked,true);assert.equal(publicSeries.series.saved,false);
  assert.deepEqual(publicSeries.series.subtitle_languages,selectedSubtitles);
  assert.equal(publicSeries.series.views,0,'Metadata and byte ranges must not count as views.');
  const guestPlayback=await request(`/api/episodes/${first.id}/playback`,{});assert.match(guestPlayback.cookie,/^drama_viewer=/);
  assert.equal(guestPlayback.data.viewCounted,true,'A playback start must count immediately, without waiting for a heartbeat.');assert.equal(guestPlayback.data.watchedMs,0);
  const immediatePublic=(await request(`/api/series/${sid}`)).data;
  assert.equal(immediatePublic.series.views,1);assert.equal(immediatePublic.episodes.find(episode=>episode.id===first.id).views,1);
  const immediateAnalytics=(await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data;
  assert.equal(immediateAnalytics.totals.views,1);assert.equal(immediateAnalytics.totals.watchSeconds,0);assert.equal(immediateAnalytics.totals.avgWatchSeconds,0);
  const duplicateGuestStart=(await request(`/api/episodes/${first.id}/playback`,{},guestPlayback.cookie)).data;
  assert.equal(duplicateGuestStart.sessionId,guestPlayback.data.sessionId);assert.equal(duplicateGuestStart.viewCounted,true);
  const zeroTime=(await request(`/api/playback/${guestPlayback.data.sessionId}`,{watchedMs:0},guestPlayback.cookie,200,'PUT')).data;
  assert.equal(zeroTime.viewCounted,true);assert.equal(zeroTime.watchedMs,0);
  await request(`/api/episodes/${second.id}/playback`,{},guestPlayback.cookie,403);
  assert.equal((await request(`/api/series/${sid}`)).data.series.views,1,'Retries, zero-time heartbeats and rejected paid playback must not add another view.');
  await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,viewer,403);
  await new Promise(resolve=>setTimeout(resolve,3300));
  const qualified=(await request(`/api/playback/${guestPlayback.data.sessionId}`,{watchedMs:3200},guestPlayback.cookie,200,'PUT')).data;
  assert.equal(qualified.viewCounted,true);assert.equal(qualified.watchedMs,3200);
  const analytics=(await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data;
  assert.equal(analytics.totals.views,1);assert.equal(analytics.totals.avgWatchSeconds,3.2);assert.equal(analytics.totals.likes,1);assert.equal(analytics.daily.length,7);
  assert.equal(analytics.episodes.find(episode=>episode.id===first.id).views,1);
  const ordinaryPublisherId=publicSeries.series.publisher_id;
  assert.ok(ordinaryPublisherId);assert.notEqual(ordinaryPublisherId,p.data.user.id);assert.equal('creator_id' in publicSeries.series,false);
  const ordinaryPublisherProfile=(await request(`/api/publishers/${ordinaryPublisherId}`)).data;
  assert.equal(ordinaryPublisherProfile.publisher.display_name,'Local Publisher');assert.equal(ordinaryPublisherProfile.publisher.managed,false);
  assert.equal(ordinaryPublisherProfile.stats.series_count,1);assert.equal(ordinaryPublisherProfile.stats.episode_count,2);assert.equal(ordinaryPublisherProfile.stats.views,1);assert.equal(ordinaryPublisherProfile.stats.tracked_views,1);assert.equal(ordinaryPublisherProfile.stats.likes,1);assert.equal(ordinaryPublisherProfile.stats.total_watch_seconds,3.2);assert.equal(ordinaryPublisherProfile.stats.avg_watch_seconds,3.2);
  assert.equal(ordinaryPublisherProfile.series[0].id,sid);assert.equal(JSON.stringify(ordinaryPublisherProfile).includes('publisher@example.test'),false);
  await request(`/api/publishers/${p.data.user.id}`,undefined,'',404);
  console.log('PASS: immediate anonymous/public publisher views, preview exclusion, durable deduplication, exact watch time, and owner-only series/episode analytics.');

  await Promise.all(Array.from({length:8},()=>request(`/api/episodes/${second.id}/unlock`,{},viewer)));
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,9_490_000);
  const studio=(await request('/api/studio',undefined,publisher)).data;assert.equal(studio.user.earnings_micros,357_000);assert.equal(studio.stats.sales,1);
  const report=(await request('/api/admin',undefined,admin)).data;assert.equal(report.stats.sales.platform_micros,153_000);
  const paid=await fetch(base+`/api/episodes/${second.id}/stream`,{headers:{Cookie:viewer,Range:'bytes=0-15'}});assert.equal(paid.status,206);assert.equal((await paid.arrayBuffer()).byteLength,16);
  await request('/api/studio/withdrawals',{amount_cents:100},publisher,400);
  await request('/api/studio/withdrawals',{amount_cents:999},publisher,400);
  await request('/api/studio/withdrawals',{amount_cents:1000},publisher,400);
  // Earn enough through an actual, entirely local demo purchase to exercise the
  // USD10 minimum and zero-fee snapshot without fabricating a production balance.
  const payoutBuyer=(await request('/api/auth/register',{name:'Payout smoke viewer',email:'payout-smoke@example.test',password},'',201)).cookie;
  const payoutFunding=(await request('/api/payments/checkout',{kind:'funding',amount_cents:2000},payoutBuyer)).data;
  await request(`/api/payments/${payoutFunding.paymentId}/demo-confirm`,{},payoutBuyer);
  await request(`/api/episodes/${second.id}/unlock`,{},payoutBuyer);
  // Every paid episode stays within the global US$1 maximum. A separate local
  // publisher earns the minimum through distinct real unlocks, preserving the
  // primary publisher's media/analytics fixtures and historical sale counts.
  const payoutCreator=(await request('/api/auth/register',{name:'Payout smoke creator',email:'payout-creator@example.test',password},'',201)).cookie;
  const payoutPass=(await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent},payoutCreator)).data;
  await request(`/api/payments/${payoutPass.paymentId}/demo-confirm`,{},payoutCreator);
  const payoutDetails={...body,title:'Payout minimum validation drama',language:'en',genres:['comedy'],price_cents:100,free_episodes:0};
  const payoutSeriesId=(await request('/api/studio/series',payoutDetails,payoutCreator,201)).data.id,payoutPath=`/api/studio/series/${payoutSeriesId}`,payoutEpisodes=[];
  await upload(payoutPath+'/cover',cover,'payout-cover.jpg',payoutCreator,{},'cover',200);
  for(let number=1;number<=15;number++)payoutEpisodes.push(await upload(payoutPath+'/episodes',video,`payout-${number}.mp4`,payoutCreator,{title:`Payout validation ${number}`,number}));
  await request(payoutPath+'/status',{status:'published'},payoutCreator);
  for(const episode of payoutEpisodes){const paid=(await request(`/api/episodes/${episode.id}/unlock`,{},payoutBuyer)).data;assert.equal(paid.paid_micros,1_000_000);assert.equal(paid.creator_micros,700_000);assert.equal(paid.platform_micros,300_000);}
  const withdrawal=(await request('/api/studio/withdrawals',{amount_cents:1000,note:'Local test only'},payoutCreator,201)).data;
  const terms=(await request('/api/studio',undefined,payoutCreator)).data.withdrawals.find(row=>row.id===withdrawal.id);
  assert.equal(terms.amount_micros,10_000_000);assert.equal(terms.fee_micros,0);assert.equal(terms.payout_micros,10_000_000);
  assert.equal(withdrawal.user.earnings_micros,500_000);
  await request(`/api/admin/withdrawals/${withdrawal.id}`,{approve:true},admin);
  await request(`/api/admin/withdrawals/${withdrawal.id}`,{approve:true},admin,409);
  await request('/api/studio/storage-requests',{requested_gb:20,reason:'More storage for additional drama episodes.'},publisher,201);
  const pending=(await request('/api/admin',undefined,admin)).data.storageRequests[0];
  await request(`/api/admin/storage-requests/${pending.id}`,{approve:true},admin);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.quota_bytes,20*1024**3);
  console.log('PASS: concurrent purchases debit once, exact fractional-cent 70/30 split, payout minimum/approval, storage approval.');

  const adminSeriesPath='/api/admin/series?'+new URLSearchParams({q:body.title,status:'all',page:'1',limit:'5'});
  await request(adminSeriesPath,undefined,viewer,403);
  await request(adminSeriesPath,undefined,publisher,403);
  const managed=(await request(adminSeriesPath,undefined,admin)).data;
  assert.equal(managed.total,1);assert.equal(managed.series[0].id,sid);assert.equal(managed.series[0].paid_unlocks,2);assert.equal(managed.series[0].taken_down,false);
  const moderationFinance=async()=>{
    const [viewerWallet,publisherWallet,report]=await Promise.all([
      request('/api/wallet',undefined,viewer),request('/api/wallet',undefined,publisher),request('/api/admin',undefined,admin),
    ]);
    const balances=user=>({wallet:user.wallet_micros,earnings:user.earnings_micros,publisher_active:user.publisher_active,quota:user.quota_bytes,used:user.used_bytes});
    return{viewer:{balances:balances(viewerWallet.data.user),ledger:viewerWallet.data.ledger,payments:viewerWallet.data.payments},publisher:{balances:balances(publisherWallet.data.user),ledger:publisherWallet.data.ledger,payments:publisherWallet.data.payments},sales:report.data.stats.sales,withdrawals:report.data.withdrawals};
  };
  const beforeModerationFinance=await moderationFinance();
  const moderationPath=`/api/admin/series/${sid}/moderation`;
  await request(moderationPath,{action:'takedown',reason:'Local runtime review of a series with an existing paid viewer.'},publisher,403);
  const removed=(await request(moderationPath,{action:'takedown',reason:'Local runtime review of a series with an existing paid viewer.'},admin)).data;
  assert.equal(removed.taken_down,true);assert.equal(removed.alreadyApplied,false);
  assert.equal((await request(newestPath)).data.series.some(series=>series.id===sid),false);
  await request(`/api/publishers/${ordinaryPublisherId}`,undefined,'',404);
  for(const identity of ['',viewer,publisher,admin]){
    await request(`/api/series/${sid}`,undefined,identity,404);
    await request(`/api/series/${sid}/cover`,undefined,identity,404);
    await request(`/api/episodes/${first.id}/stream`,undefined,identity,404);
    await request(`/api/episodes/${second.id}/stream`,undefined,identity,404);
  }
  await request(`/api/episodes/${second.id}/unlock`,{},viewer,404);
  await request(`/api/episodes/${first.id}/unlock`,{},publisher,404);
  await request(`/api/episodes/${first.id}/playback`,{},guestPlayback.cookie,404);
  await request(`/api/playback/${guestPlayback.data.sessionId}`,{watchedMs:3300},guestPlayback.cookie,404,'PUT');
  await request(`/api/studio/series/${sid}/status`,{status:'published'},publisher,423);
  await request(`/api/studio/series/${sid}`,undefined,viewer,403);
  const privateEditor=(await request(`/api/studio/series/${sid}`,undefined,admin)).data;
  assert.equal(privateEditor.series.taken_down,true);assert.equal(privateEditor.series.status,'published');assert.equal(privateEditor.episodes.length,2);assert.equal(privateEditor.series.views,1);
  assert.equal((await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series.taken_down,true);
  const privateCover=await fetch(base+`/api/studio/series/${sid}/cover`,{headers:{Cookie:admin}});
  assert.equal(privateCover.status,200);assert.equal(privateCover.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await privateCover.arrayBuffer()),cover);
  await request(`/api/admin/episodes/${second.id}/stream`,undefined,viewer,403);
  const reviewStream=await fetch(base+`/api/admin/episodes/${second.id}/stream`,{headers:{Cookie:admin,Range:'bytes=0-15'}});
  assert.equal(reviewStream.status,206);assert.equal(reviewStream.headers.get('cache-control'),'private, no-store');assert.equal((await reviewStream.arrayBuffer()).byteLength,16);
  const reviewedDetails={...body,description:body.description+' Metadata verified during a local administrative review.'};
  await request(`/api/studio/series/${sid}`,reviewedDetails,admin,200,'PATCH');
  const reviewedEditor=(await request(`/api/studio/series/${sid}`,undefined,admin)).data;
  assert.equal(reviewedEditor.series.description,reviewedDetails.description);assert.equal(reviewedEditor.series.taken_down,true);assert.equal(reviewedEditor.series.views,1);
  await request(moderationPath,{action:'restore',reason:'Local runtime review completed; retain existing purchases and media.'},admin);
  const moderationAudit=(await request(moderationPath,undefined,admin)).data.events;
  assert.deepEqual(moderationAudit.map(event=>event.action),['restore','metadata','takedown']);
  assert.equal(moderationAudit[1].snapshot.after.description,reviewedDetails.description);
  assert.equal((await request(`/api/series/${sid}`,undefined,viewer)).data.episodes.find(episode=>episode.id===second.id).unlocked,true);
  const restoredPaid=await fetch(base+`/api/episodes/${second.id}/stream`,{headers:{Cookie:viewer,Range:'bytes=0-15'}});
  assert.equal(restoredPaid.status,206);assert.equal((await restoredPaid.arrayBuffer()).byteLength,16);
  assert.deepEqual(await moderationFinance(),beforeModerationFinance);
  console.log('PASS: Cloudflare SQL moderation hides purchased content, preserves private admin review and audit history, blocks publisher republication, and restores access without changing money.');

  const suggestionPath=`/api/admin/series/${sid}/featured`;
  const suggestionFinance=await moderationFinance();
  const suggestionAuditBefore=(await request(moderationPath,undefined,admin)).data.events.length;
  await request(suggestionPath,{featured:true},publisher,403,'PUT');
  await request(suggestionPath,{featured:true},viewer,403,'PUT');
  await request(suggestionPath,{featured:1},admin,400,'PUT');
  assert.deepEqual((await request(suggestionPath,{featured:true},admin,200,'PUT')).data,{featured:1,alreadyApplied:false});
  assert.deepEqual((await request(suggestionPath,{featured:true},admin,200,'PUT')).data,{featured:1,alreadyApplied:true});
  const suggested=(await request('/api/series?featured=true')).data.series;
  assert.ok(suggested.some(series=>series.id===sid));
  assert.ok(suggested.every(series=>series.featured===1&&series.status==='published'&&series.episode_count>0));
  assert.equal((await request(adminSeriesPath,undefined,admin)).data.series[0].featured,1);
  assert.equal((await request(moderationPath,undefined,admin)).data.events.length,suggestionAuditBefore+1);
  assert.deepEqual((await request(suggestionPath,{featured:false},admin,200,'PUT')).data,{featured:0,alreadyApplied:false});
  assert.equal((await request('/api/series?featured=true')).data.series.some(series=>series.id===sid),false);
  const suggestionAudit=(await request(moderationPath,undefined,admin)).data.events;
  assert.equal(suggestionAudit.length,suggestionAuditBefore+2);
  assert.deepEqual(await moderationFinance(),suggestionFinance);
  console.log('PASS: Cloudflare homepage suggestions enforce administrator access, strict booleans, selected-only discovery, replay-safe audit and unchanged financial state.');

  const beforeHideFinance=await moderationFinance();
  const beforeHideAnalytics=(await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data;
  await request(`/api/studio/series/${sid}/status`,{status:'archived'},publisher);
  assert.equal((await request(newestPath)).data.series.some(series=>series.id===sid),false);
  await request(`/api/publishers/${ordinaryPublisherId}`,undefined,admin,404);
  for(const identity of ['',viewer,publisher,admin]){
    await request(`/api/series/${sid}`,undefined,identity,404);
    await request(`/api/series/${sid}/cover`,undefined,identity,404);
    await request(`/api/episodes/${first.id}/stream`,undefined,identity,404);
    await request(`/api/episodes/${second.id}/stream`,undefined,identity,404);
  }
  await request(`/api/episodes/${second.id}/unlock`,{},viewer,404);
  await request(`/api/episodes/${first.id}/playback`,{},guestPlayback.cookie,404);
  await request(`/api/playback/${guestPlayback.data.sessionId}`,{watchedMs:3300},guestPlayback.cookie,404,'PUT');
  await request(`/api/series/${sid}/like`,{liked:true},viewer,404,'PUT');
  const hiddenEditor=(await request(`/api/studio/series/${sid}`,undefined,publisher)).data;
  assert.equal(hiddenEditor.series.status,'archived');assert.equal(hiddenEditor.episodes.length,2);
  const hiddenOwnerPreview=await fetch(base+`/api/studio/episodes/${second.id}/stream`,{headers:{Cookie:publisher,Range:'bytes=0-15'}});
  assert.equal(hiddenOwnerPreview.status,206);assert.equal(hiddenOwnerPreview.headers.get('cache-control'),'private, no-store');assert.equal((await hiddenOwnerPreview.arrayBuffer()).byteLength,16);
  assert.deepEqual((await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data,beforeHideAnalytics);
  assert.deepEqual(await moderationFinance(),beforeHideFinance);
  await request(`/api/studio/series/${sid}/status`,{status:'published'},publisher);
  assert.equal((await request(newestPath)).data.series[0].published_at,publishedAt);
  assert.equal((await request(`/api/series/${sid}`,undefined,viewer)).data.episodes.find(episode=>episode.id===second.id).unlocked,true);
  assert.deepEqual((await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data,beforeHideAnalytics);
  assert.deepEqual(await moderationFinance(),beforeHideFinance);
  console.log('PASS: creator hide/show denies owner and purchaser public URLs, retains private R2 preview, publication date, purchases, analytics and money.');

  // Exercise bulk editorial changes against actual local SQL/R2 without
  // changing the main paid drama used by all the financial restart checks.
  const bulkBody={...body,title:'Local Bulk Episode Drama',genres:['drama'],themes:[],format:'live-action',free_episodes:1};
  const bulkId=(await request('/api/studio/series',bulkBody,publisher,201)).data.id,bulkPath=`/api/studio/series/${bulkId}`;
  await upload(bulkPath+'/cover',cover,'bulk-cover.jpg',publisher,{},'cover',200);
  const bulkOne=await upload(bulkPath+'/episodes',video,'Bulk 001.mp4',publisher,{title:'Original 001',number:1});
  const bulkTwo=await upload(bulkPath+'/episodes',video,'Bulk 002.mp4',publisher,{title:'Original 002',number:2});
  await request(bulkPath+'/status',{status:'published'},publisher);
  let bulkEditor=(await request(bulkPath,undefined,publisher)).data;
  await request(bulkPath+'/episodes/batch',{action:'rename',revision:bulkEditor.episodes_revision,episode_ids:[bulkOne.id,bulkTwo.id],base_name:'Runtime Name'},viewer,403);
  let bulkState=(await request(bulkPath+'/episodes/batch',{action:'rename',revision:bulkEditor.episodes_revision,episode_ids:[bulkOne.id,bulkTwo.id],base_name:'Runtime Name'},publisher)).data;
  assert.deepEqual(bulkState.episodes.map(e=>e.title),['Runtime Name 001','Runtime Name 002']);
  await request(bulkPath+'/episodes/batch',{action:'reorder',revision:bulkState.episodes_revision,episode_ids:[bulkTwo.id,bulkOne.id]},publisher,409);
  bulkState=(await request(bulkPath+'/episodes/batch',{action:'reorder',revision:bulkState.episodes_revision,episode_ids:[bulkTwo.id,bulkOne.id],acknowledge_access_change:true},publisher)).data;
  assert.deepEqual(bulkState.episodes.map(e=>[e.id,e.number,e.title]),[[bulkTwo.id,1,'Runtime Name 002'],[bulkOne.id,2,'Runtime Name 001']]);
  const bulkPreview=(await request(bulkPath+'/episodes/batch-delete-preview',{revision:bulkState.episodes_revision,episode_ids:[bulkOne.id,bulkTwo.id]},publisher)).data;
  assert.equal(bulkPreview.summary.episode_count,2);assert.equal(bulkPreview.summary.paid_episode_count,0);assert.equal(bulkPreview.summary.media_bytes,video.length*2);
  const bulkDeleted=(await request(bulkPath+'/episodes/batch',{action:'delete',revision:bulkState.episodes_revision,episode_ids:[bulkOne.id,bulkTwo.id],confirmation_token:bulkPreview.confirmation_token,confirm_title:bulkBody.title,acknowledge:true},publisher)).data;
  assert.equal(bulkDeleted.deleted_count,2);assert.equal(bulkDeleted.cleanup_pending,false);assert.equal(bulkDeleted.owner_storage.used_bytes,used+cover.length);
  bulkEditor=(await request(bulkPath,undefined,publisher)).data;assert.equal(bulkEditor.series.status,'archived');assert.equal(bulkEditor.episodes.length,0);
  for(const episode of [bulkOne,bulkTwo])await request(`/api/studio/episodes/${episode.id}/stream`,undefined,publisher,404);
  const bulkSeriesProof=(await request(bulkPath+'/lifecycle',undefined,publisher)).data;
  await request(bulkPath,{confirmation_token:bulkSeriesProof.confirmation_token,confirm_title:bulkBody.title,acknowledge:true},publisher,200,'DELETE');
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.used_bytes,used);
  console.log('PASS: Cloudflare bulk rename keeps numeric suffixes, atomic reorder confirms free access, and batch deletion releases exact quota only after R2 removal.');

  // Keep the main drama intact for restart checks. This separate paid upload
  // exercises irreversible deletion only inside the local SQL/R2 emulator.
  const deletionBody={title:'Disposable Cloudflare Lifecycle Drama',description:'A private local upload removed permanently after an exact paid-access confirmation.',language:'en',genres:['drama'],themes:[],format:'live-action',creation_type:'human',price_cents:10,free_episodes:0};
  const disposableId=(await request('/api/studio/series',deletionBody,publisher,201)).data.id;
  const disposablePath=`/api/studio/series/${disposableId}`;
  await upload(disposablePath+'/cover',cover,'disposable-cover.jpg',publisher,{},'cover',200);
  // Stream an exact 200 MiB, 300-second valid MP4 as forty small requests.
  // A free box pads the real H.264 fixture without a huge Git fixture or
  // materializing the whole file. Restart after three parts proves persistence.
  const boundaryPath=path.join(dir,'boundary-300.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=1:d=300','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',boundaryPath]);
  const boundaryVideo=await readFile(boundaryPath),freeBox=Buffer.alloc(8);
  freeBox.writeUInt32BE(maxEpisodeBytes-boundaryVideo.length,0);freeBox.write('free',4,'ascii');
  const prefix=Buffer.concat([boundaryVideo,freeBox]);
  const largePart=(offset,length)=>{const bytes=Buffer.alloc(length,0x5b);if(offset<prefix.length)prefix.copy(bytes,0,offset,Math.min(prefix.length,offset+length));return bytes;};
  const largeUpload=await chunkedEpisode(disposablePath+'/episode-uploads',maxEpisodeBytes,largePart,'001_He Said I Wasn’t Smart Enough for Cambri_001.mp4',publisher,{title:'Disposable paid episode',number:1},{restartAfterPart:3});
  const disposableEpisode=largeUpload.episode;
  assert.equal(disposableEpisode.bytes,maxEpisodeBytes);assert.equal(disposableEpisode.duration,300);
  assert.equal((await request(disposablePath,undefined,publisher)).data.episodes[0].duration,300);
  const uploadedTail=await fetch(base+`/api/studio/episodes/${disposableEpisode.id}/stream`,{headers:{Cookie:publisher,Range:'bytes=-32'}});
  assert.equal(uploadedTail.status,206);assert.deepEqual(Buffer.from(await uploadedTail.arrayBuffer()),Buffer.alloc(32,0x5b));
  const uploadedComplete=await fetch(base+`/api/studio/episodes/${disposableEpisode.id}/stream`,{headers:{Cookie:publisher}});
  assert.equal(uploadedComplete.status,200);
  const receivedHash=createHash('sha256');let receivedBytes=0;for await(const bytes of uploadedComplete.body){receivedBytes+=bytes.length;receivedHash.update(bytes);}
  assert.equal(receivedBytes,maxEpisodeBytes);assert.equal(receivedHash.digest('hex'),largeUpload.sha256);
  await request(disposablePath+'/status',{status:'published'},publisher);
  assert.equal((await request(`/api/series/${disposableId}`,undefined,publisher)).data.episodes[0].duration,300);
  await request(`/api/episodes/${disposableEpisode.id}/progress`,{seconds:300},publisher);
  await request(`/api/episodes/${disposableEpisode.id}/progress`,{seconds:300.001},publisher,400);
  const disposableBytes=cover.length+maxEpisodeBytes;
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.used_bytes,used+disposableBytes);
  await request(`/api/series/${disposableId}/like`,{liked:true},viewer,200,'PUT');
  await request(`/api/series/${disposableId}/save`,{},viewer);
  await request(`/api/episodes/${disposableEpisode.id}/unlock`,{},viewer);
  await request(`/api/episodes/${disposableEpisode.id}/progress`,{seconds:1},viewer);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,9_390_000);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.earnings_micros,784_000);
  const beforeDeletionFinance=await moderationFinance();
  await request(disposablePath+'/lifecycle',undefined,'',401);
  await request(disposablePath+'/lifecycle',undefined,viewer,403);
  let deletionPreview=(await request(disposablePath+'/lifecycle',undefined,publisher)).data;
  assert.equal(deletionPreview.series.id,disposableId);assert.equal(deletionPreview.series.title,deletionBody.title);
  assert.equal(deletionPreview.summary.episode_count,1);assert.equal(deletionPreview.summary.views,0);assert.equal(deletionPreview.summary.likes,1);
  assert.equal(deletionPreview.summary.real_paid_unlocks,1);assert.equal(deletionPreview.summary.real_paid_viewers,1);
  assert.equal(deletionPreview.summary.test_paid_unlocks,0);assert.equal(deletionPreview.summary.test_paid_viewers,0);
  assert.equal(deletionPreview.summary.affected_paid_viewers,1);assert.equal(deletionPreview.summary.media_bytes,disposableBytes);
  assert.ok(Date.parse(deletionPreview.expires_at)>Date.now());
  assert.deepEqual(await moderationFinance(),beforeDeletionFinance,'Deletion preview must not remove content, change balances or consume quota.');
  const deletionConfirmation=()=>({confirmation_token:deletionPreview.confirmation_token,confirm_title:deletionBody.title,acknowledge:true});
  await request(disposablePath,deletionConfirmation(),viewer,403,'DELETE');
  const actorMismatch=await request(disposablePath,deletionConfirmation(),admin,400,'DELETE');assert.equal(actorMismatch.data.error.code,'DELETION_CONFIRMATION_INVALID');
  const titleMismatch=await request(disposablePath,{...deletionConfirmation(),confirm_title:'Incorrect title'},publisher,400,'DELETE');assert.equal(titleMismatch.data.error.code,'DELETION_TITLE_MISMATCH');
  const missingAcknowledgement=await request(disposablePath,{...deletionConfirmation(),acknowledge:false},publisher,400,'DELETE');assert.equal(missingAcknowledgement.data.error.code,'DELETION_ACK_REQUIRED');
  await request(disposablePath,{...deletionBody,description:deletionBody.description+' Updated before confirmation.'},publisher,200,'PATCH');
  const staleConfirmation=await request(disposablePath,deletionConfirmation(),publisher,409,'DELETE');assert.equal(staleConfirmation.data.error.code,'DELETION_CONFIRMATION_STALE');
  deletionPreview=(await request(disposablePath+'/lifecycle',undefined,publisher)).data;
  const deletionResult=(await request(disposablePath,deletionConfirmation(),publisher,200,'DELETE')).data;
  assert.equal(deletionResult.deleted,true);assert.equal(deletionResult.cleanup_pending,false);assert.equal(deletionResult.released_bytes,disposableBytes);
  assert.equal(deletionResult.owner_storage.used_bytes,used);
  const afterDeletionFinance=await moderationFinance();
  assert.equal(afterDeletionFinance.publisher.balances.used,used);
  // Storage is released after R2 acknowledges removal; receipts and every
  // financial value must stay exactly as they were immediately before delete.
  afterDeletionFinance.publisher.balances.used=beforeDeletionFinance.publisher.balances.used;
  assert.deepEqual(afterDeletionFinance,beforeDeletionFinance);
  const assertDisposableDeleted=async()=>{
    for(const identity of ['',viewer,publisher,admin]){
      await request(`/api/series/${disposableId}`,undefined,identity,404);
      await request(`/api/series/${disposableId}/cover`,undefined,identity,404);
      await request(`/api/episodes/${disposableEpisode.id}/stream`,undefined,identity,404);
    }
    for(const identity of [publisher,admin]){
      await request(disposablePath,undefined,identity,404);
      await request(disposablePath+'/cover',undefined,identity,404);
      await request(disposablePath+'/lifecycle',undefined,identity,404);
      await request(disposablePath+'/analytics?period=all',undefined,identity,404);
      await request(`/api/studio/episodes/${disposableEpisode.id}/stream`,undefined,identity,404);
    }
    await request(`/api/admin/episodes/${disposableEpisode.id}/stream`,undefined,admin,404);
    await request(`/api/admin/series/${disposableId}/moderation`,{action:'restore',reason:'A permanently deleted local drama cannot be restored.'},admin,404);
    assert.equal((await request('/api/studio',undefined,publisher)).data.series.some(series=>series.id===disposableId),false);
    assert.equal((await request('/api/series')).data.series.some(series=>series.id===disposableId),false);
    assert.equal((await request('/api/series?saved=true',undefined,viewer)).data.series.some(series=>series.id===disposableId),false);
    assert.equal((await request('/api/history',undefined,viewer)).data.history.some(series=>series.id===disposableId),false);
    const deletedAdmin=(await request('/api/admin/series?'+new URLSearchParams({q:deletionBody.title,status:'all'}),undefined,admin)).data;
    assert.equal(deletedAdmin.total,0);
  };
  await assertDisposableDeleted();
  await request(`/api/episodes/${disposableEpisode.id}/unlock`,{},viewer,404);
  await request(disposablePath,deletionConfirmation(),publisher,404,'DELETE');
  assert.equal((await request('/api/studio',undefined,publisher)).data.stats.sales,3,'Deletion must retain historical creator sales.');
  console.log('PASS: exact 200 MiB / 300-second upload uses forty 5 MiB requests, survives restart, replays completion once, and preserves full-file SHA-256 and exact quota.');
  console.log('PASS: permanent paid-series deletion enforces private fresh confirmations, removes R2 media and quota exactly, denies restoration, and retains financial receipts and historical sales.');

  const giftCookie=(await request('/api/auth/register',{name:'Local funding gift viewer',email:'funding-gift@example.test',password,language:'en'},'',201)).cookie;
  let giftBalance=0;
  for(const[amount,bonus,total]of[[5000,500,5500],[10000,1500,11500]]){
    const quote=(await request('/api/payments/checkout',{kind:'funding',amount_cents:amount},giftCookie)).data;
    assert.equal(quote.amount_cents,amount);assert.equal(quote.funding.bonusCents,bonus);assert.equal(quote.funding.totalCreditCents,total);
    assert.equal((await request('/api/auth/me',undefined,giftCookie)).data.user.wallet_micros,giftBalance);
    const confirmed=(await request(`/api/payments/${quote.paymentId}/demo-confirm`,{},giftCookie)).data;giftBalance+=total*10000;
    assert.equal(confirmed.user.wallet_micros,giftBalance);assert.equal((await request(`/api/payments/${quote.paymentId}/demo-confirm`,{},giftCookie)).data.user.wallet_micros,giftBalance);
  }
  const giftLedger=(await request('/api/wallet',undefined,giftCookie)).data.ledger;
  assert.equal(giftBalance,170_000_000);assert.equal(giftLedger.filter(row=>row.kind==='funding_bonus').length,2);assert.equal(giftLedger.filter(row=>row.kind==='funding_bonus').reduce((sum,row)=>sum+row.amount_micros,0),20_000_000);
  console.log('PASS: Cloudflare funding quotes credit US$50+5 and US$100+15 exactly once, separately audit gifts, and never credit before confirmation.');

  await stop();await start(true,true,base,true);
  const missingTest=(await request('/api/config')).data;
  assert.equal(missingTest.paymentsTestMode,true);assert.equal(missingTest.paymentsReady,false);assert.equal(missingTest.paymentsConfigured,false);
  await request('/api/payments/checkout',{kind:'funding',amount_cents:500},viewer,503);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,0);
  console.log('PASS: one test-mode flag with missing dedicated test keys disables new Checkout rather than selecting saved live credentials.');
  await stop();await start(true,true);
  const stripeTest=(await request('/api/config')).data;
  assert.equal(stripeTest.paymentSetup.status,'ready');assert.equal(stripeTest.paymentSetup.code,'STRIPE_TEST_CONFIGURATION');assert.equal(stripeTest.paymentsMode,'stripe');assert.equal(stripeTest.paymentsTestMode,true);assert.equal(stripeTest.paymentsReady,true);assert.equal(stripeTest.sandbox,false);assert.equal(stripeTest.uploadsEnabled,true);assert.equal(stripeTest.auth.google,true);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,0);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.earnings_micros,0);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.publisher_active,1);
  assert.equal(stripeTest.paymentMethods.wechatPay,true);
  const wechatQuote=(await request('/api/payments/wechat/quote',{amount_cents:1000},viewer)).data.quote;
  assert.equal(wechatQuote.amountUsdCents,1000);assert.equal(wechatQuote.amountHkdCents,7800);assert.equal(wechatQuote.rateMicros,7_800_000);assert.ok(wechatQuote.expiresAt>Date.now());
  await request('/api/payments/wechat/quote',{amount_cents:499},viewer,400);
  await request('/api/payments/wechat/quote',{amount_cents:1000},'',401);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,0);
  console.log('PASS: Cloudflare SQL stores actor-bound HKD quotes for USD wallet credit without creating credit or payment.');
  const testWallet=(await request('/api/wallet',undefined,viewer)).data;assert.deepEqual(testWallet.ledger,[]);assert.deepEqual(testWallet.payments,[]);
  const retainedUnlock=(await request(`/api/episodes/${second.id}/unlock`,{},viewer)).data;assert.equal(retainedUnlock.alreadyUnlocked,true);assert.equal(retainedUnlock.user.wallet_micros,0);
  await request('/api/studio/connect',{},publisher,503);
  await request('/api/studio/withdrawals',{amount_cents:300},publisher,503);
  console.log('PASS: same-site Stripe test mode retains Google, uploads and real entitlements, exposes separate zero test balances, and blocks payouts.');

  const riskPayload=JSON.stringify({id:'evt_cloudflare_risk_fixture',type:'charge.refunded',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:'ch_cloudflare_unknown_risk',payment_intent:'pi_cloudflare_unknown_risk',amount:500,amount_refunded:500,currency:'usd',livemode:false}}});
  const signedAt=Math.floor(Date.now()/1000);
  const riskSignature=`t=${signedAt},v1=${createHmac('sha256','whsec_local_cloudflare_fixture_only').update(`${signedAt}.${riskPayload}`).digest('hex')}`;
  const sendRisk=async()=>{const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':riskSignature},body:riskPayload});assert.equal(response.status,200);return response.json();};
  assert.equal((await sendRisk()).unmapped,true);assert.equal((await sendRisk()).duplicate,true);
  const reviews=(await request('/api/admin/payment-reviews',undefined,admin)).data.reviews;
  assert.equal(reviews.length,1);assert.equal(reviews[0].status,'open');assert.equal(reviews[0].mapped,false);
  await request('/api/admin/payment-reviews',undefined,viewer,403);
  await request(`/api/admin/payment-reviews/${reviews[0].id}/resolve`,{decision:'platform_loss',wallet_debit_cents:0,note:'Unmatched provider reference must remain held.'},admin,409);
  await stop();await start(true,true);
  const persistedReviews=(await request('/api/admin/payment-reviews',undefined,admin)).data.reviews;
  assert.equal(persistedReviews.length,1);assert.equal(persistedReviews[0].id,reviews[0].id);assert.equal(persistedReviews[0].status,'open');
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,0);
  console.log('PASS: signed refund events persist once across Cloudflare SQL restart, unmatched cases stay held, and non-admin/unmapped resolutions are rejected.');

  await stop();await start(true);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.quota_bytes,20*1024**3,'A restart must retain the approved higher allowance.');
  const production=(await request('/api/config')).data;assert.equal(production.paymentsMode,'disabled');assert.equal(production.runtime,'cloudflare');assert.equal(production.auth.google,false);
  const retainedFinale=await readFinale();assert.equal(retainedFinale.series.last_episode_free,true);assert.equal(retainedFinale.series.free_episode_count,1);assert.equal(retainedFinale.episodes.find(episode=>episode.free).id,finaleEpisodes[2].id);assert.equal(retainedFinale.series.views,3);assert.deepEqual(retainedFinale.episodes.map(episode=>episode.views),[1,1,1]);
  const retainedLikes=(await request(`/api/series/${sid}`,undefined,viewer)).data;assert.equal(retainedLikes.series.likes,1);assert.equal(retainedLikes.series.liked,true);
  const retainedNewest=(await request(newestPath)).data.series;assert.equal(retainedNewest[0].id,sid);assert.equal(retainedNewest[0].published_at,publishedAt);
  const resumedGuest=(await request(`/api/episodes/${first.id}/playback`,{},guestPlayback.cookie)).data;assert.equal(resumedGuest.sessionId,guestPlayback.data.sessionId);assert.equal(resumedGuest.viewCounted,true);assert.equal(resumedGuest.watchedMs,3200);
  assert.equal((await request(`/api/series/${sid}`)).data.series.views,1,'A runtime restart must not recount a previously started view.');
  const retainedAnalytics=(await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data;assert.equal(retainedAnalytics.totals.views,1);assert.equal(retainedAnalytics.totals.avgWatchSeconds,3.2);assert.equal(retainedAnalytics.totals.paidViewers,2);assert.equal(retainedAnalytics.episodes.find(episode=>episode.id===second.id).paidViewers,2);
  const retainedModerationAudit=(await request(moderationPath,undefined,admin)).data.events;
  assert.deepEqual(retainedModerationAudit,suggestionAudit);
  assert.equal((await request(`/api/studio/series/${sid}`,undefined,admin)).data.series.taken_down,false);
  const retainedClassification=(await request(`/api/studio/series/${sid}`,undefined,publisher)).data.series;
  assert.equal(retainedClassification.language,'cmn');assert.equal((await request('/api/series/blue-hour')).data.series.language,'zh-TW');assert.equal((await request('/api/series/neon-promises')).data.series.language,'zh-CN');
  assert.deepEqual(retainedClassification.themes,body.themes);assert.equal(retainedClassification.format,body.format);
  assert.ok((await request('/api/series?'+new URLSearchParams({q:body.title,theme:'entrepreneurship',language:body.language,format:body.format}))).data.series.some(item=>item.id===sid),'The added story theme stays filterable after a Cloudflare runtime restart.');
  assert.deepEqual(retainedClassification.subtitle_languages,selectedSubtitles);assert.deepEqual(retainedLikes.series.subtitle_languages,selectedSubtitles);
  assert.equal(retainedClassification.cover_aspect_ratio,'9:16');
  assert.equal((await request('/api/series/tokyo-tomorrow')).data.series.cover_aspect_ratio,'2:3');
  const retainedLocalCatalogue=(await request('/api/series')).data.series;
  assert.ok(series.every(sample=>retainedLocalCatalogue.some(item=>item.id===sample.id)),'Production-mode local restarts must preserve disposable sample fixtures outside the production canonical host.');
  assert.equal((await request(profileSeriesPath,undefined,admin)).data.series.cover_aspect_ratio,'16:9');
  assert.equal((await request(profileSeriesPath,undefined,admin)).data.owner_storage.storage_unlimited,true);
  assert.equal((await request(`/api/series/${profileSeriesId}`)).data.series.cover_aspect_ratio,'16:9');
  assert.deepEqual((await request(profileSeriesPath,undefined,admin)).data.series.subtitle_languages,profileSubtitles);
  assert.deepEqual((await request(`/api/series/${profileSeriesId}`)).data.series.subtitle_languages,profileSubtitles);
  const restartedLayoutCover=await fetch(base+`/api/series/${profileSeriesId}/cover`);assert.deepEqual(Buffer.from(await restartedLayoutCover.arrayBuffer()),cover);
  assert.equal(retainedClassification.publisher_id,ordinaryPublisherId);
  const restartedPublisher=(await request(`/api/publishers/${managedPublisher.id}`)).data;
  assert.equal(restartedPublisher.publisher.display_name,editedPublisher.display_name);assert.equal(restartedPublisher.publisher.registered_at,editedPublisher.registered_at);assert.equal(restartedPublisher.stats.series_count,1);assert.equal(restartedPublisher.series[0].id,profileSeriesId);
  assert.equal(restartedPublisher.series[0].cover_aspect_ratio,'16:9');
  assert.deepEqual(restartedPublisher.series[0].subtitle_languages,profileSubtitles);
  const restartedPublisherAdmin=(await request('/api/admin/publishers',undefined,admin)).data;
  assert.equal(restartedPublisherAdmin.default_publisher_id,officialPublisher.id);assert.equal(restartedPublisherAdmin.publishers.find(profile=>profile.id===managedPublisher.id).created_at,managedPublisher.created_at);
  const restartedOrdinaryPublisher=(await request(`/api/publishers/${ordinaryPublisherId}`)).data;
  assert.equal(restartedOrdinaryPublisher.stats.likes,1);assert.equal(restartedOrdinaryPublisher.stats.views,1);assert.equal(restartedOrdinaryPublisher.stats.total_watch_seconds,3.2);
  console.log('PASS: edited managed profiles, public IDs, real engagement totals and series attribution survive Cloudflare restarts and payment-mode changes.');
  assert.ok((await request(newestPath)).data.series.some(s=>s.id===sid));
  await request('/api/auth/google/start',undefined,'',503);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,9_390_000);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.earnings_micros,784_000);
  const retainedPayoutCreator=(await request('/api/auth/me',undefined,payoutCreator)).data.user;
  assert.equal(retainedPayoutCreator.earnings_micros,500_000);assert.equal(retainedPayoutCreator.wallet_micros,0);assert.equal(retainedPayoutCreator.publisher_active,1);
  assert.equal((await request('/api/auth/me',undefined,payoutBuyer)).data.user.wallet_micros,4_490_000);
  const retainedWithdrawal=(await request('/api/studio',undefined,payoutCreator)).data.withdrawals.find(row=>row.id===withdrawal.id);
  assert.equal(retainedWithdrawal.status,'paid');assert.equal(retainedWithdrawal.amount_micros,10_000_000);assert.equal(retainedWithdrawal.fee_micros,0);assert.equal(retainedWithdrawal.payout_micros,10_000_000);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.used_bytes,used);
  await assertDisposableDeleted();
  const retainedPass=(await request('/api/auth/me',undefined,publisher)).data.user.dramio_pass;assert.equal(retainedPass.active,true);assert.equal(retainedPass.purchased_at,activated.dramio_pass.purchased_at);
  assert.equal((await request('/api/auth/me',undefined,giftCookie)).data.user.wallet_micros,giftBalance);assert.equal((await request('/api/wallet',undefined,giftCookie)).data.ledger.filter(row=>row.kind==='funding_bonus').length,2);
  const persisted=await fetch(base+`/api/episodes/${second.id}/stream`,{headers:{Cookie:viewer,Range:'bytes=0-31'}});assert.equal(persisted.status,206);assert.equal((await persisted.arrayBuffer()).byteLength,32);
  await request('/api/payments/checkout',{kind:'funding',amount_cents:500},viewer,503);
  await request(`/api/payments/${funding.paymentId}/demo-confirm`,{},viewer,404);
  const login=await request('/api/auth/login',{email:'viewer@example.test',password});assert.match(login.headers.get('set-cookie'),/Secure/);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const page=await fetch(base+'/studio');assert.equal(page.status,200);assert.match(page.headers.get('x-robots-tag'),/noindex/);
  const privateShell=await page.text();assert.match(privateShell,/<div id="root">/);assert.match(privateShell,/data-search-snapshot/);assert.ok(!privateShell.includes(body.title),'The generic private-page shell must not expose creator details.');
  const restartedPromotions=(await request('/api/admin/promotions',undefined,admin)).data;assert.equal(restartedPromotions.promotions.find(row=>row.id===managedPromotion.id).amount_hkd_cents,6800);assert.equal(restartedPromotions.promotions.find(row=>row.id===managedPromotion.id).max_redemptions,2);
  assert.equal((await request('/api/auth/me',undefined,promotion)).data.user.dramio_pass.active,true);
  assert.equal((await request('/api/wallet',undefined,promotion)).data.ledger.find(row=>row.kind==='activation').payment_amount_cents,5800);
  console.log('PASS: full runtime restart retains sessions, wallet balances, purchases, and R2 media; production test payments disabled; secure cookies.');
  console.log('Cloudflare local integration smoke passed. No Cloudflare account resources were created.');
}catch(error){console.error(error);console.error(logs.slice(-12000));process.exitCode=1;}
finally{await stop();await rm(dir,{recursive:true,force:true});}
