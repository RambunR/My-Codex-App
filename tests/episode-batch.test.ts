import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-episode-batch-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='demo';process.env.STRIPE_TEST_MODE='false';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const {cleanupSeriesMedia}=await import('../server/series-lifecycle');
const {setSeriesModeration}=await import('../server/moderation');
const {batchEpisodeTitle}=await import('../shared/episode-batch');
const origin='https://episode-batch.example.test';
interface Actor {id:string;cookie:string}
interface Drama {id:string;title:string;owner:Actor;ids:string[];keys:string[];sizes:number[];bytes:number}
let server:Server,base:string,other:Actor,admin:Actor,buyer:Actor;
function identity(role='publisher'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros) VALUES (?,?,?,?,?,?,?)',id,id+'@batch.test','Episode batch test','!disabled-test-login',role,role==='viewer'?0:1,5_000_000);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
  return{id,cookie:'drama_session='+token};
}
async function fixture(count=4):Promise<Drama>{
  const owner=identity(),id=randomUUID(),title='Batch series '+id,ids=Array.from({length:count},()=>randomUUID()),sizes=ids.map((_,i)=>31+i),keys=ids.map(episode=>'videos/'+owner.id+'/'+episode+'.mp4');
  run("INSERT INTO series (id,creator_id,title,description,language,genres,status,cover_key,free_episodes,price_cents,views,created_at) VALUES (?,?,?,?,?,?,'published','public:/images/midnight.jpg',2,10,2,'2025-01-01 00:00:00')",id,owner.id,title,'An original series for safe episode batch operations.','en','["drama"]');
  for(let i=0;i<count;i++){
    run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',ids[i],id,'Original title '+String(i+1).padStart(3,'0'),i+1,10,sizes[i],keys[i],'episode-'+(i+1)+'.mp4');
    const target=path.join(dir,'objects',keys[i]);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,Buffer.alloc(sizes[i],i+1));
  }
  const bytes=sizes.reduce((n,value)=>n+value,0);run('UPDATE users SET used_bytes=? WHERE id=?',bytes,owner.id);
  for(let i=0;i<Math.min(count,2);i++)run('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,watched_ms,reported_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),ids[i],createHash('sha256').update('viewer-'+i+id).digest('hex'),Date.now()-10000,Date.now(),i?7000:3000,i?7000:3000,1,Date.now());
  if(count)run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',buyer.id,ids[0],2);
  return{id,title,owner,ids,keys,sizes,bytes};
}
async function request(route:string,body?:unknown,cookie='',status:number|number[]=200,method=body===undefined?'GET':'POST',headers:Record<string,string>={}){
  const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),method+' '+route+': '+response.status+' '+JSON.stringify(data));return{data,response,status:response.status};
}
const seriesPath=(drama:Drama)=>'/api/studio/series/'+drama.id;
const batchPath=(drama:Drama)=>seriesPath(drama)+'/episodes/batch';
async function state(drama:Drama){return(await request(seriesPath(drama),undefined,drama.owner.cookie)).data;}
async function revision(drama:Drama){return(await state(drama)).episodes_revision as string;}
async function preview(drama:Drama,ids=drama.ids,actor=drama.owner){return(await request(seriesPath(drama)+'/episodes/batch-delete-preview',{revision:await revision(drama),episode_ids:ids},actor.cookie)).data;}
const confirmation=(drama:Drama,proof:any,ids=drama.ids)=>({action:'delete',revision:proof.episodes_revision,episode_ids:ids,confirmation_token:proof.confirmation_token,confirm_title:drama.title,acknowledge:true});
function episodes(drama:Drama){return all('SELECT id,title,number,bytes,storage_key FROM episodes WHERE series_id=? ORDER BY number',drama.id);}
function financial(){return{users:all('SELECT id,wallet_micros,earnings_micros,publisher_active,quota_bytes FROM users ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id')};}
function purchase(episodeId:string,testMode=false){
  if(testMode)run('INSERT OR IGNORE INTO test_accounts (user_id) VALUES (?)',buyer.id);
  run('INSERT INTO '+(testMode?'test_purchases':'purchases')+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),buyer.id,episodeId,100_000,70_000,30_000);
}
function pending(drama:Drama){const id=randomUUID();run("INSERT INTO episode_upload_sessions (id,series_id,actor_id,creator_id,object_key,episode_id,title,number,filename,total_bytes,status,created_at_ms,expires_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,'uploading',?,?)",id,drama.id,drama.owner.id,drama.owner.id,'videos/pending/'+id,randomUUID(),'Pending episode',drama.ids.length+1,'pending.mp4',10,Date.now(),Date.now()+3600000);return id;}
before(async()=>{other=identity();admin=identity('admin');buyer=identity('viewer');config.appUrl=origin;const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(()=>{config.production=false;config.sandbox=false;config.payments='demo';config.stripeTestMode=false;config.appUrl=origin;});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('batch title numbering comes from persisted episode numbers, including sparse selections and episode 1000',()=>{
  assert.equal(batchEpisodeTitle('  New name  ',1),'New name 001');assert.equal(batchEpisodeTitle('New name',37),'New name 037');assert.equal(batchEpisodeTitle('New name',1000),'New name 1000');
  for(const [name,number] of [['',1],['a'.repeat(116),1],['Name',0],['Name',1001],['Name',1.5]] as const)assert.throws(()=>batchEpisodeTitle(name,number));
});

test('episode batch requests enforce authentication, creator ownership and same-origin authorization',async()=>{
  const drama=await fixture(),before=episodes(drama),body={action:'rename',revision:await revision(drama),episode_ids:drama.ids,base_name:'Unauthorized'};
  await request(batchPath(drama),body,'',401);await request(batchPath(drama),body,other.cookie,403);await request(batchPath(drama),body,buyer.cookie,403);
  await request(batchPath(drama),body,drama.owner.cookie,403,'POST',{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'});
  await request(seriesPath(drama)+'/episodes/batch-delete-preview',{revision:body.revision,episode_ids:drama.ids},other.cookie,403);
  assert.deepEqual(episodes(drama),before);assert.equal(one('SELECT COUNT(*) AS n FROM episode_batch_events WHERE series_id=?',drama.id)!.n,0);
});

test('batch rename preserves each selected current episode suffix and stores title text without executing SQL or HTML',async()=>{
  const drama=await fixture(),rev=await revision(drama),literal='<img src=x onerror=alert(1)>; DROP TABLE users;';
  const renamed=await request(batchPath(drama),{action:'rename',revision:rev,episode_ids:[drama.ids[2],drama.ids[0]],base_name:'  '+literal+'  '},drama.owner.cookie);
  assert.equal(renamed.response.headers.get('content-type')?.includes('application/json'),true);assert.equal(renamed.response.headers.get('x-content-type-options'),'nosniff');
  const rows=episodes(drama);assert.equal(rows[0].title,literal+' 001');assert.equal(rows[2].title,literal+' 003');assert.equal(rows[1].title,'Original title 002');assert.equal(rows[3].title,'Original title 004');
  assert.equal(rows.length,4);assert.ok(one('SELECT id FROM users WHERE id=?',drama.owner.id));assert.notEqual(renamed.data.episodes_revision,rev);
  assert.equal(one("SELECT COUNT(*) AS n FROM episode_batch_events WHERE series_id=? AND action='rename'",drama.id)!.n,1);
});

test('duplicate, foreign, excessive and malformed selections are rejected before any partial title change',async()=>{
  const drama=await fixture(),foreign=await fixture(),before=episodes(drama),rev=await revision(drama);
  for(const ids of [[drama.ids[0],drama.ids[0]],[drama.ids[0],foreign.ids[0]],[],Array.from({length:1001},(_,i)=>'episode-'+i)])await request(batchPath(drama),{action:'rename',revision:rev,episode_ids:ids,base_name:'Must not change'},drama.owner.cookie,400);
  for(const extra of [{base_name:''},{base_name:'x'.repeat(116)},{creator_id:other.id}])await request(batchPath(drama),{action:'rename',revision:rev,episode_ids:drama.ids,base_name:'Valid name',...extra},drama.owner.cookie,400);
  assert.deepEqual(episodes(drama),before);
});

test('concurrent editors must refresh a stale revision before changing titles or order',async()=>{
  const drama=await fixture(),rev=await revision(drama),body={action:'rename',revision:rev,episode_ids:drama.ids,base_name:'First editor'};
  await request(batchPath(drama),body,drama.owner.cookie);const before=episodes(drama);
  const stale=await request(batchPath(drama),{...body,base_name:'Stale editor'},drama.owner.cookie,409);assert.equal(stale.data.error.code,'EPISODE_BATCH_STALE');
  await request(batchPath(drama),{action:'reorder',revision:rev,episode_ids:[...drama.ids].reverse(),acknowledge_access_change:true},drama.owner.cookie,409);assert.deepEqual(episodes(drama),before);
});

test('reordering atomically preserves episode IDs, titles, purchases and finances while requiring free-access acknowledgement',async()=>{
  const drama=await fixture();purchase(drama.ids[2]);const original=episodes(drama),before=financial(),rev=await revision(drama),order=[drama.ids[2],drama.ids[0],drama.ids[1],drama.ids[3]];
  const denied=await request(batchPath(drama),{action:'reorder',revision:rev,episode_ids:order},drama.owner.cookie,409);assert.equal(denied.data.error.code,'EPISODE_ACCESS_CONFIRM_REQUIRED');assert.deepEqual(episodes(drama),original);
  await request(batchPath(drama),{action:'reorder',revision:rev,episode_ids:order,acknowledge_access_change:true},drama.owner.cookie);
  const rows=episodes(drama);assert.deepEqual(rows.map(x=>x.id),order);assert.deepEqual(rows.map(x=>x.number),[1,2,3,4]);for(const row of rows)assert.equal(row.title,original.find(x=>x.id===row.id)!.title);assert.deepEqual(financial(),before);
  const publicData=(await request('/api/series/'+drama.id,undefined,buyer.cookie)).data;assert.deepEqual(publicData.episodes.filter((x:any)=>x.free).map((x:any)=>x.id),order.slice(0,2));assert.equal(publicData.episodes.find((x:any)=>x.id===drama.ids[2]).unlocked,true);
  const renamed=(await request(batchPath(drama),{action:'rename',revision:await revision(drama),episode_ids:[drama.ids[2]],base_name:'Current position'},drama.owner.cookie)).data;
  assert.equal(renamed.episodes.find((x:any)=>x.id===drama.ids[2]).title,'Current position 001');
});

test('incomplete reorder lists cannot silently remove an episode or leave colliding positions',async()=>{
  const drama=await fixture(),before=episodes(drama),rev=await revision(drama);
  await request(batchPath(drama),{action:'reorder',revision:rev,episode_ids:drama.ids.slice(0,3),acknowledge_access_change:true},drama.owner.cookie,400);assert.deepEqual(episodes(drama),before);
});

test('batch deletion previews exact selected statistics without changing content, storage or finances',async()=>{
  const drama=await fixture(),before=financial(),rows=episodes(drama),proof=await preview(drama,drama.ids.slice(0,2));
  assert.equal(proof.summary.episode_count,2);assert.equal(proof.summary.views,2);assert.equal(proof.summary.total_watch_seconds,10);assert.equal(proof.summary.media_bytes,drama.sizes[0]+drama.sizes[1]);assert.equal(proof.summary.paid_episode_count,0);
  assert.match(proof.confirmation_token,/^[a-f0-9]{64}$/);assert.ok(Date.parse(proof.expires_at)>Date.now());assert.deepEqual(episodes(drama),rows);assert.deepEqual(financial(),before);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes);
});

test('permanent batch deletion requires the same actor, selection, exact series title, acknowledgement and unexpired proof',async()=>{
  const drama=await fixture(),proof=await preview(drama,drama.ids.slice(0,2)),body=confirmation(drama,proof,drama.ids.slice(0,2)),before=episodes(drama);
  await request(batchPath(drama),body,admin.cookie,400);
  for(const changed of [{confirmation_token:'0'.repeat(64)},{confirm_title:'Wrong title'},{acknowledge:false},{episode_ids:[drama.ids[0]]}])await request(batchPath(drama),{...body,...changed},drama.owner.cookie,400);
  const now=mock.method(Date,'now',()=>Date.parse(proof.expires_at)+1);try{await request(batchPath(drama),body,drama.owner.cookie,410);}finally{now.mock.restore();}
  assert.deepEqual(episodes(drama),before);
});

test('purchases in either financial mode protect the whole selected batch, including unpaid members',async()=>{
  for(const testMode of [false,true]){
    const drama=await fixture();purchase(drama.ids[1],testMode);const before=episodes(drama),proof=await preview(drama,drama.ids.slice(0,2));
    assert.equal(proof.summary.paid_episode_count,1);assert.equal(proof.summary[testMode?'test_paid_unlocks':'real_paid_unlocks'],1);
    const denied=await request(batchPath(drama),confirmation(drama,proof,drama.ids.slice(0,2)),drama.owner.cookie,409);assert.equal(denied.data.error.code,'EPISODE_PURCHASED');assert.deepEqual(episodes(drama),before);
  }
});

test('a new purchase after the warning invalidates the old selection proof instead of deleting a paid episode',async()=>{
  const drama=await fixture(),proof=await preview(drama,[drama.ids[2]]);purchase(drama.ids[2]);
  const denied=await request(batchPath(drama),confirmation(drama,proof,[drama.ids[2]]),drama.owner.cookie,409);assert.equal(denied.data.error.code,'EPISODE_BATCH_STALE');assert.equal(episodes(drama).length,4);
});

test('batch deletion removes only selected media and watch history, releasing acknowledged quota exactly once',async()=>{
  const drama=await fixture(),selected=drama.ids.slice(0,2),proof=await preview(drama,selected),before=financial(),released=drama.sizes[0]+drama.sizes[1];
  const result=(await request(batchPath(drama),confirmation(drama,proof,selected),drama.owner.cookie)).data;assert.equal(result.deleted,true);assert.equal(result.deleted_count,2);assert.equal(result.cleanup_pending,false);assert.equal(result.released_bytes,released);
  assert.deepEqual(episodes(drama).map(x=>x.id),drama.ids.slice(2));assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes-released);assert.deepEqual(financial(),before);
  for(const key of drama.keys.slice(0,2))await assert.rejects(readFile(path.join(dir,'objects',key)),{code:'ENOENT'});for(const key of drama.keys.slice(2))assert.ok((await readFile(path.join(dir,'objects',key))).length);
  assert.equal(one('SELECT COUNT(*) AS n FROM playback_sessions WHERE episode_id IN (?,?)',...selected)!.n,0);assert.equal(one('SELECT COUNT(*) AS n FROM progress WHERE episode_id IN (?,?)',...selected)!.n,0);
  await request(batchPath(drama),confirmation(drama,proof,selected),drama.owner.cookie,409);assert.equal((await cleanupSeriesMedia(drama.id)).released_bytes,0);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes-released);
});

test('failed media removal keeps batch deletion successful and quota charged until durable retry succeeds',async()=>{
  const drama=await fixture(),selected=[drama.ids[0]],proof=await preview(drama,selected),remove=fs.rm.bind(fs),failure=mock.method(fs,'rm',async(file:any,options:any)=>{if(String(file).endsWith(drama.keys[0]))throw new Error('Local object removal unavailable.');return remove(file,options);});
  try{
    const deleted=(await request(batchPath(drama),confirmation(drama,proof,selected),drama.owner.cookie)).data;assert.equal(deleted.deleted,true);assert.equal(deleted.cleanup_pending,true);assert.equal(episodes(drama).some(x=>x.id===selected[0]),false);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes);
    assert.equal(one("SELECT COUNT(*) AS n FROM series_media_deletions WHERE series_id=? AND status='pending'",drama.id)!.n,1);
  }finally{failure.mock.restore();}
  const cleanup=await cleanupSeriesMedia(drama.id);assert.equal(cleanup.released_bytes,drama.sizes[0]);assert.equal(cleanup.cleanup_pending,false);assert.equal((await cleanupSeriesMedia(drama.id)).released_bytes,0);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes-drama.sizes[0]);
});

test('deleting every unpurchased episode archives the empty series without resetting its original publication date',async()=>{
  const drama=await fixture(),proof=await preview(drama);await request(batchPath(drama),confirmation(drama,proof),drama.owner.cookie);
  assert.equal(one('SELECT status FROM series WHERE id=?',drama.id)!.status,'archived');assert.equal(one('SELECT published_at FROM series_publications WHERE series_id=?',drama.id)!.published_at,'2025-01-01 00:00:00');
  await request('/api/series/'+drama.id,undefined,'',404);assert.deepEqual((await state(drama)).episodes,[]);
});

test('active chunk uploads and financial holds in either mode block batch changes and legacy individual edits',async()=>{
  const drama=await fixture(),rev=await revision(drama),uploadId=pending(drama),body={action:'rename',revision:rev,episode_ids:drama.ids,base_name:'Blocked'};
  for(const [route,payload,method] of [[batchPath(drama),body,'POST'],['/api/studio/episodes/'+drama.ids[0],{title:'Blocked',number:1},'PATCH'],['/api/studio/episodes/'+drama.ids[0],undefined,'DELETE']] as const){const denied=await request(route,payload,drama.owner.cookie,409,method);assert.equal(denied.data.error.code,'EPISODE_UPLOAD_PENDING');}
  run("UPDATE episode_upload_sessions SET status='cancelled',cleanup_pending=0 WHERE id=?",uploadId);
  for(const [group,live] of [['default',1],['test',0]] as const){
    const caseId=randomUUID();run("INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES (?,?,?,'dispute',?,?,'open')",caseId,group,live,'local-risk-'+caseId,drama.owner.id);
    try{const denied=await request(batchPath(drama),{...body,revision:await revision(drama)},drama.owner.cookie,423);assert.equal(denied.data.error.code,'PAYMENT_REVIEW_REQUIRED');await request('/api/studio/episodes/'+drama.ids[0],{title:'Held',number:1},drama.owner.cookie,423,'PATCH');await request('/api/studio/episodes/'+drama.ids[0],undefined,drama.owner.cookie,423,'DELETE');}finally{run('DELETE FROM payment_risk_cases WHERE id=?',caseId);}
  }
});

test('creator batch changes cannot bypass a moderation takedown',async()=>{
  const drama=await fixture(),rev=await revision(drama);setSeriesModeration(admin.id,drama.id,'takedown','A rights review prevents creator modifications.');
  for(const body of [{action:'rename',revision:rev,episode_ids:drama.ids,base_name:'Blocked'},{action:'reorder',revision:rev,episode_ids:drama.ids,acknowledge_access_change:true}])await request(batchPath(drama),body,drama.owner.cookie,423);
});

test('legacy individual deletion uses the same durable cleanup and never grants quota before storage confirms removal',async()=>{
  const drama=await fixture(),remove=fs.rm.bind(fs),failure=mock.method(fs,'rm',async(file:any,options:any)=>{if(String(file).endsWith(drama.keys[0]))throw new Error('Local object removal unavailable.');return remove(file,options);});
  try{const result=(await request('/api/studio/episodes/'+drama.ids[0],undefined,drama.owner.cookie,200,'DELETE')).data;assert.equal(result.deleted,true);assert.equal(result.cleanup_pending,true);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes);}finally{failure.mock.restore();}
  await cleanupSeriesMedia(drama.id);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner.id)!.used_bytes,drama.bytes-drama.sizes[0]);assert.equal((await cleanupSeriesMedia(drama.id)).released_bytes,0);
});
