import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DATABASE_SCHEMA} from '../shared/schema';
import {MAX_EPISODE_SECONDS,MAX_TRACKED_EPISODE_SECONDS} from '../shared/config';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-owner-long-duration-'));
Object.assign(process.env,{DATA_DIR:directory,NODE_ENV:'test',SEED_DEMO:'false',PAYMENTS_MODE:'disabled',STRIPE_TEST_MODE:'false',PLATFORM_OWNER_USER_ID:'long-duration-owner',PLATFORM_ADMIN_EMAIL_SHA256:''});
const file=path.join(directory,'platform.sqlite'),legacy=new DatabaseSync(file);
// Reproduce the real historical CHECK constraints before initializing current
// schema. No financial-reference table is replaced to widen a duration field.
legacy.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE episodes (
 id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,title TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number>0),duration REAL NOT NULL CHECK(duration>0 AND duration<=180),
 bytes INTEGER NOT NULL CHECK(bytes>0),storage_key TEXT NOT NULL,original_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(series_id,number)
);`);
legacy.exec(DATABASE_SCHEMA);
// Model a deployment before the new, empty long-duration tier existed.
legacy.exec('DROP TABLE playback_session_times_long; DROP TABLE episode_durations_long;');
const owner='long-duration-owner',buyer='long-duration-buyer',ordinary='ordinary-duration-publisher',otherAdmin='other-duration-admin',retainedSeries='retained-duration-series';
for(const[id,role]of [[owner,'admin'],[buyer,'viewer'],[ordinary,'publisher'],[otherAdmin,'admin']] as const){
  legacy.prepare('INSERT INTO users(id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros,used_bytes) VALUES (?,?,?,?,?,?,?,?,?)').run(id,id+'@duration.test','Retained '+role,'!unused',role,role==='viewer'?0:1,5_000_000,7_000_000,98765);
  legacy.prepare('INSERT INTO test_accounts(user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)').run(id,6_000_000,8_000_000,role==='viewer'?0:1);
}
legacy.prepare('INSERT INTO series(id,creator_id,title,description,language,genres,status,views) VALUES (?,?,?,?,?,?,?,?)').run(retainedSeries,owner,'Retained duration series','Original historical series description.','en','["drama"]','published',17);
for(const[number,duration]of [[1,180],[2,240],[3,300]]){
  const id='retained-duration-'+duration;
  legacy.prepare('INSERT INTO episodes(id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)').run(id,retainedSeries,'Retained '+duration,number,180,64,'retained/'+id+'.mp4');
  if(duration>180)legacy.prepare('INSERT INTO episode_durations VALUES (?,?)').run(id,Math.min(duration,240));
  if(duration>240)legacy.prepare('INSERT INTO episode_durations_extended VALUES (?,?)').run(id,duration);
}
for(const table of ['purchases','test_purchases'])legacy.prepare('INSERT INTO '+table+'(id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)').run(table+'-historical',buyer,'retained-duration-240',1_000_000,700_000,300_000);
for(const table of ['ledger','test_ledger'])legacy.prepare('INSERT INTO '+table+'(id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)').run(table+'-historical',buyer,'unlock',-1_000_000,'historical-purchase','Original receipt');
for(const table of ['payments','test_payments'])legacy.prepare('INSERT INTO '+table+'(id,user_id,kind,amount_cents,currency,provider,provider_session,status) VALUES (?,?,?,?,?,?,?,?)').run(table+'-historical',buyer,'funding',1000,'usd','stripe','cs_'+table+'_historical','paid');
legacy.prepare('INSERT INTO progress(user_id,episode_id,seconds) VALUES (?,?,?)').run(buyer,'retained-duration-240',239);
const financialTables=['users','test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','withdrawals','withdrawal_terms','creator_pass_consents'];
function finances(connection:DatabaseSync){return Object.fromEntries(financialTables.map(table=>[table,connection.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}
const originalMoney=finances(legacy);
const originalRoots=legacy.prepare("SELECT name,rootpage,sql FROM sqlite_master WHERE name IN ('users','series','episodes','episode_durations','episode_durations_extended','playback_sessions','playback_session_times','playback_session_times_extended','purchases','test_purchases') ORDER BY name").all();
legacy.close();
const {config}=await import('../server/config');
const {all,one,run,transaction,db}=await import('../server/db');
const {episodeDurationSql,writeEpisodeDuration,legacyEpisodeDuration}=await import('../server/episode-duration');
const {playbackTimeSql}=await import('../server/playback-times');
const {startPlayback,recordPlayback,readSeriesAnalytics}=await import('../server/analytics');
const {AppError}=await import('../server/errors');
config.platformOwnerUserId=owner;config.payments='disabled';config.stripeTestMode=false;config.sandbox=false;
after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
const viewer=()=>createHash('sha256').update(randomUUID()).digest('hex');
function series(creator=owner){const id=randomUUID();run('INSERT INTO series(id,creator_id,title,description,language,genres,status) VALUES (?,?,?,?,?,?,?)',id,creator,'Duration '+id,'An original drama for long-duration regression coverage.','en','["drama"]','published');return id;}
function episode(seconds:number,seriesId=series()){const id=randomUUID();transaction(()=>{run('INSERT INTO episodes(id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',id,seriesId,'Complete chapter',1,legacyEpisodeDuration(seconds),64,'duration/'+id+'.mp4');writeEpisodeDuration(id,seconds);});return{id,seriesId};}
function duration(id:string){return one<{duration:number}>(`SELECT ${episodeDurationSql()} AS duration FROM episodes e WHERE id=?`,id)!.duration;}
function badTime(action:()=>unknown,code='INVALID_WATCH_TIME'){assert.throws(action,(error:unknown)=>error instanceof AppError&&error.code===code);}

test('adding long-duration storage retains historical 180/240/300-second values, constraints and both financial partitions',()=>{
  assert.equal(MAX_EPISODE_SECONDS,300);
  for(const seconds of [180,240,300])assert.equal(duration('retained-duration-'+seconds),seconds);
  assert.deepEqual(finances(db),originalMoney);assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  assert.deepEqual(all("SELECT name,rootpage,sql FROM sqlite_master WHERE name IN ('users','series','episodes','episode_durations','episode_durations_extended','playback_sessions','playback_session_times','playback_session_times_extended','purchases','test_purchases') ORDER BY name"),originalRoots);
  assert.throws(()=>run('UPDATE episodes SET duration=601 WHERE id=?','retained-duration-180'),/CHECK constraint/);
  assert.throws(()=>run('UPDATE episode_durations_extended SET seconds=601 WHERE episode_id=?','retained-duration-300'),/CHECK constraint/);
});

test('owner episodes above an hour retain complete fractional durations with bounded legacy mirrors and restart persistence',()=>{
  const money=finances(db),ids=[601.25,7200,10800].map(seconds=>({seconds,...episode(seconds)}));
  for(const{id,seconds}of ids){assert.equal(duration(id),seconds);assert.equal(one('SELECT duration FROM episodes WHERE id=?',id)!.duration,180);assert.equal(one('SELECT seconds FROM episode_durations WHERE episode_id=?',id)!.seconds,240);assert.equal(one('SELECT seconds FROM episode_durations_extended WHERE episode_id=?',id)!.seconds,300);assert.equal(one('SELECT seconds FROM episode_durations_long WHERE episode_id=?',id)!.seconds,seconds);}
  const reopened=new DatabaseSync(file);try{reopened.exec('PRAGMA foreign_keys=ON;');reopened.exec(DATABASE_SCHEMA);for(const{id,seconds}of ids)assert.equal((reopened.prepare(`SELECT ${episodeDurationSql()} AS duration FROM episodes e WHERE id=?`).get(id) as any).duration,seconds);assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}
  assert.deepEqual(finances(db),money);
});

test('the storage writer cannot grant long uploads to ordinary publishers or an unrelated administrator',()=>{
  const money=finances(db);
  for(const creator of [ordinary,otherAdmin]){
    const normal=episode(300,series(creator));
    assert.throws(()=>writeEpisodeDuration(normal.id,300.001),(error:unknown)=>error instanceof AppError&&error.code==='VIDEO_TOO_LONG');
    for(const seconds of [0,-1,NaN,Infinity,MAX_TRACKED_EPISODE_SECONDS+1])assert.throws(()=>writeEpisodeDuration(normal.id,seconds),(error:unknown)=>error instanceof AppError&&error.code==='INVALID_VIDEO');
    assert.equal(duration(normal.id),300);assert.equal(one('SELECT 1 FROM episode_durations_long WHERE episode_id=?',normal.id),undefined);
  }
  assert.deepEqual(finances(db),money);
});

test('a shorter replacement clears higher-duration tiers without leaving a stale long value',()=>{
  const item=episode(7200),money=finances(db);
  for(const seconds of [300,240,180]){writeEpisodeDuration(item.id,seconds);assert.equal(duration(item.id),seconds);assert.equal(one('SELECT 1 FROM episode_durations_long WHERE episode_id=?',item.id),undefined);}
  assert.equal(one('SELECT 1 FROM episode_durations_extended WHERE episode_id=?',item.id),undefined);assert.equal(one('SELECT 1 FROM episode_durations WHERE episode_id=?',item.id),undefined);assert.deepEqual(finances(db),money);
});

test('stored long episodes remain readable and measurable after the owner upload exception is revoked',()=>{
  const item=episode(7200),key=viewer(),start=Date.now(),money=finances(db),session=startPlayback(item.id,key,start),configured=config.platformOwnerUserId;
  try{
    config.platformOwnerUserId='';run("UPDATE users SET role='publisher' WHERE id=?",owner);
    assert.equal(duration(item.id),7200);assert.equal(recordPlayback(session.sessionId,key,601_000,start+500).watchedMs,500);
    assert.throws(()=>writeEpisodeDuration(item.id,7201),(error:unknown)=>error instanceof AppError&&error.code==='VIDEO_TOO_LONG');
  }finally{config.platformOwnerUserId=configured;run("UPDATE users SET role='admin' WHERE id=?",owner);}
  assert.deepEqual(finances(db),money);
});

test('long playback and saved progress round-trip beyond five minutes without changing purchases or financial state',()=>{
  const item=episode(601),key=viewer(),start=Date.now(),money=finances(db),session=startPlayback(item.id,key,start);let result=session;
  for(let time=15_000;time<=600_000;time+=15_000)result=recordPlayback(session.sessionId,key,time,start+time);
  result=recordPlayback(session.sessionId,key,601_000,start+601_000);
  assert.equal(result.watchedMs,601_000);assert.equal(result.reportedMs,601_000);assert.equal(one('SELECT views FROM series WHERE id=?',item.seriesId)!.views,1);
  assert.equal(one('SELECT watched_ms FROM playback_sessions WHERE id=?',session.sessionId)!.watched_ms,180_000);assert.equal(one('SELECT watched_ms FROM playback_session_times WHERE session_id=?',session.sessionId)!.watched_ms,240_000);assert.equal(one('SELECT watched_ms FROM playback_session_times_extended WHERE session_id=?',session.sessionId)!.watched_ms,300_000);assert.equal(one('SELECT watched_ms FROM playback_session_times_long WHERE session_id=?',session.sessionId)!.watched_ms,601_000);
  run('INSERT INTO progress(user_id,episode_id,seconds) VALUES (?,?,?)',buyer,item.id,600.5);
  const reopened=new DatabaseSync(file);try{reopened.exec(DATABASE_SCHEMA);assert.equal((reopened.prepare(`SELECT ${playbackTimeSql()} AS watched FROM playback_sessions p WHERE id=?`).get(session.sessionId) as any).watched,601_000);assert.equal((reopened.prepare('SELECT seconds FROM progress WHERE user_id=? AND episode_id=?').get(buyer,item.id) as any).seconds,600.5);}finally{reopened.close();}
  const summary=readSeriesAnalytics(owner,item.seriesId,{period:'all'},start+601_000);assert.equal(summary.totals.watchSeconds,601);assert.equal(summary.totals.views,1);assert.equal(summary.episodes[0].duration,601);assert.deepEqual(finances(db),money);
});

test('continuous two-hour playback keeps a single counted view after thirty minutes',()=>{
  const item=episode(7200),key=viewer(),start=Date.now(),money=finances(db),session=startPlayback(item.id,key,start);let result=session;
  for(let time=15_000;time<=7_200_000;time+=15_000)result=recordPlayback(session.sessionId,key,time,start+time);
  assert.equal(result.watchedMs,7_200_000);assert.equal(result.reportedMs,7_200_000);assert.equal(one('SELECT views FROM series WHERE id=?',item.seriesId)!.views,1);assert.equal(one('SELECT COUNT(*) AS n FROM playback_sessions WHERE episode_id=?',item.id)!.n,1);
  badTime(()=>recordPlayback(session.sessionId,key,7_200_000,start+9_000_001),'PLAYBACK_EXPIRED');assert.deepEqual(finances(db),money);
});

test('long reports preserve elapsed-time and heartbeat caps, replay protection and per-episode bounds',()=>{
  const item=episode(7200),key=viewer(),start=Date.now(),money=finances(db),session=startPlayback(item.id,key,start);
  const clipped=recordPlayback(session.sessionId,key,7_200_000,start+500);assert.equal(clipped.watchedMs,500);assert.equal(clipped.reportedMs,7_200_000);
  assert.equal(recordPlayback(session.sessionId,key,7_200_000,start+30_000).watchedMs,500,'A retry cannot credit a previously discarded high report.');
  for(const value of [-1,1.5,7_200_001,Number.MAX_SAFE_INTEGER])badTime(()=>recordPlayback(session.sessionId,key,value,start+31_000));
  const second=episode(7200),secondKey=viewer(),secondSession=startPlayback(second.id,secondKey,start),bounded=recordPlayback(secondSession.sessionId,secondKey,120_000,start+60_000);assert.equal(bounded.watchedMs,15_000);
  const short=episode(12),shortKey=viewer(),shortSession=startPlayback(short.id,shortKey,start),legacyReport=recordPlayback(shortSession.sessionId,shortKey,180_000,start+500);assert.equal(legacyReport.watchedMs,500);assert.equal(legacyReport.reportedMs,180_000);badTime(()=>recordPlayback(shortSession.sessionId,shortKey,300_001,start+1000));
  badTime(()=>recordPlayback(shortSession.sessionId,shortKey,180_000,start+1_800_001),'PLAYBACK_EXPIRED');assert.deepEqual(finances(db),money);
});

test('deleting a disposable long episode cascades the new duration and playback tiers without touching financial history',()=>{
  const item=episode(601),key=viewer(),start=Date.now(),money=finances(db),session=startPlayback(item.id,key,start);
  recordPlayback(session.sessionId,key,601_000,start+500);assert.ok(one('SELECT 1 FROM episode_durations_long WHERE episode_id=?',item.id));assert.ok(one('SELECT 1 FROM playback_session_times_long WHERE session_id=?',session.sessionId));
  run('DELETE FROM episodes WHERE id=?',item.id);assert.equal(one('SELECT 1 FROM episode_durations_long WHERE episode_id=?',item.id),undefined);assert.equal(one('SELECT 1 FROM playback_session_times_long WHERE session_id=?',session.sessionId),undefined);assert.deepEqual(all('PRAGMA foreign_key_check'),[]);assert.deepEqual(finances(db),money);
});
