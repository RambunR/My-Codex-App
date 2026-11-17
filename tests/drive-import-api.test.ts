import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import type {Server} from 'node:http';
import {DEFAULT_DRIVE_IMPORT_FOLDER} from '../shared/drive-import-types';
const dir=await mkdtemp(path.join(tmpdir(),'lingying-drive-import-api-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db,transaction}=await import('../server/db');
const {driveImportRuntime}=await import('../server/drive-import-runtime');
const {getDriveImportSettingsRow,requireDriveImportOwner,notifyDriveImport,notifyDriveImportRoot,recordDriveImportEvent,unreadDriveImportNotifications}=await import('../server/drive-import-store');
const {DRIVE_IMPORT_SCHEMA}=await import('../shared/drive-import-schema');
let server:Server,base:string,clock=Date.now(),runtime=false,configured=false,fingerprint='fixture-credential-fingerprint';
let verify:()=>Promise<void>=async()=>{};
const cookies=new Map<string,string>();
const actors={owner:'',admin:'',publisher:'',viewer:''};
const origin='https://drive-import.example.test';
function user(role:string){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros) VALUES (?,?,?,?,?,?,?)',id,id+'@example.test','Local '+role,'!fixture',role,role==='publisher'||role==='admin'?1:0,15_000_000);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+7*24*60*60*1000);cookies.set(id,'drama_session='+token);return id;
}
async function request(route='',body?:unknown,actor:string|null=actors.owner,expected=200,method=body===undefined?'GET':'POST',headers:Record<string,string>={}){
  const response=await fetch(base+'/api/admin/drive-imports'+route,{method,headers:{...(actor?{Cookie:cookies.get(actor)!}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);return{data,headers:response.headers};
}
async function enable(){runtime=true;configured=true;await request('/connection',{});await request('',{enabled:true},actors.owner,200,'PATCH');}
function job(status='waiting',ownerId=actors.owner,seriesId:string|null=null){
  const id=randomUUID();run('INSERT INTO drive_import_jobs (id,root_folder_id,folder_id,folder_name,owner_id,config_revision,status,series_id,lease_token,lease_until) VALUES (?,?,?,?,?,?,?,?,?,?)',id,getDriveImportSettingsRow().folder_id,'series-'+id,'001_clips',ownerId,getDriveImportSettingsRow().revision,status,seriesId,'old-fixture-lease',clock+60_000);return id;
}
function staged(jobId:string){
  run('INSERT INTO drive_import_files (id,job_id,drive_file_id,name,kind,number,bytes,sha256,drive_version,object_key,upload_id,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),jobId,'drive-file-'+jobId,'001.mp4','video',1,4,'a'.repeat(64),'v1','drive-import/staged/'+jobId,'fixture-upload','uploading');
}
function financialSnapshot(){return{users:all('SELECT id,wallet_micros,earnings_micros,publisher_active FROM users ORDER BY id'),payments:all('SELECT * FROM payments ORDER BY id'),testPayments:all('SELECT * FROM test_payments ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id')};}
before(async()=>{
  actors.owner=user('admin');actors.admin=user('admin');actors.publisher=user('publisher');actors.viewer=user('viewer');
  config.platformOwnerUserId=actors.owner;config.appUrl=origin;config.seed=false;config.payments='disabled';config.stripeTestMode=false;
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as any).port;
});
beforeEach(()=>{
  clock+=61_000;mock.method(Date,'now',()=>clock);
  config.platformOwnerUserId=actors.owner;config.production=false;config.sandbox=false;config.payments='disabled';config.stripeTestMode=false;config.stripeKey='';
  runtime=false;configured=false;fingerprint='fixture-credential-fingerprint';verify=async()=>{};
  mock.method(driveImportRuntime,'available',()=>runtime);
  mock.method(driveImportRuntime,'credentials',()=>({configured,serviceAccountEmail:configured?'fixture-importer@example-project.iam.gserviceaccount.com':null,fingerprint:configured?fingerprint:''}));
  mock.method(driveImportRuntime,'verifyFolder',async()=>verify());
  run('DELETE FROM drive_import_jobs');run('DELETE FROM drive_import_notifications');run('DELETE FROM drive_import_settings');run('DELETE FROM payment_risk_cases');
});
afterEach(()=>{mock.restoreAll();config.platformOwnerUserId=actors.owner;config.sandbox=false;});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('default status is disabled, private and exclusive to the pinned persisted administrator',async()=>{
  await request('',undefined,null,401);
  for(const actor of [actors.admin,actors.publisher,actors.viewer])await request('',undefined,actor,403);
  const status=await request();assert.match(status.headers.get('cache-control')!,/private.*no-store/);
  assert.deepEqual(status.data.settings,{enabled:false,folderId:DEFAULT_DRIVE_IMPORT_FOLDER,revision:1,verifiedAt:null});
  assert.deepEqual(status.data.connection,{configured:false,serviceAccountEmail:null,runtimeAvailable:false});assert.equal(status.data.unread,0);
  assert.equal(one('SELECT 1 FROM drive_import_settings'),undefined);
  run("UPDATE users SET role='viewer' WHERE id=?",actors.owner);
  try{assert.throws(()=>transaction(()=>requireDriveImportOwner()),/administrator/);}finally{run("UPDATE users SET role='admin' WHERE id=?",actors.owner);}
});
test('enable fails closed without a supported runtime, credentials, recent verification and exact owner binding',async()=>{
  await request('',{enabled:true},actors.owner,503,'PATCH');runtime=true;
  await request('',{enabled:true},actors.owner,409,'PATCH');configured=true;
  await request('',{enabled:true},actors.owner,409,'PATCH');
  const verified=await request('/connection',{});assert.equal(verified.data.settings.enabled,false);assert.equal(verified.data.settings.verifiedAt,clock);
  const publicJson=JSON.stringify(verified.data);assert(!publicJson.includes(fingerprint));assert(!publicJson.includes('verified_owner_id'));assert(!publicJson.includes(actors.owner));
  run('UPDATE drive_import_settings SET verified_owner_id=?',actors.admin);await request('',{enabled:true},actors.owner,409,'PATCH');
  run('UPDATE drive_import_settings SET verified_owner_id=?,verified_at=?',actors.owner,clock-24*60*60*1000-1);await request('',{enabled:true},actors.owner,409,'PATCH');
  await request('/connection',{});config.sandbox=true;await request('',{enabled:true},actors.owner,503,'PATCH');
});
test('pause and resume preserve the configuration revision and retained job checkpoints',async()=>{
  await enable();const id=job('downloading');staged(id);const before=one('SELECT * FROM drive_import_jobs WHERE id=?',id),revision=getDriveImportSettingsRow().revision;
  assert.equal((await request('',{enabled:false},actors.owner,200,'PATCH')).data.settings.enabled,false);
  assert.deepEqual(one('SELECT * FROM drive_import_jobs WHERE id=?',id),before);await request('/scan',{},actors.owner,409);
  await request('',{enabled:true},actors.owner,200,'PATCH');assert.equal(getDriveImportSettingsRow().revision,revision);assert.deepEqual(one('SELECT * FROM drive_import_jobs WHERE id=?',id),before);
  await request('/scan',{});assert.equal(getDriveImportSettingsRow().scan_requested,1);
});
test('an enabled watcher keeps a valid stable connection after 24 hours, while a new activation requires fresh verification',async()=>{
  await enable();run('UPDATE drive_import_settings SET verified_at=?',clock-25*60*60*1000);
  assert.notEqual((await request()).data.settings.verifiedAt,null);await request('/scan',{});await request('',{enabled:true},actors.owner,200,'PATCH');
  await request('',{enabled:false},actors.owner,200,'PATCH');assert.equal((await request()).data.settings.verifiedAt,null);await request('',{enabled:true},actors.owner,409,'PATCH');
});
test('changing the root cancels only unfinished unmapped sources and schedules cleanup without touching destination content or money',async()=>{
  await enable();const active=job('downloading');staged(active);const done=job('complete',actors.owner,'existing-destination-id'),before=financialSnapshot();
  const settings=await request('',{folderId:'new_root_folder_fixture_123',enabled:true},actors.owner,200,'PATCH');
  assert.equal(settings.data.settings.enabled,false);assert.equal(settings.data.settings.revision,2);assert.equal(settings.data.settings.verifiedAt,null);
  const cancelled=one('SELECT * FROM drive_import_jobs WHERE id=?',active)!;assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cleanup_needed,1);assert.equal(cancelled.lease_token,'');assert.equal(cancelled.lease_until,0);
  assert.equal(one('SELECT status FROM drive_import_jobs WHERE id=?',done)!.status,'complete');assert.equal(one('SELECT series_id FROM drive_import_jobs WHERE id=?',done)!.series_id,'existing-destination-id');
  assert.equal(getDriveImportSettingsRow().verified_credential_hash,'');assert.equal(getDriveImportSettingsRow().verified_owner_id,'');assert.equal(getDriveImportSettingsRow().scan_token,'');
  assert.deepEqual(financialSnapshot(),before);assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,0);
});
test('a connection verification cannot approve a different folder, credential or owner after an asynchronous race',async()=>{
  runtime=true;configured=true;
  verify=async()=>{run('INSERT INTO drive_import_settings (id,folder_id,revision) VALUES (1,?,2)','changed-folder-fixture');};
  await request('/connection',{},actors.owner,409);assert.equal(getDriveImportSettingsRow().verified_at,null);
  verify=async()=>{fingerprint='rotated-fixture-credential';};await request('/connection',{},actors.owner,409);assert.equal(getDriveImportSettingsRow().verified_at,null);
  verify=async()=>{config.platformOwnerUserId=actors.admin;};await request('/connection',{},actors.owner,409);assert.equal(getDriveImportSettingsRow().verified_at,null);
});
test('raw provider failure details never reach the browser or enable the importer',async()=>{
  runtime=true;configured=true;verify=async()=>{throw new Error('Bearer fixture-private-access-token -----BEGIN PRIVATE KEY-----');};
  const result=await request('/connection',{},actors.owner,409);assert.equal(result.data.error.code,'DRIVE_IMPORT_CONNECTION_FAILED');assert(!JSON.stringify(result.data).includes('fixture-private'));assert.equal(getDriveImportSettingsRow().enabled,0);
});
test('connection diagnostics select fixed owner guidance across runtime error classes without changing verification, imports or finances',async()=>{
  runtime=true;configured=true;
  const snapshot=()=>({settings:all('SELECT * FROM drive_import_settings'),jobs:all('SELECT * FROM drive_import_jobs'),files:all('SELECT * FROM drive_import_files'),events:all('SELECT * FROM drive_import_events'),notifications:all('SELECT * FROM drive_import_notifications'),series:all('SELECT * FROM series'),finances:financialSnapshot()});
  const before=snapshot(),privateText='private-provider-project fixture-folder client_email Bearer fixture-token -----BEGIN PRIVATE KEY-----';
  // A separate class models the original runtime versus generated CF module.
  class AdapterError extends Error {constructor(readonly code:unknown,readonly retryAfterSeconds?:unknown){super(privateText);}}
  for(const [providerCode,apiCode,status]of [
    ['DRIVE_API_DISABLED','DRIVE_IMPORT_API_DISABLED',409],['DRIVE_AUTH_FAILED','DRIVE_IMPORT_AUTH_FAILED',409],['DRIVE_ACCESS_DENIED','DRIVE_IMPORT_ACCESS_DENIED',409],
    ['DRIVE_RATE_LIMITED','DRIVE_IMPORT_RATE_LIMITED',429],['DRIVE_UNAVAILABLE','DRIVE_IMPORT_UNAVAILABLE',503],['INVALID_DRIVE_FOLDER','DRIVE_IMPORT_INVALID_FOLDER',422],['DRIVE_SOURCE_CHANGED','DRIVE_IMPORT_INVALID_RESPONSE',502],
    ['unrecognized-provider-reason','DRIVE_IMPORT_CONNECTION_FAILED',409],['toString','DRIVE_IMPORT_CONNECTION_FAILED',409],
  ]as const){
    clock+=61_000;verify=async()=>{throw new AdapterError(providerCode,999999);};
    const result=await request('/connection',{},actors.owner,status),serialized=JSON.stringify(result.data);
    assert.equal(result.data.error.code,apiCode);assert.deepEqual(Object.keys(result.data.error).sort(),['code','message']);
    for(const marker of privateText.split(' '))assert(!serialized.includes(marker),providerCode+' leaked provider text');
    assert.equal(result.headers.get('Retry-After'),status===429?'3600':null);assert.deepEqual(snapshot(),before);
  }
  for(const retry of ['90\r\nX-Private: fixture-token',-1,Infinity]){
    clock+=61_000;verify=async()=>{throw new AdapterError('DRIVE_RATE_LIMITED',retry);};
    assert.equal((await request('/connection',{},actors.owner,429)).headers.get('Retry-After'),null);assert.deepEqual(snapshot(),before);
  }
  clock+=61_000;verify=async()=>{};const recovered=await request('/connection',{});assert.equal(recovered.data.settings.verifiedAt,clock);assert.equal(recovered.data.settings.enabled,false);assert.equal(recovered.data.jobs.length,0);assert.deepEqual(financialSnapshot(),before.finances);
});
test('cancel is idempotent, invalidates the lease and notifies once; imported tombstones can never be cancelled or retried',async()=>{
  await enable();const id=job('downloading');staged(id);
  await request('/jobs/'+id+'/cancel',{});await request('/jobs/'+id+'/cancel',{});
  assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_notifications WHERE job_id=?',id)!.n,1);assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_events WHERE job_id=? AND action=?',id,'job.cancelled')!.n,1);
  const stopped=one('SELECT * FROM drive_import_jobs WHERE id=?',id)!;assert.equal(stopped.status,'cancelled');assert.equal(stopped.cleanup_needed,1);assert.equal(stopped.lease_token,'');
  await request('/jobs/'+id+'/retry',{},actors.owner,409);run('UPDATE drive_import_jobs SET cleanup_needed=0 WHERE id=?',id);await request('/jobs/'+id+'/retry',{},actors.owner,409);
  run('DELETE FROM drive_import_files WHERE job_id=?',id);await request('/jobs/'+id+'/retry',{});assert.equal(one('SELECT status FROM drive_import_jobs WHERE id=?',id)!.status,'waiting');
  for(const status of ['complete','error','review']){const mapped=job(status,actors.owner,'manually-deleted-destination');await request('/jobs/'+mapped+'/cancel',{},actors.owner,409);await request('/jobs/'+mapped+'/retry',{},actors.owner,409);}
});
test('account review blocks starting work but permits status, stopping jobs and reading notices',async()=>{
  await enable();const id=job('downloading');staged(id);
  run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id) VALUES (?,\'default\',0,\'dispute\',?,?)',randomUUID(),'fixture-case-'+randomUUID(),actors.owner);
  await request();await request('/scan',{},actors.owner,423);await request('',{enabled:true},actors.owner,423,'PATCH');
  await request('/jobs/'+id+'/cancel',{});assert.equal((await request()).data.unread,1);await request('/notifications/read',{});assert.equal((await request()).data.unread,0);
  assert.equal(unreadDriveImportNotifications(actors.admin),0);
});
test('notification deduplication and owner scoping survive a changed owner pin',async()=>{
  const id=job(),first=transaction(()=>notifyDriveImport(id,'same-event','attention','Private source notice','Original owner only.'));
  config.platformOwnerUserId=actors.admin;assert.equal(notifyDriveImport(id,'same-event','attention','Duplicate','Duplicate'),first);notifyDriveImport(id,'later-event','attention','Private follow-up','Still original owner only.');
  const result=await request('',undefined,actors.admin);assert.equal(result.data.jobs.length,0);assert.equal(result.data.notifications.length,0);assert.equal(result.data.unread,0);
  await request('/notifications/read',{},actors.admin);assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_notifications WHERE owner_id=? AND read_at IS NULL',actors.owner)!.n,2);
  config.platformOwnerUserId=actors.owner;assert.equal((await request()).data.unread,2);
});
test('root access failures can notify the owner once without creating a series job',async()=>{
  const key=DEFAULT_DRIVE_IMPORT_FOLDER+':1:DRIVE_ACCESS_DENIED';
  const first=notifyDriveImportRoot(key,'error','Drive connection needs attention','Check that the root folder is shared with the service account.',actors.owner);
  assert.equal(notifyDriveImportRoot(key,'error','Repeat','Repeat',actors.owner),first);
  const status=(await request()).data;assert.equal(status.jobs.length,0);assert.equal(status.notifications.length,1);assert.equal(status.notifications[0].jobId,null);assert.equal(status.unread,1);
  config.platformOwnerUserId=actors.admin;assert.equal((await request('',undefined,actors.admin)).data.unread,0);
  notifyDriveImportRoot(key,'error','New owner connection notice','Private to the new owner.',actors.admin);assert.equal((await request('',undefined,actors.admin)).data.unread,1);
});
test('settings and controls reject unknown fields and cross-site mutations',async()=>{
  for(const body of [{enabled:'true'},{folderId:'https://drive.google.com/anything'},{folderId:'../unsafe'},{enabled:false,owner_id:actors.admin},{}])await request('',body,actors.owner,400,'PATCH');
  await request('/connection',{credential:'do-not-accept-from-browser'},actors.owner,400);
  await request('',{enabled:false},actors.owner,403,'PATCH',{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'});
});
test('audit events remain append-only and redacted when the schema is reapplied',()=>{
  const id=transaction(()=>recordDriveImportEvent('local.fixture',null,{secret:'fixture-secret',nested:{private_key:'fixture-key'},safe:'Expected summary'},actors.owner));
  const before=one('SELECT * FROM drive_import_events WHERE id=?',id)!;assert(!before.summary_json.includes('fixture-secret'));assert(!before.summary_json.includes('fixture-key'));assert.match(before.summary_json,/Expected summary/);
  assert.throws(()=>run('UPDATE drive_import_events SET action=? WHERE id=?','tampered',id),/append-only/);assert.throws(()=>run('DELETE FROM drive_import_events WHERE id=?',id),/append-only/);
  db.exec(DRIVE_IMPORT_SCHEMA);run('INSERT OR REPLACE INTO drive_import_events (id,actor_type,action,summary_json) VALUES (?,\'SYSTEM\',\'replacement\',\'{}\')',id);assert.deepEqual(one('SELECT * FROM drive_import_events WHERE id=?',id),before);
});


test('ClipWeave progress counts required support assets as well as episode media',async()=>{
  const id=job('validating');staged(id);
  run('INSERT INTO drive_import_clipweave_jobs (job_id,owner_id,export_folder_id,export_id,source_id) VALUES (?,?,?,?,?)',id,actors.owner,'export-folder','export-one','source-one');
  for(let n=0;n<3;n++)run('INSERT INTO drive_import_clipweave_assets (id,job_id,path,role,kind,drive_file_id,parent_id,drive_version,bytes,sha256,verified) VALUES (?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),id,'asset-'+n,n===0?'clip':'clip_caption_srt',n===0?'media':'support','source-'+n,'parent','v1',4,'a'.repeat(64),Number(n<2));
  const state=(await request()).data.jobs.find((item:any)=>item.id===id);assert.equal(state.episodeCount,1);assert.equal(state.totalFiles,3);assert.equal(state.finishedFiles,2);
});
