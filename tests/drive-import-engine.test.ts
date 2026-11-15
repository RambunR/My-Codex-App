import {test,before,beforeEach,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {DriveReader,DriveFile,DriveSeriesManifest} from '../shared/drive-import-types';
import type {DriveImportStorage} from '../server/drive-import-engine';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-drive-engine-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='demo';
const {config}=await import('../server/config');
const {one,all,run,db}=await import('../server/db');
const {runDriveImportEngine}=await import('../server/drive-import-engine');
const {initializePublisherProfiles}=await import('../server/publisher-profiles');
const {episodeDurationSql}=await import('../server/episode-duration');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const OWNER='drive-engine-owner',FOLDER='application/vnd.google-apps.folder';
let clock=Date.now(),fixture:Fixture;

class MemoryStorage implements DriveImportStorage {
  objects=new Map<string,Uint8Array>();uploads=new Map<string,Map<number,Uint8Array>>();
  partCalls=0;completeCalls=0;headCalls=0;reads=0;removed:string[]=[];videoCalls:Array<number|null>=[];
  codecError=false;duration=690;abortFailures=0;onComplete?:()=>void;onValidate?:()=>void;onCreate?:()=>void;
  async create(){const id=randomUUID();this.uploads.set(id,new Map());this.onCreate?.();return id;}
  async part(_key:string,id:string,number:number,bytes:Uint8Array){this.partCalls++;this.uploads.get(id)!.set(number,bytes.slice());return'part-'+number;}
  async complete(key:string,id:string,parts:Array<{partNumber:number;etag:string}>){
    this.completeCalls++;const source=this.uploads.get(id)!;const output=new Uint8Array(parts.reduce((size,part)=>size+source.get(part.partNumber)!.length,0));let offset=0;
    for(const part of parts){const bytes=source.get(part.partNumber)!;output.set(bytes,offset);offset+=bytes.length;}
    this.objects.set(key,output);this.uploads.delete(id);this.onComplete?.();
  }
  async head(key:string){this.headCalls++;const bytes=this.objects.get(key);return bytes?{size:bytes.length}:null;}
  async read(key:string){this.reads++;const bytes=this.objects.get(key)!;return new ReadableStream<Uint8Array>({start(controller){for(let index=0;index<bytes.length;index+=7)controller.enqueue(bytes.subarray(index,index+7));controller.close();}});}
  async validateVideo(key:string,maxSeconds:number|null){this.videoCalls.push(maxSeconds);this.onValidate?.();if(this.codecError)throw Object.assign(new Error('codec'),{code:'INVALID_VIDEO'});return{duration:this.duration,bytes:this.objects.get(key)!.length};}
  async validateCover(key:string){return{bytes:this.objects.get(key)!.length};}
  async abort(_key:string,id:string){if(this.abortFailures-->0)throw new Error('temporary R2 failure');this.uploads.delete(id);}
  async remove(key:string){this.removed.push(key);this.objects.delete(key);}
}
class MemoryDrive implements DriveReader {
  metadata=new Map<string,DriveFile>();bodies=new Map<string,Uint8Array>();calls=0;ranges=0;
  onRange?:()=>void;onRejectedPage?:()=>void;failRoot=false;rootTokens:Array<string|undefined>=[];
  constructor(readonly root:string,readonly folder:string){
    this.add(root,'Root',FOLDER,undefined);this.add(folder,'001_clips',FOLDER,root);
  }
  add(id:string,name:string,mimeType:string,parent:string|undefined,body?:Uint8Array){
    this.metadata.set(id,{id,name,mimeType,size:body?.length||0,version:'1',modifiedTime:'2026-11-15T00:00:00Z',...(parent?{parents:[parent]}:{})});
    if(body)this.bodies.set(id,body);return id;
  }
  bump(id:string){const file=this.metadata.get(id)!;file.version=String(Number(file.version)+1);}
  async getFile(id:string){this.calls++;if(this.failRoot&&id===this.root)throw Object.assign(new Error('private provider text'),{code:'DRIVE_ACCESS_DENIED'});const file=this.metadata.get(id);if(!file)throw Object.assign(new Error('missing'),{code:'DRIVE_ACCESS_DENIED'});return structuredClone(file);}
  async listChildren(id:string,pageToken?:string){this.calls++;if(id===this.root){this.rootTokens.push(pageToken);if(pageToken==='expired-token'){this.onRejectedPage?.();throw Object.assign(new Error('expired Google page token'),{code:'DRIVE_UNAVAILABLE'});}}const files=[...this.metadata.values()].filter(file=>file.parents?.includes(id)),offset=pageToken?.startsWith('page:')?Number(pageToken.slice(5)):0;return{files:files.slice(offset,offset+1000).map(file=>structuredClone(file)),...(offset+1000<files.length?{nextPageToken:`page:${offset+1000}`}:{})};}
  async readText(id:string){this.calls++;return new TextDecoder().decode(this.bodies.get(id)!);}
  async readRange(id:string,offset:number,length:number){this.calls++;this.ranges++;this.onRange?.();return this.bodies.get(id)!.slice(offset,offset+length);}
}
interface Fixture {root:string;folder:string;drive:MemoryDrive;storage:MemoryStorage;manifest:DriveSeriesManifest;ready:string;tick:(scanRoot?:boolean)=>Promise<{wakeInMs?:number}>;job:()=>Record<string,any>|undefined}
function makeFixture({size=40,episodes=2,cover=true}:{size?:number;episodes?:number;cover?:boolean}={}):Fixture {
  const root='root-'+randomUUID(),folder='folder-'+randomUUID(),drive=new MemoryDrive(root,folder),storage=new MemoryStorage();
  const manifest:DriveSeriesManifest={version:1,series:{title:'Drive Story '+randomUUID(),description:'A complete original draft imported for review.',language:'en',genres:['drama'],creation_type:'ai-generated'},episodes:[]};
  for(let number=1;number<=episodes;number++){
    const bytes=new Uint8Array(size).fill(number),name=`Drama_${String(number).padStart(3,'0')}.mp4`;
    drive.add('video-'+number,name,'video/mp4',folder,bytes);manifest.episodes.push({number,name,bytes:bytes.length,sha256:hash(bytes),title:`Imported episode ${number}`});
  }
  if(cover){const bytes=new Uint8Array([137,80,78,71,13,10,26,10,2,3]);drive.add('cover','poster.png','image/png',folder,bytes);manifest.cover={name:'poster.png',bytes:bytes.length,sha256:hash(bytes)};}
  const ready=drive.add('ready', 'lingying-ready.json','application/json',folder,new TextEncoder().encode(JSON.stringify(manifest)));
  run("INSERT INTO drive_import_settings (id,enabled,folder_id,verified_at,verified_folder_id,verified_credential_hash,verified_owner_id) VALUES (1,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,folder_id=excluded.folder_id,revision=drive_import_settings.revision+1,verified_at=excluded.verified_at,verified_folder_id=excluded.verified_folder_id,verified_credential_hash=excluded.verified_credential_hash,verified_owner_id=excluded.verified_owner_id,scan_token='',scan_requested=0",root,clock,root,'fixture-fingerprint',OWNER);
  const tick=async(scanRoot=false)=>{clock+=2_000;return runDriveImportEngine({drive,storage,credentialFingerprint:'fixture-fingerprint',scanRoot,now:()=>clock});};
  return{root,folder,drive,storage,manifest,ready,tick,job:()=>one('SELECT * FROM drive_import_jobs WHERE folder_id=?',folder)};
}
async function finish(subject=fixture){
  await subject.tick(true);
  for(let index=0;index<60&&subject.job()&&['waiting','downloading','validating'].includes(subject.job()!.status);index++)await subject.tick();
  return subject.job()!;
}
function finance(){return Object.fromEntries(['wallet_micros','earnings_micros','publisher_active'].map(field=>[field,one(`SELECT ${field} AS value FROM users WHERE id=?`,OWNER)!.value]));}

before(()=>{
  config.sandbox=false;config.platformOwnerUserId=OWNER;
  run("INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,'unused','admin')",OWNER,'drive-engine@example.test','Drive administrator');
  initializePublisherProfiles();
});
beforeEach(()=>{config.sandbox=false;config.platformOwnerUserId=OWNER;run("UPDATE users SET role='admin' WHERE id=?",OWNER);fixture=makeFixture();});
afterEach(async()=>{
  run("UPDATE drive_import_jobs SET status='cancelled',lease_token='',lease_until=0,cleanup_needed=1 WHERE root_folder_id=? AND series_id IS NULL",fixture.root);
  run('UPDATE drive_import_settings SET enabled=0 WHERE id=1');
  for(let index=0;index<10&&one('SELECT 1 FROM drive_import_jobs WHERE root_folder_id=? AND cleanup_needed=1',fixture.root);index++)await runDriveImportEngine({storage:fixture.storage,credentialFingerprint:'',now:()=>clock});
});
after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});

test('disabled or unverified automation makes no Drive requests',async()=>{
  run('UPDATE drive_import_settings SET enabled=0 WHERE id=1');await fixture.tick(true);assert.equal(fixture.drive.calls,0);assert.equal(fixture.job(),undefined);
  run("UPDATE drive_import_settings SET enabled=1,verified_credential_hash='other-key' WHERE id=1");await fixture.tick(true);assert.equal(fixture.drive.calls,0);
});
test('incomplete folders wait for their manifest and exact files without creating drafts or notices',async()=>{
  fixture.drive.metadata.delete('ready');await fixture.tick(true);assert.equal(fixture.job()!.status,'waiting');
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,0);assert.equal(fixture.storage.partCalls,0);
  const before=one('SELECT COUNT(*) AS n FROM drive_import_notifications')!.n;
  const body=new TextEncoder().encode(JSON.stringify(fixture.manifest));fixture.drive.add('ready','lingying-ready.json','application/json',fixture.folder,body);fixture.drive.metadata.delete('video-2');
  clock+=5*60_000;await fixture.tick();assert.equal(fixture.job()!.status,'waiting');assert.equal(fixture.storage.partCalls,0);assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_notifications')!.n,before);
});
test('complete source imports one editable all-free draft atomically with actual long durations and no financial changes',async()=>{
  const before=finance(),used=one('SELECT used_bytes FROM users WHERE id=?',OWNER)!.used_bytes;
  await fixture.tick(true);assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,0,'staging never creates a partial series');
  const job=await finish();assert.equal(job.status,'complete');const series=one('SELECT * FROM series WHERE id=?',job.series_id)!;
  assert.equal(series.status,'draft');assert.equal(series.creator_id,OWNER);assert.equal(series.free_episodes,1000);assert.equal(series.price_cents,10);
  const episodes=all(`SELECT e.*,${episodeDurationSql('e')} AS actual_duration FROM episodes e WHERE series_id=? ORDER BY number`,series.id);
  assert.deepEqual(episodes.map(episode=>[episode.number,episode.title,episode.actual_duration]),[[1,'Imported episode 1',690],[2,'Imported episode 2',690]]);
  assert(fixture.storage.videoCalls.every(value=>value===null));assert.equal(one('SELECT publisher_id FROM series_publisher_profiles WHERE series_id=?',series.id)!.publisher_id,'official');
  assert.deepEqual(finance(),before);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',OWNER)!.used_bytes,used+90);
  const event=one("SELECT * FROM drive_import_events WHERE job_id=? AND action='import-complete'",job.id)!;assert.equal(event.actor_type,'SYSTEM');assert.equal(event.actor_id,null);
  assert.equal(one("SELECT COUNT(*) AS n FROM drive_import_notifications WHERE job_id=? AND kind='complete'",job.id)!.n,1);
  const count=one('SELECT COUNT(*) AS n FROM series')!.n;clock+=5*60_000;await fixture.tick(true);await fixture.tick();assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',OWNER)!.used_bytes,used+90);
});
test('each transfer tick downloads at most two exact 5 MiB parts and resumes its durable checkpoint',async()=>{
  fixture=makeFixture({size:11*1024*1024,episodes:1,cover:false});await fixture.tick(true);const job=fixture.job()!;
  await fixture.tick();assert.equal(fixture.drive.ranges,2);const staged=one('SELECT * FROM drive_import_files WHERE job_id=?',job.id)!;
  assert.equal(staged.next_part,3);assert.equal(JSON.parse(staged.parts_json).length,2);assert.equal(fixture.storage.objects.size,0);
  await fixture.tick();assert.equal(fixture.drive.ranges,3);assert.equal(fixture.storage.completeCalls,1);
  assert.equal(one('SELECT status FROM drive_import_files WHERE id=?',staged.id)!.status,'assembled');
});
test('changed Drive versions and incorrect source checksums reject the entire draft and clean private staging',async()=>{
  await fixture.tick(true);fixture.drive.bump('video-1');await fixture.tick();assert.equal(fixture.job()!.status,'error');assert.equal(fixture.job()!.error_code,'DRIVE_SOURCE_CHANGED');
  assert.equal(one('SELECT COUNT(*) AS n FROM series WHERE title=?',fixture.manifest.series.title)!.n,0);await fixture.tick();await fixture.tick();assert.equal(all('SELECT * FROM drive_import_files WHERE job_id=?',fixture.job()!.id).length,0);
  fixture=makeFixture();await fixture.tick(true);fixture.drive.bodies.set('video-1',new Uint8Array(40).fill(9));await fixture.tick();await fixture.tick();assert.equal(fixture.job()!.status,'error');assert.equal(fixture.job()!.error_code,'DRIVE_CHECKSUM_MISMATCH');
  await fixture.tick();await fixture.tick();assert.equal(fixture.storage.objects.size,0);assert.equal(fixture.job()!.series_id,null);
});
test('normal codec validation failure never creates a partial destination',async()=>{
  fixture.storage.codecError=true;const job=await finish();assert.equal(job.status,'error');assert.equal(job.error_code,'INVALID_VIDEO');assert.equal(job.series_id,null);
  await fixture.tick();await fixture.tick();assert.equal(fixture.storage.objects.size,0);
});
test('disabling during a read pauses before the R2 part and resumes from its checkpoint',async()=>{
  await fixture.tick(true);fixture.drive.onRange=()=>run('UPDATE drive_import_settings SET enabled=0 WHERE id=1');await fixture.tick();
  assert.equal(fixture.storage.partCalls,0);assert.equal(fixture.job()!.series_id,null);assert.equal(fixture.job()!.status,'downloading');
  fixture.drive.onRange=undefined;run('UPDATE drive_import_settings SET enabled=1 WHERE id=1');assert.equal((await finish()).status,'complete');
});
test('administrator cancellation and role revocation during awaits prevent commit and remain cleanup-safe without credentials',async()=>{
  await fixture.tick(true);fixture.drive.onRange=()=>run("UPDATE drive_import_jobs SET status='cancelled',lease_token='',lease_until=0,cleanup_needed=1 WHERE id=?",fixture.job()!.id);await fixture.tick();
  assert.equal(fixture.job()!.status,'cancelled');assert.equal(fixture.storage.partCalls,0);for(let index=0;index<2;index++)await runDriveImportEngine({storage:fixture.storage,credentialFingerprint:'',now:()=>clock});assert.equal(all('SELECT * FROM drive_import_files WHERE job_id=?',fixture.job()!.id).length,0);
  fixture=makeFixture();await fixture.tick(true);fixture.storage.onValidate=()=>run("UPDATE users SET role='viewer' WHERE id=?",OWNER);await fixture.tick();await fixture.tick();
  assert.equal(fixture.job()!.series_id,null);await fixture.tick();await fixture.tick();assert(['error','cancelled'].includes(fixture.job()!.status));assert.equal(fixture.storage.objects.size,0);
});
test('cancellation while creating multipart storage journals its ID before a failed abort and retries cleanup',async()=>{
  await fixture.tick(true);const job=fixture.job()!;
  fixture.storage.onCreate=()=>run("UPDATE drive_import_jobs SET status='cancelled',lease_token='',lease_until=0,cleanup_needed=1 WHERE id=?",job.id);
  fixture.storage.abortFailures=1;await fixture.tick();
  const staged=one('SELECT * FROM drive_import_files WHERE job_id=? AND upload_id IS NOT NULL',job.id)!;
  assert(staged.upload_id,'the returned multipart ID survives the cancellation');assert(fixture.storage.uploads.has(staged.upload_id));assert.equal(fixture.storage.partCalls,0);
  await runDriveImportEngine({storage:fixture.storage,credentialFingerprint:'',now:()=>clock});
  assert(one('SELECT 1 FROM drive_import_files WHERE id=?',staged.id),'a failed abort retains its cleanup journal');assert(fixture.storage.uploads.has(staged.upload_id));
  for(let index=0;index<3;index++)await runDriveImportEngine({storage:fixture.storage,credentialFingerprint:'',now:()=>clock});
  assert.equal(fixture.storage.uploads.size,0);assert.equal(all('SELECT * FROM drive_import_files WHERE job_id=?',job.id).length,0);assert.equal(fixture.job()!.status,'cancelled');assert.equal(fixture.job()!.series_id,null);
});
test('a crash after multipart completion uses existing R2 bytes instead of completing again',async()=>{
  fixture=makeFixture({episodes:1,cover:false});await fixture.tick(true);fixture.storage.onComplete=()=>{fixture.storage.onComplete=undefined;throw new Error('crash after R2 completion');};
  await fixture.tick();assert.equal(fixture.storage.completeCalls,1);assert.equal(fixture.job()!.status,'downloading');
  clock+=20_000;await fixture.tick();assert.equal(fixture.storage.completeCalls,1);assert.equal((await finish()).status,'complete');
});
test('final commit rechecks old source files, title uniqueness and current administrator policy',async()=>{
  await fixture.tick(true);
  for(let index=0;index<20;index++){const rows=all('SELECT * FROM drive_import_files WHERE job_id=?',fixture.job()!.id);if(rows.length&&rows.every(row=>row.status==='validated'))break;await fixture.tick();}
  fixture.drive.bump('video-1');await fixture.tick();assert.equal(fixture.job()!.status,'error');assert.equal(fixture.job()!.series_id,null);
});
test('completed provenance detects a changed video and never recreates a manually deleted destination or overwrites edits',async()=>{
  const job=await finish();run('UPDATE series SET title=? WHERE id=?','Edited on LingYing '+randomUUID(),job.series_id);
  const edited=one('SELECT title FROM series WHERE id=?',job.series_id)!.title;
  fixture.drive.bump('video-1');clock+=5*60_000;await fixture.tick(true);assert.equal(fixture.job()!.status,'review');assert.equal(one('SELECT title FROM series WHERE id=?',job.series_id)!.title,edited);
  const count=one('SELECT COUNT(*) AS n FROM series')!.n;
  run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',job.series_id,OWNER,OWNER,'{}');run("UPDATE series SET status='archived' WHERE id=?",job.series_id);
  clock+=5*60_000;await fixture.tick(true);await fixture.tick();assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);assert.equal(fixture.job()!.series_id,job.series_id);assert(one('SELECT 1 FROM series_deletions WHERE series_id=?',job.series_id));
  assert.equal(one("SELECT COUNT(*) AS n FROM drive_import_notifications WHERE job_id=? AND kind='attention'",job.id)!.n,1);
});
test('root connection failures give one safe administrator notice across repeated scans',async()=>{
  fixture.drive.failRoot=true;await fixture.tick(true);await fixture.tick(true);
  const notices=all('SELECT * FROM drive_import_notifications WHERE job_id IS NULL AND owner_id=? ORDER BY rowid DESC',OWNER);
  assert.equal(notices.filter(notice=>notice.event_key.includes(fixture.root)).length,0,'notification keys are hashed');
  assert(notices.length>=1);assert(!notices[0].message.includes('private provider text'));assert.equal(fixture.job(),undefined);
});
test('a rejected root page token restarts discovery safely without touching replacement configuration',async()=>{
  run("UPDATE drive_import_settings SET scan_requested=1,scan_token='expired-token' WHERE id=1");
  const result=await fixture.tick();assert.equal(result.wakeInMs,5*60_000);
  assert.equal(one('SELECT scan_token FROM drive_import_settings WHERE id=1')!.scan_token,'');assert.equal(one('SELECT scan_requested FROM drive_import_settings WHERE id=1')!.scan_requested,1);
  await fixture.tick();assert.deepEqual(fixture.drive.rootTokens,['expired-token',undefined]);assert(fixture.job());
  const count=one('SELECT COUNT(*) AS n FROM drive_import_jobs WHERE root_folder_id=?',fixture.root)!.n;
  await fixture.tick(true);assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_jobs WHERE root_folder_id=?',fixture.root)!.n,count);
  run("UPDATE drive_import_settings SET scan_requested=1,scan_token='expired-token' WHERE id=1");
  fixture.drive.onRejectedPage=()=>run("UPDATE drive_import_settings SET folder_id='replacement-root',revision=revision+1,scan_token='replacement-token' WHERE id=1");
  await fixture.tick();assert.equal(one('SELECT scan_token FROM drive_import_settings WHERE id=1')!.scan_token,'replacement-token');
});
test('a second failed manual import attempt creates a fresh unread notice without duplicate terminal notices',async()=>{
  fixture=makeFixture({episodes:1,cover:false});fixture.storage.codecError=true;const job=await finish();assert.equal(job.status,'error');
  const notices=()=>all('SELECT * FROM drive_import_notifications WHERE job_id=? AND kind=\'error\' ORDER BY rowid',job.id);
  assert.equal(notices().length,1);run("UPDATE drive_import_notifications SET read_at=datetime('now') WHERE job_id=?",job.id);
  await fixture.tick();assert.equal(all('SELECT * FROM drive_import_files WHERE job_id=?',job.id).length,0);
  run("UPDATE drive_import_jobs SET status='waiting',manifest_hash='',manifest_json='{}',source_snapshot_json='[]',retry_count=0,next_check_at=0,lease_token='',lease_until=0 WHERE id=? AND series_id IS NULL AND cleanup_needed=0",job.id);
  assert.equal((await finish()).status,'error');assert.equal(notices().length,2);assert.equal(notices().filter(notice=>notice.read_at===null).length,1);
  await fixture.tick();await fixture.tick();assert.equal(notices().length,2,'a terminal job is not notified repeatedly');
});
test('a thousand-episode final commit uses bounded source calls and no redundant per-file storage requests',async()=>{
  fixture=makeFixture({size:1,episodes:1000,cover:true});await fixture.tick(true);const job=fixture.job()!;
  const staged=all('SELECT * FROM drive_import_files WHERE job_id=?',job.id);assert.equal(staged.length,1001);
  // Arrange the same private validated checkpoints produced by earlier
  // individual transfer/hash/media ticks, then exercise the final phase only.
  for(const file of staged){fixture.storage.objects.set(file.object_key,fixture.drive.bodies.get(file.drive_file_id)!.slice());run("UPDATE drive_import_files SET status='validated',duration=? WHERE id=?",file.kind==='video'?690:null,file.id);}
  const before={drive:fixture.drive.calls,heads:fixture.storage.headCalls,parts:fixture.storage.partCalls,completes:fixture.storage.completeCalls,reads:fixture.storage.reads};
  await fixture.tick();assert.equal(fixture.job()!.status,'complete');assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',fixture.job()!.series_id)!.n,1000);
  assert(fixture.drive.calls-before.drive<=5,'final source recheck stays bounded across paginated metadata');
  assert.equal(fixture.storage.headCalls-before.heads,0);assert.equal(fixture.storage.partCalls-before.parts,0);assert.equal(fixture.storage.completeCalls-before.completes,0);assert.equal(fixture.storage.reads-before.reads,0);
});
