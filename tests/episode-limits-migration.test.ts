import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {DATABASE_SCHEMA} from '../shared/schema';
import {MAX_EPISODE_SECONDS,MAX_PRICE_CENTS} from '../shared/config';
import {SERIES_LIMITS,seriesDetailsErrors} from '../shared/series-validation';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-episode-limits-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';delete process.env.S3_BUCKET;
const file=path.join(directory,'platform.sqlite'),legacy=new DatabaseSync(file);
legacy.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE episodes (
 id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,title TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number>0),duration REAL NOT NULL CHECK(duration>0 AND duration<=180),
 bytes INTEGER NOT NULL CHECK(bytes>0),storage_key TEXT NOT NULL,original_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(series_id,number)
);
CREATE TABLE episode_durations (episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,seconds REAL NOT NULL CHECK(seconds>0 AND seconds<=240));
CREATE TABLE playback_session_times (session_id TEXT PRIMARY KEY REFERENCES playback_sessions(id) ON DELETE CASCADE,watched_ms INTEGER NOT NULL CHECK(watched_ms>=0 AND watched_ms<=240000),reported_ms INTEGER NOT NULL CHECK(reported_ms>=0 AND reported_ms<=240000));`);
legacy.exec(DATABASE_SCHEMA);
interface Actor{id:string;cookie:string}
function seedActor(connection:DatabaseSync,id:string,role='viewer'):Actor{
  connection.prepare('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros,used_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,id+'@episode-limits.test','Retained '+role,'unused-local-hash',role,role==='viewer'?0:1,10_000_000,7_000_000,98765,'2020-02-03 04:05:06');
  connection.prepare('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)').run(id,10_000_000,8_000_000,0);
  const token=randomBytes(32).toString('hex');connection.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
const owner=seedActor(legacy,'retained-owner','publisher'),oldBuyer=seedActor(legacy,'retained-buyer'),admin=seedActor(legacy,'retained-admin','admin');
const details={title:'An original limited-price drama',description:'A complete original short drama synopsis for episode limit regressions.',language:'en',genres:['drama'],creation_type:'human',price_cents:100,free_episodes:0};
const retainedSeries='retained-expensive-series',retainedEpisode='retained-purchased-episode',mediaKey='limits/retained.mp4',media=Buffer.from('Retained private video bytes, not transcoded during migration.');
for(const[id,price,status]of [[retainedSeries,501,'published'],['retained-draft',777,'draft'],['retained-archived',901,'archived'],['retained-at-cap',100,'published'],['retained-cheaper',51,'draft']] as const)legacy.prepare('INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status,cover_key,cover_bytes,views,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner.id,id,details.description,'zh-TW','["drama"]',price,0,status,'limits/retained-cover.webp',42,17,'2021-02-03 04:05:06','2022-03-04 05:06:07');
legacy.prepare('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)').run(retainedEpisode,retainedSeries,'Retained 240-second episode',1,180,media.length,mediaKey,'retained-export.mp4');legacy.prepare('INSERT INTO episode_durations VALUES (?,?)').run(retainedEpisode,240);
legacy.prepare('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,watched_ms,reported_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run('retained-playback',retainedEpisode,createHash('sha256').update('retained-playback-viewer').digest('hex'),Date.now()-240000,Date.now(),180000,180000,1,Date.now());legacy.prepare('INSERT INTO playback_session_times VALUES (?,?,?)').run('retained-playback',240000,240000);
for(const table of ['purchases','test_purchases'])legacy.prepare('INSERT INTO '+table+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros,created_at) VALUES (?,?,?,?,?,?,?)').run(table+'-old-501',oldBuyer.id,retainedEpisode,5_010_000,3_507_000,1_503_000,'2022-04-05 06:07:08');
for(const table of ['ledger','test_ledger'])legacy.prepare('INSERT INTO '+table+' (id,user_id,kind,amount_micros,reference_id,description,created_at) VALUES (?,?,?,?,?,?,?)').run(table+'-old-501',oldBuyer.id,'unlock',-5_010_000,table.replace('ledger','purchases')+'-old-501','Original 501-cent receipt','2022-04-05 06:07:08');
for(const table of ['payments','test_payments'])legacy.prepare('INSERT INTO '+table+' (id,user_id,kind,amount_cents,currency,provider,provider_session,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(table+'-retained',oldBuyer.id,'funding',500,'usd','stripe','cs_retained_'+table,'paid','2022-04-05 06:07:08');
legacy.prepare('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)').run(oldBuyer.id,retainedEpisode,239);
const financialTables=['users','test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','withdrawals','withdrawal_terms','creator_pass_consents'];
function financial(connection:DatabaseSync){const state:Record<string,unknown>={};for(const table of financialTables)state[table]=connection.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();return state;}
function mediaState(connection:DatabaseSync){const state:Record<string,unknown>={series:connection.prepare('SELECT * FROM series ORDER BY id').all().map(({price_cents,...series})=>series)};for(const table of ['episodes','episode_durations','playback_sessions','playback_session_times','progress'])state[table]=connection.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();return state;}
const originalMoney=financial(legacy),originalMedia=mediaState(legacy),rootPages=legacy.prepare("SELECT name,rootpage,sql FROM sqlite_master WHERE name IN ('users','series','episodes','episode_durations','playback_sessions','playback_session_times','purchases','test_purchases') ORDER BY name").all();legacy.close();
await mkdir(path.join(directory,'objects','limits'),{recursive:true});await writeFile(path.join(directory,'objects',mediaKey),media);
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const {episodeDurationSql,writeEpisodeDuration}=await import('../server/episode-duration');
const {playbackTimeSql}=await import('../server/playback-times');
const {applyEpisodePriceCap,EPISODE_PRICE_CAP_POLICY}=await import('../server/episode-pricing');
const {setSeriesModeration}=await import('../server/moderation');
const origin='https://episode-limits.example.test';let server:Server,base:string;
function identity(role='viewer'){return seedActor(db,randomUUID(),role);}
function series(price=100,free=0){const id=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status,cover_key) VALUES (?,?,?,?,?,?,?,?,?,?)',id,owner.id,'Limits '+id,details.description,'en','["drama"]',price,free,'published','public:/images/midnight.jpg');return id;}
function episode(seriesId:string,number=1){const id=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',id,seriesId,'Episode '+number,number,180,media.length,mediaKey);return id;}
async function request(route:string,actor?:Actor,body?:unknown,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
before(async()=>{config.appUrl=origin;config.mailProvider='disabled';const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
beforeEach(()=>{config.stripeTestMode=false;config.payments='disabled';config.sandbox=false;});
afterEach(()=>mock.restoreAll());
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('startup caps only current asking prices with SYSTEM audit while legacy media, constraints and both financial partitions remain intact',async()=>{
  assert.equal(MAX_EPISODE_SECONDS,300);assert.equal(MAX_PRICE_CENTS,100);assert.equal(SERIES_LIMITS.priceMax,100);
  for(const id of [retainedSeries,'retained-draft','retained-archived','retained-at-cap'])assert.equal(one('SELECT price_cents FROM series WHERE id=?',id)!.price_cents,100);assert.equal(one('SELECT price_cents FROM series WHERE id=?','retained-cheaper')!.price_cents,51);
  const audits=all('SELECT * FROM episode_price_cap_events ORDER BY before_price_cents');assert.equal(audits.length,3);assert.deepEqual(audits.map(row=>[row.before_price_cents,row.after_price_cents,row.actor_type,row.policy_key]),[[501,100,'SYSTEM',EPISODE_PRICE_CAP_POLICY],[777,100,'SYSTEM',EPISODE_PRICE_CAP_POLICY],[901,100,'SYSTEM',EPISODE_PRICE_CAP_POLICY]]);for(const audit of audits)assert.ok(Number.isFinite(Date.parse(audit.created_at+'Z')));
  assert.deepEqual(financial(db),originalMoney);assert.deepEqual(mediaState(db),originalMedia);assert.deepEqual(all("SELECT name,rootpage,sql FROM sqlite_master WHERE name IN ('users','series','episodes','episode_durations','playback_sessions','playback_session_times','purchases','test_purchases') ORDER BY name"),rootPages);assert.deepEqual(all('PRAGMA foreign_key_check'),[]);assert.deepEqual(await readFile(path.join(directory,'objects',mediaKey)),media);
  assert.equal(one(`SELECT ${episodeDurationSql()} AS duration FROM episodes e WHERE id=?`,retainedEpisode)!.duration,240);assert.equal(one(`SELECT ${playbackTimeSql()} AS watched FROM playback_sessions p WHERE id=?`,'retained-playback')!.watched,240000);
});

test('repeated startup is idempotent and migration audit cannot be rewritten, deleted or replaced',()=>{
  const before=all('SELECT * FROM episode_price_cap_events ORDER BY id'),money=financial(db);createApp();db.exec(DATABASE_SCHEMA);createApp();assert.equal(applyEpisodePriceCap(),0);assert.deepEqual(all('SELECT * FROM episode_price_cap_events ORDER BY id'),before);
  const audit=before[0];assert.throws(()=>run('UPDATE episode_price_cap_events SET before_price_cents=1 WHERE id=?',audit.id),/append-only/);assert.throws(()=>run('DELETE FROM episode_price_cap_events WHERE id=?',audit.id),/append-only/);
  run('INSERT OR REPLACE INTO episode_price_cap_events (id,series_id,policy_key,before_price_cents,after_price_cents,created_at) VALUES (?,?,?,?,?,?)',audit.id,audit.series_id,'forged-policy',9999,10,'1999-01-01 00:00:00');assert.deepEqual(all('SELECT * FROM episode_price_cap_events ORDER BY id'),before);assert.deepEqual(financial(db),money);
});

test('an audit insertion failure rolls back every cap and audit in the startup transaction without touching historical money',()=>{
  const first=series(150),second=series(160),money=financial(db),audits=all('SELECT * FROM episode_price_cap_events ORDER BY id');
  run(`CREATE TRIGGER local_price_audit_failure BEFORE INSERT ON episode_price_cap_events WHEN NEW.series_id='${second}' BEGIN SELECT RAISE(ABORT,'local audit failure'); END;`);
  try{assert.throws(()=>createApp(),/local audit failure/);assert.equal(one('SELECT price_cents FROM series WHERE id=?',first)!.price_cents,150);assert.equal(one('SELECT price_cents FROM series WHERE id=?',second)!.price_cents,160);assert.deepEqual(all('SELECT * FROM episode_price_cap_events ORDER BY id'),audits);assert.deepEqual(financial(db),money);}finally{run('DROP TRIGGER local_price_audit_failure');}
  createApp();for(const id of [first,second]){assert.equal(one('SELECT price_cents FROM series WHERE id=?',id)!.price_cents,100);assert.equal(one('SELECT COUNT(*) AS n FROM episode_price_cap_events WHERE series_id=?',id)!.n,1);}assert.deepEqual(financial(db),money);
});

test('price 100 is accepted and 101 rejected by API and shared validation without weakening ownership or moderation',async()=>{
  const publicConfig=await request('/api/config');assert.equal(publicConfig.limits.maximumPriceUsd,1);assert.equal(publicConfig.limits.maxEpisodeSeconds,300);
  assert.equal(seriesDetailsErrors(details).price_cents,undefined);for(const price of [101,10000,100.1])assert.equal(seriesDetailsErrors({...details,price_cents:price}).price_cents,'seriesPriceInvalid');
  const id=(await request('/api/studio/series',owner,details,201)).id,money=financial(db),before=one('SELECT * FROM series WHERE id=?',id),count=one('SELECT COUNT(*) AS n FROM series')!.n;
  await request('/api/studio/series',owner,{...details,price_cents:101},400);await request('/api/studio/series/'+id,owner,{...details,title:'Must not persist invalid update',price_cents:101},400,'PATCH');assert.deepEqual(one('SELECT * FROM series WHERE id=?',id),before);assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);
  const other=identity('publisher');await request('/api/studio/series/'+id,other,details,403,'PATCH');setSeriesModeration(admin.id,id,'takedown','The ordinary publisher must not bypass a rights review.');await request('/api/studio/series/'+id,owner,details,423,'PATCH');setSeriesModeration(admin.id,id,'restore','The local regression rights review has been resolved.');await request('/api/studio/series/'+id,owner,details,200,'PATCH');
  const after=financial(db);for(const table of financialTables.filter(table=>table!=='users'&&table!=='test_accounts'))assert.deepEqual(after[table],money[table]);
});

test('historical 501-cent live and test purchase proofs remain entitled without refunds, another debit or rewritten revenue',async()=>{
  const before=financial(db);for(const testMode of [false,true]){config.stripeTestMode=testMode;const detail=await request('/api/series/'+retainedSeries,oldBuyer);assert.equal(detail.series.price_cents,100);assert.equal(detail.episodes[0].unlocked,true);const replay=await request('/api/episodes/'+retainedEpisode+'/unlock',oldBuyer,{});assert.equal(replay.alreadyUnlocked,true);}
  assert.deepEqual(financial(db),before);for(const table of ['purchases','test_purchases']){const receipt=one('SELECT * FROM '+table+' WHERE user_id=? AND episode_id=?',oldBuyer.id,retainedEpisode)!;assert.equal(receipt.price_micros,5_010_000);assert.equal(receipt.creator_micros,3_507_000);assert.equal(receipt.platform_micros,1_503_000);}
});

test('defensive serialization and unlock pricing clamp a post-startup raw legacy price with isolated exact 70/30 purchases',async()=>{
  const buyer=identity(),id=series(501),first=episode(id),second=episode(id,2),oldProof=one('SELECT * FROM purchases WHERE user_id=?',oldBuyer.id),liveOwner=one('SELECT earnings_micros FROM users WHERE id=?',owner.id)!.earnings_micros,testOwner=one('SELECT earnings_micros FROM test_accounts WHERE user_id=?',owner.id)!.earnings_micros;
  await request('/api/episodes/'+first+'/progress',owner,{seconds:1});
  const sources=[(await request('/api/series/'+id)).series,(await request('/api/series')).series.find((s:any)=>s.id===id),(await request('/api/studio/series/'+id,owner)).series,(await request('/api/studio',owner)).series.find((s:any)=>s.id===id),(await request('/api/admin/series?limit=50',admin)).series.find((s:any)=>s.id===id),(await request('/api/history',owner)).history.find((s:any)=>s.id===id)];for(const item of sources)assert.equal(item.price_cents,100);assert.equal(one('SELECT price_cents FROM series WHERE id=?',id)!.price_cents,501,'defensive reads do not rewrite the raw legacy value');
  for(const[testMode,episodeId,table]of [[false,first,'purchases'],[true,second,'test_purchases']] as const){config.stripeTestMode=testMode;const results=await Promise.all(Array.from({length:4},()=>request('/api/episodes/'+episodeId+'/unlock',buyer,{price_cents:501})));assert.equal(results.filter(result=>!result.alreadyUnlocked).length,1);const proof=one('SELECT * FROM '+table+' WHERE user_id=? AND episode_id=?',buyer.id,episodeId)!;assert.equal(proof.price_micros,1_000_000);assert.equal(proof.creator_micros,700_000);assert.equal(proof.platform_micros,300_000);const beforeReplay=financial(db);await request('/api/episodes/'+episodeId+'/unlock',buyer,{});assert.deepEqual(financial(db),beforeReplay);}
  assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',buyer.id)!.wallet_micros,9_000_000);assert.equal(one('SELECT wallet_micros FROM test_accounts WHERE user_id=?',buyer.id)!.wallet_micros,9_000_000);assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',owner.id)!.earnings_micros,liveOwner+700_000);assert.equal(one('SELECT earnings_micros FROM test_accounts WHERE user_id=?',owner.id)!.earnings_micros,testOwner+700_000);assert.deepEqual(one('SELECT * FROM purchases WHERE user_id=?',oldBuyer.id),oldProof);assert.equal(one('SELECT COUNT(*) AS n FROM purchases WHERE user_id=? AND episode_id=?',buyer.id,second)!.n,0);assert.equal(one('SELECT COUNT(*) AS n FROM test_purchases WHERE user_id=? AND episode_id=?',buyer.id,first)!.n,0);
});

test('additive duration tables retain real old CHECK constraints, authoritative 300-second values, lower-value fallback and restart persistence',()=>{
  const id=series(),ep=episode(id),money=financial(db);assert.throws(()=>run('UPDATE episodes SET duration=300 WHERE id=?',ep),/CHECK constraint/);writeEpisodeDuration(ep,300);assert.equal(one('SELECT duration FROM episodes WHERE id=?',ep)!.duration,180);assert.equal(one('SELECT seconds FROM episode_durations WHERE episode_id=?',ep)!.seconds,240);assert.equal(one('SELECT seconds FROM episode_durations_extended WHERE episode_id=?',ep)!.seconds,300);
  assert.throws(()=>run('UPDATE episode_durations SET seconds=300 WHERE episode_id=?',ep),/CHECK constraint/);assert.throws(()=>writeEpisodeDuration(ep,300.001),{status:422,code:'VIDEO_TOO_LONG'});assert.throws(()=>run('UPDATE episode_durations_extended SET seconds=301 WHERE episode_id=?',ep),/CHECK constraint/);
  writeEpisodeDuration(ep,200);assert.equal(one('SELECT 1 FROM episode_durations_extended WHERE episode_id=?',ep),undefined);assert.equal(one(`SELECT ${episodeDurationSql()} AS duration FROM episodes e WHERE id=?`,ep)!.duration,200);writeEpisodeDuration(ep,180);assert.equal(one('SELECT 1 FROM episode_durations WHERE episode_id=?',ep),undefined);writeEpisodeDuration(ep,300);
  const reopened=new DatabaseSync(file);try{reopened.exec('PRAGMA foreign_keys=ON;');reopened.exec(DATABASE_SCHEMA);assert.equal(reopened.prepare(`SELECT ${episodeDurationSql()} AS duration FROM episodes e WHERE id=?`).get(ep)!.duration,300);assert.deepEqual(reopened.prepare("SELECT name,rootpage,sql FROM sqlite_master WHERE name IN ('users','series','episodes','episode_durations','playback_sessions','playback_session_times','purchases','test_purchases') ORDER BY name").all(),rootPages);assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}assert.deepEqual(financial(db),money);
});

test('full five-minute playback, progress, history, batch and lifecycle summaries use actual time without duplicate views',async()=>{
  const viewer=identity(),id=series(100,1),ep=episode(id);writeEpisodeDuration(ep,300);let now=Date.now();mock.method(Date,'now',()=>now);const started=await request('/api/episodes/'+ep+'/playback',viewer,{}),route='/api/playback/'+started.sessionId;
  for(let watchedMs=15000;watchedMs<=300000;watchedMs+=15000){now+=15000;const receipt=await request(route,viewer,{watchedMs},200,'PUT');assert.equal(receipt.watchedMs,watchedMs);assert.equal(receipt.reportedMs,watchedMs);}
  assert.equal(one('SELECT watched_ms FROM playback_sessions WHERE id=?',started.sessionId)!.watched_ms,180000);assert.equal(one('SELECT watched_ms FROM playback_session_times WHERE session_id=?',started.sessionId)!.watched_ms,240000);const actual=one('SELECT * FROM playback_session_times_extended WHERE session_id=?',started.sessionId)!;assert.equal(actual.watched_ms,300000);assert.equal(actual.reported_ms,300000);
  assert.throws(()=>run('UPDATE playback_session_times SET watched_ms=300000 WHERE session_id=?',started.sessionId),/CHECK constraint/);assert.throws(()=>run('UPDATE playback_session_times_extended SET reported_ms=300001 WHERE session_id=?',started.sessionId),/CHECK constraint/);
  now+=5000;assert.equal((await request(route,viewer,{watchedMs:300000},200,'PUT')).watchedMs,300000);assert.equal((await request('/api/episodes/'+ep+'/playback',viewer,{})).sessionId,started.sessionId);assert.equal(one('SELECT views FROM series WHERE id=?',id)!.views,1);await request(route,viewer,{watchedMs:300001},400,'PUT');
  await request('/api/episodes/'+ep+'/progress',viewer,{seconds:300});await request('/api/episodes/'+ep+'/progress',viewer,{seconds:300.001},400);assert.equal(one('SELECT seconds FROM progress WHERE user_id=? AND episode_id=?',viewer.id,ep)!.seconds,300);const history=(await request('/api/history',viewer)).history.find((s:any)=>s.id===id);assert.equal(history.seconds,300);assert.equal(history.duration,300);
  const studio=await request('/api/studio/series/'+id,owner);assert.equal(studio.episodes[0].duration,300);const batch=await request('/api/studio/series/'+id+'/episodes/batch-delete-preview',owner,{revision:studio.episodes_revision,episode_ids:[ep]});assert.equal(batch.summary.total_watch_seconds,300);const renamed=await request('/api/studio/series/'+id+'/episodes/batch',owner,{action:'rename',revision:studio.episodes_revision,episode_ids:[ep],base_name:'Five-minute episode'});assert.equal(renamed.episodes[0].duration,300);
  const analytics=await request('/api/studio/series/'+id+'/analytics?period=all',owner);assert.equal(analytics.totals.views,1);assert.equal(analytics.totals.watchSeconds,300);assert.equal(analytics.episodes[0].duration,300);const lifecycle=await request('/api/studio/series/'+id+'/lifecycle',owner);assert.equal(lifecycle.summary.total_watch_seconds,300);assert.equal(lifecycle.summary.avg_watch_seconds,300);
  const publicDetail=await request('/api/series/'+id);assert.equal(publicDetail.episodes[0].duration,300);const stream=await fetch(base+'/api/episodes/'+ep+'/stream',{headers:{Range:'bytes=0-7'}});assert.equal(stream.status,206);assert.equal((await stream.arrayBuffer()).byteLength,8);db.exec(DATABASE_SCHEMA);createApp();assert.equal(one(`SELECT ${playbackTimeSql()} AS watched FROM playback_sessions p WHERE id=?`,started.sessionId)!.watched,300000);
  run('DELETE FROM playback_sessions WHERE id=?',started.sessionId);assert.equal(one('SELECT 1 FROM playback_session_times_extended WHERE session_id=?',started.sessionId),undefined);assert.equal(one('SELECT 1 FROM playback_session_times WHERE session_id=?',started.sessionId),undefined);
});
