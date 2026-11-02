import {createHash,randomUUID} from 'node:crypto';
import {one,all,run,transaction} from './db.js';
import {publisherNameSql} from './publisher-profile-sql.js';
import {DEMO_CATALOG} from '../shared/catalog.js';

export const CATALOG_RETIREMENT_OPERATION='retire-built-in-catalogue-v1';
// This migration is permanently limited to the original twenty source IDs.
// Adding a development sample to DEMO_CATALOG cannot widen this operation.
const MANIFEST_IDS=[
  'after-midnight','seoul-searching','the-last-kingdom','last-train-home','blue-hour',
  'after-the-rain','paper-moon','neon-promises','the-quiet-rule','wildflower-season',
  'tide-between-us','tokyo-tomorrow','borrowed-sunshine','a-thousand-lanterns','the-second-draft',
  'between-two-cities','the-silver-thread','a-paris-minute','sand-and-stars','love-in-translation',
] as const;
const manifestIds=new Set<string>(MANIFEST_IDS);
// Original shared preview bytes at the v1 catalogue's creation. Future preview
// replacements must not change the provenance accepted by this fixed migration.
const ORIGINAL_PREVIEW_BYTES=1_037_034;
const PROTECTED_SERIES_ID='284bc1d4-7bf3-48f8-a97b-f45abfb3bb44';
const PROTECTED_PUBLISHER_ID='publisher-887f66b6-6d6c-42b6-846f-2bbf175f7e5c';
type Row=Record<string,any>;
interface Hashes {preserved:string;protected:string}
interface ProtectedSummary {anchor_count:number;series_count:number;episode_count:number}
export interface CatalogRetirementReceipt {
  operation:string;status:'not_applicable'|'blocked'|'applied'|'already_applied';
  retired_ids:string[];protected_summary:ProtectedSummary;
  before_hashes:Hashes;after_hashes:Hashes;
  skipped:Array<{id:string;reason:string}>;reason?:string;
}
class SafetyBlock extends Error {constructor(readonly reason:string){super(reason);}}
const normalize=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').replace(/[\u2018\u2019\u02bc`]/g,"'").trim().replace(/\s+/g,' ').toLowerCase():'';
const protectedTitle=(value:unknown)=>normalize(value)==="the godfather's caged bird";
const protectedCreator=(value:unknown)=>normalize(value).replace(/[\s._-]+/g,'')==='dreamshortdrama';
function emptyReceipt(status:CatalogRetirementReceipt['status'],reason?:string):CatalogRetirementReceipt{
  return{operation:CATALOG_RETIREMENT_OPERATION,status,retired_ids:[],protected_summary:{anchor_count:0,series_count:0,episode_count:0},before_hashes:{preserved:'',protected:''},after_hashes:{preserved:'',protected:''},skipped:[],...(reason?{reason}:{})};
}
function recordRun(receipt:CatalogRetirementReceipt){
  run('INSERT INTO catalog_retirement_runs (id,operation_key,status,actor_type,actor_id,receipt_json) VALUES (?,?,?,\'SYSTEM\',NULL,?)',randomUUID(),CATALOG_RETIREMENT_OPERATION,receipt.status,JSON.stringify(receipt));
}
function priorReceipt():CatalogRetirementReceipt|undefined{
  const row=one("SELECT receipt_json FROM catalog_retirement_runs WHERE operation_key=? AND status='applied'",CATALOG_RETIREMENT_OPERATION);
  if(!row)return;
  // The operator log contains only this allowlisted summary, even if a stored
  // receipt is unexpectedly malformed. An applied operation is never replayed.
  const receipt=emptyReceipt('already_applied');
  receipt.retired_ids=all('SELECT series_id FROM retired_catalog_series WHERE operation_key=? ORDER BY series_id LIMIT 20',CATALOG_RETIREMENT_OPERATION).map(r=>r.series_id).filter(id=>manifestIds.has(id));
  try{
    const saved=JSON.parse(row.receipt_json),summary=saved.protected_summary;
    if(summary&&['anchor_count','series_count','episode_count'].every(key=>Number.isSafeInteger(summary[key])&&summary[key]>=0))receipt.protected_summary={anchor_count:summary.anchor_count,series_count:summary.series_count,episode_count:summary.episode_count};
    for(const key of ['before_hashes','after_hashes'] as const)if(saved[key]&&['preserved','protected'].every(name=>/^[a-f0-9]{64}$/.test(saved[key][name])))receipt[key]={preserved:saved[key].preserved,protected:saved[key].protected};
  }catch{/* An immutable applied marker still prevents a second mutation. */}
  return receipt;
}
interface ProtectedRows {series:Set<string>;episodes:Set<string>;sessions:Set<string>;owners:Set<string>;publishers:Set<string>;summary:ProtectedSummary}
function protectedRows():ProtectedRows{
  const rows=all(`SELECT s.id,s.creator_id,s.title,${publisherNameSql()} AS publisher_name,u.name AS account_name,
    (SELECT publisher_id FROM series_publisher_profiles WHERE series_id=s.id) AS publisher_profile_id FROM series s JOIN users u ON u.id=s.creator_id
    WHERE NOT EXISTS (SELECT 1 FROM series_deletions d WHERE d.series_id=s.id) AND NOT EXISTS (SELECT 1 FROM retired_catalog_series r WHERE r.series_id=s.id) ORDER BY s.id LIMIT 10001`);
  if(rows.length>10_000)throw new SafetyBlock('snapshot_limit');
  const series=new Set<string>(),owners=new Set<string>(),episodes=new Set<string>(),sessions=new Set<string>(),publishers=new Set<string>();let anchors=0;
  for(const row of rows){const title=protectedTitle(row.title),creator=protectedCreator(row.publisher_name)||protectedCreator(row.account_name);if(title&&creator)anchors++;if(title||creator||row.id===PROTECTED_SERIES_ID||row.publisher_profile_id===PROTECTED_PUBLISHER_ID){series.add(row.id);owners.add(row.creator_id);}}
  for(const id of series){for(const row of all('SELECT id FROM episodes WHERE series_id=? LIMIT 20001',id)){episodes.add(row.id);if(episodes.size>20_000)throw new SafetyBlock('snapshot_limit');}for(const row of all('SELECT publisher_id FROM series_publisher_profiles WHERE series_id=?',id))publishers.add(row.publisher_id);}
  for(const id of episodes)for(const row of all('SELECT id FROM playback_sessions WHERE episode_id=? LIMIT 50001',id)){sessions.add(row.id);if(sessions.size>50_000)throw new SafetyBlock('snapshot_limit');}
  return{series,episodes,sessions,owners,publishers,summary:{anchor_count:anchors,series_count:series.size,episode_count:episodes.size}};
}
function isProtectedRow(table:string,row:Row,protectedSet:ProtectedRows){
  return(table==='series'&&protectedSet.series.has(row.id))||(table==='episodes'&&protectedSet.episodes.has(row.id))||(table==='users'&&protectedSet.owners.has(row.id))||(table==='publisher_profiles'&&protectedSet.publishers.has(row.id))||protectedSet.series.has(row.series_id)||protectedSet.episodes.has(row.episode_id)||protectedSet.sessions.has(row.session_id)||protectedSet.owners.has(row.user_id);
}
/** Hash existing records rather than copying private user/financial data into
 * an audit. Only the two explicitly permitted catalogue fields are normalized.
 * A bounded scan fails closed if the database outgrows this one-time job. */
function fingerprints(candidates:Set<string>,protectedSet:ProtectedRows):Hashes{
  const preserved=createHash('sha256'),protectedHash=createHash('sha256');let count=0,bytes=0;
  const tables=all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(row=>String(row.name)).filter(name=>!name.startsWith('sqlite_')&&!name.startsWith('_cf_')&&name!=='retired_catalog_series'&&name!=='catalog_retirement_runs');
  if(tables.length>150)throw new SafetyBlock('snapshot_limit');
  for(const table of tables){
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table))throw new SafetyBlock('source_unexpected');
    preserved.update(JSON.stringify(table)+'\n');protectedHash.update(JSON.stringify(table)+'\n');
    for(let offset=0;;offset+=128){
      const rows=all(`SELECT * FROM "${table}" ORDER BY rowid LIMIT 128 OFFSET ?`,offset);
      for(const row of rows){
        if(++count>100_000)throw new SafetyBlock('snapshot_limit');
        const raw=JSON.stringify(row);bytes+=Buffer.byteLength(raw);if(bytes>32*1024*1024)throw new SafetyBlock('snapshot_limit');
        if(isProtectedRow(table,row,protectedSet))protectedHash.update(raw+'\n');
        const normalized=table==='series'&&candidates.has(row.id)?{...row,status:'retired-catalogue',featured:0}:row;
        preserved.update(JSON.stringify(normalized)+'\n');
      }
      if(rows.length<128)break;
    }
  }
  return{preserved:preserved.digest('hex'),protected:protectedHash.digest('hex')};
}
function seedSkipReason(id:string,protectedSet:ProtectedRows):string|undefined{
  const series=one('SELECT * FROM series WHERE id=?',id);if(!series)return'missing';
  if(protectedSet.series.has(id))return'protected';
  if(one('SELECT 1 FROM retired_catalog_series WHERE series_id=?',id))return'already_retired';
  if(one('SELECT 1 FROM series_deletions WHERE series_id=?',id))return'deleted';
  const source=DEMO_CATALOG.find(item=>item[0]===id);if(!source)return'source_unexpected';
  const[,title,description,language,genres,image,type,featured]=source;
  const publisher=one('SELECT email,name,role FROM users WHERE id=?','catalog-publisher');
  if(!publisher||publisher.email!=='catalog@aidramio.invalid'||publisher.name!=='Studio Afterglow'||publisher.role!=='publisher')return'publisher_changed';
  if(series.creator_id!=='catalog-publisher'||series.demo!==1||series.title!==title||series.description!==description||series.language!==language||series.genres!==JSON.stringify(genres)||series.creation_type!==type||series.cover_key!==`public:/images/${image}.jpg`||series.cover_bytes!==0||series.price_cents!==30||series.free_episodes!==8||!['published','archived'].includes(series.status)||![0,featured].includes(series.featured))return'series_changed';
  if(one('SELECT 1 FROM series_moderation WHERE series_id=?',id)||one('SELECT 1 FROM series_publisher_profiles WHERE series_id=?',id)||one('SELECT 1 FROM series_cover_layouts WHERE series_id=?',id)||one('SELECT 1 FROM series_classifications WHERE series_id=?',id)||one('SELECT 1 FROM series_subtitle_languages WHERE series_id=?',id))return'metadata_changed';
  if(one("SELECT 1 FROM episode_upload_sessions WHERE series_id=? AND status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1) LIMIT 1",id))return'active_upload';
  if(one('SELECT 1 FROM series_media_deletions WHERE series_id=? LIMIT 1',id))return'media_cleanup';
  if(one('SELECT 1 FROM purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? LIMIT 1',id)||one('SELECT 1 FROM test_purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? LIMIT 1',id))return'purchased';
  const episodes=all('SELECT e.*,d.seconds AS actual_seconds FROM episodes e LEFT JOIN episode_durations d ON d.episode_id=e.id WHERE e.series_id=? ORDER BY e.number LIMIT 9',id);
  if(episodes.length!==8)return'episodes_changed';
  for(let n=1;n<=8;n++){const episode=episodes[n-1];if(episode.id!==`${id}-${n}`||episode.title!==`Sample preview ${n}`||episode.number!==n||episode.duration!==12||(episode.actual_seconds!==null&&episode.actual_seconds!==12)||episode.bytes!==ORIGINAL_PREVIEW_BYTES||episode.storage_key!=='demo/preview.mp4'||episode.original_name!=='')return'episodes_changed';}
}

/** A constructor-only, fixed-manifest system migration. There is deliberately
 * no HTTP trigger, administrator impersonation, file deletion or payout here. */
export function retireBuiltInCatalogue(options:{environment?:string;appUrl?:string}):CatalogRetirementReceipt{
  if(options.environment!=='production'||options.appUrl!=='https://lingyingdrama.com')return emptyReceipt('not_applicable');
  try{
    return transaction(()=>{
      const previous=priorReceipt();if(previous)return previous;
      const protectedSet=protectedRows();
      if(protectedSet.summary.anchor_count===0)throw new SafetyBlock('protected_anchor_missing');
      const receipt=emptyReceipt('applied');receipt.protected_summary=protectedSet.summary;
      for(const id of MANIFEST_IDS){const reason=seedSkipReason(id,protectedSet);if(reason)receipt.skipped.push({id,reason});else receipt.retired_ids.push(id);}
      const selected=new Set(receipt.retired_ids);receipt.before_hashes=fingerprints(selected,protectedSet);
      for(const id of receipt.retired_ids){run('INSERT INTO retired_catalog_series (series_id,operation_key) VALUES (?,?)',id,CATALOG_RETIREMENT_OPERATION);run("UPDATE series SET status='archived',featured=0 WHERE id=?",id);}
      receipt.after_hashes=fingerprints(selected,protectedSet);
      if(receipt.before_hashes.preserved!==receipt.after_hashes.preserved||receipt.before_hashes.protected!==receipt.after_hashes.protected)throw new SafetyBlock('preservation_mismatch');
      recordRun(receipt);return receipt;
    });
  }catch(error){
    const receipt=emptyReceipt('blocked',error instanceof SafetyBlock?error.reason:'source_unexpected');
    // A failed precondition rolls back every candidate. Keep a bounded SYSTEM
    // audit per reason; retrying startup never duplicates the same blocked run.
    try{transaction(()=>{if(!one("SELECT 1 FROM catalog_retirement_runs WHERE operation_key=? AND status='blocked' AND json_extract(receipt_json,'$.reason')=?",CATALOG_RETIREMENT_OPERATION,receipt.reason))recordRun(receipt);});}catch{/* Maintenance must not prevent normal website startup. */}
    return receipt;
  }
}
