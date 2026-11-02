import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-series-lifecycle-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='demo';process.env.STRIPE_TEST_MODE='false';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {all,one,run,db}=await import('../server/db');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const moderation=await import('../server/moderation');
const origin='https://lifecycle.example.test';
interface Identity {id:string;cookie:string}
interface Fixture {id:string;title:string;episodes:string[];keys:string[];bytes:number}
let server:Server,base:string,owner:Identity,other:Identity,admin:Identity,buyer:Identity,secondBuyer:Identity;

function identity(name:string,role:'publisher'|'admin'|'viewer'):Identity{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?,?)',id,name+'@lifecycle.test',name,'unused-local-password',role,role==='viewer'?0:1,5_000_000,700_000);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+30*24*60*60_000);
  return{id,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,cookie='',expected:number|number[]=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);
  return{response,data,status:response.status};
}
async function fixture(published=true):Promise<Fixture>{
  const id=randomUUID(),title='Lifecycle drama '+id,episodes=[randomUUID(),randomUUID(),randomUUID()];
  const keys=[`covers/${id}.webp`,...episodes.map(e=>`videos/${owner.id}/${e}.mp4`)];const sizes=[29,37,42,47],bytes=sizes.reduce((a,b)=>a+b,0);
  for(let i=0;i<keys.length;i++){const target=path.join(dir,'objects',keys[i]);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,Buffer.alloc(sizes[i],i+1));}
  run('INSERT INTO series (id,creator_id,title,description,language,genres,status,cover_key,cover_bytes,free_episodes,price_cents,views) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,owner.id,title,'An original drama for permanent deletion and privacy checks.','en','["drama"]',published?'published':'draft',keys[0],sizes[0],1,10,2);
  episodes.forEach((episode,i)=>run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',episode,id,'Episode '+(i+1),i+1,10,sizes[i+1],keys[i+1],'Episode '+(i+1)+'.mp4'));
  run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',bytes,owner.id);
  run('INSERT INTO series_classifications (series_id,themes,format) VALUES (?,?,?)',id,'["revenge"]','live-action');
  run('INSERT INTO series_publications (series_id,published_at) VALUES (?,?)',id,'2026-10-01T00:00:00.000Z');
  for(const actor of [buyer,secondBuyer])run('INSERT INTO series_likes (user_id,series_id) VALUES (?,?)',actor.id,id);
  run('INSERT INTO saves (user_id,series_id) VALUES (?,?)',buyer.id,id);
  run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',buyer.id,episodes[1],3);
  for(const[actor,index,watched]of [[buyer,0,3000],[secondBuyer,1,6000]] as const)run('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,watched_ms,reported_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),episodes[index],createHash('sha256').update(actor.id).digest('hex'),Date.now()-10000,Date.now(),watched,watched,1,Date.now());
  for(const[actor,index]of [[buyer,1],[secondBuyer,2]] as const){const purchase=randomUUID();run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',purchase,actor.id,episodes[index],100_000,70_000,30_000);run('INSERT INTO ledger (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)',randomUUID(),actor.id,'unlock',-100_000,purchase,'Original financial receipt');}
  run('INSERT INTO test_accounts (user_id,wallet_micros) VALUES (?,?) ON CONFLICT(user_id) DO NOTHING',buyer.id,900_000);
  const testPurchase=randomUUID();run('INSERT INTO test_purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',testPurchase,buyer.id,episodes[2],200_000,140_000,60_000);
  run('INSERT INTO test_ledger (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)',randomUUID(),buyer.id,'unlock',-200_000,testPurchase,'Original test financial receipt');
  return{id,title,episodes,keys,bytes};
}
const route=(drama:Fixture)=>'/api/studio/series/'+drama.id;
const deletion=(drama:Fixture,token:string)=>({confirmation_token:token,confirm_title:drama.title,acknowledge:true});
async function preview(drama:Fixture,actor=owner){return(await request(route(drama)+'/lifecycle',undefined,actor.cookie)).data;}
function financialSnapshot(drama:Fixture){return{
  purchases:all('SELECT p.* FROM purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? ORDER BY p.id',drama.id),
  testPurchases:all('SELECT p.* FROM test_purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? ORDER BY p.id',drama.id),
  ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id'),
  users:all('SELECT id,role,publisher_active,wallet_micros,earnings_micros,quota_bytes FROM users ORDER BY id'),test:all('SELECT * FROM test_accounts ORDER BY user_id'),
};}
async function assertUnavailable(drama:Fixture){
  for(const actor of [undefined,buyer,owner,admin]){
    const cookie=actor?.cookie||'';
    await request('/api/series/'+drama.id,undefined,cookie,404);
    await request('/api/series/'+drama.id+'/cover',undefined,cookie,404);
    await request('/api/episodes/'+drama.episodes[0]+'/stream',undefined,cookie,404);
  }
  for(const action of ['unlock','playback','progress'])await request('/api/episodes/'+drama.episodes[1]+'/'+action,action==='progress'?{seconds:1}:{},buyer.cookie,404);
  await request('/api/series/'+drama.id+'/save',{},buyer.cookie,404);
  await request('/api/series/'+drama.id+'/like',{liked:true},buyer.cookie,404,'PUT');
  assert.equal((await request('/api/series')).data.series.some((s:any)=>s.id===drama.id),false);
  assert.equal((await request('/api/history',undefined,buyer.cookie)).data.history.some((s:any)=>s.id===drama.id),false);
}

before(async()=>{
  owner=identity('Lifecycle owner','publisher');other=identity('Other creator','publisher');admin=identity('Lifecycle administrator','admin');buyer=identity('First buyer','viewer');secondBuyer=identity('Second buyer','viewer');
  config.appUrl=origin;const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{config.production=false;config.sandbox=false;config.stripeTestMode=false;config.payments='demo';config.appUrl=origin;});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('a creator can hide a purchased published series and republish it without losing its publication date or money',async()=>{
  const drama=await fixture(),before=financialSnapshot(drama);
  const analytics=await import('../server/analytics'),sessions=all('SELECT p.* FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? ORDER BY p.id',drama.id),session=sessions[0];
  const originalViews=one('SELECT views FROM series WHERE id=?',drama.id)!.views;
  await request(route(drama)+'/status',{status:'archived'},other.cookie,403);
  await request(route(drama)+'/status',{status:'archived'},owner.cookie);
  await assertUnavailable(drama);
  assert.throws(()=>analytics.startPlayback(session.episode_id,session.viewer_key,session.last_seen_ms+5000),{status:404,code:'NOT_FOUND'});
  assert.throws(()=>analytics.recordPlayback(session.id,session.viewer_key,10000,session.last_seen_ms+5000),{status:404,code:'NOT_FOUND'});
  assert.deepEqual(all('SELECT p.* FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? ORDER BY p.id',drama.id),sessions);
  assert.equal(one('SELECT views FROM series WHERE id=?',drama.id)!.views,originalViews);
  assert.equal((await request(route(drama),undefined,owner.cookie)).data.series.status,'archived');
  await request(route(drama)+'/analytics?period=all',undefined,owner.cookie);
  await request(route(drama)+'/status',{status:'published'},owner.cookie);
  assert.equal((await request('/api/series/'+drama.id,undefined,buyer.cookie)).data.episodes[1].unlocked,true);
  assert.equal(one('SELECT published_at FROM series_publications WHERE series_id=?',drama.id)!.published_at,'2026-10-01T00:00:00.000Z');assert.deepEqual(financialSnapshot(drama),before);
});

test('creator hiding cannot restore or republish an administrative takedown',async()=>{
  const drama=await fixture();moderation.setSeriesModeration(admin.id,drama.id,'takedown','An existing rights investigation must remain in effect.');
  await request(route(drama)+'/status',{status:'archived'},owner.cookie,423);
  await request(route(drama)+'/status',{status:'published'},owner.cookie,423);
  assert.equal(moderation.moderationState(drama.id).taken_down,true);await assertUnavailable(drama);
});

test('hiding legacy published content preserves its original listing date without inventing one for drafts',async()=>{
  const published=await fixture(),originalDate='2025-04-03 02:01:00';
  run('DELETE FROM series_publications WHERE series_id=?',published.id);
  run('UPDATE series SET created_at=? WHERE id=?',originalDate,published.id);
  await request(route(published)+'/status',{status:'archived'},owner.cookie);
  assert.equal(one('SELECT published_at FROM series_publications WHERE series_id=?',published.id)!.published_at,originalDate);
  await request(route(published)+'/status',{status:'published'},owner.cookie);
  assert.equal(one('SELECT published_at FROM series_publications WHERE series_id=?',published.id)!.published_at,originalDate);
  const draft=await fixture(false);run('DELETE FROM series_publications WHERE series_id=?',draft.id);
  await request(route(draft)+'/status',{status:'archived'},owner.cookie);
  assert.equal(one('SELECT published_at FROM series_publications WHERE series_id=?',draft.id),undefined);
});

test('a moderation hold blocks creator deletion and private playback while an administrator can review and permanently remove it',async()=>{
  const drama=await fixture(),p=await preview(drama),before=financialSnapshot(drama);
  await request('/api/admin/series/'+drama.id+'/moderation',{action:'takedown',reason:'A rights investigation prevents creator removal during review.'},admin.cookie);
  const snapshot=one('SELECT * FROM series WHERE id=?',drama.id);
  await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,423,'DELETE');
  await request('/api/studio/episodes/'+drama.episodes[0]+'/stream',undefined,owner.cookie,423);
  assert.equal(one('SELECT * FROM series_deletions WHERE series_id=?',drama.id),undefined);
  assert.deepEqual(one('SELECT * FROM series WHERE id=?',drama.id),snapshot);
  for(const key of drama.keys)assert.ok((await readFile(path.join(dir,'objects',key))).length);
  for(const stream of ['/api/admin/episodes/','/api/studio/episodes/']){
    const response=await fetch(base+stream+drama.episodes[0]+'/stream',{headers:{Cookie:admin.cookie}});
    assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,37);
  }
  const adminPreview=await preview(drama,admin);assert.equal(adminPreview.series.taken_down,true);
  await request(route(drama),deletion(drama,adminPreview.confirmation_token),admin.cookie,200,'DELETE');
  assert.ok(one('SELECT * FROM series_deletions WHERE series_id=?',drama.id));assert.deepEqual(financialSnapshot(drama),before);
});

test('switching payment mode cannot bypass live, test or unmapped payment holds when hiding or deleting content',async()=>{
  // Authentication initializes this zero-value test profile lazily on a mode
  // switch; seed it before comparing immutable balances and financial receipts.
  run('INSERT INTO test_accounts (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING',owner.id);
  for(const hold of [{testMode:true,group:'default',live:1,mapped:true},{testMode:false,group:'test',live:0,mapped:true},{testMode:true,group:'default',live:1,mapped:false}]){
    const drama=await fixture();config.payments='stripe';config.stripeTestMode=!hold.testMode;
    const p=await preview(drama),caseId=randomUUID(),before=financialSnapshot(drama);
    run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES (?,?,?,?,?,?,?)',caseId,hold.group,hold.live,'dispute','local-fixture-'+caseId,hold.mapped?owner.id:null,'open');
    config.stripeTestMode=hold.testMode;
    try{
      for(const response of [await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,423,'DELETE'),await request(route(drama)+'/status',{status:'archived'},owner.cookie,423)])assert.equal(response.data.error.code,'PAYMENT_REVIEW_REQUIRED');
      assert.equal(one('SELECT * FROM series_deletions WHERE series_id=?',drama.id),undefined);
      assert.equal(one('SELECT status FROM series WHERE id=?',drama.id)!.status,'published');
      for(const key of drama.keys)assert.ok((await readFile(path.join(dir,'objects',key))).length);
      assert.deepEqual(financialSnapshot(drama),before);
    }finally{run("UPDATE payment_risk_cases SET status='resolved' WHERE id=?",caseId);}
  }
});

test('deletion preview is private, reports real counters and does not remove content or spend money',async()=>{
  const drama=await fixture(),before=financialSnapshot(drama),used=one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes;
  await request(route(drama)+'/lifecycle',undefined,'',401);await request(route(drama)+'/lifecycle',undefined,buyer.cookie,403);await request(route(drama)+'/lifecycle',undefined,other.cookie,403);
  const p=await preview(drama);assert.equal(p.series.id,drama.id);assert.equal(p.series.title,drama.title);assert.equal(p.summary.episode_count,3);assert.equal(p.summary.views,2);assert.equal(p.summary.likes,2);assert.equal(p.summary.paid_unlocks,2);assert.equal(p.summary.paid_viewers,2);assert.equal(p.summary.real_paid_unlocks,2);assert.equal(p.summary.real_paid_viewers,2);assert.equal(p.summary.test_paid_unlocks,1);assert.equal(p.summary.test_paid_viewers,1);assert.equal(p.summary.affected_paid_viewers,2);assert.equal(p.summary.total_watch_seconds,9);assert.equal(p.summary.avg_watch_seconds,4.5);assert.equal(p.summary.media_bytes,drama.bytes);assert.equal(typeof p.confirmation_token,'string');
  assert.equal((await request('/api/series/'+drama.id)).status,200);for(const key of drama.keys)assert.ok((await readFile(path.join(dir,'objects',key))).length);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used);assert.deepEqual(financialSnapshot(drama),before);
  config.stripeTestMode=true;const testPreview=await preview(drama);assert.equal(testPreview.summary.paid_unlocks,1);assert.equal(testPreview.summary.paid_viewers,1);assert.equal(testPreview.summary.real_paid_unlocks,2);assert.equal(testPreview.summary.test_paid_unlocks,1);assert.equal(testPreview.summary.affected_paid_viewers,2);
});

test('permanent deletion requires a fresh actor-bound proof, exact title and explicit irreversible acknowledgement',async()=>{
  const drama=await fixture(),p=await preview(drama),body=deletion(drama,p.confirmation_token);
  await request(route(drama),body,'',401,'DELETE');await request(route(drama),body,other.cookie,403,'DELETE');
  for(const value of [{...body,confirmation_token:'0'.repeat(64)},{...body,acknowledge:false},{...body,confirm_title:'Another title'}])await request(route(drama),value,owner.cookie,[400,409],'DELETE');
  await request(route(drama),body,admin.cookie,[400,409],'DELETE');
  assert.ok(one('SELECT title FROM series WHERE id=?',drama.id));
  const future=Date.now()+31*60_000;const now=mock.method(Date,'now',()=>future);try{await request(route(drama),body,owner.cookie,[400,409,410],'DELETE');}finally{now.mock.restore();}
  assert.equal((await request('/api/series/'+drama.id)).status,200);
});

test('a preview cannot delete content changed after the creator reviewed it',async()=>{
  const drama=await fixture(),p=await preview(drama);
  run('UPDATE episodes SET title=? WHERE id=?','A changed episode title',drama.episodes[0]);
  await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,409,'DELETE');
  assert.equal((await request(route(drama),undefined,owner.cookie)).data.episodes.length,3);
});

test('new purchases and a financial mode switch require another deletion review',async()=>{
  const drama=await fixture(),p=await preview(drama);
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),secondBuyer.id,drama.episodes[1],100_000,70_000,30_000);
  await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,409,'DELETE');
  config.payments='stripe';const livePreview=await preview(drama);assert.equal(livePreview.summary.financial_mode,'live');
  config.stripeTestMode=true;
  await request(route(drama),deletion(drama,livePreview.confirmation_token),owner.cookie,409,'DELETE');
  const testPreview=await preview(drama);assert.equal(testPreview.summary.financial_mode,'test');assert.equal(testPreview.summary.real_paid_unlocks,3);assert.equal(testPreview.summary.test_paid_unlocks,1);
});

test('a paid unlock racing permanent deletion either invalidates confirmation or is rejected without charging',async()=>{
  for(const unlockFirst of [false,true]){
    const drama=await fixture(),p=await preview(drama),balance=Number(one('SELECT wallet_micros FROM users WHERE id=?',other.id)!.wallet_micros);
    const remove=()=>request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,[200,409],'DELETE');
    const unlock=()=>request('/api/episodes/'+drama.episodes[1]+'/unlock',{},other.cookie,[200,404]);
    const results=await Promise.all(unlockFirst?[unlock(),remove()]:[remove(),unlock()]);
    const deletionResult=results[unlockFirst?1:0],purchaseResult=results[unlockFirst?0:1];
    if(deletionResult.status===200){assert.equal(purchaseResult.status,404);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',other.id)!.wallet_micros,balance);assert.equal(one('SELECT id FROM purchases WHERE episode_id=? AND user_id=?',drama.episodes[1],other.id),undefined);}
    else{assert.equal(purchaseResult.status,200);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',other.id)!.wallet_micros,balance-100_000);assert.ok(one('SELECT id FROM purchases WHERE episode_id=? AND user_id=?',drama.episodes[1],other.id));assert.equal((await request('/api/series/'+drama.id)).status,200);}
  }
});

test('whole-series deletion removes content and media irreversibly while preserving all real and test financial records',async()=>{
  const drama=await fixture(),before=financialSnapshot(drama),used=Number(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes),p=await preview(drama);
  const deleted=(await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,200,'DELETE')).data;assert.equal(deleted.ok,true);assert.equal(deleted.cleanup_pending,false);assert.equal(deleted.released_bytes,drama.bytes);
  await assertUnavailable(drama);
  for(const actor of [owner,admin]){await request(route(drama),undefined,actor.cookie,404);await request(route(drama)+'/cover',undefined,actor.cookie,404);await request(route(drama)+'/analytics?period=all',undefined,actor.cookie,404);await request(route(drama)+'/status',{status:'published'},actor.cookie,404);}
  await request('/api/admin/episodes/'+drama.episodes[1]+'/stream',undefined,admin.cookie,404);await request('/api/admin/series/'+drama.id+'/moderation',{action:'restore',reason:'A deleted series must never be restored by a moderator.'},admin.cookie,404);
  await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,[404,409],'DELETE');
  for(const key of drama.keys)await assert.rejects(readFile(path.join(dir,'objects',key)),{code:'ENOENT'});
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes);
  assert.equal(one('SELECT COUNT(*) AS n FROM saves WHERE series_id=?',drama.id)!.n,0);assert.equal(one('SELECT COUNT(*) AS n FROM series_likes WHERE series_id=?',drama.id)!.n,0);
  assert.equal(one('SELECT COUNT(*) AS n FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?',drama.id)!.n,0);assert.equal(one('SELECT COUNT(*) AS n FROM progress p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?',drama.id)!.n,0);
  assert.deepEqual(financialSnapshot(drama),before);
  const remaining=one('SELECT * FROM series WHERE id=?',drama.id);assert.ok(remaining);assert.notEqual(remaining.title,drama.title);assert.equal(remaining.description,'');assert.equal(remaining.cover_key,'');
  assert.ok(all('SELECT storage_key,original_name FROM episodes WHERE series_id=?',drama.id).every(row=>row.storage_key===''&&row.original_name===''));
  db.exec(DATABASE_SCHEMA);await request(route(drama),undefined,owner.cookie,404);await request('/api/admin/series/'+drama.id+'/moderation',{action:'restore',reason:'A schema restart cannot recover permanently deleted content.'},admin.cookie,404);
});

test('failed physical cleanup keeps the series deleted, retains charged quota and retries exactly once after restart',async()=>{
  const drama=await fixture(),p=await preview(drama),target=path.join(dir,'objects',drama.keys[1]);
  const used=Number(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes),before=financialSnapshot(drama);
  await rm(target);await mkdir(target); // fs.rm without recursive fails with EISDIR, like a failed object deletion.
  const result=(await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,200,'DELETE')).data;
  assert.equal(result.cleanup_pending,true);assert.equal(result.released_bytes,drama.bytes-37);
  await assertUnavailable(drama);await request(route(drama),undefined,owner.cookie,404);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes+37);
  assert.deepEqual(financialSnapshot(drama),before);
  db.exec(DATABASE_SCHEMA);
  await rm(target,{recursive:true,force:true});await writeFile(target,Buffer.alloc(37));
  const {cleanupSeriesMedia}=await import('../server/series-lifecycle');
  await Promise.all([cleanupSeriesMedia(drama.id),cleanupSeriesMedia(drama.id)]);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes);
  await assert.rejects(readFile(target),{code:'ENOENT'});
  await cleanupSeriesMedia(drama.id);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes);
  assert.deepEqual(financialSnapshot(drama),before);
});

test('an unexpected cleanup failure after deletion commits returns success with a durable retry instead of a misleading server error',async()=>{
  const drama=await fixture(),p=await preview(drama),used=Number(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes),before=financialSnapshot(drama);
  db.exec(`CREATE TRIGGER lifecycle_cleanup_failure BEFORE UPDATE OF attempts ON series_media_deletions WHEN NEW.series_id='${drama.id}' BEGIN SELECT RAISE(ABORT,'fixture cleanup failure'); END`);
  try{
    const deleted=(await request(route(drama),deletion(drama,p.confirmation_token),owner.cookie,200,'DELETE')).data;
    assert.equal(deleted.ok,true);assert.equal(deleted.deleted,true);assert.equal(deleted.cleanup_pending,true);
    assert.ok(one('SELECT * FROM series_deletions WHERE series_id=?',drama.id));
    assert.equal(one('SELECT COUNT(*) AS n FROM series_media_deletions WHERE series_id=? AND status=\'pending\'',drama.id)!.n,4);
    assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used);
    await request(route(drama),undefined,owner.cookie,404);
    await request('/api/admin/series/'+drama.id+'/moderation',{action:'restore',reason:'An interrupted physical cleanup cannot restore deleted content.'},admin.cookie,404);
    assert.deepEqual(financialSnapshot(drama),before);
  }finally{db.exec('DROP TRIGGER lifecycle_cleanup_failure');}
  const {cleanupSeriesMedia}=await import('../server/series-lifecycle');
  await cleanupSeriesMedia(drama.id);await cleanupSeriesMedia(drama.id);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes);
  for(const key of drama.keys)await assert.rejects(readFile(path.join(dir,'objects',key)),{code:'ENOENT'});
  assert.deepEqual(financialSnapshot(drama),before);
});

test('an episode PUT racing permanent deletion queues its uncommitted object for cleanup without charging or double-releasing quota',async()=>{
  const drama=await fixture(),p=await preview(drama),used=Number(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes),before=financialSnapshot(drama);
  const lifecycle=await import('../server/series-lifecycle'),copyFile=fs.copyFile,removeFile=fs.rm;let orphanPath='',orphanKey='',removed=false;
  mock.method(fs,'copyFile',async(...args:Parameters<typeof fs.copyFile>)=>{
    await copyFile(...args);
    const destination=String(args[1]);if(!destination.includes(path.join('objects','videos',owner.id)))return;
    orphanPath=destination;orphanKey=path.relative(path.join(dir,'objects'),destination).split(path.sep).join('/');
    const deleted=await lifecycle.deleteSeriesPermanently(owner.id,drama.id,deletion(drama,p.confirmation_token));
    assert.equal(deleted.deleted,true);assert.equal(deleted.cleanup_pending,false);removed=true;
  });
  mock.method(fs,'rm',async(...args:Parameters<typeof fs.rm>)=>{
    if(orphanPath&&String(args[0])===orphanPath)throw Object.assign(new Error('Fixture object store temporarily unavailable'),{code:'EACCES'});
    return removeFile(...args);
  });
  const form=new FormData();form.set('title','Episode 4 uploaded during deletion');form.set('number','4');form.set('video',new Blob([await readFile(path.join(process.cwd(),'public/demo-preview.mp4'))],{type:'video/mp4'}),'episode-04.mp4');
  let response:Response;
  try{response=await fetch(base+route(drama)+'/episodes',{method:'POST',headers:{Cookie:owner.cookie,Origin:origin},body:form});}
  finally{mock.restoreAll();}
  assert.equal(response.status,404,JSON.stringify(await response.json()));assert.equal(removed,true);assert.ok(orphanKey);
  assert.ok((await readFile(orphanPath)).length);
  const queued=one('SELECT * FROM series_media_deletions WHERE series_id=? AND object_key=?',drama.id,orphanKey)!;
  assert.ok(queued);assert.equal(queued.status,'pending');assert.equal(queued.bytes,0);
  assert.equal(one('SELECT number FROM episodes WHERE series_id=? AND number=4',drama.id),undefined);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes);assert.deepEqual(financialSnapshot(drama),before);
  await lifecycle.cleanupSeriesMedia(drama.id);await lifecycle.cleanupSeriesMedia(drama.id);
  await assert.rejects(readFile(orphanPath),{code:'ENOENT'});
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,used-drama.bytes);assert.deepEqual(financialSnapshot(drama),before);
});
