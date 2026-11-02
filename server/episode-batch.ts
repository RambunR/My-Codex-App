import crypto from 'node:crypto';
import type {Express,Request} from 'express';
import {z} from 'zod';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {requirePublisher,getUser,rateLimit} from './auth.js';
import {assertSeriesWritable} from './moderation.js';
import {assertSeriesLifecycleFinancialClear,isSeriesDeleted,cleanupSeriesMedia} from './series-lifecycle.js';
import {scheduleMediaCleanup} from './background.js';
import {episodeDurationSql} from './episode-duration.js';
import {playbackTimeSql} from './playback-times.js';
import {batchEpisodeTitle,MAX_EPISODE_BATCH_SIZE,MAX_EPISODE_BATCH_BASE_NAME} from '../shared/episode-batch.js';

type Row=Record<string,any>;
const hash=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const idsSchema=z.array(z.string().min(1).max(128)).min(1).max(MAX_EPISODE_BATCH_SIZE).refine(ids=>new Set(ids).size===ids.length,'Choose each episode only once.');
const revisionSchema=z.string().regex(/^[a-f0-9]{64}$/);
const selectionSchema=z.object({revision:revisionSchema,episode_ids:idsSchema}).strict();
const mutationSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('rename'),revision:revisionSchema,episode_ids:idsSchema,base_name:z.string().trim().min(1).max(MAX_EPISODE_BATCH_BASE_NAME)}).strict(),
  z.object({action:z.literal('reorder'),revision:revisionSchema,episode_ids:idsSchema,acknowledge_access_change:z.boolean().optional()}).strict(),
  z.object({action:z.literal('delete'),revision:revisionSchema,episode_ids:idsSchema,confirmation_token:z.string().regex(/^[a-f0-9]{64}$/),confirm_title:z.string().max(120),acknowledge:z.literal(true)}).strict(),
]);
const publicEpisodes=(seriesId:string)=>all(`SELECT e.id,e.series_id,e.title,e.number,${episodeDurationSql()} AS duration,e.bytes FROM episodes e WHERE e.series_id=? ORDER BY e.number`,seriesId);
function seriesEpisodes(seriesId:string){return all('SELECT id,title,number,storage_key,bytes,original_name FROM episodes WHERE series_id=? ORDER BY number,id',seriesId);}
function pendingUploads(seriesId:string){return all("SELECT id,number,status,cleanup_pending FROM episode_upload_sessions WHERE series_id=? AND status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1) ORDER BY id",seriesId);}
/** Views change independently of editorial state. Purchases and pending upload
 * reservations do invalidate a deletion/reorder warning. */
export function episodeBatchRevision(seriesId:string){
  const series=one('SELECT id,title,free_episodes,status FROM series WHERE id=?',seriesId);
  const purchases=['purchases','test_purchases'].map(table=>one(`SELECT COUNT(*) AS n,COALESCE(MAX(p.rowid),0) AS latest FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?`,seriesId));
  return hash(JSON.stringify({series,episodes:seriesEpisodes(seriesId),purchases,pending:pendingUploads(seriesId)}));
}
function checkedSeries(req:Request,seriesId=String(req.params.id)){
  const series=one('SELECT * FROM series WHERE id=?',seriesId),actor=one('SELECT role FROM users WHERE id=?',req.user!.id);
  assert(series&&!isSeriesDeleted(seriesId),404,'NOT_FOUND','Series not found.');
  assert(actor&&(actor.role==='admin'||series.creator_id===req.user!.id),403,'FORBIDDEN','This series belongs to another publisher.');
  if(actor.role!=='admin')assertSeriesWritable(seriesId);
  assertSeriesLifecycleFinancialClear(req.user!.id,series.creator_id);
  assert(pendingUploads(seriesId).length===0,409,'EPISODE_UPLOAD_PENDING','Finish or cancel uploads before editing this episode list.');
  return series;
}
export const assertEpisodeBatchWritable=checkedSeries;
function selection(req:Request,input:{revision:string;episode_ids:string[]}){
  const series=checkedSeries(req),revision=episodeBatchRevision(series.id);
  assert(input.revision===revision,409,'EPISODE_BATCH_STALE','The episode list changed. Refresh it before trying again.');
  const episodes=seriesEpisodes(series.id),byId=new Map(episodes.map(episode=>[episode.id,episode]));
  assert(input.episode_ids.every(id=>byId.has(id)),400,'INVALID_EPISODE_SELECTION','Choose episodes from this series only.');
  return{series,revision,episodes,selected:input.episode_ids.map(id=>byId.get(id)!)};
}
function impact(seriesId:string,selected:Row[]){
  const selectedIds=new Set(selected.map(episode=>episode.id));
  const paid=(table:'purchases'|'test_purchases')=>all(`SELECT p.episode_id,COUNT(*) AS n FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? GROUP BY p.episode_id`,seriesId).filter(row=>selectedIds.has(row.episode_id));
  const real=paid('purchases'),test=paid('test_purchases');
  const views=all(`SELECT p.episode_id,COUNT(*) AS n,COALESCE(SUM(${playbackTimeSql()}),0) AS watched FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.counted_view=1 GROUP BY p.episode_id`,seriesId).filter(row=>selectedIds.has(row.episode_id));
  return{episode_count:selected.length,views:views.reduce((n,row)=>n+Number(row.n),0),total_watch_seconds:views.reduce((n,row)=>n+Number(row.watched),0)/1000,media_bytes:selected.reduce((n,episode)=>n+Number(episode.bytes),0),real_paid_unlocks:real.reduce((n,row)=>n+Number(row.n),0),test_paid_unlocks:test.reduce((n,row)=>n+Number(row.n),0),paid_episode_count:new Set([...real,...test].map(row=>row.episode_id)).size};
}
const selectionHash=(ids:string[])=>hash(JSON.stringify([...ids].sort()));
function audit(actorId:string,seriesId:string,action:'rename'|'reorder'|'delete',snapshot:unknown){
  run('INSERT INTO episode_batch_events (id,series_id,actor_id,action,snapshot_json) VALUES (?,?,?,?,?)',crypto.randomUUID(),seriesId,actorId,action,JSON.stringify(snapshot));
}
const editorial=(episodes:Row[])=>episodes.map(({id,title,number})=>({id,title,number}));
function stateResponse(req:Request,series:Row){return{episodes:publicEpisodes(series.id),episodes_revision:episodeBatchRevision(series.id),user:getUser(req.user!.id),owner_storage:one('SELECT used_bytes,quota_bytes FROM users WHERE id=?',series.creator_id)};}
function verifyDeletion(req:Request,input:z.infer<typeof mutationSchema>&{action:'delete'}){
  const state=selection(req,input),proof=one('SELECT * FROM episode_batch_confirmations WHERE token_hash=? AND series_id=? AND actor_id=?',hash(input.confirmation_token),state.series.id,req.user!.id);
  assert(proof&&proof.revision===state.revision&&proof.selection_hash===selectionHash(input.episode_ids),400,'EPISODE_BATCH_CONFIRM_INVALID','Review the selected episodes again before deleting.');
  assert(proof.expires_at_ms>Date.now(),410,'EPISODE_BATCH_CONFIRM_INVALID','This deletion confirmation expired. Review the selected episodes again.');
  assert(input.confirm_title===state.series.title,400,'DELETION_TITLE_MISMATCH','Type the series title exactly to confirm deletion.');
  const summary=impact(state.series.id,state.selected);assert(summary.paid_episode_count===0,409,'EPISODE_PURCHASED','Purchased episodes must remain available. Hide the series to stop public access.');
  return{...state,summary};
}
function commitDeletion(req:Request,state:{series:Row;selected:Row[];summary:ReturnType<typeof impact>},source:'single'|'batch'){
  const objects=new Map<string,number>();
  for(const episode of state.selected){
    const key=episode.storage_key;
    if(key&&!key.startsWith('public:')&&!key.startsWith('demo/'))objects.set(key,(objects.get(key)||0)+Number(episode.bytes));
    run('DELETE FROM episodes WHERE id=?',episode.id);
  }
  // No SQL IN list or bind-variable explosion is needed for 1,000 rows.
  // Shared or still-referenced objects must remain available elsewhere.
  for(const[key,bytes]of objects)if(!one('SELECT 1 FROM episodes WHERE storage_key=? UNION ALL SELECT 1 FROM series WHERE cover_key=? LIMIT 1',key,key))run("INSERT OR IGNORE INTO series_media_deletions (series_id,creator_id,object_key,bytes) VALUES (?,?,?,?)",state.series.id,state.series.creator_id,key,bytes);
  if(!one('SELECT 1 FROM episodes WHERE series_id=?',state.series.id)&&state.series.status==='published'){
    run('INSERT OR IGNORE INTO series_publications (series_id,published_at) VALUES (?,?)',state.series.id,state.series.created_at);
    run("UPDATE series SET status='archived' WHERE id=?",state.series.id);
  }
  audit(req.user!.id,state.series.id,'delete',{source,episodes:editorial(state.selected),summary:state.summary});
  run('DELETE FROM episode_batch_confirmations WHERE series_id=?',state.series.id);return state.series;
}
async function deletionResponse(req:Request,series:Row,count:number){
  let cleanup:{released_bytes:number;cleanup_pending:boolean};try{cleanup=await cleanupSeriesMedia(series.id,20);}catch{cleanup={released_bytes:0,cleanup_pending:true};}
  // Deletion has committed. Failed cleanup or subsequent account reads must
  // not report that this irreversible action is still pending or recoverable.
  let state={};try{state=stateResponse(req,series);}catch{}
  return{ok:true,deleted:true,deleted_count:count,...cleanup,...state};
}
export async function deleteSingleEpisode(req:Request,episodeId:string){
  const prepare=()=>{
    const episode=one('SELECT * FROM episodes WHERE id=?',episodeId);assert(episode,404,'NOT_FOUND','Episode not found.');
    const series=checkedSeries(req,episode.series_id),summary=impact(series.id,[episode]);
    assert(summary.paid_episode_count===0,409,'EPISODE_PURCHASED','Purchased episodes must remain available. Hide the series to stop public access.');
    return{series,selected:[episode],summary};
  };
  prepare();await scheduleMediaCleanup();
  const series=transaction(()=>commitDeletion(req,prepare(),'single'));
  return deletionResponse(req,series,1);
}
export function registerEpisodeBatch(app:Express){
  const base='/api/studio/series/:id/episodes';
  app.post(base+'/batch-delete-preview',requirePublisher,rateLimit('episode-delete-preview',30,60_000),(req,res)=>{
    const input=selectionSchema.parse(req.body);
    const preview=transaction(()=>{
      const state=selection(req,input),now=Date.now(),token=crypto.randomBytes(32).toString('hex');
      run('DELETE FROM episode_batch_confirmations WHERE expires_at_ms<=? OR (series_id=? AND actor_id=?)',now,state.series.id,req.user!.id);
      run('INSERT INTO episode_batch_confirmations (token_hash,series_id,actor_id,revision,selection_hash,expires_at_ms,created_at_ms) VALUES (?,?,?,?,?,?,?)',hash(token),state.series.id,req.user!.id,state.revision,selectionHash(input.episode_ids),now+600_000,now);
      return{series:{id:state.series.id,title:state.series.title},summary:impact(state.series.id,state.selected),confirmation_token:token,expires_at:new Date(now+600_000).toISOString(),episodes_revision:state.revision};
    });res.json(preview);
  });
  app.post(base+'/batch',requirePublisher,rateLimit('episode-batch',30,60_000),async(req,res)=>{
    const input=mutationSchema.parse(req.body);
    if(input.action==='delete'){
      verifyDeletion(req,input);await scheduleMediaCleanup();
      const series=transaction(()=>commitDeletion(req,verifyDeletion(req,input),'batch'));
      res.json(await deletionResponse(req,series,input.episode_ids.length));return;
    }
    const series=transaction(()=>{
      const state=selection(req,input),before=editorial(state.selected);
      if(input.action==='rename')for(const episode of state.selected)run('UPDATE episodes SET title=? WHERE id=?',batchEpisodeTitle(input.base_name,Number(episode.number)),episode.id);
      else{
        assert(input.episode_ids.length===state.episodes.length,400,'INVALID_EPISODE_SELECTION','Include every episode exactly once when changing order.');
        const changedAccess=state.selected.some((episode,index)=>(Number(episode.number)<=state.series.free_episodes)!==(index+1<=state.series.free_episodes));
        assert(!changedAccess||input.acknowledge_access_change===true,409,'EPISODE_ACCESS_CONFIRM_REQUIRED','Confirm that changing this order also changes which episodes are free.');
        const temporary=Math.max(1000,...state.episodes.map(episode=>Number(episode.number)))+1;
        state.selected.forEach((episode,index)=>run('UPDATE episodes SET number=? WHERE id=?',temporary+index,episode.id));
        state.selected.forEach((episode,index)=>run('UPDATE episodes SET number=? WHERE id=?',index+1,episode.id));
      }
      audit(req.user!.id,state.series.id,input.action,{before,after:editorial(seriesEpisodes(state.series.id))});
      run('DELETE FROM episode_batch_confirmations WHERE series_id=?',state.series.id);return state.series;
    });res.json({ok:true,...stateResponse(req,series)});
  });
}
