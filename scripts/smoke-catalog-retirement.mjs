import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';

// Positive migration test against disposable local Durable Object SQL and R2.
// The canonical production origin is passed to the local emulator only: every
// HTTP request below is constrained to loopback and redirects are never followed.
const port=Number(process.env.RETIREMENT_SMOKE_PORT||8791);
assert.ok(Number.isSafeInteger(port)&&port>=1024&&port<=65135,'Choose a valid local test port.');
const base=`http://127.0.0.1:${port}`,canonical='https://lingyingdrama.com';
const dir=await mkdtemp(path.join(tmpdir(),'lingying-catalog-retirement-'));
const bootstrap=randomBytes(32).toString('hex'),password='LocalRetirementFixture123!';
let child,logs='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fingerprint=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={passed:false,remoteResourcesCreated:false,financialActions:false,requestsOnlyLoopback:true};

async function localFetch(route,options={}){
  const url=new URL(route,base);
  assert.equal(url.origin,base,'Migration smoke requests must stay on loopback.');
  return fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(25000)});
}
async function request(route,body,cookie='',status=200,method=body===undefined?'GET':'POST',headers={}){
  const response=await localFetch(route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;
  try{data=JSON.parse(text);}catch{throw new Error(`${route}: expected JSON, got HTTP ${response.status}: ${text.slice(0,200)}`);}
  assert.equal(response.status,status,`${route}: ${JSON.stringify(data)}`);
  return{data,cookie:response.headers.get('set-cookie')?.split(';')[0]||'',headers:response.headers};
}
async function upload(route,bytes,name,cookie,fields={},field='video',status=201){
  const form=new FormData();for(const[key,value]of Object.entries(fields))form.append(key,String(value));
  form.append(field,new Blob([bytes]),name);
  const response=await localFetch(route,{method:'POST',headers:{Cookie:cookie},body:form}),data=await response.json();
  assert.equal(response.status,status,`${route}: ${JSON.stringify(data)}`);return data;
}
async function bytesAt(route,cookie=''){
  const response=await localFetch(route,{headers:cookie?{Cookie:cookie}:{}});
  assert.equal(response.status,200,`${route}: media must stay available without a redirect.`);
  return Buffer.from(await response.arrayBuffer());
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const stopped=once(child,'exit');child.kill('SIGINT');
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  await stopped;clearTimeout(timer);child=undefined;
}
async function start(production=false,stateName='state'){
  logs='';const origin=production?canonical:base;
  const args=['node_modules/wrangler/bin/wrangler.js','dev','--local','--port',String(port),
    '--local-upstream',new URL(origin).host,'--upstream-protocol',new URL(origin).protocol.slice(0,-1),
    '--inspector-port',String(port+400),'--persist-to',path.join(dir,stateName),
    '--var',`ENVIRONMENT:${production?'production':'development'}`,'--var',`APP_URL:${origin}`,'--var',`PUBLIC_APP_URL:${origin}`,
    '--var','PAYMENTS_MODE:disabled','--var','PAYOUTS_ENABLED:false','--var','STRIPE_TEST_MODE:false','--var','STRIPE_AUTO_CONFIGURE_WEBHOOK:false',
    '--var',`STRIPE_SITE_ORIGIN:${base}`,'--var','PASS_PROMOTION_ENABLED:false',
    '--var','SEED_CATALOG:true','--var','PLATFORM_OWNER_USER_ID:','--var','PLATFORM_ADMIN_EMAIL_SHA256:',
    '--var',`BOOTSTRAP_TOKEN:${bootstrap}`];
  child=spawn(process.execPath,args,{env:{...process.env,XDG_CONFIG_HOME:path.join(dir,'config'),WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(dir,'wrangler.log')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
  for(let attempt=0;attempt<180;attempt++){
    if(child.exitCode!==null)throw new Error('Local Cloudflare retirement server exited before becoming ready.');
    let response;
    try{response=await localFetch('/api/health');}catch{await delay(500);continue;}
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error(`Local upstream did not rebase to its configured canonical origin (HTTP ${response.status}).`);}
    if(response.status===200){const health=await response.json();if(health.ok&&health.database)return;}
    else await response.body?.cancel();
    await delay(500);
  }
  throw new Error('Local Cloudflare retirement startup timed out.');
}
function normaliseOrigins(value){
  if(typeof value==='string')return value.replaceAll(canonical,base);
  if(Array.isArray(value))return value.map(normaliseOrigins);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normaliseOrigins(item)]));
  return value;
}
async function receipt(expectedStatus){
  for(let attempt=0;attempt<30;attempt++){
    for(const line of logs.split(/\r?\n/)){
      const begin=line.indexOf('{"event":"catalog_retirement"'),end=line.lastIndexOf('}');
      if(begin===-1||end<begin)continue;
      let data;try{data=JSON.parse(line.slice(begin,end+1));}catch{continue;}
      if(data.status===expectedStatus)return data;
      throw new Error(`Unexpected migration receipt status ${data.status}: ${data.reason||'no reason'}`);
    }
    await delay(100);
  }
  throw new Error(`No ${expectedStatus} catalogue retirement receipt was emitted.`);
}
function assertApplied(receipt,seedIds){
  assert.equal(receipt.operation,'retire-built-in-catalogue-v1');
  assert.deepEqual([...receipt.retired_ids].sort(),[...seedIds].sort());assert.deepEqual(receipt.skipped,[]);
  assert.deepEqual(receipt.protected_summary,{anchor_count:1,series_count:1,episode_count:1});
  for(const key of ['preserved','protected']){assert.match(receipt.before_hashes[key],/^[a-f0-9]{64}$/);assert.equal(receipt.after_hashes[key],receipt.before_hashes[key]);}
}

try{
  await start();
  const initial=(await request('/api/series')).data.series;
  assert.equal(initial.length,20);assert.ok(initial.every(series=>series.demo===1));
  const seedIds=initial.map(series=>series.id);
  await request('/api/admin/bootstrap',{email:'retirement-admin@example.test',name:'Retirement Admin',password},'',201,'POST',{'x-bootstrap-token':bootstrap});
  const admin=(await request('/api/auth/login',{email:'retirement-admin@example.test',password})).cookie;assert.ok(admin);
  const profile=(await request('/api/admin/publishers',{display_name:'DreamShortDrama',registered_at:'2020-01-15'},admin,201)).data.publisher;
  const body={title:"The Godfather's Caged Bird",description:'Protected real publisher upload for a local catalogue retirement test.',language:'en',genres:['drama'],themes:[],format:'live-action',creation_type:'human',price_cents:10,free_episodes:1,publisher_profile_id:profile.id,cover_aspect_ratio:'16:9',subtitle_languages:['en','zh-TW']};
  const seriesId=(await request('/api/studio/series',body,admin,201)).data.id,studioPath=`/api/studio/series/${seriesId}`;
  const cover=await readFile('public/images/midnight.jpg'),video=await readFile('public/demo-preview.mp4');
  await upload(studioPath+'/cover',cover,'protected-cover.jpg',admin,{},'cover',200);
  const episode=await upload(studioPath+'/episodes',video,'Protected 001.mp4',admin,{title:'Protected episode 001',number:1});
  await request(studioPath+'/status',{status:'published'},admin);
  // Initialise optional read-only configuration before taking preservation
  // snapshots, so lazy setup is not mistaken for an effect of retirement.
  const developmentConfig=(await request('/api/config')).data;assert.equal(developmentConfig.paymentsMode,'disabled');
  const before={user:(await request('/api/auth/me',undefined,admin)).data.user,wallet:(await request('/api/wallet',undefined,admin)).data,
    studio:(await request(studioPath,undefined,admin)).data,series:(await request(`/api/series/${seriesId}`)).data,
    publisher:(await request(`/api/publishers/${profile.id}`)).data,admin:(await request('/api/admin',undefined,admin)).data};
  assert.equal((await request('/api/series')).data.series.length,21);
  const beforeAdminSeries=(await request('/api/admin/series?limit=50',undefined,admin)).data;assert.equal(beforeAdminSeries.total,21);
  assert.deepEqual(await bytesAt(`/api/series/${seriesId}/cover`),cover);assert.deepEqual(await bytesAt(`/api/episodes/${episode.id}/stream`),video);
  assert.equal(before.user.used_bytes,cover.length+video.length);assert.equal(before.user.wallet_micros,0);assert.equal(before.user.earnings_micros,0);
  assert.deepEqual(before.wallet.payments,[]);assert.deepEqual(before.wallet.ledger,[]);
  await stop();await start(true);
  const applied=await receipt('applied');assertApplied(applied,seedIds);
  const afterConfig=(await request('/api/config')).data;assert.equal(afterConfig.paymentsMode,'disabled');assert.equal(afterConfig.payoutsEnabled,false);
  const remaining=(await request('/api/series')).data.series;assert.deepEqual(remaining.map(series=>series.id),[seriesId]);assert.equal(remaining[0].creator_name,'DreamShortDrama');
  assert.deepEqual((await request('/api/auth/me',undefined,admin)).data.user,before.user);
  assert.deepEqual((await request('/api/wallet',undefined,admin)).data,before.wallet);
  assert.deepEqual(normaliseOrigins((await request(studioPath,undefined,admin)).data),normaliseOrigins(before.studio));
  assert.deepEqual(normaliseOrigins((await request(`/api/series/${seriesId}`)).data),normaliseOrigins(before.series));
  assert.deepEqual(normaliseOrigins((await request(`/api/publishers/${profile.id}`)).data),normaliseOrigins(before.publisher));
  assert.deepEqual((await request('/api/admin',undefined,admin)).data,before.admin);
  const afterAdminSeries=(await request('/api/admin/series?limit=50',undefined,admin)).data;assert.equal(afterAdminSeries.total,1);assert.deepEqual(afterAdminSeries.series.map(series=>series.id),[seriesId]);
  const studio=(await request('/api/studio',undefined,admin)).data;assert.deepEqual(studio.series.map(series=>series.id),[seriesId]);
  assert.deepEqual(await bytesAt(`/api/series/${seriesId}/cover`),cover);assert.deepEqual(await bytesAt(`/api/episodes/${episode.id}/stream`),video);
  for(const id of seedIds){
    await request(`/api/series/${id}`,undefined,'',404);
    await request(`/api/episodes/${id}-1/stream`,undefined,'',404);
    await request(`/api/studio/series/${id}`,undefined,admin,404);
  }
  await stop();await start(true);
  const repeated=await receipt('already_applied');assertApplied(repeated,seedIds);
  assert.deepEqual(repeated.before_hashes,applied.before_hashes);assert.deepEqual(repeated.after_hashes,applied.after_hashes);
  assert.deepEqual((await request('/api/series')).data.series.map(series=>series.id),[seriesId]);
  assert.deepEqual((await request('/api/auth/me',undefined,admin)).data.user,before.user);
  assert.deepEqual(await bytesAt(`/api/series/${seriesId}/cover`),cover);assert.deepEqual(await bytesAt(`/api/episodes/${episode.id}/stream`),video);
  // An empty, separate production state directly exercises the hard seeding
  // guard: existing archived rows alone would also stop the older seed check.
  await stop();await start(true,'empty-production-state');
  const emptyProduction=await receipt('blocked');assert.equal(emptyProduction.reason,'protected_anchor_missing');
  assert.deepEqual((await request('/api/series')).data.series,[],'Production must never seed examples, even when its database is empty and SEED_CATALOG is stale.');
  report.passed=true;report.checks={initialSamples:20,retiredSamples:20,survivingRealSeries:1,protectedEpisodes:1,privateAndPublicMetadataPreserved:true,accountAndWalletPreserved:true,quotaPreserved:true,retiredPublicAndPrivateRoutesDenied:true,staleSeedFlagCannotRecreateExamples:true,emptyProductionDoesNotSeed:true,idempotentAfterRestart:true};
  report.media={coverBytes:cover.length,coverSha256:fingerprint(cover),episodeBytes:video.length,episodeSha256:fingerprint(video)};
  report.applied=applied;report.repeated=repeated;report.emptyProduction=emptyProduction;
}catch(error){report.error={name:error.name,message:error.message};console.error(logs.slice(-12000).replaceAll(bootstrap,'[local bootstrap redacted]'));process.exitCode=1;}
finally{await stop();await rm(dir,{recursive:true,force:true});console.log(JSON.stringify(report));}
