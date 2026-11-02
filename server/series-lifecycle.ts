import crypto from 'node:crypto';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {config} from './config.js';
import {purchaseTable,usingTestPaymentState} from './payment-state.js';
import {deleteObject} from './storage.js';
import {scheduleMediaCleanup} from './background.js';
import {assertSeriesWritable} from './moderation.js';
import {playbackTimeSql} from './playback-times.js';

type Row=Record<string,any>;
const CONFIRMATION_LIFETIME=10*60_000;
const hash=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
export function isSeriesDeleted(seriesId:string){return!!one('SELECT 1 FROM series_deletions WHERE series_id=?',seriesId);}
function ownedSeries(actorId:string,seriesId:string){
  const actor=one('SELECT role FROM users WHERE id=?',actorId);assert(actor,401,'AUTH_REQUIRED','Sign in to continue.');
  const series=one('SELECT * FROM series WHERE id=?',seriesId);assert(series&&!isSeriesDeleted(seriesId),404,'NOT_FOUND','Series not found.');
  assert(series.creator_id===actorId||actor.role==='admin',403,'FORBIDDEN','This series belongs to another publisher.');return series;
}
export function assertSeriesLifecycleFinancialClear(actorId:string,ownerId:string){
  assert(!one("SELECT 1 FROM payment_risk_cases WHERE status='open' AND (user_id IS NULL OR user_id IN (?,?)) LIMIT 1",actorId,ownerId),423,'PAYMENT_REVIEW_REQUIRED','This content cannot be removed while a payment review remains unresolved.');
}
/** Failed/ambiguous uploads were never charged. Keep cleanup durable even if
 * deletion raced an upstream PUT or an immediate best-effort cleanup fails. */
export async function queueUnreferencedSeriesMedia(seriesId:string,creatorId:string,key:string){
  if(!key||key.startsWith('public:')||key.startsWith('demo/'))return;
  if(one('SELECT 1 FROM series WHERE cover_key=? UNION ALL SELECT 1 FROM episodes WHERE storage_key=? LIMIT 1',key,key))return;
  run("INSERT OR IGNORE INTO series_media_deletions (series_id,creator_id,object_key,bytes) VALUES (?,?,?,0)",seriesId,creatorId,key);
  try{await scheduleMediaCleanup();await cleanupSeriesMedia(seriesId,20);}catch{console.warn('Series media cleanup remains queued for retry.');}
}
function financialMode(){return usingTestPaymentState()||config.sandbox||config.payments==='demo'?'test':'live';}
function purchases(table:'purchases'|'test_purchases',id:string){return one(`SELECT COUNT(*) AS paid_unlocks,COUNT(DISTINCT p.user_id) AS paid_viewers FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0`,id)!;}
function summary(series:Row){
  const episodes=one('SELECT COUNT(*) AS n,COALESCE(SUM(bytes),0) AS bytes FROM episodes WHERE series_id=?',series.id)!;
  const views=one(`SELECT COALESCE(SUM(${playbackTimeSql()}),0) AS watched_ms,COUNT(*) AS views FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.counted_view=1`,series.id)!;
  const paid=purchases(purchaseTable() as 'purchases'|'test_purchases',series.id),real=purchases('purchases',series.id),test=purchases('test_purchases',series.id);
  const affected=one('SELECT COUNT(DISTINCT user_id) AS n FROM (SELECT p.user_id FROM purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0 UNION SELECT p.user_id FROM test_purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0)',series.id,series.id)!.n;
  return{episode_count:Number(episodes.n),views:Number(series.views),likes:Number(one('SELECT COUNT(*) AS n FROM series_likes WHERE series_id=?',series.id)!.n),paid_unlocks:Number(paid.paid_unlocks),paid_viewers:Number(paid.paid_viewers),total_watch_seconds:Number(views.watched_ms)/1000,avg_watch_seconds:views.views?Number(views.watched_ms)/1000/Number(views.views):0,media_bytes:Number(series.cover_bytes)+Number(episodes.bytes),financial_mode:financialMode(),real_paid_unlocks:Number(real.paid_unlocks),real_paid_viewers:Number(real.paid_viewers),test_paid_unlocks:Number(test.paid_unlocks),test_paid_viewers:Number(test.paid_viewers),affected_paid_viewers:Number(affected)};
}
// Views/likes can continue while the warning is open; content and paid-access
// changes require another preview so a confirmation never silently changes scope.
function fingerprint(series:Row){
  const {views,updated_at,...content}=series;
  const episodes=all('SELECT * FROM episodes WHERE series_id=? ORDER BY id',series.id);
  // Financial records are immutable. Bounded aggregates detect newly granted
  // paid access without copying a popular series' entire purchase history.
  const purchases=['purchases','test_purchases'].map(table=>one(`SELECT COUNT(*) AS n,COALESCE(MAX(p.rowid),0) AS latest FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?`,series.id));
  return hash(JSON.stringify({content,episodes,purchases,financial_mode:financialMode()}));
}
export function previewSeriesDeletion(actorId:string,seriesId:string){
  return transaction(()=>{
    const series=ownedSeries(actorId,seriesId),now=Date.now(),token=crypto.randomBytes(32).toString('hex');
    run('DELETE FROM series_deletion_confirmations WHERE expires_at_ms<=? OR (series_id=? AND actor_id=?)',now,seriesId,actorId);
    run('INSERT INTO series_deletion_confirmations (token_hash,series_id,actor_id,content_hash,expires_at_ms,created_at_ms) VALUES (?,?,?,?,?,?)',hash(token),seriesId,actorId,fingerprint(series),now+CONFIRMATION_LIFETIME,now);
    return{series:{id:series.id,title:series.title,status:series.status,taken_down:!!one('SELECT 1 FROM series_moderation WHERE series_id=? AND taken_down=1',seriesId)},summary:summary(series),confirmation_token:token,expires_at:new Date(now+CONFIRMATION_LIFETIME).toISOString()};
  });
}
export async function cleanupSeriesMedia(seriesId?:string,limit=100){
  const bounded=Math.max(1,Math.min(40,Math.floor(limit))),rows=all(`SELECT * FROM series_media_deletions WHERE status='pending'${seriesId?' AND series_id=?':''} ORDER BY COALESCE(attempted_at_ms,0),rowid LIMIT ?`,...(seriesId?[seriesId,bounded]:[bounded]));let released=0;
  for(const row of rows){
    run('UPDATE series_media_deletions SET attempts=attempts+1,attempted_at_ms=? WHERE series_id=? AND object_key=? AND status=\'pending\'',Date.now(),row.series_id,row.object_key);
    try{await deleteObject(row.object_key);}catch{continue;}
    transaction(()=>{const pending=one("SELECT bytes,creator_id FROM series_media_deletions WHERE series_id=? AND object_key=? AND status='pending'",row.series_id,row.object_key);if(!pending)return;
      run('UPDATE users SET used_bytes=MAX(0,used_bytes-?) WHERE id=?',pending.bytes,pending.creator_id);
      run("UPDATE series_media_deletions SET status='done',object_key=?,completed_at=datetime('now') WHERE series_id=? AND object_key=?",'removed:'+crypto.randomUUID(),row.series_id,row.object_key);released+=Number(pending.bytes);
    });
  }
  const pending=!!one(`SELECT 1 FROM series_media_deletions WHERE status='pending'${seriesId?' AND series_id=?':''} LIMIT 1`,...(seriesId?[seriesId]:[]));
  if(pending)await scheduleMediaCleanup();
  return{released_bytes:released,cleanup_pending:pending};
}
export async function deleteSeriesPermanently(actorId:string,seriesId:string,input:{confirmation_token:string;confirm_title:string;acknowledge:boolean}){
  ownedSeries(actorId,seriesId);
  // Register the durable wake-up before the irreversible transaction. If this
  // request is interrupted after commit, the persisted outbox still gets work.
  await scheduleMediaCleanup();
  transaction(()=>{
    const series=ownedSeries(actorId,seriesId);assertSeriesLifecycleFinancialClear(actorId,series.creator_id);
    if(one('SELECT role FROM users WHERE id=?',actorId)!.role!=='admin')assertSeriesWritable(seriesId);
    assert(input.acknowledge===true,400,'DELETION_ACK_REQUIRED','Confirm that this deletion cannot be recovered.');
    assert(typeof input.confirm_title==='string'&&input.confirm_title===series.title,400,'DELETION_TITLE_MISMATCH','Type the series title exactly to confirm deletion.');
    assert(typeof input.confirmation_token==='string'&&/^[a-f0-9]{64}$/.test(input.confirmation_token),400,'DELETION_CONFIRMATION_INVALID','Open the deletion warning again before deleting.');
    const proof=one('SELECT * FROM series_deletion_confirmations WHERE token_hash=? AND actor_id=? AND series_id=?',hash(input.confirmation_token),actorId,seriesId);
    assert(proof,400,'DELETION_CONFIRMATION_INVALID','Open the deletion warning again before deleting.');
    assert(proof.expires_at_ms>Date.now(),410,'DELETION_CONFIRMATION_INVALID','This deletion confirmation expired. Review the latest information again.');
    assert(proof.content_hash===fingerprint(series),409,'DELETION_CONFIRMATION_STALE','The series or its paid viewers changed. Review the latest information again.');
    const snapshot=summary(series),episodes=all('SELECT id,storage_key,bytes FROM episodes WHERE series_id=?',seriesId);
    run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',seriesId,series.creator_id,actorId,JSON.stringify(snapshot));
    // Only private uploaded assets are owned by this deletion. Shared catalogue
    // art/previews are never removed from other series or from the application.
    const objects=new Map<string,number>();
    for(const asset of [{storage_key:series.cover_key,bytes:series.cover_bytes},...episodes])if(asset.storage_key&&!asset.storage_key.startsWith('public:')&&!asset.storage_key.startsWith('demo/'))objects.set(asset.storage_key,(objects.get(asset.storage_key)||0)+Number(asset.bytes));
    for(const[key,bytes]of objects)run('INSERT INTO series_media_deletions (series_id,creator_id,object_key,bytes) VALUES (?,?,?,?)',seriesId,series.creator_id,key,bytes);
    run('DELETE FROM playback_sessions WHERE episode_id IN (SELECT id FROM episodes WHERE series_id=?)',seriesId);
    run('DELETE FROM progress WHERE episode_id IN (SELECT id FROM episodes WHERE series_id=?)',seriesId);
    run('DELETE FROM saves WHERE series_id=?',seriesId);run('DELETE FROM series_likes WHERE series_id=?',seriesId);
    run('DELETE FROM series_classifications WHERE series_id=?',seriesId);run('DELETE FROM series_publications WHERE series_id=?',seriesId);
    run('DELETE FROM episode_durations WHERE episode_id IN (SELECT id FROM episodes WHERE series_id=?)',seriesId);
    run('DELETE FROM episodes WHERE series_id=? AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.episode_id=episodes.id) AND NOT EXISTS (SELECT 1 FROM test_purchases p WHERE p.episode_id=episodes.id)',seriesId);
    run("UPDATE episodes SET title='Deleted episode',duration=1,bytes=1,storage_key='',original_name='' WHERE series_id=?",seriesId);
    run("UPDATE series SET title='Deleted series',description='',language='en',genres='[]',creation_type='human',price_cents=10,free_episodes=0,cover_key='',cover_bytes=0,status='archived',views=0,featured=0,demo=0,updated_at=datetime('now') WHERE id=?",seriesId);
    run('DELETE FROM series_deletion_confirmations WHERE series_id=?',seriesId);
  });
  // The content deletion is already committed. Cleanup errors must never turn
  // a successful irreversible action into a misleading failure response. The
  // pre-registered durable alarm will retry the persisted pending objects.
  try{const cleanup=await cleanupSeriesMedia(seriesId,20);return{ok:true,deleted:true,...cleanup};}
  catch{return{ok:true,deleted:true,cleanup_pending:true,released_bytes:0};}
}
