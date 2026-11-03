import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-last-episode-free-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';delete process.env.S3_BUCKET;
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const {config}=await import('../server/config');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {setSeriesModeration}=await import('../server/moderation');
const {writeEpisodeDuration}=await import('../server/episode-duration');
const origin='https://last-episode-free.example.test';
const details={title:'A last free episode drama',description:'An original drama used to verify optional final-episode access.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
interface Actor{id:string;cookie:string}
interface Fixture{id:string;ids:string[];numbers:number[]}
let server:Server,base:string,owner:Actor,other:Actor,viewer:Actor,admin:Actor;
function identity(role='publisher'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros) VALUES (?,?,?,?,?,?,?)',id,id+'@last-episode.test','Final episode '+role,'unused-local-hash',role,role==='viewer'?0:1,5_000_000);
  run('INSERT INTO test_accounts (user_id,wallet_micros,publisher_active) VALUES (?,?,?)',id,9_000_000,role==='viewer'?0:1);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,actor?:Actor,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
async function create(values:Record<string,unknown>={},actor=owner){return(await request('/api/studio/series',{...details,title:'Optional last episode '+randomUUID(),...values},actor,201)).id as string;}
async function edit(id:string,values:Record<string,unknown>={},actor=owner,status=200){const row=one('SELECT title,description,language,genres,creation_type,price_cents,free_episodes FROM series WHERE id=?',id)!;return request('/api/studio/series/'+id,{...row,genres:JSON.parse(row.genres),...values},actor,status,'PATCH');}
async function read(id:string,actor=owner){return request('/api/studio/series/'+id,undefined,actor);}
async function episode(seriesId:string,number:number,duration=10){
  const id=randomUUID(),key='videos/final-free/'+id+'.mp4',bytes=Buffer.alloc(32,number);run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',id,seriesId,'Episode '+number,number,Math.min(duration,180),bytes.length,key);writeEpisodeDuration(id,duration);
  const file=path.join(directory,'objects',key);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',bytes.length,owner.id);return id;
}
async function fixture(numbers=[1,2,3],free=1,last=true):Promise<Fixture>{const id=await create({free_episodes:free,last_episode_free:last});const ids=[];for(const number of numbers)ids.push(await episode(id,number));run("UPDATE series SET status='published',cover_key='public:/images/midnight.jpg' WHERE id=?",id);return{id,ids,numbers};}
const flags=async(f:Fixture)=>(await request('/api/series/'+f.id)).episodes.map((item:any)=>({id:item.id,free:item.free,unlocked:item.unlocked}));
function financial(){const state:Record<string,unknown>={};for(const table of ['users','test_accounts','purchases','test_purchases','payments','test_payments','ledger','test_ledger'])state[table]=all('SELECT * FROM '+table+' ORDER BY rowid');return state;}
async function stream(id:string,actor?:Actor,status=200){const response=await fetch(base+'/api/episodes/'+id+'/stream',{headers:actor?{Cookie:actor.cookie}:undefined});assert.equal(response.status,status,'stream '+id);if(status===200)assert.equal((await response.arrayBuffer()).byteLength,32);return response;}
before(async()=>{config.appUrl=origin;owner=identity();other=identity();viewer=identity('viewer');admin=identity('admin');const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
beforeEach(()=>{config.stripeTestMode=false;config.sandbox=false;config.payments='disabled';});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('new and legacy series default false; optional edits persist across additive schema initialization without rewriting episodes or finances',async()=>{
  const created=await create();assert.equal((await read(created)).series.last_episode_free,false);
  const legacy=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres) VALUES (?,?,?,?,?,?)',legacy,owner.id,details.title,details.description,'en','["drama"]');const legacyRow=one('SELECT * FROM series WHERE id=?',legacy);
  const before=financial();db.exec(DATABASE_SCHEMA);assert.equal((await read(legacy)).series.last_episode_free,false);assert.deepEqual(one('SELECT * FROM series WHERE id=?',legacy),legacyRow);
  const f=await fixture(),money=financial();const episodeRows=all('SELECT * FROM episodes WHERE series_id=? ORDER BY number',f.id);await edit(f.id,{last_episode_free:true});await edit(f.id,{description:'An older editor saves details without the optional access field.'});assert.equal((await read(f.id)).series.last_episode_free,true);
  db.exec(DATABASE_SCHEMA);assert.equal((await read(f.id)).series.last_episode_free,true);await edit(f.id,{last_episode_free:false});assert.equal((await read(f.id)).series.last_episode_free,false);assert.deepEqual(all('SELECT * FROM episodes WHERE series_id=? ORDER BY number',f.id),episodeRows);
  assert.deepEqual(financial(),money);assert.deepEqual(all('SELECT * FROM purchases'),before.purchases);assert.deepEqual(all('SELECT * FROM ledger'),before.ledger);
});

test('malformed access inputs reject atomically and retain authorization, ownership, takedown and administrator audit guards',async()=>{
  const f=await fixture(),before=financial(),row=one('SELECT * FROM series WHERE id=?',f.id),rev=(await read(f.id)).episodes_revision,count=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const last_episode_free of [null,0,1,'true','false',{},[]]){await request('/api/studio/series',{...details,last_episode_free},owner,400);await edit(f.id,{last_episode_free},owner,400);}
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);assert.deepEqual(one('SELECT * FROM series WHERE id=?',f.id),row);assert.equal((await read(f.id)).episodes_revision,rev);
  await request('/api/studio/series',{...details,last_episode_free:true},undefined,401);await request('/api/studio/series',{...details,last_episode_free:true},viewer,403);await edit(f.id,{last_episode_free:false},other,403);
  setSeriesModeration(admin.id,f.id,'takedown','A rights complaint requires an administrator review.');await edit(f.id,{last_episode_free:false},owner,423);await edit(f.id,{last_episode_free:false},admin);
  const audit=(await request('/api/admin/series/'+f.id+'/moderation',undefined,admin)).events.find((event:any)=>event.action==='metadata');assert.equal(audit.snapshot.before.last_episode_free,true);assert.equal(audit.snapshot.after.last_episode_free,false);assert.deepEqual(financial(),before);await request('/api/series/'+f.id,undefined,undefined,404);
});

test('free access uses the highest persisted episode number with gaps, overlaps, a single episode and no episodes',async()=>{
  for(const[numbers,first,last,expected]of [[[1,4,9],1,true,[true,false,true]],[[2,9],0,true,[false,true]],[[9],0,true,[true]],[[1,2],9,true,[true,true]],[[],0,true,[]],[[1,4,9],1,false,[true,false,false]]] as const){
    const f=await fixture([...numbers],first,last);assert.deepEqual((await flags(f)).map((episode:any)=>episode.free),expected);assert.deepEqual((await flags(f)).map((episode:any)=>episode.unlocked),expected);assert.equal((await request('/api/series/'+f.id)).series.free_episode_count,expected.filter(Boolean).length);
  }
  const f=await fixture([1,2],1,false);writeEpisodeDuration(f.ids[1],240);assert.equal((await request('/api/series/'+f.id)).series.last_episode_free,false);assert.equal((await flags(f))[1].free,false);
});

test('guests can stream and track the free final episode while middle episodes and revoked playback remain locked',async()=>{
  const f=await fixture([1,4,9],1,true);await stream(f.ids[0]);await stream(f.ids[2]);await stream(f.ids[1],undefined,403);await request('/api/episodes/'+f.ids[1]+'/playback',{},undefined,403);
  const response=await fetch(base+'/api/episodes/'+f.ids[2]+'/playback',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'});assert.equal(response.status,200);const receipt=await response.json() as any,cookie=response.headers.get('set-cookie')!.split(';')[0],guest={id:'guest',cookie};assert.ok(receipt.sessionId);
  await request('/api/playback/'+receipt.sessionId,{watchedMs:1000},guest,200,'PUT');await request('/api/episodes/'+f.ids[2]+'/progress',{seconds:3},viewer);await request('/api/episodes/'+f.ids[1]+'/progress',{seconds:3},viewer,403);
  await edit(f.id,{last_episode_free:false});await stream(f.ids[2],undefined,403);await request('/api/playback/'+receipt.sessionId,{watchedMs:2000},guest,403,'PUT');await request('/api/episodes/'+f.ids[2]+'/progress',{seconds:4},viewer,403);assert.equal(one('SELECT seconds FROM progress WHERE user_id=? AND episode_id=?',viewer.id,f.ids[2])!.seconds,3);
});

test('free-final unlocks create no purchases, receipts, ledger entries or wallet movement in live and test modes',async()=>{
  const f=await fixture([1,4,9],1,true);
  for(const testMode of [false,true]){config.stripeTestMode=testMode;const before=financial();const result=await request('/api/episodes/'+f.ids[2]+'/unlock',{},viewer);assert.equal(result.alreadyUnlocked,true);assert.deepEqual(financial(),before);await request('/api/episodes/'+f.ids[2]+'/unlock',{},viewer);assert.deepEqual(financial(),before);}
});

test('purchased final episodes retain entitlements when the option is enabled, disabled and moved by a newer episode',async()=>{
  const f=await fixture([1,4,9],1,false);for(const table of ['purchases','test_purchases'])run('INSERT INTO '+table+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,f.ids[2],100_000,70_000,30_000);const before=financial();
  for(const testMode of [false,true]){config.stripeTestMode=testMode;await edit(f.id,{last_episode_free:true});assert.equal((await request('/api/series/'+f.id,undefined,viewer)).episodes.find((e:any)=>e.id===f.ids[2]).free,true);await request('/api/episodes/'+f.ids[2]+'/unlock',{},viewer);await edit(f.id,{last_episode_free:false});const final=(await request('/api/series/'+f.id,undefined,viewer)).episodes.find((e:any)=>e.id===f.ids[2]);assert.equal(final.free,false);assert.equal(final.unlocked,true);await stream(f.ids[2],viewer);}
  assert.deepEqual(financial(),before);
  config.stripeTestMode=false;await edit(f.id,{last_episode_free:true});const newer=await episode(f.id,15),state=await request('/api/series/'+f.id,undefined,viewer),former=state.episodes.find((e:any)=>e.id===f.ids[2]);assert.equal(former.free,false);assert.equal(former.unlocked,true);assert.equal(state.episodes.find((e:any)=>e.id===newer).free,true);await stream(f.ids[2],viewer);assert.deepEqual(all('SELECT * FROM purchases ORDER BY rowid'),before.purchases);assert.deepEqual(all('SELECT * FROM test_purchases ORDER BY rowid'),before.test_purchases);assert.deepEqual(all('SELECT * FROM ledger ORDER BY rowid'),before.ledger);assert.deepEqual(all('SELECT * FROM test_ledger ORDER BY rowid'),before.test_ledger);
});

test('catalogue access filters and all public, private, administrator, publisher and history metadata use the same final-free rule',async()=>{
  const f=await fixture([4,9],0,true),single=await fixture([9],0,true),empty=await fixture([],0,true);const detail=(await request('/api/series/'+f.id)).series;run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer.id,f.ids[1],1);
  const sources=[detail,(await request('/api/series')).series.find((s:any)=>s.id===f.id),(await read(f.id)).series,(await request('/api/studio',undefined,owner)).series.find((s:any)=>s.id===f.id),(await request('/api/admin/series?limit=50',undefined,admin)).series.find((s:any)=>s.id===f.id),(await request('/api/publishers/'+detail.publisher_id+'?page_size=50')).series.find((s:any)=>s.id===f.id),(await request('/api/history',undefined,viewer)).history.find((s:any)=>s.id===f.id)];
  for(const source of sources){assert.equal(source.last_episode_free,true);assert.equal(source.access_type,'free-then-paid');assert.equal(source.free_episode_count,1);}
  assert.ok((await request('/api/series?access=free-then-paid')).series.some((s:any)=>s.id===f.id));assert.ok(!(await request('/api/series?access=all-paid')).series.some((s:any)=>s.id===f.id));assert.equal((await request('/api/series/'+single.id)).series.access_type,'all-free');assert.equal((await request('/api/series/'+empty.id)).series.access_type,null);
  await edit(f.id,{last_episode_free:false});assert.ok((await request('/api/series?access=all-paid')).series.some((s:any)=>s.id===f.id));
});

test('reordering a free final episode requires real access-change acknowledgement and access toggles invalidate old revisions',async()=>{
  const f=await fixture([1,4,9],0,true),before=financial(),state=await read(f.id),ordered=[f.ids[0],f.ids[2],f.ids[1]],route='/api/studio/series/'+f.id+'/episodes/batch';
  const rejected=await request(route,{action:'reorder',revision:state.episodes_revision,episode_ids:ordered},owner,409);assert.equal(rejected.error.code,'EPISODE_ACCESS_CONFIRM_REQUIRED');assert.deepEqual(all('SELECT id FROM episodes WHERE series_id=? ORDER BY number',f.id).map(e=>e.id),f.ids);
  await request(route,{action:'reorder',revision:state.episodes_revision,episode_ids:ordered,acknowledge_access_change:true},owner);assert.deepEqual((await flags(f)).map((e:any)=>[e.id,e.free]),[[f.ids[0],false],[f.ids[2],false],[f.ids[1],true]]);assert.deepEqual(financial(),before);
  const revision=(await read(f.id)).episodes_revision;await edit(f.id,{last_episode_free:false});const stale=await request(route,{action:'reorder',revision,episode_ids:ordered,acknowledge_access_change:true},owner,409);assert.equal(stale.error.code,'EPISODE_BATCH_STALE');
  const overlapping=await fixture([1,2],2,true),noChange=await read(overlapping.id);await request('/api/studio/series/'+overlapping.id+'/episodes/batch',{action:'reorder',revision:noChange.episodes_revision,episode_ids:[...overlapping.ids].reverse()},owner);
});

test('the final-free designation follows actual persisted additions and deletion instead of the old episode ID',async()=>{
  const f=await fixture([1,4,9],1,true),receipt=await request('/api/episodes/'+f.ids[2]+'/playback',{},viewer),added=await episode(f.id,15);assert.deepEqual((await flags(f)).map((e:any)=>[e.id,e.free]),[[f.ids[0],true],[f.ids[1],false],[f.ids[2],false],[added,true]]);await stream(f.ids[2],undefined,403);await stream(added);await request('/api/playback/'+receipt.sessionId,{watchedMs:1000},viewer,403,'PUT');
  await request('/api/studio/episodes/'+added,undefined,owner,200,'DELETE');assert.deepEqual((await flags(f)).map((e:any)=>[e.id,e.free]),[[f.ids[0],true],[f.ids[1],false],[f.ids[2],true]]);await stream(f.ids[2]);await request('/api/playback/'+receipt.sessionId,{watchedMs:1000},viewer,200,'PUT');
});

test('a real uploaded episode becomes the new free final episode only after authoritative upload commit',async()=>{
  const f=await fixture([1,4],1,true),file=path.join(directory,'uploaded-final.mp4');await promisify(execFile)(config.ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=64x64:r=1','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',file]);const bytes=await readFile(file),form=new FormData();form.append('video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}),'new-final.mp4');form.append('title','New finale');form.append('number','9');
  const response=await fetch(base+'/api/studio/series/'+f.id+'/episodes',{method:'POST',headers:{Cookie:owner.cookie,Origin:origin},body:form});const data=await response.json() as any;assert.equal(response.status,201,JSON.stringify(data));const current=await flags(f);assert.equal(current.find((e:any)=>e.id===f.ids[1]).free,false);assert.equal(current.find((e:any)=>e.id===data.id).free,true);assert.equal((await read(f.id)).series.last_episode_free,true);
});
