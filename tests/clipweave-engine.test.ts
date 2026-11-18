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
  codecError=false;duration=10;abortFailures=0;onComplete?:()=>void;onValidate?:()=>void;onCreate?:()=>void;
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

interface Fixture {root:string;folder:string;drive:MemoryDrive;storage:MemoryStorage;manifest:any;writeSeal:()=>void;tick:(scanRoot?:boolean)=>Promise<{wakeInMs?:number}>;job:()=>Record<string,any>|undefined;videoIds:string[]}
const encode=(text:string)=>new TextEncoder().encode(text);
function makeFixture({backupBytes=30,child=true,cover=true}:{backupBytes?:number;child?:boolean;cover?:boolean}={}):Fixture{
  const root='root-'+randomUUID(),folder=child?'export-'+randomUUID():root,drive=new MemoryDrive(root,folder),storage=new MemoryStorage();
  drive.metadata.clear();drive.bodies.clear();drive.add(root,child?'Uploads':'ClipWeave_20261115',FOLDER,undefined);
  if(child)drive.add(folder,'ClipWeave_20261115',FOLDER,root);
  drive.add('clips','001_clips',FOLDER,folder);drive.add('nested','01_Original drama',FOLDER,'clips');
  drive.add('downloads','downloads',FOLDER,folder);
  const videoIds:string[]=[],files:any[]=[],clips:any[]=[];
  const asset=(id:string,path:string,role:string,parent:string,body:Uint8Array,series:string|null='source-one')=>{const name=path.split('/').at(-1)!;drive.add(id,name,role==='clip'?'video/mp4':'application/octet-stream',parent,body);files.push({path,role,series_id:series,required:true,size_bytes:body.length,sha256:hash(body)});};
  for(let number=1;number<=2;number++){
    const id='video-'+number,path=`001_clips/01_Original drama/drama_${String(number).padStart(3,'0')}.mp4`;videoIds.push(id);asset(id,path,'clip','nested',new Uint8Array(40).fill(number));
    clips.push({index:number,file:path,source_start:number===1?0:8,source_end:number===1?10:18,duration:10,overlap_previous:number===1?0:2});
  }
  asset('caption','001_clips/01_Original drama/drama_001.srt','clip_caption_srt','nested',encode('1\n00:00:00,000 --> 00:00:01,000\nCaption'));
  clips[0].subtitle_srt='001_clips/01_Original drama/drama_001.srt';
  asset('batch','batch.json','batch_manifest',folder,encode('{"status":"completed"}'),null);
  asset('source-meta','001_clips/export.json','source_manifest','clips',encode('{"original_path":"C:\\\\private\\\\export.mp4"}'));
  asset('backup','downloads/Original.mp4','original_download','downloads',new Uint8Array(backupBytes).fill(77));
  if(cover){drive.add('covers','series_covers',FOLDER,folder);drive.add('cover-source','source-one',FOLDER,'covers');asset('cover','series_covers/source-one/series_cover_1080x1920.png','series_cover','cover-source',encode('cover source bytes'));}
  const manifest:any={schema_version:1,app:'ClipWeave',export_id:'export-'+randomUUID(),operation:'process',status:'completed',finished_at:'2026-11-15T00:00:00Z',batch_upload_ready:true,global_reasons:[],completeness_scope:'generated_export',original_series_complete:null,
    series:[{source_id:'source-one',series_key:'001',order:1,name:'ClipWeave story '+randomUUID(),source_duration:18,expected_clip_count:2,actual_clip_count:2,clips_complete:true,upload_ready:true,reasons:[],metadata_requested:false,cover_requested:cover,clips}],files};
  const writeSeal=()=>{const data=encode(JSON.stringify(manifest));drive.add('manifest','upload_manifest.json','application/json',folder,data);drive.add('seal','EXPORT_FINALIZED.json','application/json',folder,encode(JSON.stringify({schema_version:1,app:'ClipWeave',export_id:manifest.export_id,manifest:'upload_manifest.json',manifest_size_bytes:data.length,manifest_sha256:hash(data),text_summary:'EXPORT_SUMMARY.txt',batch_upload_ready:manifest.batch_upload_ready,ready_series_ids:manifest.series.filter((source:any)=>source.upload_ready&&source.reasons.length===0).map((source:any)=>source.source_id),status:'finalized',finished_at:'2026-11-15T00:00:03Z'})));};
  writeSeal();drive.add('summary','EXPORT_SUMMARY.txt','text/plain',folder,encode('The generated export is ready; original story completeness is unknown.'));
  run("INSERT INTO drive_import_settings (id,enabled,folder_id,verified_at,verified_folder_id,verified_credential_hash,verified_owner_id) VALUES (1,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,folder_id=excluded.folder_id,revision=drive_import_settings.revision+1,verified_at=excluded.verified_at,verified_folder_id=excluded.verified_folder_id,verified_credential_hash=excluded.verified_credential_hash,verified_owner_id=excluded.verified_owner_id,scan_token='',scan_requested=0",root,clock,root,'fixture-fingerprint',OWNER);
  return{root,folder,drive,storage,manifest,writeSeal,tick:async(scanRoot=false)=>{clock+=2000;return runDriveImportEngine({drive,storage,credentialFingerprint:'fixture-fingerprint',scanRoot,now:()=>clock});},job:()=>one('SELECT * FROM drive_import_jobs WHERE root_folder_id=? ORDER BY created_at DESC LIMIT 1',root),videoIds};
}
async function finish(subject=fixture){
  await subject.tick(true);
  for(let index=0;index<100&&(!subject.job()||['waiting','downloading','validating'].includes(subject.job()!.status));index++)await subject.tick();
  return subject.job();
}
function seriesCount(){return one('SELECT COUNT(*) AS n FROM series')!.n;}
before(()=>{config.sandbox=false;config.platformOwnerUserId=OWNER;run("INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,'unused','admin')",OWNER,'clipweave-engine@example.test','Drive administrator');initializePublisherProfiles();});
beforeEach(()=>{clock=Date.now();config.sandbox=false;config.platformOwnerUserId=OWNER;run("UPDATE users SET role='admin' WHERE id=?",OWNER);fixture=makeFixture();});
afterEach(async()=>{run("UPDATE drive_import_jobs SET status='cancelled',lease_token='',lease_until=0,cleanup_needed=1 WHERE root_folder_id=? AND series_id IS NULL",fixture.root);run('UPDATE drive_import_settings SET enabled=0 WHERE id=1');for(let index=0;index<10&&one('SELECT 1 FROM drive_import_jobs WHERE root_folder_id=? AND cleanup_needed=1',fixture.root);index++)await runDriveImportEngine({storage:fixture.storage,credentialFingerprint:'',now:()=>clock});});
after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});

test('nested ClipWeave export verifies every required asset, imports only numbered clips, and preserves original-story uncertainty',async()=>{
  const before=seriesCount(),used=one('SELECT used_bytes FROM users WHERE id=?',OWNER)!.used_bytes;
  await fixture.tick(true);assert.equal(seriesCount(),before);assert.equal(fixture.storage.partCalls,0);
  const job=await finish();assert.equal(job!.status,'complete');assert.equal(seriesCount(),before+1);
  const episodes=all('SELECT * FROM episodes WHERE series_id=? ORDER BY number',job!.series_id);assert.deepEqual(episodes.map(row=>row.number),[1,2]);assert.deepEqual(episodes.map(row=>row.duration),[10,10]);
  assert.ok(episodes.every(row=>!row.original_name.includes('Original.mp4')));assert.equal(episodes.length,2,'backup MP4 is not an episode');
  assert.equal(one('SELECT status FROM series WHERE id=?',job!.series_id)!.status,'draft');
  assert.equal(one('SELECT original_series_complete FROM drive_import_clipweave_jobs WHERE job_id=?',job!.id)!.original_series_complete,null);
  assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_clipweave_assets WHERE job_id=? AND verified=0',job!.id)!.n,0);
  assert.equal(fixture.storage.objects.size,3,'only two clips and a cover are stored, never support/backup records');
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',OWNER)!.used_bytes-used,80+encode('cover source bytes').length);
  assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',OWNER)!.wallet_micros,0);
});
test('seal-first, missing video and missing required captions wait without staging or destination records',async()=>{
  const before=seriesCount(),missing=fixture.drive.metadata.get('video-2')!;fixture.drive.metadata.delete('video-2');await fixture.tick(true);await fixture.tick();assert.equal(fixture.job()!.status,'waiting');assert.equal(fixture.storage.partCalls,0);assert.equal(seriesCount(),before);
  fixture.drive.metadata.set('video-2',missing);fixture.drive.metadata.delete('caption');clock+=WAIT;await fixture.tick();assert.equal(fixture.job()!.status,'waiting');assert.equal(seriesCount(),before);
});
const WAIT=24*60*60_000;
test('a same-size corrupted support file fails before any clip transfer',async()=>{
  const before=seriesCount(),body=fixture.drive.bodies.get('caption')!;fixture.drive.bodies.set('caption',body.map((byte,index)=>index===0?byte^1:byte));
  const job=await finish();assert.equal(job!.status,'error');assert.equal(job!.error_code,'CLIPWEAVE_CHECKSUM_MISMATCH');assert.equal(fixture.storage.partCalls,0);assert.equal(seriesCount(),before);
});
test('support hashing checkpoints across pause/resume and does not permanently store a full-source backup',async()=>{
  fixture=makeFixture({backupBytes:11*1024*1024,cover:false});await fixture.tick(true);await fixture.tick();
  for(let count=0;count<20;count++){await fixture.tick();const asset=one('SELECT * FROM drive_import_clipweave_assets WHERE job_id=? AND role=?',fixture.job()!.id,'original_download');if(asset?.offset===10*1024*1024)break;}
  const checkpoint=one('SELECT * FROM drive_import_clipweave_assets WHERE job_id=? AND role=?',fixture.job()!.id,'original_download')!;assert.equal(checkpoint.offset,10*1024*1024);const calls=fixture.drive.calls;
  run('UPDATE drive_import_settings SET enabled=0 WHERE id=1');await fixture.tick();assert.equal(fixture.drive.calls,calls);
  run('UPDATE drive_import_settings SET enabled=1 WHERE id=1');const result=await finish();assert.equal(result!.status,'complete');assert.equal(fixture.storage.objects.size,2);
});
test('Drive-provided SHA256 can verify a required backup larger than the episode cap without treating it as an episode',async()=>{
  const asset=fixture.manifest.files.find((file:any)=>file.role==='original_download');asset.size_bytes=300*1024*1024;asset.sha256='b'.repeat(64);const remote=fixture.drive.metadata.get('backup')!;remote.size=asset.size_bytes;remote.sha256Checksum=asset.sha256;fixture.writeSeal();
  const result=await finish();assert.equal(result!.status,'complete');assert.equal(all('SELECT id FROM episodes WHERE series_id=?',result!.series_id).length,2);
});
test('a changed seal after staged verification cannot create a partial destination',async()=>{
  const before=seriesCount();await fixture.tick(true);await fixture.tick();fixture.storage.onValidate=()=>{fixture.drive.bump('seal');fixture.storage.onValidate=undefined;};const result=await finish();assert.equal(result!.status,'error');assert.equal(seriesCount(),before);
});
test('the configured root may itself be a sealed export and cannot fall back to a legacy flat marker',async()=>{
  fixture=makeFixture({child:false,cover:false});const flat=fixture.manifest.series[0];
  fixture.drive.add('old-ready','lingying-ready.json','application/json','clips',encode(JSON.stringify({version:1,series:{title:'Must not import an unsealed export'},episodes:[{name:'old.mp4',number:1,bytes:1,sha256:'a'.repeat(64)}]})));fixture.drive.metadata.delete('seal');
  const before=seriesCount();await fixture.tick(true);await fixture.tick();assert.equal(seriesCount(),before);assert.equal(fixture.storage.partCalls,0);assert.equal(fixture.job(),undefined);
  fixture.writeSeal();run('UPDATE drive_import_clipweave_exports SET next_check_at=0 WHERE root_folder_id=?',fixture.root);
  const result=await finish();assert.equal(result!.status,'complete');assert.equal(one('SELECT title FROM series WHERE id=?',result!.series_id)!.title,flat.name);
});
test('revising a completed manifest preserves the same export/source identity and existing website edits',async()=>{
  const result=await finish(),before=seriesCount();run('UPDATE series SET title=? WHERE id=?','Owner website title '+randomUUID(),result!.series_id);
  fixture.manifest.series[0].name='Revised producer title';fixture.writeSeal();fixture.drive.bump('manifest');fixture.drive.bump('seal');clock+=WAIT;await fixture.tick(true);await fixture.tick();
  assert.equal(seriesCount(),before);assert.equal(fixture.job()!.status,'review');assert.notEqual(one('SELECT title FROM series WHERE id=?',result!.series_id)!.title,fixture.manifest.series[0].name);
});


test('a partial failed batch imports its ready sibling while failed sources remain absent',async()=>{
  const ready=fixture.manifest.series[0];fixture.manifest.status='failed';fixture.manifest.batch_upload_ready=false;fixture.manifest.global_reasons=['A sibling failed'];
  fixture.manifest.series.push({...structuredClone(ready),source_id:'source-failed',series_key:'002',order:2,name:'Failed sibling',expected_clip_count:null,actual_clip_count:null,source_duration:null,clips_complete:false,upload_ready:false,reasons:['Export stopped'],metadata_requested:false,cover_requested:false,clips:[]});
  fixture.manifest.files.push({path:'002_clips/missing.mp4',role:'clip',series_id:'source-failed',required:true,size_bytes:null,sha256:null,issue:'Not produced'});fixture.writeSeal();
  const result=await finish();assert.equal(result!.status,'complete');assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_jobs WHERE root_folder_id=?',fixture.root)!.n,1);
});
test('discovery of hundreds of other exports cannot starve an active transfer job',async()=>{
  await fixture.tick(true);await fixture.tick();const revision=one('SELECT revision FROM drive_import_settings WHERE id=1')!.revision;
  for(let index=0;index<350;index++)run('INSERT INTO drive_import_clipweave_exports (id,root_folder_id,export_folder_id,owner_id,config_revision) VALUES (?,?,?,?,?)','!pending-'+index,fixture.root,'not-synced-'+index,OWNER,revision);
  const result=await finish();assert.equal(result!.status,'complete');
  assert.ok(one('SELECT COUNT(*) AS n FROM drive_import_clipweave_exports WHERE root_folder_id=? AND next_check_at=0',fixture.root)!.n>300,'The job makes progress without exhausting the discovery queue');
});
test('distinct nested clip paths may share basenames without changing their source paths or numbering',async()=>{
  const second=fixture.manifest.series[0].clips[1],oldPath=second.file,newPath='001_clips/02_alternate/drama_001.mp4';fixture.drive.add('alternate','02_alternate',FOLDER,'clips');
  const remote=fixture.drive.metadata.get('video-2')!;remote.name='drama_001.mp4';remote.parents=['alternate'];second.file=newPath;fixture.manifest.files.find((file:any)=>file.path===oldPath).path=newPath;fixture.writeSeal();
  const result=await finish();assert.equal(result!.status,'complete');const episodes=all('SELECT number,original_name FROM episodes WHERE series_id=? ORDER BY number',result!.series_id);assert.deepEqual(episodes.map(row=>row.number),[1,2]);assert.deepEqual(episodes.map(row=>row.original_name),['drama_001.mp4','drama_001.mp4']);
  assert.ok(one('SELECT path FROM drive_import_clipweave_assets WHERE job_id=? AND path=?',result!.id,newPath));
});

test('duplicate physical folders carrying one export/source identity stop an unfinished job instead of retargeting it',async()=>{
  const before=seriesCount();await fixture.tick(true);assert.ok(fixture.job());
  const duplicate='duplicate-export-root';fixture.drive.add(duplicate,'ClipWeave_duplicate',FOLDER,fixture.root);
  for(const [id,name] of [['seal','EXPORT_FINALIZED.json'],['manifest','upload_manifest.json'],['summary','EXPORT_SUMMARY.txt']])fixture.drive.add('duplicate-'+id,name,'application/octet-stream',duplicate,fixture.drive.bodies.get(id)!);
  clock+=WAIT;await fixture.tick(true);
  assert.equal(fixture.job()!.status,'review');assert.equal(seriesCount(),before);
  assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_clipweave_jobs WHERE owner_id=? AND export_id=?',OWNER,fixture.manifest.export_id)!.n,1);
  assert.ok(one("SELECT 1 FROM drive_import_notifications WHERE job_id=? AND title='Duplicate ClipWeave source identity'",fixture.job()!.id));
});
test('completed and deleted destination provenance survives moving the export beneath a newly configured root',async()=>{
  const result=await finish(),before=seriesCount();
  run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',result!.series_id,OWNER,OWNER,'{}');run("UPDATE series SET status='archived' WHERE id=?",result!.series_id);
  const nextRoot='root-after-move-'+randomUUID();fixture.drive.add(nextRoot,'Other uploads',FOLDER,undefined);fixture.drive.metadata.get(fixture.folder)!.parents=[nextRoot];
  run("UPDATE drive_import_settings SET folder_id=?,verified_folder_id=?,revision=revision+1,scan_token='',scan_requested=0",nextRoot,nextRoot);
  clock+=WAIT;await fixture.tick(true);await fixture.tick();
  assert.equal(seriesCount(),before);assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_clipweave_jobs WHERE owner_id=? AND export_id=?',OWNER,fixture.manifest.export_id)!.n,1);
  assert.ok(one("SELECT 1 FROM drive_import_notifications WHERE job_id=? AND title='ClipWeave source mapping needs review'",result!.id));
});


test('a root replacement during sealed discovery cannot create a stale global source mapping',async()=>{
  const nextRoot='reconfigured-root-'+randomUUID();fixture.drive.add(nextRoot,'Other root',FOLDER,undefined);
  fixture.drive.onRange=()=>{fixture.drive.onRange=undefined;run("UPDATE drive_import_settings SET folder_id=?,verified_folder_id=?,revision=revision+1",nextRoot,nextRoot);};
  await fixture.tick(true);
  assert.equal(one('SELECT COUNT(*) AS n FROM drive_import_clipweave_jobs WHERE export_id=?',fixture.manifest.export_id)!.n,0);
  assert.equal(fixture.job(),undefined);
});
