import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';

// Entirely local: Miniflare emulates Durable Objects and R2. Never deploys or charges money.
const dir=await mkdtemp(path.join(tmpdir(),'aidramio-cloudflare-test-'));
const port=Number(process.env.CLOUDFLARE_TEST_PORT||8789),base=`http://127.0.0.1:${port}`;
const bootstrap=randomBytes(32).toString('hex');
const password='LocalSmokePassword123!';
let child,logs='';
async function start(production=false,testStripe=false){
  logs='';
  const args=['node_modules/wrangler/bin/wrangler.js','dev','--local','--port',String(port),'--inspector-port',String(port+400),'--persist-to',path.join(dir,'state'),
    '--var',`ENVIRONMENT:${production?'production':'development'}`,'--var',`PAYMENTS_MODE:${testStripe?'stripe':production?'disabled':'demo'}`,'--var',`STRIPE_TEST_MODE:${testStripe}`,'--var',`APP_URL:${base}`,'--var',`BOOTSTRAP_TOKEN:${bootstrap}`];
  if(!production||testStripe)args.push('--var','GOOGLE_CLIENT_ID:local-test.apps.googleusercontent.com','--var','GOOGLE_CLIENT_SECRET:local-test-only-google-secret');
  if(testStripe)args.push('--var','STRIPE_SECRET_KEY:rk_test_local_cloudflare_fixture_only','--var','STRIPE_WEBHOOK_SECRET:whsec_local_cloudflare_fixture_only');
  child=spawn(process.execPath,args,{env:{...process.env,XDG_CONFIG_HOME:path.join(dir,'config'),WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(dir,'wrangler.log')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  for(let n=0;n<120;n++){
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
try{
  await start();
  const cfg=(await request('/api/config')).data;assert.equal(cfg.runtime,'cloudflare');assert.equal(cfg.paymentsMode,'demo');assert.equal(cfg.auth.google,true);
  const oauth=await fetch(base+'/api/auth/google/start?next=%2Fwallet&language=zh-TW',{redirect:'manual'});assert.equal(oauth.status,302);const authorization=new URL(oauth.headers.get('location'));assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  const binding=oauth.headers.getSetCookie().find(c=>c.startsWith('drama_google='))?.split(';')[0];assert.ok(binding);const callback=base+'/api/auth/google/callback?'+new URLSearchParams({state:authorization.searchParams.get('state'),error:'access_denied'});
  const cancelled=await fetch(callback,{redirect:'manual',headers:{Cookie:binding}});assert.equal(cancelled.status,303);assert.equal(new URL(cancelled.headers.get('location'),base).searchParams.get('error'),'google_cancelled');
  const replay=await fetch(callback,{redirect:'manual',headers:{Cookie:binding}});assert.equal(new URL(replay.headers.get('location'),base).searchParams.get('error'),'google_expired');
  console.log('PASS: Cloudflare Google authorization, private browser binding, durable OAuth state, cancellation and replay protection.');
  const series=(await request('/api/series')).data.series;assert.equal(series.length,20);
  const sample=(await request('/api/series/'+series[0].id)).data;assert.ok(sample.episodes.every(e=>e.unlocked),'Public samples must all be free.');
  const sampleVideo=await fetch(base+`/api/episodes/${sample.episodes[0].id}/stream`);assert.equal(sampleVideo.status,200);assert.equal((await sampleVideo.arrayBuffer()).byteLength,1037034);
  console.log('PASS: Cloudflare runtime, public catalogue, and free sample playback.');

  await request('/api/admin/bootstrap',{email:'admin@example.test',name:'Local Admin',password},'',403);
  await request('/api/admin/bootstrap',{email:'admin@example.test',name:'Local Admin',password},'',201,'POST',{'x-bootstrap-token':bootstrap});
  await request('/api/admin/bootstrap',{email:'second@example.test',name:'Second Admin',password},'',409,'POST',{'x-bootstrap-token':bootstrap});
  const admin=(await request('/api/auth/login',{email:'admin@example.test',password})).cookie;
  const p=await request('/api/auth/register',{email:'publisher@example.test',name:'Local Publisher',password,role:'admin',publisher_active:1},'',201);const publisher=p.cookie;
  assert.equal(p.data.user.role,'viewer');assert.equal(p.data.user.publisher_active,0);
  assert.deepEqual(p.data.user.dramio_pass,{active:false,test:false,purchased_at:null});
  const viewer=(await request('/api/auth/register',{email:'viewer@example.test',name:'Local Viewer',password},'',201)).cookie;
  assert.deepEqual((await request('/api/account/identities',undefined,viewer)).data,{google:{linked:false},password:true});
  await request('/api/auth/login',{email:'viewer@example.test',password:'wrong'},'',401);
  await request('/api/admin',undefined,publisher,403);
  await request('/api/studio/series',{},publisher,403);
  const activation=(await request('/api/payments/checkout',{kind:'activation'},publisher)).data;assert.equal(activation.amount_cents,8800);assert.equal(activation.currency,'hkd');
  await request(`/api/payments/${activation.paymentId}/demo-confirm`,{},viewer,404);
  await Promise.all([0,1].map(()=>request(`/api/payments/${activation.paymentId}/demo-confirm`,{},publisher)));
  const activated=(await request('/api/auth/me',undefined,publisher)).data.user;assert.equal(activated.publisher_active,1);assert.equal(activated.quota_bytes,5*1024**3);
  assert.equal(activated.dramio_pass.active,true);assert.equal(activated.dramio_pass.test,true);assert.match(activated.dramio_pass.purchased_at,/^\d{4}-\d{2}-\d{2}T/);
  const funding=(await request('/api/payments/checkout',{kind:'funding',amount_cents:1000},viewer)).data;
  await Promise.all([0,1].map(()=>request(`/api/payments/${funding.paymentId}/demo-confirm`,{},viewer)));
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,10_000_000);
  console.log('PASS: scrypt authentication, first-admin bootstrap, authorization, activation, and replay-safe funding.');

  const body={title:'Cloudflare Published Drama',description:'A real upload used to validate durable financial and media storage.',language:'zh-TW',genres:['romance'],creation_type:'human',price_cents:501,free_episodes:1};
  const sid=(await request('/api/studio/series',body,publisher,201)).data.id;
  const video=await readFile('public/demo-preview.mp4');
  const cover=await readFile('public/images/midnight.jpg');
  await upload(`/api/studio/series/${sid}/cover`,cover,'cover.jpg',publisher,{},'cover',200);
  const first=await upload(`/api/studio/series/${sid}/episodes`,video,'Episode 01.mp4',publisher,{title:'First episode',number:1});
  const second=await upload(`/api/studio/series/${sid}/episodes`,video,'Episode 02.mp4',publisher,{title:'Second episode',number:2});
  assert.equal(first.bytes,video.length);assert.ok(first.duration>0&&first.duration<=180);
  const used=(await request('/api/auth/me',undefined,publisher)).data.user.used_bytes;assert.equal(used,video.length*2+cover.length);
  const longfile=path.join(dir,'long.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=1:d=181','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',longfile]);
  const rejected=await upload(`/api/studio/series/${sid}/episodes`,await readFile(longfile),'long.mp4',publisher,{title:'Too long',number:3},'video',422);assert.equal(rejected.error.code,'VIDEO_TOO_LONG');
  const large=await upload(`/api/studio/series/${sid}/episodes`,Buffer.alloc(75*1024**2+1),'oversized.mp4',publisher,{title:'Too large',number:3},'video',413);assert.equal(large.error.code,'FILE_TOO_LARGE');
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.used_bytes,used);
  await request(`/api/studio/series/${sid}/status`,{status:'published'},publisher);
  const image=await fetch(base+`/api/series/${sid}/cover`);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await image.arrayBuffer()),cover);
  const free=await fetch(base+`/api/episodes/${first.id}/stream`,{headers:{Range:'bytes=0-31'}});assert.equal(free.status,206);assert.equal((await free.arrayBuffer()).byteLength,32);
  await request(`/api/episodes/${second.id}/stream`,undefined,'',403);
  console.log('PASS: R2 covers and videos, quota accounting, publication, byte ranges, 181-second and 75 MiB rejection.');

  const liked=(await request(`/api/series/${sid}/like`,{liked:true},viewer,200,'PUT')).data;assert.equal(liked.likes,1);
  const duplicateLike=(await request(`/api/series/${sid}/like`,{liked:true},viewer,200,'PUT')).data;assert.equal(duplicateLike.likes,1);
  const publicSeries=(await request(`/api/series/${sid}`,undefined,viewer)).data;
  assert.equal(publicSeries.series.likes,1);assert.equal(publicSeries.series.liked,true);assert.equal(publicSeries.series.saved,false);
  assert.equal(publicSeries.series.views,0,'Metadata and byte ranges must not count as views.');
  const guestPlayback=await request(`/api/episodes/${first.id}/playback`,{});assert.match(guestPlayback.cookie,/^drama_viewer=/);
  await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,viewer,403);
  await new Promise(resolve=>setTimeout(resolve,3300));
  const qualified=(await request(`/api/playback/${guestPlayback.data.sessionId}`,{watchedMs:3200},guestPlayback.cookie,200,'PUT')).data;
  assert.equal(qualified.viewCounted,true);assert.equal(qualified.watchedMs,3200);
  const analytics=(await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data;
  assert.equal(analytics.totals.views,1);assert.equal(analytics.totals.avgWatchSeconds,3.2);assert.equal(analytics.totals.likes,1);assert.equal(analytics.daily.length,7);
  assert.equal(analytics.episodes.find(episode=>episode.id===first.id).views,1);
  console.log('PASS: durable likes, anonymous qualified playback, exact watch time, and owner-only series/episode analytics.');

  await Promise.all(Array.from({length:8},()=>request(`/api/episodes/${second.id}/unlock`,{},viewer)));
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,4_990_000);
  const studio=(await request('/api/studio',undefined,publisher)).data;assert.equal(studio.user.earnings_micros,3_507_000);assert.equal(studio.stats.sales,1);
  const report=(await request('/api/admin',undefined,admin)).data;assert.equal(report.stats.sales.platform_micros,1_503_000);
  const paid=await fetch(base+`/api/episodes/${second.id}/stream`,{headers:{Cookie:viewer,Range:'bytes=0-15'}});assert.equal(paid.status,206);assert.equal((await paid.arrayBuffer()).byteLength,16);
  await request('/api/studio/withdrawals',{amount_cents:100},publisher,400);
  const withdrawal=(await request('/api/studio/withdrawals',{amount_cents:300,note:'Local test only'},publisher,201)).data;
  assert.equal(withdrawal.user.earnings_micros,507_000);
  await request(`/api/admin/withdrawals/${withdrawal.id}`,{approve:true},admin);
  await request(`/api/admin/withdrawals/${withdrawal.id}`,{approve:true},admin,409);
  await request('/api/studio/storage-requests',{requested_gb:10,reason:'More storage for additional drama episodes.'},publisher,201);
  const pending=(await request('/api/admin',undefined,admin)).data.storageRequests[0];
  await request(`/api/admin/storage-requests/${pending.id}`,{approve:true},admin);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.quota_bytes,10*1024**3);
  console.log('PASS: concurrent purchases debit once, exact fractional-cent 70/30 split, payout minimum/approval, storage approval.');

  await stop();await start(true,true);
  const stripeTest=(await request('/api/config')).data;
  assert.equal(stripeTest.paymentsMode,'stripe');assert.equal(stripeTest.paymentsTestMode,true);assert.equal(stripeTest.paymentsReady,true);assert.equal(stripeTest.sandbox,false);assert.equal(stripeTest.uploadsEnabled,true);assert.equal(stripeTest.auth.google,true);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,0);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.earnings_micros,0);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.publisher_active,1);
  const testWallet=(await request('/api/wallet',undefined,viewer)).data;assert.deepEqual(testWallet.ledger,[]);assert.deepEqual(testWallet.payments,[]);
  const retainedUnlock=(await request(`/api/episodes/${second.id}/unlock`,{},viewer)).data;assert.equal(retainedUnlock.alreadyUnlocked,true);assert.equal(retainedUnlock.user.wallet_micros,0);
  await request('/api/studio/connect',{},publisher,503);
  await request('/api/studio/withdrawals',{amount_cents:300},publisher,503);
  console.log('PASS: same-site Stripe test mode retains Google, uploads and real entitlements, exposes separate zero test balances, and blocks payouts.');

  await stop();await start(true);
  const production=(await request('/api/config')).data;assert.equal(production.paymentsMode,'disabled');assert.equal(production.runtime,'cloudflare');assert.equal(production.auth.google,false);
  const retainedLikes=(await request(`/api/series/${sid}`,undefined,viewer)).data;assert.equal(retainedLikes.series.likes,1);assert.equal(retainedLikes.series.liked,true);
  const resumedGuest=(await request(`/api/episodes/${first.id}/playback`,{},guestPlayback.cookie)).data;assert.equal(resumedGuest.sessionId,guestPlayback.data.sessionId);assert.equal(resumedGuest.viewCounted,true);
  const retainedAnalytics=(await request(`/api/studio/series/${sid}/analytics?period=7d`,undefined,publisher)).data;assert.equal(retainedAnalytics.totals.views,1);assert.equal(retainedAnalytics.totals.avgWatchSeconds,3.2);assert.equal(retainedAnalytics.totals.paidViewers,1);assert.equal(retainedAnalytics.episodes.find(episode=>episode.id===second.id).paidViewers,1);
  await request('/api/auth/google/start',undefined,'',503);
  assert.equal((await request('/api/auth/me',undefined,viewer)).data.user.wallet_micros,4_990_000);
  assert.equal((await request('/api/auth/me',undefined,publisher)).data.user.earnings_micros,507_000);
  const retainedPass=(await request('/api/auth/me',undefined,publisher)).data.user.dramio_pass;assert.equal(retainedPass.active,true);assert.equal(retainedPass.purchased_at,activated.dramio_pass.purchased_at);
  const persisted=await fetch(base+`/api/episodes/${second.id}/stream`,{headers:{Cookie:viewer,Range:'bytes=0-31'}});assert.equal(persisted.status,206);assert.equal((await persisted.arrayBuffer()).byteLength,32);
  await request('/api/payments/checkout',{kind:'funding',amount_cents:500},viewer,503);
  await request(`/api/payments/${funding.paymentId}/demo-confirm`,{},viewer,404);
  const login=await request('/api/auth/login',{email:'viewer@example.test',password});assert.match(login.headers.get('set-cookie'),/Secure/);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const page=await fetch(base+'/studio');assert.equal(page.status,200);assert.match(await page.text(),/<div id="root"><\/div>/);
  console.log('PASS: full runtime restart retains sessions, wallet balances, purchases, and R2 media; production test payments disabled; secure cookies.');
  console.log('Cloudflare local integration smoke passed. No Cloudflare account resources were created.');
}catch(error){console.error(error);console.error(logs.slice(-12000));process.exitCode=1;}
finally{await stop();await rm(dir,{recursive:true,force:true});}
