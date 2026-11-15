import {createHash,randomUUID} from 'node:crypto';
import {one,all,run,transaction} from './db.js';
import {config} from './config.js';
import {AppError,assert} from './errors.js';
import {getDriveImportSettingsRow,requireDriveImportOwner,notifyDriveImport,notifyDriveImportRoot,recordDriveImportEvent} from './drive-import-store.js';
import {parseDriveManifest,matchDriveManifestFiles,isDriveSeriesFolderName,driveFileRevision} from '../shared/drive-import-manifest.js';
import {DRIVE_IMPORT_MANIFEST_NAME,type DriveReader,type DriveFile,type DriveSeriesManifest} from '../shared/drive-import-types.js';
import {MAX_EPISODE_BYTES} from '../shared/config.js';
import {assertPaymentAccountClear} from './payment-risk.js';
import {episodeUploadLimits,assertEpisodeUploadDuration} from './episode-upload-policy.js';
import {assertSeriesTitleAvailable} from './series-titles.js';
import {getOwnerStorage,withinStorageQuota} from './storage-quota.js';
import {legacyEpisodeDuration,writeEpisodeDuration} from './episode-duration.js';
import {writeSeriesClassification} from './taxonomy.js';
import {assignSeriesPublisher} from './publisher-profiles.js';
import {writeSeriesCoverLayout} from './cover-layout.js';
import {writeSeriesSubtitleLanguages} from './subtitle-languages.js';
import {writeSeriesLastEpisodeFree} from './episode-access.js';

const PART_BYTES=5*1024*1024,COVER_BYTES=5*1024*1024,WAIT_MS=5*60_000,LEASE_MS=60_000;
const STAGING_TTL_MS=24*60*60_000,FOLDER='application/vnd.google-apps.folder';
type Row=Record<string,any>;
type Part={partNumber:number;etag:string};
interface Snapshot {manifest:DriveFile;files:DriveFile[]}
export interface DriveImportStorage {
  create(key:string,kind:'video'|'cover'):Promise<string>;
  part(key:string,uploadId:string,number:number,bytes:Uint8Array):Promise<string>;
  complete(key:string,uploadId:string,parts:Part[]):Promise<void>;
  head(key:string):Promise<{size:number}|null>;
  read(key:string):Promise<ReadableStream<Uint8Array>>;
  validateVideo(key:string,maxSeconds:number|null):Promise<{duration:number;bytes:number}>;
  validateCover(key:string):Promise<{bytes:number}>;
  abort(key:string,uploadId:string):Promise<void>;
  remove(key:string):Promise<void>;
}
export interface DriveImportEngineOptions {
  drive?:DriveReader;
  storage:DriveImportStorage;
  credentialFingerprint:string;
  scanRoot?:boolean;
  now?:()=>number;
}
class Interrupted extends Error {constructor(readonly cleanup=false){super('Drive import was paused or cancelled.');}}
let ticking=false;
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
const jobRow=(id:string)=>one<Row>('SELECT * FROM drive_import_jobs WHERE id=?',id);
const filesFor=(id:string)=>all<Row>('SELECT * FROM drive_import_files WHERE job_id=? ORDER BY kind DESC,number,id',id);
const activeStatus=(status:string)=>['waiting','downloading','validating'].includes(status);
function objectKey(job:Row,file:Row){
  return file.kind==='video'?`videos/${encodeURIComponent(job.owner_id)}/drive-${job.id}-${file.id}.mp4`:`covers/drive-${job.id}-${file.id}`;
}
function assertBinding(options:DriveImportEngineOptions,job?:Row,lease?:string,financial=false){
  const settings=getDriveImportSettingsRow();
  if(!settings.enabled)throw new Interrupted();
  const owner=requireDriveImportOwner();
  if(config.sandbox||settings.verified_owner_id!==owner||settings.verified_folder_id!==settings.folder_id||!settings.verified_at||!options.credentialFingerprint||settings.verified_credential_hash!==options.credentialFingerprint)throw new Interrupted();
  if(job){
    const current=jobRow(job.id);
    if(!current||!activeStatus(current.status)||current.series_id||current.lease_token!==lease)throw new Interrupted();
    if(current.owner_id!==owner||current.root_folder_id!==settings.folder_id||current.config_revision!==settings.revision)throw new Interrupted(true);
  }
  if(financial)assertPaymentAccountClear(owner);
  return{settings,owner};
}
function checkpoint(job:Row,lease:string,sql:string,...values:any[]){
  run(`${sql} WHERE id=? AND lease_token=? AND series_id IS NULL AND status IN('waiting','downloading','validating')`,...values,job.id,lease);
}
function safeCode(error:unknown){return error instanceof AppError?error.code:typeof(error as any)?.code==='string'?(error as any).code:'DRIVE_UNAVAILABLE';}
function failed(job:Row,lease:string,error:unknown,now:number){
  const current=jobRow(job.id);if(!current||current.lease_token!==lease||!activeStatus(current.status)||current.series_id)return;
  if(error instanceof Interrupted){
    if(error.cleanup){checkpoint(job,lease,"UPDATE drive_import_jobs SET status='cancelled',cleanup_needed=1,message='The verified import configuration changed. Staged files are being removed.',updated_at=datetime('now')");}
    return;
  }
  const code=safeCode(error);
  const transient=['DRIVE_UNAVAILABLE','DRIVE_RATE_LIMITED','DRIVE_AUTH_FAILED'].includes(code);
  if(transient&&current.retry_count<5){
    checkpoint(job,lease,"UPDATE drive_import_jobs SET retry_count=retry_count+1,next_check_at=?,message='Drive is temporarily unavailable. The importer will retry.',updated_at=datetime('now')",now+Math.min(WAIT_MS,15_000*2**current.retry_count));return;
  }
  const message=code==='SERIES_TITLE_EXISTS'?'A drama already uses this title. Rename the source manifest and retry after cleanup.':code==='PAYMENT_REVIEW_REQUIRED'?'The administrator payment account needs review before this import can continue.':code==='DRIVE_SOURCE_CHANGED'?'The source folder changed during import. Complete the folder and retry after cleanup.':code==='DRIVE_CHECKSUM_MISMATCH'?'A source file did not match its manifest checksum. Check the completed upload and retry.':code==='INVALID_VIDEO'||code==='VIDEO_TOO_LONG'?'A video failed the normal website media checks. Check its codec and duration before retrying.':'This folder could not be imported safely. Review its manifest and source files, then retry after cleanup.';
  transaction(()=>{
    checkpoint(job,lease,"UPDATE drive_import_jobs SET status='error',error_code=?,message=?,cleanup_needed=1,updated_at=datetime('now')",code,message);
    notifyDriveImport(job.id,`error:${lease}`,'error','Drive import needs attention',`${job.folder_name}: ${message}`);
    recordDriveImportEvent('import-error',job.id,{code});
  });
}
function sourceFolder(file:DriveFile,parent:string){assert(file.mimeType===FOLDER&&file.parents?.includes(parent),422,'DRIVE_SOURCE_CHANGED','The source folder is no longer in the configured Drive folder.');}
function assertSnapshotFile(file:DriveFile,folderId:string){assert(file.parents?.includes(folderId)&&file.mimeType!==FOLDER&&file.mimeType!=='application/vnd.google-apps.shortcut',422,'DRIVE_SOURCE_CHANGED','A source file is no longer directly in the series folder.');}
async function listSeries(drive:DriveReader,folder:string){
  const files:DriveFile[]=[];let pageToken:string|undefined;const seen=new Set<string>();
  for(let page=0;page<3;page++){
    const result=await drive.listChildren(folder,pageToken);
    for(const file of result.files){assert(file.parents?.includes(folder),422,'DRIVE_SOURCE_CHANGED','Unexpected Drive file parent.');assert(!seen.has(file.id),422,'DRIVE_FILES_AMBIGUOUS','Drive returned duplicate source files.');seen.add(file.id);files.push(file);}
    assert(files.length<=2005,422,'DRIVE_FILES_AMBIGUOUS','This folder contains too many files.');
    pageToken=result.nextPageToken;if(!pageToken)return files;
  }
  throw new AppError(422,'DRIVE_FILES_AMBIGUOUS','This series folder contains too many files.');
}
async function discover(options:DriveImportEngineOptions){
  const {settings,owner}=assertBinding(options,undefined,undefined,true);if(!options.drive)return;
  const root=await options.drive.getFile(settings.folder_id);assert(root.mimeType===FOLDER,422,'DRIVE_SOURCE_CHANGED','The configured source is not a Drive folder.');
  const page=await options.drive.listChildren(settings.folder_id,settings.scan_token||undefined);
  const fresh=assertBinding(options);if(fresh.settings.folder_id!==settings.folder_id||fresh.settings.revision!==settings.revision)throw new Interrupted();
  transaction(()=>{
    for(const file of page.files){
      if(file.mimeType!==FOLDER||!isDriveSeriesFolderName(file.name))continue;
      sourceFolder(file,settings.folder_id);
      run('INSERT OR IGNORE INTO drive_import_jobs (id,root_folder_id,folder_id,folder_name,owner_id,config_revision) VALUES (?,?,?,?,?,?)',randomUUID(),settings.folder_id,file.id,file.name,owner,settings.revision);
      run("UPDATE drive_import_jobs SET folder_name=? WHERE root_folder_id=? AND folder_id=? AND owner_id=?",file.name,settings.folder_id,file.id,owner);
    }
    run("UPDATE drive_import_settings SET scan_token=?,scan_requested=?,updated_at=datetime('now') WHERE id=1 AND revision=? AND folder_id=?",page.nextPageToken||'',page.nextPageToken?1:0,settings.revision,settings.folder_id);
  });
}
async function inspect(options:DriveImportEngineOptions,job:Row,lease:string,now:number){
  const drive=options.drive!;
  sourceFolder(await drive.getFile(job.folder_id),job.root_folder_id);
  const files=await listSeries(drive,job.folder_id);assertBinding(options,job,lease);
  const manifests=files.filter(file=>file.name===DRIVE_IMPORT_MANIFEST_NAME);
  assert(manifests.length<=1,422,'DRIVE_FILES_AMBIGUOUS','Only one ready manifest is allowed.');
  if(!manifests.length){checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,message='Waiting for lingying-ready.json and its complete files.',updated_at=datetime('now')",now+WAIT_MS);return;}
  const manifestFile=manifests[0];assertSnapshotFile(manifestFile,job.folder_id);
  assert(manifestFile.size>0&&manifestFile.size<=1024*1024,422,'INVALID_DRIVE_MANIFEST','The manifest is too large.');
  const text=await drive.readText(manifestFile.id,1024*1024);assertBinding(options,job,lease);
  const manifest=parseDriveManifest(text);let matched:ReturnType<typeof matchDriveManifestFiles>;
  try{matched=matchDriveManifestFiles(manifest,files);}catch(error){
    if(safeCode(error)!=='DRIVE_FILES_PENDING')throw error;
    checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,message='Waiting for all manifest files to finish uploading to Drive.',updated_at=datetime('now')",now+WAIT_MS);return;
  }
  const selected=[...matched.episodes.map(item=>({manifest:item.manifest,file:item.file,kind:'video' as const,number:item.manifest.number})),...(matched.cover?[{manifest:matched.cover.manifest,file:matched.cover.file,kind:'cover' as const,number:0}]:[])];
  for(const item of selected){assertSnapshotFile(item.file,job.folder_id);assert(item.file.size<=(item.kind==='cover'?COVER_BYTES:MAX_EPISODE_BYTES),422,'FILE_TOO_LARGE','A source file exceeds the website upload limit.');}
  // A file version must also stay stable while its ready marker is being read.
  const latest=await drive.getFile(manifestFile.id);assert(driveFileRevision(latest)===driveFileRevision(manifestFile)&&latest.parents?.includes(job.folder_id),422,'DRIVE_SOURCE_CHANGED','The ready manifest changed while reading.');
  assertBinding(options,job,lease,true);
  transaction(()=>{
    assertBinding(options,job,lease,true);assertSeriesTitleAvailable(manifest.series.title);
    for(const item of selected){const id=randomUUID();const file={id,kind:item.kind};run('INSERT INTO drive_import_files (id,job_id,drive_file_id,name,kind,number,bytes,sha256,drive_version,drive_md5,object_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,job.id,item.file.id,item.file.name,item.kind,item.number,item.manifest.bytes,item.manifest.sha256,driveFileRevision(item.file),item.file.md5Checksum||'',objectKey(job,file));}
    const snapshot:Snapshot={manifest:manifestFile,files:selected.map(item=>item.file)};
    checkpoint(job,lease,"UPDATE drive_import_jobs SET manifest_hash=?,manifest_json=?,source_snapshot_json=?,status='downloading',message='Source is complete. Importing private draft media.',retry_count=0,next_check_at=?,updated_at=datetime('now')",sha256(text),JSON.stringify(manifest),JSON.stringify(snapshot),now);
    recordDriveImportEvent('import-started',job.id,{episodeCount:manifest.episodes.length});
  });
}
async function freshFile(options:DriveImportEngineOptions,job:Row,lease:string,file:Row){
  const remote=await options.drive!.getFile(file.drive_file_id);assertBinding(options,job,lease,true);
  assertSnapshotFile(remote,job.folder_id);assert(driveFileRevision(remote)===file.drive_version&&remote.size===file.bytes,422,'DRIVE_SOURCE_CHANGED','A source file changed during import.');
}
async function transfer(options:DriveImportEngineOptions,job:Row,lease:string,file:Row){
  const storage=options.storage;assert(file.object_key===objectKey(job,file),409,'INVALID_IMPORT_STATE','Invalid staged media key.');
  await freshFile(options,job,lease,file);
  const head=await storage.head(file.object_key);assertBinding(options,job,lease,true);
  if(head){assert(head.size===file.bytes,422,'DRIVE_CHECKSUM_MISMATCH','Stored media size does not match the manifest.');run("UPDATE drive_import_files SET status='assembled',updated_at=datetime('now') WHERE id=?",file.id);return;}
  let uploadId=file.upload_id as string|undefined;
  if(!uploadId){
    uploadId=await storage.create(file.object_key,file.kind);
    // Cancellation deliberately retains this descriptor; cleanup is excluded
    // by the tick mutex while create() is awaiting. Journal the returned ID
    // BEFORE checking cancellation so a failed later abort remains retryable.
    // A disabled watcher keeps the valid upload checkpoint for safe resume.
    run("UPDATE drive_import_files SET upload_id=?,status='uploading',updated_at=datetime('now') WHERE id=? AND job_id=? AND object_key=?",uploadId,file.id,job.id,file.object_key);
    assertBinding(options,job,lease,true);
  }
  let next=Number(file.next_part),parts=JSON.parse(file.parts_json) as Part[];
  assert(Number.isSafeInteger(next)&&next===parts.length+1&&parts.every((part,index)=>part.partNumber===index+1&&typeof part.etag==='string'),409,'INVALID_IMPORT_STATE','Invalid multipart checkpoint.');
  for(let count=0;count<2;count++){
    const offset=(next-1)*PART_BYTES;if(offset>=file.bytes)break;
    const length=Math.min(PART_BYTES,file.bytes-offset);
    const bytes=await options.drive!.readRange(file.drive_file_id,offset,length,file.bytes);assertBinding(options,job,lease,true);
    assert(bytes.byteLength===length,422,'DRIVE_SOURCE_CHANGED','Drive returned an incomplete range.');
    const etag=await storage.part(file.object_key,uploadId,next,bytes);assertBinding(options,job,lease,true);
    parts=[...parts,{partNumber:next,etag}];next++;
    run("UPDATE drive_import_files SET next_part=?,parts_json=?,updated_at=datetime('now') WHERE id=?",next,JSON.stringify(parts),file.id);
  }
  if((next-1)*PART_BYTES>=file.bytes){
    await freshFile(options,job,lease,file);await storage.complete(file.object_key,uploadId,parts);assertBinding(options,job,lease,true);
    run("UPDATE drive_import_files SET status='assembled',updated_at=datetime('now') WHERE id=?",file.id);
  }
}
async function validate(options:DriveImportEngineOptions,job:Row,lease:string,file:Row){
  const input=await options.storage.read(file.object_key);assertBinding(options,job,lease,true);
  const sha=createHash('sha256'),md5=createHash('md5');let bytes=0;const reader=input.getReader();
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;assert(bytes<=file.bytes&&bytes<=MAX_EPISODE_BYTES,422,'DRIVE_CHECKSUM_MISMATCH','Stored media size does not match the manifest.');sha.update(part.value);md5.update(part.value);assertBinding(options,job,lease,true);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  assert(bytes===file.bytes&&sha.digest('hex')===file.sha256&&(!file.drive_md5||md5.digest('hex')===file.drive_md5),422,'DRIVE_CHECKSUM_MISMATCH','Stored media does not match its manifest checksum.');
  await freshFile(options,job,lease,file);
  // The normal uploader's validators inspect the original R2 bytes. Safari's
  // playback compatibility patch is applied only while serving, not to R2.
  const limits=episodeUploadLimits(job.owner_id);
  let media:{bytes:number},duration:number|null=null;
  if(file.kind==='video'){const video=await options.storage.validateVideo(file.object_key,limits.maxEpisodeSeconds);media=video;duration=video.duration;}
  else media=await options.storage.validateCover(file.object_key);
  assertBinding(options,job,lease,true);
  assert(media.bytes===file.bytes&&media.bytes<=(file.kind==='cover'?COVER_BYTES:MAX_EPISODE_BYTES),422,'FILE_TOO_LARGE','Validated media exceeds the website upload limit.');
  if(duration!==null)assertEpisodeUploadDuration(job.owner_id,duration);
  run("UPDATE drive_import_files SET status='validated',duration=?,updated_at=datetime('now') WHERE id=?",duration,file.id);
}
async function assertFinalSnapshot(options:DriveImportEngineOptions,job:Row,lease:string){
  const snapshot=JSON.parse(job.source_snapshot_json) as Snapshot,manifest=parseDriveManifest(JSON.parse(job.manifest_json));
  sourceFolder(await options.drive!.getFile(job.folder_id),job.root_folder_id);
  const files=await listSeries(options.drive!,job.folder_id);assertBinding(options,job,lease,true);
  const ready=files.filter(file=>file.name===DRIVE_IMPORT_MANIFEST_NAME);
  assert(ready.length===1&&ready[0].id===snapshot.manifest.id&&driveFileRevision(ready[0])===driveFileRevision(snapshot.manifest),422,'DRIVE_SOURCE_CHANGED','The ready manifest changed during import.');
  const text=await options.drive!.readText(ready[0].id,1024*1024);assertBinding(options,job,lease,true);assert(sha256(text)===job.manifest_hash,422,'DRIVE_SOURCE_CHANGED','The ready manifest changed during import.');
  const matched=matchDriveManifestFiles(manifest,files),selected=[...matched.episodes.map(item=>item.file),...(matched.cover?[matched.cover.file]:[])];
  assert(selected.length===snapshot.files.length&&snapshot.files.every(expected=>selected.some(actual=>actual.id===expected.id&&driveFileRevision(actual)===driveFileRevision(expected))),422,'DRIVE_SOURCE_CHANGED','The source files changed during import.');
  return manifest;
}
async function commit(options:DriveImportEngineOptions,job:Row,lease:string,now:number){
  const manifest=await assertFinalSnapshot(options,job,lease),files=filesFor(job.id);
  assert(files.length===manifest.episodes.length+(manifest.cover?1:0)&&files.every(file=>file.status==='validated'),409,'INVALID_IMPORT_STATE','The staged draft is incomplete.');
  // Each private job key has already passed streamed checksum, size and media
  // checks in its own bounded tick. This serialized importer is its sole
  // writer, and cleanup cannot touch active staging or run concurrently.
  // Re-heading every validated file here would exceed Worker subrequest
  // limits for a large series without adding an independent integrity proof.
  for(const file of files)assert(file.object_key===objectKey(job,file)&&file.bytes>0&&file.bytes<=(file.kind==='cover'?COVER_BYTES:MAX_EPISODE_BYTES),409,'INVALID_IMPORT_STATE','Invalid validated media checkpoint.');
  transaction(()=>{
    assertBinding(options,job,lease,true);assertSeriesTitleAvailable(manifest.series.title);
    const total=files.reduce((sum,file)=>sum+file.bytes,0),owner=getOwnerStorage(job.owner_id);
    assert(Number.isSafeInteger(total+owner.used_bytes)&&withinStorageQuota(owner,owner.used_bytes+total),413,'STORAGE_QUOTA_EXCEEDED','There is not enough media storage for this series.');
    const id=randomUUID(),cover=files.find(file=>file.kind==='cover');
    run("INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,cover_bytes,status) VALUES (?,?,?,?,?,?,?,10,1000,?,?,'draft')",id,job.owner_id,manifest.series.title,manifest.series.description,manifest.series.language,JSON.stringify(manifest.series.genres),manifest.series.creation_type,cover?.object_key||'',cover?.bytes||0);
    writeSeriesClassification(id,manifest.series.genres,{themes:[],format:null});
    assignSeriesPublisher(job.owner_id,one('SELECT * FROM series WHERE id=?',id)!,undefined,{creating:true});
    writeSeriesCoverLayout(id,undefined,{creating:true});writeSeriesSubtitleLanguages(id,[]);writeSeriesLastEpisodeFree(id,false);
    for(const episode of manifest.episodes){
      const file=files.find(file=>file.kind==='video'&&file.number===episode.number)!;assertEpisodeUploadDuration(job.owner_id,file.duration);
      const episodeId=randomUUID(),title=episode.title||`Episode ${String(episode.number).padStart(3,'0')}`;
      run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',episodeId,id,title,episode.number,legacyEpisodeDuration(file.duration),file.bytes,file.object_key,file.name);
      writeEpisodeDuration(episodeId,file.duration);
    }
    run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',total,job.owner_id);
    checkpoint(job,lease,"UPDATE drive_import_jobs SET status='complete',series_id=?,message='Imported as an unpublished draft. Review the details in Creator Studio.',next_check_at=?,retry_count=0,updated_at=datetime('now')",id,now+WAIT_MS);
    notifyDriveImport(job.id,'complete','complete','Drive series imported',`${manifest.series.title}: ${manifest.episodes.length} episodes are ready as an unpublished draft.`,id);
    recordDriveImportEvent('import-complete',job.id,{seriesId:id,episodeCount:manifest.episodes.length,bytes:total});
  });
}
async function checkCompleted(options:DriveImportEngineOptions,job:Row,now:number){
  // Provenance survives website deletion. Source changes are a review notice,
  // never permission to recreate or overwrite an edited destination.
  const snapshot=JSON.parse(job.source_snapshot_json) as Snapshot;
  if(!snapshot.manifest){run('UPDATE drive_import_jobs SET next_check_at=? WHERE id=?',now+WAIT_MS,job.id);return;}
  const changed=()=>transaction(()=>{
      run("UPDATE drive_import_jobs SET status='review',message='The Drive source changed after import. The website draft was kept unchanged.',updated_at=datetime('now') WHERE id=? AND series_id IS NOT NULL AND status='complete'",job.id);
      notifyDriveImport(job.id,'source-changed','attention','Imported Drive source changed',`${job.folder_name}: review the changed source manually. Existing website content was kept unchanged.`,job.series_id);
      recordDriveImportEvent('source-changed-after-import',job.id);
    });
  try{
    sourceFolder(await options.drive!.getFile(job.folder_id),job.root_folder_id);
    const files=await listSeries(options.drive!,job.folder_id);assertBinding(options);
    const ready=files.filter(file=>file.name===DRIVE_IMPORT_MANIFEST_NAME);
    if(ready.length!==1||ready[0].id!==snapshot.manifest.id||driveFileRevision(ready[0])!==driveFileRevision(snapshot.manifest)){changed();return;}
    const manifest=parseDriveManifest(JSON.parse(job.manifest_json)),matched=matchDriveManifestFiles(manifest,files);
    const selected=[...matched.episodes.map(item=>item.file),...(matched.cover?[matched.cover.file]:[])];
    if(selected.length!==snapshot.files.length||snapshot.files.some(expected=>!selected.some(actual=>actual.id===expected.id&&driveFileRevision(actual)===driveFileRevision(expected))))changed();
    else run('UPDATE drive_import_jobs SET next_check_at=? WHERE id=?',now+WAIT_MS,job.id);
  }catch(error){
    if(error instanceof Interrupted)throw error;
    if(['DRIVE_SOURCE_CHANGED','DRIVE_FILES_PENDING','DRIVE_FILES_UNEXPECTED','DRIVE_FILES_AMBIGUOUS','DRIVE_CHECKSUM_MISMATCH'].includes(safeCode(error)))changed();
    else run('UPDATE drive_import_jobs SET next_check_at=? WHERE id=?',now+WAIT_MS,job.id);
  }
}
function cancelUnsafeJobs(){
  const settings=getDriveImportSettingsRow(),owner=config.platformOwnerUserId;
  const role=owner?one<{role:string}>('SELECT role FROM users WHERE id=?',owner)?.role:undefined;
  const jobs=all<Row>("SELECT * FROM drive_import_jobs WHERE series_id IS NULL AND status IN('waiting','downloading','validating') AND (owner_id<>? OR ?<>'admin' OR root_folder_id<>? OR config_revision<>?) LIMIT 4",owner,role||'',settings.folder_id,settings.revision);
  for(const job of jobs)transaction(()=>{
    run("UPDATE drive_import_jobs SET status='cancelled',error_code='DRIVE_OWNER_OR_CONFIGURATION_CHANGED',message='The verified owner or folder changed. Staged media is being removed.',cleanup_needed=1,lease_token='',lease_until=0,updated_at=datetime('now') WHERE id=? AND series_id IS NULL",job.id);
    notifyDriveImport(job.id,'configuration-changed','attention','Drive import paused safely',`${job.folder_name}: the verified administrator or source configuration changed. No website series was created.`);
    recordDriveImportEvent('import-configuration-cancelled',job.id);
  });
}
async function cleanup(storage:DriveImportStorage,now:number){
  // This path needs no Drive access and remains active while importing is off.
  const stale=all<Row>("SELECT j.* FROM drive_import_jobs j WHERE j.series_id IS NULL AND j.status IN('waiting','downloading','validating') AND EXISTS(SELECT 1 FROM drive_import_files f WHERE f.job_id=j.id) AND j.updated_at<datetime(?/1000,'unixepoch') LIMIT 4",now-STAGING_TTL_MS);
  for(const job of stale)transaction(()=>{
    run("UPDATE drive_import_jobs SET status='error',error_code='DRIVE_STAGING_EXPIRED',message='Paused staged files expired. Retry to import a fresh copy.',cleanup_needed=1,lease_token='',lease_until=0 WHERE id=? AND series_id IS NULL",job.id);
    notifyDriveImport(job.id,`staging-expired:${job.updated_at}`,'error','Drive import staging expired',`${job.folder_name}: paused staged files expired. Retry after cleanup.`);
  });
  const pending=all<Row>('SELECT f.*,j.owner_id,j.id AS parent_job_id,j.series_id FROM drive_import_files f JOIN drive_import_jobs j ON j.id=f.job_id WHERE j.series_id IS NULL AND (j.cleanup_needed=1 OR f.cleanup_pending=1) ORDER BY f.created_at,f.id LIMIT 2');
  for(const file of pending){
    const job=jobRow(file.job_id);if(!job||job.series_id)continue;
    assert(file.object_key===objectKey(job,file),409,'INVALID_IMPORT_STATE','A staged cleanup key is invalid.');
    const referenced=one('SELECT 1 FROM episodes WHERE storage_key=? UNION ALL SELECT 1 FROM series WHERE cover_key=? LIMIT 1',file.object_key,file.object_key);
    if(referenced){run('DELETE FROM drive_import_files WHERE id=?',file.id);recordDriveImportEvent('cleanup-referenced-object-preserved',job.id);continue;}
    try{if(file.upload_id)await storage.abort(file.object_key,file.upload_id);await storage.remove(file.object_key);run('DELETE FROM drive_import_files WHERE id=?',file.id);}catch{ /* durable journal retries on the next bounded tick */ }
  }
  run('UPDATE drive_import_jobs SET cleanup_needed=0 WHERE cleanup_needed=1 AND series_id IS NULL AND NOT EXISTS(SELECT 1 FROM drive_import_files f WHERE f.job_id=drive_import_jobs.id)');
}
function nextWake(now:number,enabled:boolean){
  if(one('SELECT 1 FROM drive_import_jobs WHERE cleanup_needed=1 LIMIT 1'))return{wakeInMs:5_000};
  if(!enabled)return{};
  const settings=getDriveImportSettingsRow();
  const next=one<{due:number}>("SELECT MIN(MAX(next_check_at,lease_until)) AS due FROM drive_import_jobs WHERE owner_id=? AND root_folder_id=? AND config_revision=? AND status IN('waiting','downloading','validating','complete')",config.platformOwnerUserId,settings.folder_id,settings.revision)?.due;
  if(settings.scan_requested)return{wakeInMs:1_000};
  return next===null||next===undefined?{}:{wakeInMs:Math.max(1_000,Math.min(WAIT_MS,next-now))};
}

/** One durable checkpoint at a time: at most two 5 MiB source ranges, one media
 * validation or one atomic draft commit. It never publishes or changes money. */
export async function runDriveImportEngine(options:DriveImportEngineOptions):Promise<{wakeInMs?:number}>{
  if(ticking)return{wakeInMs:5_000};ticking=true;const now=(options.now||Date.now)();
  try{
    cancelUnsafeJobs();
    await cleanup(options.storage,now);
    const settings=getDriveImportSettingsRow();if(!settings.enabled||!options.drive||!options.credentialFingerprint||config.sandbox)return nextWake(now,false);
    try{assertBinding(options,undefined,undefined,true);}catch{return nextWake(now,false);}
    if(options.scanRoot)run('UPDATE drive_import_settings SET scan_requested=1 WHERE id=1');
    const scanSettings=getDriveImportSettingsRow();
    if(scanSettings.scan_requested){
      try{await discover(options);}catch(error){
        // Google page tokens can expire or be rejected. Restart discovery at
        // page one after a failed continuation; source-folder provenance makes
        // replay idempotent. Preserve a concurrent configuration replacement.
        if(scanSettings.scan_token)run("UPDATE drive_import_settings SET scan_token='',scan_requested=1 WHERE id=1 AND folder_id=? AND revision=? AND scan_token=?",scanSettings.folder_id,scanSettings.revision,scanSettings.scan_token);
        if(!(error instanceof Interrupted)){
          const current=getDriveImportSettingsRow(),code=safeCode(error);
          try{notifyDriveImportRoot(`${current.folder_id}:${current.revision}:${code}`,'error','Drive connection needs attention','The automatic importer could not read the configured Drive folder. Check the service-account access and source folder, then run a scan.',requireDriveImportOwner());}catch{ /* a revoked owner cannot receive a new setup notice */ }
        }
        return{wakeInMs:WAIT_MS};
      }
    }
    const {owner,settings:current}=assertBinding(options);
    const job=one<Row>("SELECT * FROM drive_import_jobs WHERE owner_id=? AND root_folder_id=? AND config_revision=? AND cleanup_needed=0 AND status IN('waiting','downloading','validating','complete') AND next_check_at<=? AND lease_until<=? ORDER BY next_check_at,created_at,id LIMIT 1",owner,current.folder_id,current.revision,now,now);
    if(!job)return nextWake(now,true);
    if(job.series_id){await checkCompleted(options,job,now);return nextWake(now,true);}
    const lease=randomUUID();run('UPDATE drive_import_jobs SET lease_token=?,lease_until=? WHERE id=? AND lease_until<=? AND series_id IS NULL',lease,now+LEASE_MS,job.id,now);
    if(jobRow(job.id)?.lease_token!==lease)return{wakeInMs:5_000};
    try{
      assertBinding(options,job,lease,true);
      if(job.status==='waiting')await inspect(options,job,lease,now);
      else{
        const files=filesFor(job.id),file=files.find(item=>item.status!=='validated');
        if(!file)await commit(options,job,lease,now);
        else if(file.status==='assembled'){
          checkpoint(job,lease,"UPDATE drive_import_jobs SET status='validating',message='Checking media and source checksums.',updated_at=datetime('now')");
          await validate(options,job,lease,file);checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,retry_count=0,updated_at=datetime('now')",now+1_000);
        }else{await transfer(options,job,lease,file);checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,retry_count=0,updated_at=datetime('now')",now+1_000);}
      }
    }catch(error){failed(job,lease,error,now);}
    finally{run('UPDATE drive_import_jobs SET lease_token=\'\',lease_until=0 WHERE id=? AND lease_token=?',job.id,lease);}
    return nextWake(now,!!getDriveImportSettingsRow().enabled);
  }finally{ticking=false;}
}
