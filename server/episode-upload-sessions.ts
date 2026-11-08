import {getOwnerStorage,withinStorageQuota} from './storage-quota.js';
import type {StorageUsage} from '../shared/config.js';
import crypto from 'node:crypto';
import express,{type Express,type Request} from 'express';
import {z} from 'zod';
import {one,all,run,transaction} from './db.js';
import {assert,AppError} from './errors.js';
import {requireAuth,requirePublisher,getUser,rateLimit} from './auth.js';
import {assertPaymentAccountClear} from './payment-risk.js';
import {config} from './config.js';
import {scheduleMediaCleanup} from './background.js';
import {episodeUploadStorage,type EpisodeUploadStorage} from './chunked-storage.js';
import {MAX_EPISODE_BYTES,MAX_EPISODE_SECONDS} from '../shared/config.js';
import {episodeDurationSql,legacyEpisodeDuration,writeEpisodeDuration} from './episode-duration.js';

export const EPISODE_UPLOAD_CHUNK_BYTES=5*1024*1024;
const LIFETIME=60*60_000;
type Row=Record<string,any>;
interface Helpers {writableSeries(req:Request,seriesId?:string):Row;ownerStorage(series:Row):StorageUsage}
const locks=new Map<string,Promise<void>>();
async function locked<T>(id:string,work:()=>Promise<T>):Promise<T>{
  const previous=locks.get(id)||Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve;});locks.set(id,current);
  await previous.catch(()=>{});try{return await work();}finally{release();if(locks.get(id)===current)locks.delete(id);}
}
export function chunkedEpisodeUploadsEnabled(){return episodeUploadStorage.enabled();}
export function reservedEpisodeUploadBytes(creatorId:string,excludeId=''){
  return Number(one("SELECT COALESCE(SUM(total_bytes),0) AS bytes FROM episode_upload_sessions WHERE creator_id=? AND id<>? AND status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1)",creatorId,excludeId)!.bytes);
}
function owned(req:Request){
  const session=one('SELECT * FROM episode_upload_sessions WHERE id=? AND series_id=?',String(req.params.uploadId||''),String(req.params.id||''));
  assert(session,404,'NOT_FOUND','Upload session not found.');assert(session.actor_id===req.user!.id,403,'FORBIDDEN','This upload belongs to another publisher.');return session;
}
function writable(req:Request,session:Row,helpers:Helpers){
  const series=helpers.writableSeries(req,session.series_id);assert(series.creator_id===session.creator_id,409,'UPLOAD_OWNER_CHANGED','This series owner changed. Start another upload.');assertPaymentAccountClear(series.creator_id);
  assert(session.expires_at_ms>Date.now(),410,'UPLOAD_EXPIRED','This upload expired. Choose the file again.');return series;
}
function referenced(key:string){return!!one('SELECT 1 FROM episodes WHERE storage_key=? UNION ALL SELECT 1 FROM series WHERE cover_key=? LIMIT 1',key,key);}
function markCleanup(sessionId:string){run("UPDATE episode_upload_sessions SET status='cancelled',cleanup_pending=1 WHERE id=? AND status<>'complete'",sessionId);}
function missingMultipart(error:unknown){return /(?:\b10024\b|NoSuchUpload|specified multipart upload does not exist)/i.test(error instanceof Error?error.message:String(error));}
async function cleanupOne(session:Row,storage:EpisodeUploadStorage){
  // Every call is under this session's lock. A committed episode is never
  // aborted or deleted even if its client did not receive the success reply.
  const latest=one('SELECT * FROM episode_upload_sessions WHERE id=?',session.id);if(!latest||latest.status==='complete')return;
  if(referenced(latest.object_key)){run("UPDATE episode_upload_sessions SET cleanup_pending=0 WHERE id=?",latest.id);return;}
  const head=await storage.head(latest.object_key);
  if(!head&&latest.upload_id){try{await storage.abort(latest.object_key,latest.upload_id);}catch(error){if(!missingMultipart(error))throw error;}}
  await storage.remove(latest.object_key);
  run('DELETE FROM episode_upload_parts WHERE session_id=?',latest.id);
  run("UPDATE episode_upload_sessions SET status='cancelled',cleanup_pending=0,upload_id=NULL WHERE id=? AND status<>'complete'",latest.id);
}
export async function cleanupExpiredEpisodeUploads(limit=10,now=Date.now(),storage:EpisodeUploadStorage=episodeUploadStorage){
  if(!storage.enabled())return;
  const rows=all("SELECT u.* FROM episode_upload_sessions u WHERE u.status<>'complete' AND (u.cleanup_pending=1 OR u.status<>'cancelled' AND (u.expires_at_ms<=? OR EXISTS(SELECT 1 FROM series_deletions d WHERE d.series_id=u.series_id))) ORDER BY u.created_at_ms LIMIT ?",now,Math.min(10,Math.max(1,limit)));
  for(const row of rows)await locked(row.id,async()=>{const current=one('SELECT * FROM episode_upload_sessions WHERE id=?',row.id);if(!current||current.status==='complete')return;markCleanup(row.id);try{await cleanupOne(current,storage);}catch{console.warn('Episode upload cleanup remains queued for retry.');}});
  const pending=one("SELECT MIN(CASE WHEN cleanup_pending=1 THEN ? ELSE expires_at_ms END) AS next FROM episode_upload_sessions WHERE status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1)",now+60_000);
  if(pending?.next!==null&&pending?.next!==undefined)await scheduleMediaCleanup(Math.max(1000,Number(pending.next)-now));
}
function response(session:Row){
  const episode=one(`SELECT e.id,${episodeDurationSql()} AS duration,e.bytes FROM episodes e WHERE e.id=?`,session.episode_id);assert(episode,404,'NOT_FOUND','Uploaded episode no longer exists.');
  return{...episode,user:getUser(session.actor_id),owner_storage:getOwnerStorage(session.creator_id)};
}
let rawRequests=0;
export function registerEpisodeUploadSessions(app:Express,helpers:Helpers,storage:EpisodeUploadStorage=episodeUploadStorage){
  const enabled=(_req:Request,_res:express.Response,next:express.NextFunction)=>{assert(storage.enabled(),404,'NOT_FOUND','Not found.');assert(!config.sandbox,403,'SANDBOX_UPLOAD_DISABLED','Uploads are disabled on the payment-test site.');next();};
  const base='/api/studio/series/:id/episode-uploads';
  app.post(base,enabled,requirePublisher,rateLimit('episode-upload-create',60,60_000),async(req,res)=>{
    const body=z.object({title:z.string().trim().min(1).max(120),number:z.number().int().min(1).max(1000),filename:z.string().min(1).max(255),size:z.number().int().positive()}).strict().parse(req.body);
    assert(body.size<=MAX_EPISODE_BYTES,413,'FILE_TOO_LARGE',`Episodes must be ${MAX_EPISODE_BYTES/1024**2} MiB or less.`);
    await cleanupExpiredEpisodeUploads(3,Date.now(),storage);
    const uploadId=crypto.randomUUID(),episodeId=crypto.randomUUID(),now=Date.now();
    const session=transaction(()=>{
      const series=helpers.writableSeries(req);assertPaymentAccountClear(series.creator_id);const owner=helpers.ownerStorage(series);
      assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=?',series.id,body.number),409,'EPISODE_EXISTS','An episode with this number already exists.');
      assert(!one("SELECT id FROM episode_upload_sessions WHERE series_id=? AND number=? AND status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1)",series.id,body.number),409,'EPISODE_UPLOAD_EXISTS','This episode already has an upload in progress.');
      assert(Number(one("SELECT COUNT(*) AS n FROM episode_upload_sessions WHERE creator_id=? AND status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1)",series.creator_id)!.n)<3,503,'SERVER_BUSY','Finish or cancel an existing upload before starting another.');
      assert(withinStorageQuota(owner,owner.used_bytes+reservedEpisodeUploadBytes(series.creator_id)+body.size),413,'QUOTA_EXCEEDED','Not enough storage. Request an increase from your studio.');
      const key=`videos/${series.creator_id}/${episodeId}.mp4`,filename=body.filename.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f]/g,'');
      run('INSERT INTO episode_upload_sessions (id,series_id,actor_id,creator_id,object_key,episode_id,title,number,filename,total_bytes,created_at_ms,expires_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',uploadId,series.id,req.user!.id,series.creator_id,key,episodeId,body.title,body.number,filename,body.size,now,now+LIFETIME);
      return one('SELECT * FROM episode_upload_sessions WHERE id=?',uploadId)!;
    });
    await locked(session.id,async()=>{
      try{
        await scheduleMediaCleanup();const id=await storage.create(session.object_key);
        run('UPDATE episode_upload_sessions SET upload_id=? WHERE id=?',id,session.id);
        writable(req,session,helpers);run("UPDATE episode_upload_sessions SET status='uploading' WHERE id=?",session.id);
      }catch(error){markCleanup(session.id);try{await cleanupOne(one('SELECT * FROM episode_upload_sessions WHERE id=?',session.id)!,storage);}catch{}throw error;}
    });
    res.status(201).json({id:session.id,chunkBytes:EPISODE_UPLOAD_CHUNK_BYTES,partCount:Math.ceil(session.total_bytes/EPISODE_UPLOAD_CHUNK_BYTES),expiresAt:new Date(session.expires_at_ms).toISOString()});
  });
  const guardPart=(req:Request,res:express.Response,next:express.NextFunction)=>{
    const session=owned(req);writable(req,session,helpers);
    assert(session.status==='uploading',409,'UPLOAD_CLOSED','This upload no longer accepts parts.');
    const number=Number(req.params.partNumber);assert(Number.isSafeInteger(number)&&number>=1&&number<=Math.ceil(session.total_bytes/EPISODE_UPLOAD_CHUNK_BYTES),400,'INVALID_PART','Choose a valid upload part.');
    assert(req.is('application/octet-stream'),415,'INVALID_PART_TYPE','Upload parts must contain binary video bytes.');
    assert(rawRequests<3,503,'SERVER_BUSY','Uploads are busy. Please retry shortly.');rawRequests++;let done=false;const release=()=>{if(done)return;done=true;rawRequests--;};
    (req as any).episodeChunkRelease=release;res.once('finish',release);res.once('close',()=>{if(!(req as any).episodeChunkProcessing)release();});next();
  };
  app.put(base+'/:uploadId/parts/:partNumber',enabled,requirePublisher,guardPart,express.raw({type:'application/octet-stream',limit:EPISODE_UPLOAD_CHUNK_BYTES}),async(req,res)=>{
    (req as any).episodeChunkProcessing=true;
    try{
    const initial=owned(req),number=Number(req.params.partNumber),data=req.body;assert(Buffer.isBuffer(data),400,'INVALID_PART','The upload part is empty.');
    const size=Math.min(EPISODE_UPLOAD_CHUNK_BYTES,initial.total_bytes-(number-1)*EPISODE_UPLOAD_CHUNK_BYTES);assert(data.length===size,400,'INVALID_PART_SIZE','This upload part has an incorrect size.');
    const sha256=crypto.createHash('sha256').update(data).digest('hex');
    await locked(initial.id,async()=>{
      const session=owned(req);writable(req,session,helpers);assert(session.status==='uploading',409,'UPLOAD_CLOSED','This upload no longer accepts parts.');
      const previous=one('SELECT * FROM episode_upload_parts WHERE session_id=? AND part_number=?',session.id,number);
      if(previous){assert(previous.bytes===size&&previous.sha256===sha256,409,'PART_MISMATCH','This upload part was already sent with different bytes.');return;}
      const part=await storage.part(session.object_key,session.upload_id,number,data);
      const current=owned(req);writable(req,current,helpers);assert(current.status==='uploading',409,'UPLOAD_CLOSED','This upload no longer accepts parts.');
      run('INSERT INTO episode_upload_parts (session_id,part_number,bytes,sha256,etag) VALUES (?,?,?,?,?)',session.id,number,size,sha256,part.etag);
    });res.json({partNumber:number});
    }finally{(req as any).episodeChunkRelease?.();}
  });
  app.post(base+'/:uploadId/complete',enabled,requirePublisher,async(req,res)=>{
    const initial=owned(req);const result=await locked(initial.id,async()=>{
      let session=owned(req);
      if(session.status==='complete'){helpers.writableSeries(req,session.series_id);return{created:false,...response(session)};}
      writable(req,session,helpers);
      assert(session.status==='uploading'||session.status==='completing',409,'UPLOAD_CLOSED','This upload was cancelled.');
      const parts=all('SELECT part_number,bytes,etag FROM episode_upload_parts WHERE session_id=? ORDER BY part_number',session.id);
      const count=Math.ceil(session.total_bytes/EPISODE_UPLOAD_CHUNK_BYTES);
      assert(parts.length===count&&parts.every((part,index)=>part.part_number===index+1&&part.bytes===Math.min(EPISODE_UPLOAD_CHUNK_BYTES,session.total_bytes-index*EPISODE_UPLOAD_CHUNK_BYTES)),409,'UPLOAD_INCOMPLETE','Upload every part before completing this episode.');
      run("UPDATE episode_upload_sessions SET status='completing' WHERE id=?",session.id);
      try{
        // After a lost completion reply or runtime restart, the assembled
        // private object is reused and never assembled/charged twice.
        const exists=await storage.head(session.object_key);
        if(!exists)await storage.complete(session.object_key,session.upload_id,parts.map(part=>({partNumber:part.part_number,etag:part.etag})));
        session=owned(req);writable(req,session,helpers);assert(session.status==='completing',409,'UPLOAD_CLOSED','This upload was cancelled.');
        const media=await storage.validate(session.object_key);
        assert(media.bytes===session.total_bytes&&media.bytes<=MAX_EPISODE_BYTES,422,'INVALID_VIDEO','The uploaded video size does not match this upload.');
        assert(Number.isFinite(media.duration)&&media.duration>0,422,'INVALID_VIDEO','This file has no readable video track.');
        assert(media.duration<=MAX_EPISODE_SECONDS,422,'VIDEO_TOO_LONG',`Episodes must be ${MAX_EPISODE_SECONDS/60} minutes or less.`);
        transaction(()=>{
          const latest=owned(req),series=writable(req,latest,helpers);assert(latest.status==='completing',409,'UPLOAD_CLOSED','This upload was cancelled.');const owner=helpers.ownerStorage(series);
          assert(withinStorageQuota(owner,owner.used_bytes+reservedEpisodeUploadBytes(series.creator_id,latest.id)+media.bytes),413,'QUOTA_EXCEEDED','Not enough storage. Request an increase.');
          assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=?',series.id,latest.number),409,'EPISODE_EXISTS','An episode with this number already exists.');
          run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',latest.episode_id,series.id,latest.title,latest.number,legacyEpisodeDuration(media.duration),media.bytes,latest.object_key,latest.filename);writeEpisodeDuration(latest.episode_id,media.duration);
          run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',media.bytes,series.creator_id);
          run("UPDATE episode_upload_sessions SET status='complete',cleanup_pending=0,completed_at_ms=? WHERE id=?",Date.now(),latest.id);
        });return{created:true,...response(session)};
      }catch(error){
        // Validation/authorization failures are definitive. Storage failures
        // retain completing state so the same session can safely be retried.
        if(error instanceof AppError&&error.status<500){markCleanup(session.id);try{await scheduleMediaCleanup();await cleanupOne(session,storage);}catch{};}
        throw error;
      }
    });const{created,...body}=result;res.status(created?201:200).json(body);
  });
  app.delete(base+'/:uploadId',enabled,requireAuth,async(req,res)=>{
    const initial=owned(req);const result=await locked(initial.id,async()=>{const session=owned(req);if(session.status==='complete')return{ok:true,completed:true,id:session.episode_id};
      markCleanup(session.id);await scheduleMediaCleanup();try{await cleanupOne(session,storage);}catch{console.warn('Cancelled episode upload cleanup remains queued.');}
      return{ok:true,cancelled:true,cleanup_pending:!!one('SELECT cleanup_pending FROM episode_upload_sessions WHERE id=?',session.id)?.cleanup_pending};
    });res.json(result);
  });
}
