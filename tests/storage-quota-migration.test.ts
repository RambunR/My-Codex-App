import {after,before,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Server} from 'node:http';
import sharp from 'sharp';
import {DATABASE_SCHEMA} from '../shared/schema';
import {DEFAULT_QUOTA_BYTES,MAX_EPISODE_BYTES} from '../shared/config';

const GiB=1024**3,baseline=10*GiB,oldBaseline=5*GiB;
// Literal pre-upgrade DDL keeps the historical column default. The production
// schema must upgrade this referenced table without replacing it.
const legacyUsers=`CREATE TABLE users (
 id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer','publisher','admin')),
 publisher_active INTEGER NOT NULL DEFAULT 0,language TEXT NOT NULL DEFAULT 'en',
 wallet_micros INTEGER NOT NULL DEFAULT 0 CHECK(wallet_micros>=0),
 earnings_micros INTEGER NOT NULL DEFAULT 0 CHECK(earnings_micros>=0),
 quota_bytes INTEGER NOT NULL DEFAULT 5368709120 CHECK(quota_bytes>=0),
 used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes>=0),stripe_account_id TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;
const directory=await mkdtemp(path.join(tmpdir(),'lingying-storage-migration-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';delete process.env.S3_BUCKET;
const legacy=new DatabaseSync(path.join(directory,'platform.sqlite'));
legacy.exec('PRAGMA foreign_keys=ON;');legacy.exec(legacyUsers);legacy.exec(DATABASE_SCHEMA);
// Only ancillary current tables are needed for the pre-upgrade fixture. Remove
// the new insert guard before populating the historical account state.
legacy.exec('DROP TRIGGER users_minimum_storage_quota');
interface Actor{id:string;cookie:string}
function seedActor(connection:DatabaseSync,id:string,role:string,quota:number,used=0):Actor{
  connection.prepare('INSERT INTO users (id,email,name,password_hash,role,publisher_active,quota_bytes,used_bytes,wallet_micros,earnings_micros,stripe_account_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id+'@storage-migration.test','Retained '+role,'unused-local-hash',role,role==='publisher'?1:0,quota,used,12340000,7654321,'acct_retained_'+id,'2020-02-03 04:05:06');
  const token=randomBytes(32).toString('hex');connection.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
const owner=seedActor(legacy,'legacy-owner','publisher',oldBaseline,6*GiB),viewer=seedActor(legacy,'legacy-viewer','viewer',oldBaseline,1234),admin=seedActor(legacy,'legacy-admin','admin',0,30*GiB),custom=seedActor(legacy,'legacy-custom','publisher',20*GiB,12*GiB),ten=seedActor(legacy,'legacy-ten','publisher',10*GiB),nine=seedActor(legacy,'legacy-nine','publisher',9*GiB);
const retainedSeries='retained-storage-series',retainedEpisode='retained-storage-episode',mediaKey='legacy/retained-video.mp4',retainedBytes=Buffer.from('Existing private media stays byte-for-byte unchanged.');
legacy.prepare('INSERT INTO series (id,creator_id,title,description,language,genres,cover_key,cover_bytes,status) VALUES (?,?,?,?,?,?,?,?,?)').run(retainedSeries,owner.id,'Retained original drama','Existing private media, purchases and accounts survive the storage migration.','zh-TW','["drama"]','legacy/retained-cover.webp',42,'published');
legacy.prepare('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)').run(retainedEpisode,retainedSeries,'Retained episode',1,30,retainedBytes.length,mediaKey,'original.mp4');
for(const table of ['payments','test_payments'])legacy.prepare('INSERT INTO '+table+' (id,user_id,kind,amount_cents,currency,provider,provider_session,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(table+'-receipt',owner.id,'activation',8800,'hkd','stripe','cs_'+table+'_retained','paid','2021-03-04 05:06:07');
for(const table of ['purchases','test_purchases'])legacy.prepare('INSERT INTO '+table+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros,created_at) VALUES (?,?,?,?,?,?,?)').run(table+'-entitlement',viewer.id,retainedEpisode,110000,77000,33000,'2021-03-04 05:06:07');
for(const table of ['ledger','test_ledger'])legacy.prepare('INSERT INTO '+table+' (id,user_id,kind,amount_micros,reference_id,description,created_at) VALUES (?,?,?,?,?,?,?)').run(table+'-entry',owner.id,'sale',77000,retainedEpisode,'Retained financial entry','2021-03-04 05:06:07');
legacy.prepare('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)').run(owner.id,99000000,88000000,0);
for(const[actor,gb]of [[owner,6],[ten,10],[custom,6]] as const)legacy.prepare('INSERT INTO storage_requests (id,user_id,requested_gb,reason,created_at) VALUES (?,?,?,?,?)').run('request-'+actor.id,actor.id,gb,'Saved request with its original requested total.','2022-04-05 06:07:08');
legacy.prepare('INSERT INTO episode_upload_sessions (id,series_id,actor_id,creator_id,object_key,upload_id,episode_id,title,number,filename,total_bytes,status,created_at_ms,expires_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('retained-upload',retainedSeries,owner.id,owner.id,'legacy/pending.mp4','retained-multipart','pending-episode','Retained pending episode',99,'pending.mp4',99,'uploading',Date.now(),Date.now()+3_600_000);
const stateTables=['sessions','series','episodes','test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','creator_pass_consents','storage_requests','episode_upload_sessions','episode_upload_parts'];
function retainedState(connection:DatabaseSync){
  const state:Record<string,unknown>={users:connection.prepare('SELECT * FROM users ORDER BY id').all().map(({quota_bytes,...user})=>user)};
  for(const table of stateTables)state[table]=connection.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();return state;
}
const beforeMigration=retainedState(legacy),oldRootPage=legacy.prepare("SELECT rootpage FROM sqlite_master WHERE name='users'").get()!.rootpage;
assert.equal(legacy.prepare('SELECT quota_bytes FROM users WHERE id=?').get(owner.id)!.quota_bytes,oldBaseline);legacy.close();
await mkdir(path.join(directory,'objects','legacy'),{recursive:true});await writeFile(path.join(directory,'objects',mediaKey),retainedBytes);

// Importing the real database module performs the same initialization used by
// the Node application, against the saved pre-upgrade database above.
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const {episodeUploadStorage}=await import('../server/chunked-storage');
const {reservedEpisodeUploadBytes}=await import('../server/episode-upload-sessions');
const origin='https://storage-migration.example.test';let server:Server,base:string,cover:Buffer,video:Buffer,providerCreates=0;
function account(role:'publisher'|'admin'='publisher',used=0){return seedActor(db,randomUUID(),role,baseline,used);}
function series(actor:Actor){const id=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres) VALUES (?,?,?,?,?,?)',id,actor.id,'Storage boundary '+id,'An original local test series for the upgraded storage allowance.','en','["drama"]');return id;}
async function request(route:string,actor?:Actor,body?:unknown,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
async function upload(id:string,actor:Actor,kind:'cover'|'video',status=kind==='cover'?200:201,bytes=kind==='cover'?cover:video){
  const form=new FormData();form.append(kind,new Blob([new Uint8Array(bytes)]),kind==='cover'?'cover.png':'episode.mp4');if(kind==='video'){form.append('title','Original episode');form.append('number','1');}
  const response=await fetch(base+'/api/studio/series/'+id+(kind==='cover'?'/cover':'/episodes'),{method:'POST',headers:{Cookie:actor.cookie,Origin:origin},body:form});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
function finances(){const state:Record<string,unknown>={users:all('SELECT id,role,publisher_active,wallet_micros,earnings_micros,stripe_account_id FROM users ORDER BY id')};for(const table of ['test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','creator_pass_consents'])state[table]=all('SELECT * FROM '+table+' ORDER BY rowid');return state;}
before(async()=>{
  config.appUrl=origin;config.mailProvider='disabled';config.sandbox=false;
  mock.method(episodeUploadStorage,'enabled',()=>true);mock.method(episodeUploadStorage,'create',async()=>{providerCreates++;return'local-multipart-'+randomUUID();});mock.method(episodeUploadStorage,'head',async()=>null);mock.method(episodeUploadStorage,'abort',async()=>{});mock.method(episodeUploadStorage,'remove',async()=>{});
  cover=await sharp({create:{width:64,height:64,channels:3,background:'#59679a'}}).png().toBuffer();const file=path.join(directory,'fixture.mp4');await promisify(execFile)(config.ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=64x64:r=1','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',file]);video=await readFile(file);
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));mock.restoreAll();db.close();await rm(directory,{recursive:true,force:true});});

test('legacy initialization raises every lower account to 10 GiB while retaining higher quotas and all non-quota state',async()=>{
  assert.equal(DEFAULT_QUOTA_BYTES,baseline);
  for(const actor of [owner,viewer,admin,ten,nine])assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',actor.id)!.quota_bytes,baseline);
  assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',custom.id)!.quota_bytes,20*GiB);assert.deepEqual(retainedState(db),beforeMigration);
  assert.equal(one("SELECT rootpage FROM sqlite_master WHERE name='users'")!.rootpage,oldRootPage);assert.equal(all('PRAGMA table_info(users)').find(column=>column.name==='quota_bytes')!.dflt_value,String(oldBaseline));assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  assert.deepEqual(await readFile(path.join(directory,'objects',mediaKey)),retainedBytes);assert.equal(reservedEpisodeUploadBytes(owner.id),99);
});

test('fresh defaults and future inserts into old-default databases receive 10 GiB without an update-enforcement trigger',()=>{
  for(const old of [false,true]){
    const connection=new DatabaseSync(':memory:');try{
      if(old)connection.exec(legacyUsers);connection.exec(DATABASE_SCHEMA);
      const insert=connection.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)');insert.run('default','default@example.test','Default','unused');
      assert.equal(connection.prepare('SELECT quota_bytes FROM users WHERE id=?').get('default')!.quota_bytes,baseline);
      assert.equal(connection.prepare('PRAGMA table_info(users)').all().find(column=>column.name==='quota_bytes')!.dflt_value,String(old?oldBaseline:baseline));
      for(const quota of [0,6*GiB,20*GiB]){const id='explicit-'+quota;seedActor(connection,id,'publisher',quota);assert.equal(connection.prepare('SELECT quota_bytes FROM users WHERE id=?').get(id)!.quota_bytes,Math.max(quota,baseline));}
      connection.prepare('UPDATE users SET quota_bytes=17 WHERE id=?').run('default');assert.equal(connection.prepare('SELECT quota_bytes FROM users WHERE id=?').get('default')!.quota_bytes,17,'isolated capacity fixtures may lower an account until the next initialization');
      connection.exec(DATABASE_SCHEMA);assert.equal(connection.prepare('SELECT quota_bytes FROM users WHERE id=?').get('default')!.quota_bytes,baseline);
    }finally{connection.close();}
  }
});

test('reopening an upgraded legacy file is idempotent and never adds another allowance or reduces a custom quota',()=>{
  const file=path.join(directory,'restart.sqlite');let connection=new DatabaseSync(file);connection.exec(legacyUsers);
  const insert=connection.prepare('INSERT INTO users (id,email,name,password_hash,role,quota_bytes,used_bytes) VALUES (?,?,?,?,?,?,?)');insert.run('five','five@example.test','Five','unused','publisher',oldBaseline,6*GiB);insert.run('higher','higher@example.test','Higher','unused','publisher',20*GiB,12*GiB);
  connection.close();let snapshot:unknown;
  for(let restart=0;restart<3;restart++){
    connection=new DatabaseSync(file);try{connection.exec('PRAGMA foreign_keys=ON;');connection.exec(DATABASE_SCHEMA);const rows=connection.prepare('SELECT * FROM users ORDER BY id').all();assert.equal(rows.find(row=>row.id==='five')!.quota_bytes,baseline);assert.equal(rows.find(row=>row.id==='higher')!.quota_bytes,20*GiB);if(restart===0)snapshot=rows;else assert.deepEqual(rows,snapshot);assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(),[]);}finally{connection.close();}
  }
});

test('approving pre-upgrade 6 or 10 GiB requests preserves the new floor, higher custom quotas and original request details',async()=>{
  const before=finances();for(const actor of [owner,ten,custom]){
    const id='request-'+actor.id,original=one('SELECT * FROM storage_requests WHERE id=?',id)!;assert.equal(original.status,'pending');
    await request('/api/admin/storage-requests/'+id,viewer,{approve:true},403);await request('/api/admin/storage-requests/'+id,admin,{approve:true});
    assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',actor.id)!.quota_bytes,actor.id===custom.id?20*GiB:baseline);const saved=one<Record<string,unknown>>('SELECT * FROM storage_requests WHERE id=?',id)!;assert.deepEqual({...saved},{...original,status:'approved'});
    await request('/api/admin/storage-requests/'+id,admin,{approve:true},404);
  }assert.deepEqual(finances(),before);
});

test('configuration, authenticated accounts, Studio and media-owner payloads expose the migrated allowance and retained admin unlimited access',async()=>{
  const publicConfig=await request('/api/config');assert.equal(publicConfig.limits.quotaBytes,baseline);assert.equal(publicConfig.limits.maxEpisodeBytes,200*1024**2);assert.equal(publicConfig.limits.maxEpisodeSeconds,240);
  for(const actor of [owner,viewer,admin,custom]){
    const expected=actor.id===custom.id?20*GiB:baseline,me=(await request('/api/auth/me',actor)).user,studio=await request('/api/studio',actor);assert.equal(me.quota_bytes,expected);assert.equal(studio.user.quota_bytes,expected);assert.equal(me.storage_unlimited,actor.id===admin.id);assert.equal(studio.user.storage_unlimited,actor.id===admin.id);assert.equal(me.used_bytes,one('SELECT used_bytes FROM users WHERE id=?',actor.id)!.used_bytes);
  }
  const detail=await request('/api/studio/series/'+retainedSeries,owner);assert.deepEqual(detail.owner_storage,{used_bytes:6*GiB,quota_bytes:baseline,storage_unlimited:false});const adminSeries=series(admin),privateAdmin=await request('/api/studio/series/'+adminSeries,admin);assert.deepEqual(privateAdmin.owner_storage,{used_bytes:30*GiB,quota_bytes:baseline,storage_unlimited:true});
});

test('ordinary publishers can save real covers and episodes above 5 GiB but cannot exceed the migrated 10 GiB total',async()=>{
  const actor=account('publisher',6*GiB),id=series(actor),before=finances(),image=await upload(id,actor,'cover');assert.equal(image.owner_storage.quota_bytes,baseline);assert.equal(image.owner_storage.storage_unlimited,false);assert.ok(image.owner_storage.used_bytes>6*GiB);
  const saved=await upload(id,actor,'video');assert.ok(saved.bytes>0);assert.equal(saved.owner_storage.used_bytes,image.owner_storage.used_bytes+saved.bytes);assert.ok(saved.owner_storage.used_bytes<baseline);
  const fullSeries=series(actor);run('UPDATE users SET used_bytes=? WHERE id=?',baseline,actor.id);for(const kind of ['cover','video'] as const){const rejected=await upload(fullSeries,actor,kind,413);assert.equal(rejected.error.code,'QUOTA_EXCEEDED');}
  assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',fullSeries)!.n,0);assert.equal(one('SELECT cover_bytes FROM series WHERE id=?',fullSeries)!.cover_bytes,0);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',actor.id)!.used_bytes,baseline);
  const oversized=await upload(id,actor,'cover',413,Buffer.alloc(5*1024**2+1));assert.equal(oversized.error.code,'FILE_TOO_LARGE');assert.deepEqual(finances(),before);
});

test('chunk reservations enforce the new total for ordinary owners while unlimited administrators retain the per-file maximum',async()=>{
  const actor=account('publisher',baseline-MAX_EPISODE_BYTES),id=series(actor),route='/api/studio/series/'+id+'/episode-uploads',before=finances();const input=(size:number,number=1)=>({title:'Reserved episode',number,filename:'episode.mp4',size});
  const first=await request(route,actor,input(MAX_EPISODE_BYTES),201);assert.equal(first.partCount,40);assert.equal(reservedEpisodeUploadBytes(actor.id),MAX_EPISODE_BYTES);const created=providerCreates;
  for(const editor of [actor,admin]){const denied=await request(route,editor,input(1,2),413);assert.equal(denied.error.code,'QUOTA_EXCEEDED');}assert.equal(providerCreates,created);
  await request(route+'/'+first.id,actor,undefined,200,'DELETE');assert.equal(reservedEpisodeUploadBytes(actor.id),0);const retry=await request(route,actor,input(1,2),201);await request(route+'/'+retry.id,actor,undefined,200,'DELETE');
  const unlimited=account('admin',50*GiB),adminSeries=series(unlimited),adminRoute='/api/studio/series/'+adminSeries+'/episode-uploads',withAdmin=finances(),accepted=await request(adminRoute,unlimited,input(MAX_EPISODE_BYTES),201),prior=providerCreates;
  const tooLarge=await request(adminRoute,unlimited,input(MAX_EPISODE_BYTES+1,2),413);assert.equal(tooLarge.error.code,'FILE_TOO_LARGE');assert.equal(providerCreates,prior);await request(adminRoute+'/'+accepted.id,unlimited,undefined,200,'DELETE');assert.equal(one('SELECT used_bytes FROM users WHERE id=?',unlimited.id)!.used_bytes,50*GiB);assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',unlimited.id)!.quota_bytes,baseline);assert.deepEqual(finances(),withAdmin);
  // The only difference from the first financial snapshot is the explicitly
  // created administrator fixture; upload reservations never change money.
  const after=finances();after.users=(after.users as Array<{id:string}>).filter(user=>user.id!==unlimited.id);assert.deepEqual(after,before);
});
