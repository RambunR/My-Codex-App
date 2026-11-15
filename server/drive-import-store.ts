import {randomUUID,createHash} from 'node:crypto';
import {one,all,run} from './db.js';
import {config} from './config.js';
import {assert} from './errors.js';
import {DEFAULT_DRIVE_IMPORT_FOLDER,type DriveImportSettings,type DriveImportJob,type DriveImportNotification,type DriveImportStatus,type DriveJobStatus} from '../shared/drive-import-types.js';

export interface DriveImportSettingsRow {
  id:number;enabled:number;folder_id:string;revision:number;verified_at:number|null;
  verified_folder_id:string;verified_credential_hash:string;verified_owner_id:string;
  scan_token:string;scan_requested:number;updated_at:string;
}
/** A missing row is disabled. Status requests never activate or initialize it. */
export function getDriveImportSettingsRow():DriveImportSettingsRow{
  return one<DriveImportSettingsRow>('SELECT * FROM drive_import_settings WHERE id=1')??{
    id:1,enabled:0,folder_id:DEFAULT_DRIVE_IMPORT_FOLDER,revision:1,verified_at:null,
    verified_folder_id:'',verified_credential_hash:'',verified_owner_id:'',scan_token:'',scan_requested:0,updated_at:''
  };
}
export function getDriveImportSettings():DriveImportSettings{
  const row=getDriveImportSettingsRow();
  return{enabled:!!row.enabled,folderId:row.folder_id,revision:row.revision,verifiedAt:row.verified_at};
}
/** Identity only: read, stop and notification controls must still work during
 * an account review. Transfers separately call assertPaymentAccountClear. */
export function requireDriveImportOwner():string{
  const id=config.platformOwnerUserId;
  assert(id&&one<{role:string}>('SELECT role FROM users WHERE id=?',id)?.role==='admin',403,'DRIVE_IMPORT_OWNER_REQUIRED','The configured platform owner must be an administrator to manage Drive imports.');
  return id;
}
export function unreadDriveImportNotifications(ownerId:string):number{
  if(!ownerId||ownerId!==config.platformOwnerUserId||one<{role:string}>('SELECT role FROM users WHERE id=?',ownerId)?.role!=='admin')return 0;
  return Number(one<{n:number}>('SELECT COUNT(*) AS n FROM drive_import_notifications WHERE owner_id=? AND read_at IS NULL',ownerId)?.n??0);
}
function safeText(value:unknown,max:number){
  const text=String(value??'').replace(/[\u0000-\u001f\u007f]/gu,' ').trim();
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|"private_key"\s*:/u.test(text))return '[Sensitive details omitted]';
  return text.slice(0,max);
}
/** Composable inside the runner's metadata transaction; no nested BEGIN. The
 * immutable job owner receives the notice even if the operator pin changes. */
export function notifyDriveImport(jobId:string,eventKey:string,kind:DriveImportNotification['kind'],title:string,message:string,seriesId:string|null=null):string{
  const job=one<{owner_id:string}>('SELECT owner_id FROM drive_import_jobs WHERE id=?',jobId);
  assert(job,404,'DRIVE_IMPORT_NOT_FOUND','Import job not found.');
  assert(['complete','error','attention'].includes(kind),400,'DRIVE_IMPORT_NOTICE_INVALID','Invalid import notification.');
  const key='drive:'+createHash('sha256').update(jobId+'\0'+eventKey).digest('hex');
  const id=randomUUID();
  run('INSERT OR IGNORE INTO drive_import_notifications (id,job_id,owner_id,event_key,kind,title,message,series_id) VALUES (?,?,?,?,?,?,?,?)',id,jobId,job.owner_id,key,kind,safeText(title,160),safeText(message,1200),seriesId);
  return one<{id:string}>('SELECT id FROM drive_import_notifications WHERE event_key=?',key)!.id;
}
/** Connection/root failures can happen before a series job exists. Bind these
 * to the current trusted owner without manufacturing a destination/source job. */
export function notifyDriveImportRoot(eventKey:string,kind:DriveImportNotification['kind'],title:string,message:string,ownerId:string):string{
  assert(ownerId===requireDriveImportOwner(),403,'DRIVE_IMPORT_OWNER_REQUIRED','Only the configured platform owner can receive root import notifications.');
  assert(['complete','error','attention'].includes(kind),400,'DRIVE_IMPORT_NOTICE_INVALID','Invalid import notification.');
  const key='root:'+createHash('sha256').update(ownerId+'\0'+eventKey).digest('hex'),id=randomUUID();
  run('INSERT OR IGNORE INTO drive_import_notifications (id,job_id,owner_id,event_key,kind,title,message) VALUES (?,NULL,?,?,?,?,?)',id,ownerId,key,kind,safeText(title,160),safeText(message,1200));
  return one<{id:string}>('SELECT id FROM drive_import_notifications WHERE event_key=?',key)!.id;
}
function safeSummary(value:unknown,depth=0):unknown{
  if(depth>4)return '[Depth limit]';
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string')return safeText(value,400);
  if(Array.isArray(value))return value.slice(0,20).map(item=>safeSummary(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,30).map(([key,item])=>[safeText(key,80),/secret|token|private.?key|credential|authorization/iu.test(key)?'[Redacted]':safeSummary(item,depth+1)]));
  return null;
}
export function recordDriveImportEvent(action:string,jobId:string|null=null,summary:unknown={},actorId:string|null=null):string{
  const id=randomUUID();
  const cleaned=safeSummary(summary),json=JSON.stringify(cleaned);
  run('INSERT INTO drive_import_events (id,actor_id,actor_type,action,job_id,summary_json) VALUES (?,?,?,?,?,?)',id,actorId,actorId===null?'SYSTEM':'owner',safeText(action,80),jobId,json.length<=12_000?json:'{"truncated":true}');
  return id;
}
type JobRow={id:string;folder_id:string;folder_name:string;status:DriveJobStatus;series_id:string|null;message:string;created_at:string;updated_at:string;episode_count:number;finished_files:number;total_files:number};
type NotificationRow={id:string;job_id:string|null;kind:DriveImportNotification['kind'];title:string;message:string;series_id:string|null;created_at:string;read_at:string|null};
export function driveImportStatus(ownerId:string,connection:DriveImportStatus['connection']):DriveImportStatus{
  assert(ownerId===requireDriveImportOwner(),403,'DRIVE_IMPORT_OWNER_REQUIRED','Only the configured platform owner can manage Drive imports.');
  const jobs=all<JobRow>(`SELECT j.id,j.folder_id,j.folder_name,j.status,j.series_id,j.message,j.created_at,j.updated_at,
    (SELECT COUNT(*) FROM drive_import_files f WHERE f.job_id=j.id AND f.kind='video') AS episode_count,
    CASE WHEN EXISTS(SELECT 1 FROM drive_import_clipweave_jobs c WHERE c.job_id=j.id) THEN (SELECT COUNT(*) FROM drive_import_clipweave_assets a WHERE a.job_id=j.id AND a.verified=1) ELSE (SELECT COUNT(*) FROM drive_import_files f WHERE f.job_id=j.id AND f.status='validated') END AS finished_files,
    CASE WHEN EXISTS(SELECT 1 FROM drive_import_clipweave_jobs c WHERE c.job_id=j.id) THEN (SELECT COUNT(*) FROM drive_import_clipweave_assets a WHERE a.job_id=j.id) ELSE (SELECT COUNT(*) FROM drive_import_files f WHERE f.job_id=j.id) END AS total_files
    FROM drive_import_jobs j WHERE j.owner_id=? ORDER BY j.updated_at DESC,j.rowid DESC LIMIT 100`,ownerId).map((row):DriveImportJob=>({id:row.id,folderId:row.folder_id,folderName:safeText(row.folder_name,255),status:row.status,seriesId:row.series_id,episodeCount:Number(row.episode_count),finishedFiles:Number(row.finished_files),totalFiles:Number(row.total_files),message:safeText(row.message,1200),createdAt:row.created_at,updatedAt:row.updated_at}));
  const notifications=all<NotificationRow>('SELECT id,job_id,kind,title,message,series_id,created_at,read_at FROM drive_import_notifications WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',ownerId).map((row):DriveImportNotification=>({id:row.id,jobId:row.job_id,kind:row.kind,title:safeText(row.title,160),message:safeText(row.message,1200),seriesId:row.series_id,createdAt:row.created_at,readAt:row.read_at}));
  return{settings:getDriveImportSettings(),connection,jobs,notifications,unread:unreadDriveImportNotifications(ownerId)};
}
