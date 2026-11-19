import type {Express,Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {requireAuth,rateLimit} from './auth.js';
import {assert,AppError} from './errors.js';
import {config} from './config.js';
import {one,all,run,transaction} from './db.js';
import {assertPaymentAccountClear} from './payment-risk.js';
import {scheduleMediaCleanup} from './background.js';
import {driveImportRuntime} from './drive-import-runtime.js';
import {getDriveImportSettingsRow,requireDriveImportOwner,notifyDriveImport,recordDriveImportEvent,driveImportStatus,importDestinationNotDeleted,type DriveImportSettingsRow} from './drive-import-store.js';

const base='/api/admin/drive-imports';
const folderId=z.string().regex(/^[A-Za-z0-9_-]{10,200}$/u,'Enter a Google Drive folder ID.');
const settingsBody=z.object({enabled:z.boolean().optional(),folderId:folderId.optional()}).strict().refine(body=>body.enabled!==undefined||body.folderId!==undefined,'Choose a setting to change.');
const emptyBody=z.object({}).strict();
const recentVerificationMs=24*60*60*1000;
const connectionFailures=new Map<string,readonly[number,string,string]>([
  ['DRIVE_API_DISABLED',[409,'DRIVE_IMPORT_API_DISABLED','Google Drive API is disabled for the service-account project. Enable Google Drive API for that project, then verify again.']],
  ['DRIVE_AUTH_FAILED',[409,'DRIVE_IMPORT_AUTH_FAILED','Google could not authorize the configured service-account key. Check or replace the private JSON key in Cloudflare, then verify again.']],
  ['DRIVE_ACCESS_DENIED',[409,'DRIVE_IMPORT_ACCESS_DENIED','The configured service account cannot read this folder. Share the selected folder with the service account shown here as a Viewer, keep general access Restricted, then verify again.']],
  ['DRIVE_RATE_LIMITED',[429,'DRIVE_IMPORT_RATE_LIMITED','Google is temporarily limiting Drive requests. Wait before verifying again.']],
  ['DRIVE_UNAVAILABLE',[503,'DRIVE_IMPORT_UNAVAILABLE','Google Drive could not be reached or is temporarily unavailable. Try verifying again later.']],
  ['INVALID_DRIVE_FOLDER',[422,'DRIVE_IMPORT_INVALID_FOLDER','The selected source is not a valid Google Drive folder. Check the folder ID, then verify again.']],
  ['DRIVE_SOURCE_CHANGED',[502,'DRIVE_IMPORT_INVALID_RESPONSE','Google Drive returned incomplete or invalid folder information. Check the source folder and try verifying again.']],
]);
type Job={id:string;owner_id:string;root_folder_id:string;status:string;series_id:string|null;cleanup_needed:number};
function credentials(){
  try{return driveImportRuntime.credentials();}catch{return{configured:false,serviceAccountEmail:null,fingerprint:''};}
}
function runtimeAvailable(){try{return!config.sandbox&&driveImportRuntime.available();}catch{return false;}}
function requireOwner(req:Request,_res:Response,next:NextFunction){
  assert(req.user!.id===requireDriveImportOwner(),403,'DRIVE_IMPORT_OWNER_REQUIRED','Only the configured platform owner can manage Drive imports.');next();
}
function initializeSettings(){
  const row=getDriveImportSettingsRow();
  run('INSERT OR IGNORE INTO drive_import_settings (id,folder_id) VALUES (1,?)',row.folder_id);
}
function verified(row:DriveImportSettingsRow,ownerId:string,requireRecent=false,now=Date.now()){
  const current=credentials();
  return current.configured&&!!current.fingerprint&&row.verified_at!==null&&row.verified_at<=now&&(!requireRecent||row.verified_at>=now-recentVerificationMs)&&row.verified_folder_id===row.folder_id&&row.verified_credential_hash===current.fingerprint&&row.verified_owner_id===ownerId;
}
function ready(ownerId:string,{enabled=false}={}){
  assertPaymentAccountClear(ownerId);
  assert(runtimeAvailable(),503,'DRIVE_IMPORT_RUNTIME_UNAVAILABLE','Drive imports require the production Cloudflare runtime.');
  assert(credentials().configured,409,'DRIVE_IMPORT_CREDENTIALS_REQUIRED','Configure the private Google Drive service-account secret first.');
  const row=getDriveImportSettingsRow();
  assert(verified(row,ownerId,!enabled),409,'DRIVE_IMPORT_VERIFICATION_REQUIRED','Verify access to the current Drive folder before starting imports.');
  if(enabled)assert(row.enabled,409,'DRIVE_IMPORT_DISABLED','Enable the Drive importer before requesting work.');
  return row;
}
function respond(req:Request,res:Response){
  const ownerId=requireDriveImportOwner();
  assert(req.user!.id===ownerId,403,'DRIVE_IMPORT_OWNER_REQUIRED','Only the configured platform owner can manage Drive imports.');
  const current=credentials(),status=driveImportStatus(ownerId,{configured:current.configured,serviceAccountEmail:current.serviceAccountEmail,runtimeAvailable:runtimeAvailable()});
  // A rotated key/owner or changed folder is not a verified connection, even
  // when an earlier verification timestamp remains as private audit state.
  const row=getDriveImportSettingsRow();if(!verified(row,ownerId,!row.enabled))status.settings.verifiedAt=null;
  res.json(status);
}
function ownedJob(req:Request):Job{
  const id=z.string().min(1).max(128).parse(req.params.id),job=one<Job>('SELECT id,owner_id,root_folder_id,status,series_id,cleanup_needed FROM drive_import_jobs WHERE id=? AND owner_id=?',id,req.user!.id);
  assert(job,404,'DRIVE_IMPORT_NOT_FOUND','Import job not found.');return job;
}
function clearLeaseSql(){return"lease_token='',lease_until=0,updated_at=datetime('now')";}
export function registerDriveImportApi(app:Express){
  app.use(base,(_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();},requireAuth,requireOwner);
  app.get(base,rateLimit('drive-import-status',120,60_000),(req,res)=>respond(req,res));
  app.patch(base,rateLimit('drive-import-settings',30,60_000),async(req,res)=>{
    const body=settingsBody.parse(req.body),ownerId=req.user!.id;
    let shouldWake=false;
    transaction(()=>{
      initializeSettings();const before=getDriveImportSettingsRow();
      if(body.folderId!==undefined&&body.folderId!==before.folder_id){
        const jobs=all<Job>("SELECT id,owner_id,root_folder_id,status,series_id,cleanup_needed FROM drive_import_jobs WHERE root_folder_id=? AND series_id IS NULL AND status NOT IN('complete','cancelled')",before.folder_id);
        for(const job of jobs){
          run(`UPDATE drive_import_jobs SET status='cancelled',message='Import cancelled because the configured Drive folder changed.',error_code='ROOT_CHANGED',cleanup_needed=CASE WHEN EXISTS(SELECT 1 FROM drive_import_files WHERE job_id=?) THEN 1 ELSE cleanup_needed END,${clearLeaseSql()} WHERE id=? AND series_id IS NULL`,job.id,job.id);
          notifyDriveImport(job.id,'root-changed','attention','Drive import cancelled','The configured source folder changed. Any temporary upload data will be removed.');
        }
        run("UPDATE drive_import_settings SET enabled=0,folder_id=?,revision=revision+1,verified_at=NULL,verified_folder_id='',verified_credential_hash='',verified_owner_id='',scan_token='',scan_requested=0,updated_at=datetime('now') WHERE id=1",body.folderId);
        recordDriveImportEvent('settings.folder',null,{before:before.folder_id,after:body.folderId,cancelled:jobs.length},ownerId);shouldWake=jobs.length>0;
      }else if(body.enabled!==undefined){
        if(body.enabled)ready(ownerId,{enabled:!!before.enabled});
        run("UPDATE drive_import_settings SET enabled=?,scan_requested=CASE WHEN ?=1 THEN 1 ELSE scan_requested END,updated_at=datetime('now') WHERE id=1",Number(body.enabled),Number(body.enabled));
        if(!!before.enabled!==body.enabled)recordDriveImportEvent(body.enabled?'settings.enable':'settings.disable',null,{folderId:before.folder_id,revision:before.revision},ownerId);
        shouldWake=body.enabled;
      }
    });
    if(shouldWake)await scheduleMediaCleanup(1000);respond(req,res);
  });
  app.post(base+'/connection',rateLimit('drive-import-connection',6,60_000),async(req,res)=>{
    emptyBody.parse(req.body??{});
    assert(runtimeAvailable(),503,'DRIVE_IMPORT_RUNTIME_UNAVAILABLE','Drive imports require the production Cloudflare runtime.');
    const ownerId=req.user!.id,before=getDriveImportSettingsRow(),current=credentials();
    assert(current.configured&&current.fingerprint,409,'DRIVE_IMPORT_CREDENTIALS_REQUIRED','Configure the private Google Drive service-account secret first.');
    try{await driveImportRuntime.verifyFolder(before.folder_id);}catch(error){
      // Runtime adapters and generated Cloudflare modules need not share an
      // Error class identity. Only allowlisted codes select fixed safe text.
      const failure=connectionFailures.get(typeof(error as any)?.code==='string'?(error as any).code:'');
      if(failure){
        const retry=(error as any).retryAfterSeconds;
        if(failure[0]===429&&Number.isSafeInteger(retry)&&retry>=0)res.setHeader('Retry-After',String(Math.min(3600,retry)));
        throw new AppError(...failure);
      }
      // Unknown provider errors may contain credentials or private folder data.
      throw new AppError(409,'DRIVE_IMPORT_CONNECTION_FAILED','Unable to verify this Drive folder. Enable Google Drive API and share the folder with the configured service account as a Viewer.');
    }
    transaction(()=>{
      assert(requireDriveImportOwner()===ownerId,409,'DRIVE_IMPORT_CONNECTION_CHANGED','The configured owner changed. Verify the connection again.');
      const after=getDriveImportSettingsRow(),latest=credentials();
      assert(after.folder_id===before.folder_id&&after.revision===before.revision&&runtimeAvailable()&&latest.configured&&latest.fingerprint===current.fingerprint,409,'DRIVE_IMPORT_CONNECTION_CHANGED','The Drive configuration changed during verification. Verify the connection again.');
      initializeSettings();
      run("UPDATE drive_import_settings SET verified_at=?,verified_folder_id=?,verified_credential_hash=?,verified_owner_id=?,updated_at=datetime('now') WHERE id=1",Date.now(),before.folder_id,current.fingerprint,ownerId);
      recordDriveImportEvent('connection.verified',null,{folderId:before.folder_id,revision:before.revision},ownerId);
    });respond(req,res);
  });
  app.post(base+'/scan',rateLimit('drive-import-scan',10,60_000),async(req,res)=>{
    emptyBody.parse(req.body??{});const ownerId=req.user!.id;
    transaction(()=>{
      const settings=ready(ownerId,{enabled:true}),now=Date.now();
      run("UPDATE drive_import_settings SET scan_requested=1,updated_at=datetime('now') WHERE id=1");
      // Let an operator recheck material that has just finished syncing.
      // Leave active transfer checkpoints and their retry timing alone.
      run(`UPDATE drive_import_jobs SET next_check_at=? WHERE owner_id=? AND root_folder_id=? AND config_revision=? AND status IN('waiting','complete') AND lease_until<=? AND next_check_at>? AND ${importDestinationNotDeleted}`,now,ownerId,settings.folder_id,settings.revision,now,now);
      run('UPDATE drive_import_clipweave_exports SET next_check_at=? WHERE owner_id=? AND root_folder_id=? AND config_revision=? AND next_check_at>?',now,ownerId,settings.folder_id,settings.revision,now);
      recordDriveImportEvent('scan.requested',null,{},ownerId);
    });
    await scheduleMediaCleanup(1000);respond(req,res);
  });
  app.post(base+'/jobs/:id/cancel',rateLimit('drive-import-cancel',30,60_000),async(req,res)=>{
    emptyBody.parse(req.body??{});
    transaction(()=>{
      const job=ownedJob(req);
      assert(job.status!=='complete'&&!job.series_id,409,'DRIVE_IMPORT_ALREADY_IMPORTED','This source already maps to an imported series. Manage the draft in Creator Studio.');
      if(job.status!=='cancelled'){
        run(`UPDATE drive_import_jobs SET status='cancelled',message='Import cancelled by the platform owner.',error_code='OWNER_CANCELLED',cleanup_needed=CASE WHEN EXISTS(SELECT 1 FROM drive_import_files WHERE job_id=?) THEN 1 ELSE cleanup_needed END,${clearLeaseSql()} WHERE id=?`,job.id,job.id);
        notifyDriveImport(job.id,'owner-cancelled','attention','Drive import cancelled','The import was stopped. Any temporary upload data will be removed.');recordDriveImportEvent('job.cancelled',job.id,{},req.user!.id);
      }
    });await scheduleMediaCleanup(1000);respond(req,res);
  });
  app.post(base+'/jobs/:id/retry',rateLimit('drive-import-retry',20,60_000),async(req,res)=>{
    emptyBody.parse(req.body??{});
    transaction(()=>{
      const job=ownedJob(req),settings=ready(req.user!.id,{enabled:true});
      assert(!job.series_id&&['error','cancelled','review'].includes(job.status),409,'DRIVE_IMPORT_RETRY_UNAVAILABLE','Only a stopped import without an existing destination can be retried.');
      assert(job.root_folder_id===settings.folder_id,409,'DRIVE_IMPORT_SOURCE_CHANGED','This job belongs to a different source folder.');
      assert(!job.cleanup_needed&&!one('SELECT 1 FROM drive_import_files WHERE job_id=? LIMIT 1',job.id),409,'DRIVE_IMPORT_CLEANUP_PENDING','Wait for temporary upload cleanup before retrying this job.');
      run(`UPDATE drive_import_jobs SET status='waiting',config_revision=?,manifest_hash='',manifest_json='{}',source_snapshot_json='[]',message='Waiting for manifest verification.',error_code='',next_check_at=0,retry_count=0,${clearLeaseSql()} WHERE id=?`,settings.revision,job.id);
      run("UPDATE drive_import_settings SET scan_requested=1,updated_at=datetime('now') WHERE id=1");recordDriveImportEvent('job.retry',job.id,{},req.user!.id);
    });await scheduleMediaCleanup(1000);respond(req,res);
  });
  app.post(base+'/notifications/read',rateLimit('drive-import-notifications-read',60,60_000),(req,res)=>{
    emptyBody.parse(req.body??{});run("UPDATE drive_import_notifications SET read_at=datetime('now') WHERE owner_id=? AND read_at IS NULL",req.user!.id);respond(req,res);
  });
}
