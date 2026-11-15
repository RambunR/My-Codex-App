import {loadClipWeaveExport,resolveClipWeaveSeries,revalidateClipWeaveSnapshot,hasClipWeaveControls,isClipWeaveExportFolderName,type ClipWeaveDriveSnapshot} from './clipweave-drive.js';
import {selectReadyClipWeaveSeries,clipWeaveSourceIdentity} from '../shared/clipweave-export.js';
import {createSha256State,updateSha256State,finishSha256State} from '../shared/resumable-sha256.js';
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
  if((error as any)?.state==='WAIT'){checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,message='Waiting for every required file in the sealed ClipWeave export.',updated_at=datetime('now')",now+WAIT_MS);return;}
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
function clipWeaveJob(jobId:string){return one<Row>('SELECT * FROM drive_import_clipweave_jobs WHERE job_id=?',jobId);}
function registerClipWeaveExport(root:string,folder:string,owner:string,revision:number){
  const id=sha256(root+'\0'+folder);
  run('INSERT OR IGNORE INTO drive_import_clipweave_exports (id,root_folder_id,export_folder_id,owner_id,config_revision) VALUES (?,?,?,?,?)',id,root,folder,owner,revision);
  // Reverification may safely restart discovery, but never rewrites a mapped
  // series or silently adopts a different owner/account.
  run('UPDATE drive_import_clipweave_exports SET config_revision=? WHERE id=? AND owner_id=?',revision,id,owner);
}
async function discoverClipWeave(options:DriveImportEngineOptions,now:number){
  const {owner,settings}=assertBinding(options,undefined,undefined,true);
  const pending=one<Row>('SELECT * FROM drive_import_clipweave_exports WHERE root_folder_id=? AND owner_id=? AND config_revision=? AND next_check_at<=? ORDER BY next_check_at,id LIMIT 1',settings.folder_id,owner,settings.revision,now);
  if(!pending)return false;
  try{
    const loaded=await loadClipWeaveExport(options.drive!,pending.export_folder_id,{configuredRootId:settings.folder_id});
    const active=assertBinding(options,undefined,undefined,true);
    if(active.settings.folder_id!==settings.folder_id||active.settings.revision!==settings.revision)throw new Interrupted();
    const ready=selectReadyClipWeaveSeries(loaded);
    transaction(()=>{
      assertBinding(options,undefined,undefined,true);
      for(const source of ready){
        const existing=one<Row>('SELECT c.*,j.root_folder_id,j.config_revision,j.status,j.series_id FROM drive_import_clipweave_jobs c JOIN drive_import_jobs j ON j.id=c.job_id WHERE c.owner_id=? AND c.export_id=? AND c.source_id=?',owner,loaded.seal.export_id,source.source_id);
        if(existing){
          if(existing.export_folder_id!==pending.export_folder_id){
            if(!existing.series_id&&activeStatus(existing.status))run("UPDATE drive_import_jobs SET status='review',cleanup_needed=1,lease_token='',lease_until=0,message='Duplicate sealed export identity found in different Drive folders. Review the source mapping.' WHERE id=?",existing.job_id);
            notifyDriveImport(existing.job_id,`duplicate-physical-source:${pending.export_folder_id}`,'attention','Duplicate ClipWeave source identity','The same export/source identity appears in another Drive folder. No new series or silent folder reassignment was performed.',existing.series_id);
          }else if(existing.root_folder_id!==settings.folder_id||existing.config_revision!==settings.revision){
            notifyDriveImport(existing.job_id,`mapping-review:${settings.folder_id}:${settings.revision}`,'attention','ClipWeave source mapping needs review','This export/source identity was already tracked under an earlier folder configuration. Its destination and source mapping were preserved; review the previous job instead of creating a duplicate.',existing.series_id);
          }
          continue;
        }
        const id=randomUUID(),folderId='cw-'+sha256(clipWeaveSourceIdentity(loaded.seal.export_id,source.source_id));
        run('INSERT INTO drive_import_jobs (id,root_folder_id,folder_id,folder_name,owner_id,config_revision,message) VALUES (?,?,?,?,?,?,?)',id,settings.folder_id,folderId,source.name,owner,settings.revision,'Waiting to verify the sealed ClipWeave export.');
        run('INSERT INTO drive_import_clipweave_jobs (job_id,owner_id,export_folder_id,export_id,source_id,original_series_complete) VALUES (?,?,?,?,?,?)',id,owner,pending.export_folder_id,loaded.seal.export_id,source.source_id,loaded.manifest.original_series_complete===null?null:Number(loaded.manifest.original_series_complete));
      }
      run('UPDATE drive_import_clipweave_exports SET next_check_at=?,message=? WHERE id=? AND root_folder_id=? AND config_revision=?',now+WAIT_MS,ready.length?'Sealed ready-series identities discovered.':'No source is in the sealed ready-series set.',pending.id,settings.folder_id,settings.revision);
    });
  }catch(error){
    const state=(error as any)?.state,code=safeCode(error);
    run('UPDATE drive_import_clipweave_exports SET next_check_at=?,message=? WHERE id=? AND root_folder_id=? AND config_revision=?',now+WAIT_MS,state==='WAIT'?'Waiting for sealed export controls and files.':'The sealed export needs verification or repair.',pending.id,settings.folder_id,settings.revision);
    if(!(error instanceof Interrupted))notifyDriveImportRoot(`clipweave-export:${pending.id}:${state}:${code}`,state==='WAIT'?'attention':'error',state==='WAIT'?'ClipWeave export is still syncing':'ClipWeave export needs attention',state==='WAIT'?'A discovered ClipWeave export is not yet fully sealed and ready. No drama has been created.':'The discovered export could not pass its sealed inventory checks. No drama has been created.',owner);
  }
  return true;
}
async function inspectClipWeave(options:DriveImportEngineOptions,job:Row,lease:string,now:number){
  const mapped=clipWeaveJob(job.id)!;
  const loaded=await loadClipWeaveExport(options.drive!,mapped.export_folder_id,{configuredRootId:job.root_folder_id});assertBinding(options,job,lease,true);
  assert(loaded.seal.export_id===mapped.export_id,422,'CLIPWEAVE_SOURCE_CHANGED','The export identity changed.');
  const resolved=await resolveClipWeaveSeries(options.drive!,loaded,mapped.source_id);assertBinding(options,job,lease,true);
  const source=resolved.series,snapshot=JSON.stringify(resolved.snapshot);
  assert(Buffer.byteLength(snapshot)<=1024*1024,422,'CLIPWEAVE_LIMIT','This source snapshot exceeds the safe per-series verification size.');
  const clips=new Map(source.clips.map(clip=>[clip.file,clip])),covers=resolved.assets.filter(asset=>asset.inventory.role==='series_cover'&&asset.inventory.series_id===mapped.source_id);
  assert(covers.length<=1,422,'CLIPWEAVE_AMBIGUOUS','A series must have at most one selected cover.');
  const title=source.name.trim().slice(0,120);
  const manifest:DriveSeriesManifest={version:1,series:{title,description:'Imported ClipWeave draft. Review the title, synopsis, language and genre before publishing.',language:'en',genres:['drama'],creation_type:'ai-generated'},episodes:[],...(covers.length?{cover:{name:'cover.'+covers[0].file.name.split('.').at(-1)!.toLowerCase(),bytes:covers[0].file.size,sha256:covers[0].inventory.sha256!}}:{})};
  for(const asset of resolved.assets){
    if(asset.inventory.role==='clip'&&asset.inventory.series_id===mapped.source_id){
      const clip=clips.get(asset.path);assert(clip,422,'CLIPWEAVE_INVALID','A clip asset is not in this source sequence.');
      assert(asset.file.size<=MAX_EPISODE_BYTES,422,'FILE_TOO_LARGE','A ClipWeave episode exceeds 200 MiB.');
      manifest.episodes.push({name:`episode-${String(clip.index).padStart(3,'0')}.mp4`,bytes:asset.file.size,sha256:asset.inventory.sha256!,number:clip.index,title:`Episode ${String(clip.index).padStart(3,'0')}`});
    }else if(asset.inventory.role==='series_cover'&&asset.inventory.series_id===mapped.source_id)assert(asset.file.size<=COVER_BYTES,422,'FILE_TOO_LARGE','The ClipWeave cover exceeds 5 MiB.');
  }
  manifest.episodes.sort((a,b)=>a.number-b.number);parseDriveManifest(manifest);
  transaction(()=>{
    assertBinding(options,job,lease,true);assertSeriesTitleAvailable(title);
    assert(!one('SELECT 1 FROM drive_import_files WHERE job_id=? LIMIT 1',job.id)&&!one('SELECT 1 FROM drive_import_clipweave_assets WHERE job_id=? LIMIT 1',job.id),409,'INVALID_IMPORT_STATE','A stale ClipWeave checkpoint remains.');
    for(const asset of resolved.assets){
      const kind=asset.inventory.series_id===mapped.source_id?(asset.inventory.role==='clip'?'video':asset.inventory.role==='series_cover'?'cover':null):null;
      let mediaId:string|null=null,expectedDuration:number|null=null;
      if(kind){
        mediaId=randomUUID();const clip=clips.get(asset.path);expectedDuration=kind==='video'?clip!.duration:null;
        const file={id:mediaId,kind},internalName=kind==='video'?`episode-${String(clip!.index).padStart(3,'0')}.mp4`:manifest.cover!.name;run('INSERT INTO drive_import_files (id,job_id,drive_file_id,name,kind,number,bytes,sha256,drive_version,drive_md5,object_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',mediaId,job.id,asset.file.id,internalName,kind,clip?.index||0,asset.file.size,asset.inventory.sha256,driveFileRevision(asset.file),asset.file.md5Checksum||'',objectKey(job,file));
      }
      run('INSERT INTO drive_import_clipweave_assets (id,job_id,path,role,kind,drive_file_id,parent_id,drive_version,bytes,sha256,drive_sha256,media_file_id,expected_duration,hash_state_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),job.id,asset.path,asset.inventory.role,kind?'media':'support',asset.file.id,asset.parentId,driveFileRevision(asset.file),asset.file.size,asset.inventory.sha256,asset.file.sha256Checksum||'',mediaId,expectedDuration,JSON.stringify(createSha256State()));
    }
    run('UPDATE drive_import_clipweave_jobs SET snapshot_json=? WHERE job_id=?',snapshot,job.id);
    checkpoint(job,lease,"UPDATE drive_import_jobs SET manifest_hash=?,manifest_json=?,status='downloading',message='Checking every required ClipWeave asset before creating a draft.',retry_count=0,next_check_at=?,updated_at=datetime('now')",loaded.manifestSha256,JSON.stringify(manifest),now);
    recordDriveImportEvent('clipweave-started',job.id,{exportId:mapped.export_id,sourceId:mapped.source_id,episodeCount:source.expected_clip_count,requiredAssets:resolved.assets.length,completenessScope:'generated_export',originalSeriesComplete:loaded.manifest.original_series_complete});
  });
}
async function verifyClipWeaveSupport(options:DriveImportEngineOptions,job:Row,lease:string){
  if(!clipWeaveJob(job.id))return false;
  const asset=one<Row>("SELECT * FROM drive_import_clipweave_assets WHERE job_id=? AND kind='support' AND verified=0 ORDER BY path LIMIT 1",job.id);
  if(!asset)return false;
  const fresh=async()=>{
    const remote=await options.drive!.getFile(asset.drive_file_id);assertBinding(options,job,lease,true);
    assertSnapshotFile(remote,asset.parent_id);assert(remote.size===asset.bytes&&driveFileRevision(remote)===asset.drive_version,422,'CLIPWEAVE_SOURCE_CHANGED','A required support asset changed during verification.');return remote;
  };
  const remote=await fresh();
  if(remote.sha256Checksum){
    assert(remote.sha256Checksum.toLowerCase()===asset.sha256.toLowerCase(),422,'CLIPWEAVE_CHECKSUM_MISMATCH','A required support asset does not match its inventory.');
    run('UPDATE drive_import_clipweave_assets SET verified=1,offset=bytes WHERE id=?',asset.id);return true;
  }
  let state=JSON.parse(asset.hash_state_json),offset=Number(asset.offset);
  assert(state.bytes===offset&&offset<=asset.bytes,409,'INVALID_IMPORT_STATE','Invalid support checksum checkpoint.');
  for(let part=0;part<2&&offset<asset.bytes;part++){
    const length=Math.min(PART_BYTES,asset.bytes-offset),bytes=await options.drive!.readRange(asset.drive_file_id,offset,length,asset.bytes);assertBinding(options,job,lease,true);
    assert(bytes.length===length,422,'CLIPWEAVE_SOURCE_CHANGED','Drive returned an incomplete support range.');
    state=updateSha256State(state,bytes);offset+=bytes.length;
    run('UPDATE drive_import_clipweave_assets SET offset=?,hash_state_json=? WHERE id=?',offset,JSON.stringify(state),asset.id);
  }
  if(offset===asset.bytes){assert(finishSha256State(state)===asset.sha256,422,'CLIPWEAVE_CHECKSUM_MISMATCH','A required support asset does not match its inventory.');await fresh();run('UPDATE drive_import_clipweave_assets SET verified=1 WHERE id=?',asset.id);}
  return true;
}

async function discover(options:DriveImportEngineOptions){
  const {settings,owner}=assertBinding(options,undefined,undefined,true);if(!options.drive)return;
  const root=await options.drive.getFile(settings.folder_id);assert(root.mimeType===FOLDER,422,'DRIVE_SOURCE_CHANGED','The configured source is not a Drive folder.');
  const page=await options.drive.listChildren(settings.folder_id,settings.scan_token||undefined);
  const fresh=assertBinding(options);if(fresh.settings.folder_id!==settings.folder_id||fresh.settings.revision!==settings.revision)throw new Interrupted();
  const sealedRoot=isClipWeaveExportFolderName(root.name)||hasClipWeaveControls(page.files)||!!one('SELECT 1 FROM drive_import_clipweave_exports WHERE root_folder_id=? AND export_folder_id=?',settings.folder_id,root.id);
  transaction(()=>{
    if(sealedRoot){
      registerClipWeaveExport(settings.folder_id,root.id,owner,settings.revision);
      // A sealed-export root cannot be downgraded to old flat-file readiness,
      // including jobs discovered before the small control files arrived.
      run("UPDATE drive_import_jobs SET status='cancelled',cleanup_needed=1,message='This root uses sealed ClipWeave verification.',lease_token='',lease_until=0 WHERE root_folder_id=? AND owner_id=? AND series_id IS NULL AND status IN('waiting','downloading','validating') AND NOT EXISTS(SELECT 1 FROM drive_import_clipweave_jobs c WHERE c.job_id=drive_import_jobs.id)",settings.folder_id,owner);
    }
    for(const file of page.files){
      if(file.mimeType===FOLDER&&isClipWeaveExportFolderName(file.name)){sourceFolder(file,settings.folder_id);registerClipWeaveExport(settings.folder_id,file.id,owner,settings.revision);continue;}
      if(sealedRoot)continue;
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
  if(clipWeaveJob(job.id)){await inspectClipWeave(options,job,lease,now);return;}
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
  const asset=clipWeaveJob(job.id)?one<Row>('SELECT * FROM drive_import_clipweave_assets WHERE job_id=? AND media_file_id=?',job.id,file.id):undefined;
  assertSnapshotFile(remote,asset?.parent_id||job.folder_id);assert(driveFileRevision(remote)===file.drive_version&&remote.size===file.bytes,422,'DRIVE_SOURCE_CHANGED','A source file changed during import.');
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
  if(duration!==null){
    assertEpisodeUploadDuration(job.owner_id,duration);
    const expected=one<{expected_duration:number}>('SELECT expected_duration FROM drive_import_clipweave_assets WHERE job_id=? AND media_file_id=?',job.id,file.id)?.expected_duration;
    if(expected!==undefined&&expected!==null)assert(Math.abs(duration-expected)<=Math.max(1,expected*.02),422,'CLIPWEAVE_DURATION_MISMATCH','The uploaded clip duration does not match the sealed export.');
  }
  run("UPDATE drive_import_files SET status='validated',duration=?,updated_at=datetime('now') WHERE id=?",duration,file.id);
  run('UPDATE drive_import_clipweave_assets SET verified=1 WHERE job_id=? AND media_file_id=?',job.id,file.id);
}
async function assertFinalSnapshot(options:DriveImportEngineOptions,job:Row,lease:string){
  const sealed=clipWeaveJob(job.id);
  if(sealed){
    assert(!one('SELECT 1 FROM drive_import_clipweave_assets WHERE job_id=? AND verified=0 LIMIT 1',job.id),409,'INVALID_IMPORT_STATE','Required export assets remain unverified.');
    await revalidateClipWeaveSnapshot(options.drive!,JSON.parse(sealed.snapshot_json));assertBinding(options,job,lease,true);
    return parseDriveManifest(JSON.parse(job.manifest_json));
  }
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
      run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',episodeId,id,title,episode.number,legacyEpisodeDuration(file.duration),file.bytes,file.object_key,one<{path:string}>('SELECT path FROM drive_import_clipweave_assets WHERE job_id=? AND media_file_id=?',job.id,file.id)?.path.split('/').at(-1)||file.name);
      writeEpisodeDuration(episodeId,file.duration);
    }
    run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',total,job.owner_id);
    checkpoint(job,lease,"UPDATE drive_import_jobs SET status='complete',series_id=?,message='Imported as an unpublished draft. Review the details in Creator Studio.',next_check_at=?,retry_count=0,updated_at=datetime('now')",id,now+WAIT_MS);
    notifyDriveImport(job.id,'complete','complete','Drive series imported',`${manifest.series.title}: ${manifest.episodes.length} episodes are ready as an unpublished draft.`,id);
    recordDriveImportEvent('import-complete',job.id,{seriesId:id,episodeCount:manifest.episodes.length,bytes:total});
  });
}
async function checkCompleted(options:DriveImportEngineOptions,job:Row,now:number){
  const sealed=clipWeaveJob(job.id);
  if(sealed){
    try{await revalidateClipWeaveSnapshot(options.drive!,JSON.parse(sealed.snapshot_json));assertBinding(options);run('UPDATE drive_import_jobs SET next_check_at=? WHERE id=?',now+WAIT_MS,job.id);}
    catch(error){
      if(error instanceof Interrupted)throw error;
      if((error as any)?.state==='REJECT'||(error as any)?.state==='WAIT')transaction(()=>{run("UPDATE drive_import_jobs SET status='review',message='The sealed ClipWeave source changed. Existing website content was preserved.',updated_at=datetime('now') WHERE id=? AND status='complete'",job.id);notifyDriveImport(job.id,'clipweave-source-changed','attention','ClipWeave source needs review','The verified export changed after import. No website edits were overwritten.',job.series_id);});
      else run('UPDATE drive_import_jobs SET next_check_at=? WHERE id=?',now+WAIT_MS,job.id);
    }return;
  }
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
  run('DELETE FROM drive_import_clipweave_assets WHERE job_id IN(SELECT id FROM drive_import_jobs WHERE cleanup_needed=1 AND series_id IS NULL AND NOT EXISTS(SELECT 1 FROM drive_import_files f WHERE f.job_id=drive_import_jobs.id))');
  run('UPDATE drive_import_jobs SET cleanup_needed=0 WHERE cleanup_needed=1 AND series_id IS NULL AND NOT EXISTS(SELECT 1 FROM drive_import_files f WHERE f.job_id=drive_import_jobs.id)');
}
function nextWake(now:number,enabled:boolean){
  if(one('SELECT 1 FROM drive_import_jobs WHERE cleanup_needed=1 LIMIT 1'))return{wakeInMs:5_000};
  if(!enabled)return{};
  const settings=getDriveImportSettingsRow();
  const next=one<{due:number}>("SELECT MIN(MAX(next_check_at,lease_until)) AS due FROM drive_import_jobs WHERE owner_id=? AND root_folder_id=? AND config_revision=? AND status IN('waiting','downloading','validating','complete')",config.platformOwnerUserId,settings.folder_id,settings.revision)?.due;
  if(settings.scan_requested||one('SELECT 1 FROM drive_import_clipweave_exports WHERE root_folder_id=? AND owner_id=? AND config_revision=? AND next_check_at<=? LIMIT 1',settings.folder_id,config.platformOwnerUserId,settings.revision,now))return{wakeInMs:1_000};
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
    if(current.scan_requested)return nextWake(now,true);
    const job=one<Row>("SELECT * FROM drive_import_jobs WHERE owner_id=? AND root_folder_id=? AND config_revision=? AND cleanup_needed=0 AND status IN('waiting','downloading','validating','complete') AND next_check_at<=? AND lease_until<=? ORDER BY next_check_at,created_at,id LIMIT 1",owner,current.folder_id,current.revision,now,now);
    const nextDiscovery=one<{next_discovery_at:number}>('SELECT next_discovery_at FROM drive_import_clipweave_schedule WHERE id=1')?.next_discovery_at||0;
    // One discovery step may use a bounded folder-list budget. Interleave it
    // with transfer ticks so a large queue of exports cannot starve media.
    if((!job||nextDiscovery<=now)&&await discoverClipWeave(options,now)){
      run('INSERT INTO drive_import_clipweave_schedule (id,next_discovery_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET next_discovery_at=excluded.next_discovery_at',now+10_000);return nextWake(now,true);
    }
    if(!job)return nextWake(now,true);
    if(job.series_id){await checkCompleted(options,job,now);return nextWake(now,true);}
    const lease=randomUUID();run('UPDATE drive_import_jobs SET lease_token=?,lease_until=? WHERE id=? AND lease_until<=? AND series_id IS NULL',lease,now+LEASE_MS,job.id,now);
    if(jobRow(job.id)?.lease_token!==lease)return{wakeInMs:5_000};
    try{
      assertBinding(options,job,lease,true);
      if(job.status==='waiting')await inspect(options,job,lease,now);
      else{
        const support=await verifyClipWeaveSupport(options,job,lease);
        if(support){checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,updated_at=datetime('now')",now+1_000);}
        else {
        const files=filesFor(job.id),file=files.find(item=>item.status!=='validated');
        if(!file)await commit(options,job,lease,now);
        else if(file.status==='assembled'){
          checkpoint(job,lease,"UPDATE drive_import_jobs SET status='validating',message='Checking media and source checksums.',updated_at=datetime('now')");
          await validate(options,job,lease,file);checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,retry_count=0,updated_at=datetime('now')",now+1_000);
        }else{await transfer(options,job,lease,file);checkpoint(job,lease,"UPDATE drive_import_jobs SET next_check_at=?,retry_count=0,updated_at=datetime('now')",now+1_000);}
        }
      }
    }catch(error){failed(job,lease,error,now);}
    finally{run('UPDATE drive_import_jobs SET lease_token=\'\',lease_until=0 WHERE id=? AND lease_token=?',job.id,lease);}
    return nextWake(now,!!getDriveImportSettingsRow().enabled);
  }finally{ticking=false;}
}
