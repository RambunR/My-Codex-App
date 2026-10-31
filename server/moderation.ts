import {randomUUID} from 'node:crypto';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {config} from './config.js';

type Row=Record<string,any>;
export interface ModerationState {taken_down:boolean;reason:string|null;updated_at:string|null}
export interface SeriesAvailabilityOptions {viewerId?:string;allowOwnerPreview?:boolean}
export interface AdminSeriesFilters {q?:string;status?:'all'|'draft'|'published'|'archived'|'taken_down';page?:number;limit?:number}
interface ModerationEventRecord {id:string;series_id:string;actor_id:string;actor_name:string;action:'takedown'|'restore'|'metadata';reason:string;snapshot_json:string;created_at:string}
const states=new Set(['all','draft','published','archived','taken_down']);

function requireAdministrator(actorId:string){assert(one("SELECT 1 FROM users WHERE id=? AND role='admin'",actorId),403,'FORBIDDEN','Administrator access required.');}
function requireSeries(seriesId:string){const series=one('SELECT * FROM series WHERE id=?',seriesId);assert(series,404,'NOT_FOUND','Series not found.');return series;}
function reasonText(value:string){const reason=typeof value==='string'?value.trim():'';assert(reason.length>=10&&reason.length<=2000,400,'MODERATION_REASON_REQUIRED','Explain this moderation action in 10 to 2,000 characters.');return reason;}
function snapshotText(snapshot:unknown){const value=JSON.stringify(snapshot);assert(typeof value==='string'&&value.length<=64*1024,400,'INVALID_MODERATION_SNAPSHOT','The moderation snapshot is invalid or too large.');return value;}

/** The alias is an internal SQL identifier, never an unvalidated request value. */
export function publicSeriesAllowedSql(alias='s'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias),400,'INVALID_SQL_ALIAS','Invalid series query alias.');
  return `NOT EXISTS (SELECT 1 FROM series_moderation moderation WHERE moderation.series_id=${alias}.id AND moderation.taken_down=1)`;
}

export function seriesIsTakenDown(seriesId:string){return!!one('SELECT 1 FROM series_moderation WHERE series_id=? AND taken_down=1',seriesId);}
export function moderationState(seriesId:string):ModerationState{
  const row=one('SELECT taken_down,reason,updated_at FROM series_moderation WHERE series_id=?',seriesId);
  return{taken_down:!!row?.taken_down,reason:row?.reason??null,updated_at:row?.updated_at??null};
}

/** Public access never bypasses takedown, including purchases and owner previews. */
export function assertSeriesAvailable(seriesId:string,options:SeriesAvailabilityOptions={}):Row{
  const series=one('SELECT * FROM series WHERE id=?',seriesId);
  const ownerPreview=series&&options.allowOwnerPreview&&options.viewerId===series.creator_id;
  assert(series&&!seriesIsTakenDown(seriesId)&&(series.status==='published'||ownerPreview),404,'NOT_FOUND','Series not found.');
  return series;
}

/** Normal publisher endpoints cannot change or republish a moderated series. */
export function assertSeriesWritable(seriesId:string):Row{
  const series=requireSeries(seriesId);
  assert(!seriesIsTakenDown(seriesId),423,'SERIES_TAKEN_DOWN','This series has been taken offline by an administrator. Contact support before making changes.');
  return series;
}

export function setSeriesModeration(actorId:string,seriesId:string,action:'takedown'|'restore',reasonValue:string){
  return transaction(()=>{
    requireAdministrator(actorId);const series=requireSeries(seriesId);
    assert(action==='takedown'||action==='restore',400,'INVALID_MODERATION_ACTION','Choose takedown or restore.');
    const reason=reasonText(reasonValue),before=moderationState(seriesId),takenDown=action==='takedown';
    if(before.taken_down===takenDown)return{...before,alreadyApplied:true};
    run(`INSERT INTO series_moderation (series_id,taken_down,reason,actor_id) VALUES (?,?,?,?)
      ON CONFLICT(series_id) DO UPDATE SET taken_down=excluded.taken_down,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=datetime('now')`,seriesId,takenDown?1:0,reason,actorId);
    const after=moderationState(seriesId);
    run('INSERT INTO series_moderation_events (id,series_id,actor_id,action,reason,snapshot_json) VALUES (?,?,?,?,?,?)',randomUUID(),seriesId,actorId,action,reason,snapshotText({title:series.title,creator_id:series.creator_id,status:series.status,before,after}));
    return{...after,alreadyApplied:false};
  });
}

/** Call inside the caller's metadata-update transaction; this helper never nests BEGIN. */
export function recordSeriesMetadataEdit(actorId:string,seriesId:string,reasonValue:string,snapshot:unknown){
  requireAdministrator(actorId);requireSeries(seriesId);const reason=reasonText(reasonValue),json=snapshotText(snapshot);
  const id=randomUUID();run('INSERT INTO series_moderation_events (id,series_id,actor_id,action,reason,snapshot_json) VALUES (?,?,?,?,?,?)',id,seriesId,actorId,'metadata',reason,json);return id;
}

export function adminModerationEvents(actorId:string,seriesId:string){
  requireAdministrator(actorId);requireSeries(seriesId);
  return all<ModerationEventRecord>('SELECT e.id,e.series_id,e.actor_id,u.name AS actor_name,e.action,e.reason,e.snapshot_json,e.created_at FROM series_moderation_events e JOIN users u ON u.id=e.actor_id WHERE e.series_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100',seriesId).map(row=>{const{snapshot_json,...safe}=row;return{...safe,snapshot:JSON.parse(snapshot_json)};});
}

export function listAdminSeries(actorId:string,filters:AdminSeriesFilters={}){
  requireAdministrator(actorId);
  const q=typeof filters.q==='string'?filters.q.trim():'';
  assert(filters.q===undefined||typeof filters.q==='string'&&q.length<=120,400,'INVALID_FILTER','Search using at most 120 characters.');
  const status=filters.status??'all',page=filters.page??1,limit=filters.limit??20;
  assert(states.has(status),400,'INVALID_FILTER','Choose a valid series status.');
  assert(Number.isSafeInteger(page)&&page>=1&&page<=100000&&Number.isSafeInteger(limit)&&limit>=1&&limit<=50,400,'INVALID_PAGE','Choose a valid page and a page size from 1 to 50.');
  const conditions:string[]=[],params:any[]=[config.platformOwnerUserId,config.officialCreatorName];
  if(q){conditions.push('(s.title LIKE ? OR u.creator_name LIKE ?)');params.push('%'+q+'%','%'+q+'%');}
  if(status==='taken_down')conditions.push('COALESCE(m.taken_down,0)=1');
  else if(status!=='all'){conditions.push('s.status=?');params.push(status);}
  const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
  const source=" FROM series s JOIN (SELECT id,CASE WHEN id=? THEN COALESCE(NULLIF(?,''),name) ELSE name END AS creator_name FROM users) u ON u.id=s.creator_id LEFT JOIN series_moderation m ON m.series_id=s.id";
  const total=Number(one('SELECT COUNT(*) AS n'+source+where,...params)!.n);
  const series=all(`SELECT s.*,u.creator_name,COALESCE(m.taken_down,0) AS taken_down,m.reason AS moderation_reason,m.updated_at AS moderated_at,
    (SELECT COUNT(*) FROM episodes e WHERE e.series_id=s.id) AS episode_count,
    (SELECT COUNT(*) FROM purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=s.id) AS paid_unlocks,
    (SELECT COUNT(*) FROM test_purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=s.id) AS test_unlocks`+source+where+' ORDER BY s.updated_at DESC,s.rowid DESC LIMIT ? OFFSET ?',...params,limit,(page-1)*limit);
  return{series,total,page,limit};
}
