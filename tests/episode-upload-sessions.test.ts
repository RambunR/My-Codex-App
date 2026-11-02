import {after,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-chunk-sessions-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='demo';
// Model an existing deployment whose immutable episode table predates the
// four-minute limit. New schema initialization must preserve its data and FKs.
const {DatabaseSync}=await import('node:sqlite');const legacy=new DatabaseSync(path.join(directory,'platform.sqlite'));
legacy.exec(`CREATE TABLE episodes (
 id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,title TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number>0),duration REAL NOT NULL CHECK(duration>0 AND duration<=180),
 bytes INTEGER NOT NULL CHECK(bytes>0),storage_key TEXT NOT NULL,original_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(series_id,number)
);`);legacy.close();
const {config}=await import('../server/config');
const {episodeUploadStorage}=await import('../server/chunked-storage');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const {AppError}=await import('../server/errors');
const {MAX_EPISODE_BYTES}=await import('../shared/config');
const moderation=await import('../server/moderation');
const origin='https://chunk-sessions.example.test',partBytes=5*1024**2;
interface Identity{id:string;cookie:string}
interface Fixture{series:string;owner:Identity;other:Identity;viewer:Identity;admin:Identity;route:string}
interface Multipart{key:string;parts:Map<number,Buffer>;aborted:boolean}
const multipart=new Map<string,Multipart>(),objects=new Map<string,Buffer>();
const calls={created:0,completed:0,aborted:0,removed:0,parts:0};
let server:Server,base:string,validationDuration=1;
let beforeValidate:(()=>Promise<void>)|undefined,beforePart:(()=>Promise<void>)|undefined;
const physical=(key:string)=>path.join(directory,'objects',key);
function identity(role:'publisher'|'admin'|'viewer'):Identity{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,?)',id,id+'@chunks.test','Chunk '+role,'unused-fixture-password',role,role==='viewer'?0:1);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+86400_000);
  return{id,cookie:'drama_session='+token};
}
function fixture():Fixture{
  const owner=identity('publisher'),other=identity('publisher'),viewer=identity('viewer'),admin=identity('admin'),series=randomUUID();
  run('INSERT INTO series (id,creator_id,title,description,language,genres,status) VALUES (?,?,?,?,?,?,?)',series,owner.id,'Chunk upload '+series,'A private original drama for bounded multipart upload verification.','en','["drama"]','draft');
  return{series,owner,other,viewer,admin,route:'/api/studio/series/'+series+'/episode-uploads'};
}
async function request(route:string,body:unknown=undefined,actor?:Identity,expected:number|number[]=200,method=body===undefined?'GET':'POST',overrideOrigin=origin){
  const raw=Buffer.isBuffer(body),response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':raw?'application/octet-stream':'application/json',Origin:overrideOrigin})},body:body===undefined?undefined:raw?new Uint8Array(body):JSON.stringify(body)});
  const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{assert.fail(`${method} ${route} returned non-JSON ${response.status}: ${text.slice(0,150)}`);}
  assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);return{status:response.status,data};
}
const input=(size:number,number=1)=>({title:'Episode '+number,number,filename:`Episode ${String(number).padStart(3,'0')}—中文.mp4`,size});
async function start(f:Fixture,size:number,number=1,actor=f.owner){return(await request(f.route,input(size,number),actor,201)).data;}
const partRoute=(f:Fixture,id:string,number:number)=>f.route+'/'+id+'/parts/'+number;
const completeRoute=(f:Fixture,id:string)=>f.route+'/'+id+'/complete';
const used=(f:Fixture)=>Number(one('SELECT used_bytes FROM users WHERE id=?',f.owner.id)!.used_bytes);
async function uploadSmall(f:Fixture,bytes=Buffer.from('local validated video fixture'),number=1){const session=await start(f,bytes.length,number);await request(partRoute(f,session.id,1),bytes,f.owner,200,'PUT');return{session,bytes};}
const financial=()=>({users:all('SELECT id,wallet_micros,earnings_micros,publisher_active,quota_bytes FROM users ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id')});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}

before(async()=>{
  mock.method(episodeUploadStorage,'enabled',()=>true);
  mock.method(episodeUploadStorage,'create',async(key:string)=>{calls.created++;const id='fake-r2-'+randomUUID();multipart.set(id,{key,parts:new Map(),aborted:false});return id;});
  mock.method(episodeUploadStorage,'part',async(key:string,id:string,number:number,bytes:Uint8Array)=>{calls.parts++;await beforePart?.();const upload=multipart.get(id);if(!upload||upload.aborted||upload.key!==key)throw new Error('Multipart upload is unavailable.');const saved=Buffer.from(bytes);upload.parts.set(number,saved);return{partNumber:number,etag:createHash('sha256').update(saved).digest('hex')};});
  mock.method(episodeUploadStorage,'complete',async(key:string,id:string,parts:Array<{partNumber:number;etag:string}>)=>{calls.completed++;const upload=multipart.get(id);if(!upload||upload.aborted||upload.key!==key)throw new Error('Multipart upload is unavailable.');const bytes=Buffer.concat(parts.map(part=>{const bytes=upload.parts.get(part.partNumber)!;assert.ok(bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),part.etag);return bytes;}));objects.set(key,bytes);await mkdir(path.dirname(physical(key)),{recursive:true});await writeFile(physical(key),bytes);});
  mock.method(episodeUploadStorage,'abort',async(_key:string,id:string)=>{calls.aborted++;const upload=multipart.get(id);if(upload)upload.aborted=true;});
  mock.method(episodeUploadStorage,'head',async(key:string)=>objects.has(key)?{size:objects.get(key)!.length}:null);
  mock.method(episodeUploadStorage,'validate',async(key:string)=>{await beforeValidate?.();const bytes=objects.get(key);if(!bytes)throw new AppError(404,'MEDIA_UNAVAILABLE','Media file is unavailable.');return{bytes:bytes.length,duration:validationDuration};});
  mock.method(episodeUploadStorage,'remove',async(key:string)=>{calls.removed++;objects.delete(key);await rm(physical(key),{force:true});});
  config.appUrl=origin;const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{config.production=false;config.sandbox=false;config.payments='demo';config.stripeTestMode=false;validationDuration=1;beforeValidate=undefined;beforePart=undefined;});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));mock.restoreAll();db.close();await rm(directory,{recursive:true,force:true});});

test('chunked upload sessions enforce authentication, owner access, origin and the exact 200 MiB declared-size cap',async()=>{
  const f=fixture(),before=calls.created;
  await request(f.route,input(31),undefined,401);
  await request(f.route,input(31),f.viewer,403);
  await request(f.route,input(31),f.other,403);
  await request(f.route,input(31),f.owner,403,'POST','https://foreign.example');
  await request(f.route,input(MAX_EPISODE_BYTES+1),f.owner,[400,413]);
  await request(f.route,input(0),f.owner,400);
  assert.equal(calls.created,before);assert.equal(used(f),0);
  const session=await start(f,MAX_EPISODE_BYTES);assert.equal(session.chunkBytes,partBytes);assert.equal(session.partCount,40);assert.ok(Date.parse(session.expiresAt)>Date.now());assert.ok(!JSON.stringify(session).includes('fake-r2-'));
  await request(f.route+'/'+session.id,undefined,f.owner,200,'DELETE');assert.equal(used(f),0);
});

test('pending upload reservations prevent overcommitting creator quota and cancellation releases the reservation',async()=>{
  const f=fixture();run('UPDATE users SET quota_bytes=? WHERE id=?',partBytes+17,f.owner.id);
  const first=await start(f,partBytes+17);await request(f.route,input(1,2),f.owner,413);assert.equal(used(f),0);
  await request(f.route+'/'+first.id,undefined,f.other,403,'DELETE');
  await request(f.route+'/'+first.id,undefined,f.owner,200,'DELETE');const second=await start(f,17,2);assert.ok(second.id!==first.id);assert.equal(used(f),0);
  await request(f.route+'/'+second.id,undefined,f.owner,200,'DELETE');
});

test('chunk sizes, part bounds, actor binding and a complete manifest are validated before an episode can commit',async()=>{
  const f=fixture(),session=await start(f,partBytes+13),before=used(f);
  await request(partRoute(f,session.id,1),Buffer.alloc(partBytes,1),f.other,403,'PUT');
  await request(partRoute(f,session.id,0),Buffer.alloc(13),f.owner,[400,404],'PUT');
  await request(partRoute(f,session.id,3),Buffer.alloc(13),f.owner,400,'PUT');
  await request(partRoute(f,session.id,1),Buffer.alloc(13),f.owner,[400,422],'PUT');
  await request(partRoute(f,session.id,1),Buffer.alloc(partBytes+1),f.owner,413,'PUT');
  await request(completeRoute(f,session.id),{},f.owner,409);assert.equal(used(f),before);
  await request(partRoute(f,session.id,1),Buffer.alloc(partBytes,1),f.owner,200,'PUT');
  await request(partRoute(f,session.id,2),Buffer.alloc(12,2),f.owner,[400,422],'PUT');
  await request(completeRoute(f,session.id),{},f.owner,409);
  await request(f.route+'/'+session.id,undefined,f.owner,200,'DELETE');
});

test('a repeated identical part is safe but changed bytes cannot overwrite an accepted part',async()=>{
  const f=fixture(),bytes=Buffer.from('An immutable accepted part'),session=await start(f,bytes.length);
  await request(partRoute(f,session.id,1),bytes,f.owner,200,'PUT');const writes=calls.parts;
  await request(partRoute(f,session.id,1),bytes,f.owner,200,'PUT');assert.equal(calls.parts,writes);
  await request(partRoute(f,session.id,1),Buffer.alloc(bytes.length,0x44),f.owner,409,'PUT');
  const completed=await request(completeRoute(f,session.id),{},f.owner,201);assert.equal(completed.data.bytes,bytes.length);assert.equal(used(f),bytes.length);
  const episode=one('SELECT * FROM episodes WHERE id=?',completed.data.id)!;assert.deepEqual(await readFile(physical(episode.storage_key)),bytes);
});

test('completion replay returns the same episode without charging quota or altering financial records twice',async()=>{
  const f=fixture(),{session,bytes}=await uploadSmall(f),before=financial(),first=await request(completeRoute(f,session.id),{},f.owner,201),completedCalls=calls.completed;
  const second=await request(completeRoute(f,session.id),{},f.owner,200);assert.equal(second.data.id,first.data.id);assert.equal(used(f),bytes.length);assert.equal(calls.completed,completedCalls);
  assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,1);assert.deepEqual(financial(),before);
  await request(partRoute(f,session.id,1),bytes,f.owner,[409,410],'PUT');
  await request(f.route+'/'+session.id,undefined,f.owner,[200,409],'DELETE');assert.equal(used(f),bytes.length);assert.ok(one('SELECT id FROM episodes WHERE id=?',first.data.id));
});

test('concurrent completion cannot create duplicate episodes or release a committed file',async()=>{
  const f=fixture(),{session,bytes}=await uploadSmall(f),entered=deferred(),release=deferred();
  beforeValidate=async()=>{entered.resolve();await release.promise;};
  const first=request(completeRoute(f,session.id),{},f.owner,201);await entered.promise;
  const second=request(completeRoute(f,session.id),{},f.owner,200);release.resolve();
  const[result,replay]=await Promise.all([first,second]);beforeValidate=undefined;assert.equal(replay.data.id,result.data.id);
  assert.equal(used(f),bytes.length);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,1);const episode=one('SELECT * FROM episodes WHERE id=?',result.data.id)!;assert.deepEqual(await readFile(physical(episode.storage_key)),bytes);
});

test('duration is checked again at finalization and an over-four-minute file never becomes an episode',async()=>{
  const f=fixture(),{session}=await uploadSmall(f);validationDuration=241;
  const response=await request(completeRoute(f,session.id),{},f.owner,422);assert.equal(response.data.error.code,'VIDEO_TOO_LONG');assert.equal(used(f),0);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,0);
  await request(f.route+'/'+session.id,undefined,f.owner,200,'DELETE');
  const next=await uploadSmall(f);validationDuration=240;const accepted=await request(completeRoute(f,next.session.id),{},f.owner,201);assert.equal(accepted.data.duration,240);
  assert.ok(Number(one('SELECT duration FROM episodes WHERE id=?',accepted.data.id)!.duration)<=180,'Existing episode CHECK constraints remain valid.');
  const studio=(await request('/api/studio/series/'+f.series,undefined,f.owner)).data;assert.equal(studio.episodes.find((episode:any)=>episode.id===accepted.data.id).duration,240);
  const publicDetails=(await request('/api/series/'+f.series,undefined,f.owner)).data;assert.equal(publicDetails.episodes.find((episode:any)=>episode.id===accepted.data.id).duration,240);
});

test('moderation and financial holds are rechecked after session creation',async()=>{
  const f=fixture(),session=await start(f,17);moderation.setSeriesModeration(f.admin.id,f.series,'takedown','An existing rights review must still prevent uploads.');
  await request(partRoute(f,session.id,1),Buffer.alloc(17),f.owner,423,'PUT');await request(completeRoute(f,session.id),{},f.owner,423);assert.equal(used(f),0);
  moderation.setSeriesModeration(f.admin.id,f.series,'restore','The local fixture review is complete and upload can resume.');
  const caseId=randomUUID();run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES (?,?,?,?,?,?,?)',caseId,'default',0,'dispute','local-chunk-hold-'+caseId,f.owner.id,'open');
  try{await request(partRoute(f,session.id,1),Buffer.alloc(17),f.owner,423,'PUT');await request(completeRoute(f,session.id),{},f.owner,423);assert.equal(used(f),0);}finally{run("UPDATE payment_risk_cases SET status='resolved' WHERE id=?",caseId);}
  await request(f.route+'/'+session.id,undefined,f.owner,200,'DELETE');
});

test('deleting a series while upload validation awaits removes uncommitted media without inventing quota credit',async()=>{
  const f=fixture(),{session}=await uploadSmall(f),entered=deferred(),release=deferred();
  beforeValidate=async()=>{entered.resolve();await release.promise;};const completion=request(completeRoute(f,session.id),{},f.owner,[404,409]);await entered.promise;
  try{const preview=(await request('/api/studio/series/'+f.series+'/lifecycle',undefined,f.owner)).data;await request('/api/studio/series/'+f.series,{confirmation_token:preview.confirmation_token,confirm_title:preview.series.title,acknowledge:true},f.owner,200,'DELETE');}finally{release.resolve();}
  await completion;beforeValidate=undefined;assert.equal(used(f),0);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,0);
});

test('expired sessions abort persisted multipart state, release reserved capacity and never charge storage',async()=>{
  const f=fixture(),session=await start(f,partBytes+3);await request(partRoute(f,session.id,1),Buffer.alloc(partBytes,7),f.owner,200,'PUT');
  run('UPDATE episode_upload_sessions SET expires_at_ms=? WHERE id=?',Date.now()-1,session.id);
  await request(partRoute(f,session.id,2),Buffer.alloc(3),f.owner,410,'PUT');
  const service=await import('../server/episode-upload-sessions');await service.cleanupExpiredEpisodeUploads();
  const saved=one('SELECT * FROM episode_upload_sessions WHERE id=?',session.id)!;assert.equal(saved.status,'cancelled');assert.equal(saved.cleanup_pending,0);assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),0);assert.equal(used(f),0);
  assert.equal(one('SELECT COUNT(*) AS n FROM episode_upload_parts WHERE session_id=?',session.id)!.n,0);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,0);
});

test('cancellation ordered behind an in-flight part aborts it durably without creating an episode',async()=>{
  const f=fixture(),session=await start(f,17),entered=deferred(),release=deferred(),aborted=calls.aborted;
  beforePart=async()=>{entered.resolve();await release.promise;};
  const sending=request(partRoute(f,session.id,1),Buffer.alloc(17,5),f.owner,200,'PUT');await entered.promise;
  const cancellation=request(f.route+'/'+session.id,undefined,f.owner,200,'DELETE');release.resolve();await Promise.all([sending,cancellation]);beforePart=undefined;
  assert.ok(calls.aborted>aborted);assert.equal(used(f),0);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,0);
  await request(completeRoute(f,session.id),{},f.owner,409);
});

test('durable completion state reuses an assembled object after a transient validation failure',async()=>{
  const f=fixture(),{session,bytes}=await uploadSmall(f),savedValidate=episodeUploadStorage.validate,completeCalls=calls.completed;
  let first=true;mock.method(episodeUploadStorage,'validate',async(key:string)=>{if(first){first=false;throw new Error('Transient storage validation fixture.');}return savedValidate(key);});
  try{
    await request(completeRoute(f,session.id),{},f.owner,500);assert.equal(used(f),0);assert.equal(calls.completed,completeCalls+1);
    const completed=await request(completeRoute(f,session.id),{},f.owner,201);assert.equal(completed.data.bytes,bytes.length);assert.equal(calls.completed,completeCalls+1);assert.equal(used(f),bytes.length);
  }finally{mock.method(episodeUploadStorage,'validate',savedValidate);}
});

test('failed cancellation cleanup keeps its quota reservation until a later successful retry',async()=>{
  const f=fixture();run('UPDATE users SET quota_bytes=? WHERE id=?',17,f.owner.id);const session=await start(f,17),remove=episodeUploadStorage.remove;
  let fail=true;mock.method(episodeUploadStorage,'remove',async(key:string)=>{if(fail)throw new Error('Storage cleanup fixture failure.');await remove(key);});
  try{
    const cancelled=await request(f.route+'/'+session.id,undefined,f.owner,200,'DELETE');assert.equal(cancelled.data.cleanup_pending,true);
    const service=await import('../server/episode-upload-sessions');assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),17);assert.equal(used(f),0);
    await request(f.route,input(17,2),f.owner,413);fail=false;await service.cleanupExpiredEpisodeUploads();assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),0);
    const retry=await start(f,17,2);await request(f.route+'/'+retry.id,undefined,f.owner,200,'DELETE');assert.equal(used(f),0);
  }finally{mock.method(episodeUploadStorage,'remove',remove);}
});

test('a part finishing after series deletion is not recorded and its durable session is cleaned without quota credit',async()=>{
  const f=fixture(),session=await start(f,17),entered=deferred(),release=deferred();beforePart=async()=>{entered.resolve();await release.promise;};
  const sending=request(partRoute(f,session.id,1),Buffer.alloc(17,5),f.owner,[404,409],'PUT');await entered.promise;
  try{const preview=(await request('/api/studio/series/'+f.series+'/lifecycle',undefined,f.owner)).data;await request('/api/studio/series/'+f.series,{confirmation_token:preview.confirmation_token,confirm_title:preview.series.title,acknowledge:true},f.owner,200,'DELETE');}finally{release.resolve();}
  await sending;beforePart=undefined;const service=await import('../server/episode-upload-sessions');await service.cleanupExpiredEpisodeUploads();
  assert.equal(one('SELECT COUNT(*) AS n FROM episode_upload_parts WHERE session_id=?',session.id)!.n,0);assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),0);assert.equal(used(f),0);
});

test('administrator-owned chunked uploads reserve and account actual bytes above quota with safe completion replay',async()=>{
  const f=fixture(),prior=6*1024**3;run("UPDATE users SET role='admin',publisher_active=0,quota_bytes=0,used_bytes=? WHERE id=?",prior,f.owner.id);
  const before=financial(),bytes=Buffer.from('Administrator episode beyond any numeric quota'),session=await start(f,bytes.length),second=await start(f,17,2),service=await import('../server/episode-upload-sessions');
  assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),bytes.length+17);assert.equal(used(f),prior);
  await request(partRoute(f,session.id,1),bytes,f.owner,200,'PUT');const first=(await request(completeRoute(f,session.id),{},f.owner,201)).data;
  assert.equal(first.owner_storage.storage_unlimited,true);assert.equal(first.user.storage_unlimited,true);assert.equal(first.owner_storage.quota_bytes,0);assert.equal(first.owner_storage.used_bytes,prior+bytes.length);assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),17);
  const replay=(await request(completeRoute(f,session.id),{},f.owner)).data;assert.equal(replay.id,first.id);assert.equal(used(f),prior+bytes.length);assert.deepEqual(financial(),before);
  await request(f.route+'/'+second.id,undefined,f.owner,200,'DELETE');assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),0);assert.equal(used(f),prior+bytes.length);
  await request(f.route,input(MAX_EPISODE_BYTES+1,3),f.owner,413);
});

test('an administrator uploading to a publisher-owned series still obeys that owner quota and reservations',async()=>{
  const f=fixture();run('UPDATE users SET quota_bytes=0 WHERE id=?',f.owner.id);
  const denied=await request(f.route,input(17),f.admin,413);assert.equal(denied.data.error.code,'QUOTA_EXCEEDED');assert.equal(used(f),0);
  run('UPDATE users SET quota_bytes=17 WHERE id=?',f.owner.id);const session=await start(f,17,1,f.admin);await request(f.route,input(1,2),f.admin,413);await request(f.route+'/'+session.id,undefined,f.admin,200,'DELETE');
});

test('a role removed while chunked media validates cannot commit beyond the retained publisher quota',async()=>{
  const f=fixture();run("UPDATE users SET role='admin',quota_bytes=0 WHERE id=?",f.owner.id);const{session}=await uploadSmall(f);
  beforeValidate=async()=>{run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",f.owner.id);};
  const result=await request(completeRoute(f,session.id),{},f.owner,413);assert.equal(result.data.error.code,'QUOTA_EXCEEDED');assert.equal(used(f),0);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',f.series)!.n,0);
  const service=await import('../server/episode-upload-sessions');assert.equal(service.reservedEpisodeUploadBytes(f.owner.id),0);
});

test('unlimited administrator chunked uploads retain duration validation and financial hold guards',async()=>{
  const f=fixture();run("UPDATE users SET role='admin',quota_bytes=0 WHERE id=?",f.owner.id);const{session}=await uploadSmall(f);validationDuration=241;
  const invalid=await request(completeRoute(f,session.id),{},f.owner,422);assert.equal(invalid.data.error.code,'VIDEO_TOO_LONG');assert.equal(used(f),0);
  const hold=randomUUID();run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES (?,?,?,?,?,?,?)',hold,'default',0,'dispute','unlimited-chunk-hold-'+hold,f.owner.id,'open');
  try{await request(f.route,input(17,2),f.owner,423);}finally{run("UPDATE payment_risk_cases SET status='resolved' WHERE id=?",hold);}
});
