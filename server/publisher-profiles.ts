import crypto from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {config} from './config.js';
import {requireAdmin,rateLimit} from './auth.js';
import {publicSeriesAllowedSql} from './moderation.js';
import {playbackTimeSql} from './playback-times.js';
import type {PublisherProfile,AdminPublisherProfile,Series,PublisherPage} from '../shared/config.js';

type Row=Record<string,any>;
const OFFICIAL_ID='official';
const today=()=>new Date().toISOString().slice(0,10);
function realDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>today())return false;
  const parsed=new Date(value+'T00:00:00.000Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
const displayName=z.string().trim().transform(value=>value.normalize('NFC')).pipe(z.string().min(2).max(80).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value),'Use a display name without control characters.'));
const registeredDate=z.string().refine(realDate,'Choose a real registration date between 1900-01-01 and today.');
const profileCreate=z.object({display_name:displayName,registered_at:registeredDate}).strict();
const profileUpdate=z.object({display_name:displayName.optional(),registered_at:registeredDate.optional()}).strict().refine(value=>value.display_name!==undefined||value.registered_at!==undefined,'Choose a profile field to update.');
export const publisherProfileIdSchema=z.string().min(1).max(128).nullable().optional();
function uniqueName(name:string,exceptId=''){
  const key=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
  assert(!all('SELECT id,display_name FROM publisher_profiles').some(row=>row.id!==exceptId&&key(row.display_name)===key(name)),409,'PUBLISHER_NAME_EXISTS','A public publisher profile already uses this display name.');
}

function event(publisherId:string|null,seriesId:string|null,actorId:string|null,action:'bootstrap'|'create'|'update'|'assign'|'clear',snapshot:unknown){
  run('INSERT INTO publisher_profile_events (id,publisher_id,series_id,actor_id,action,snapshot_json) VALUES (?,?,?,?,?,?)',crypto.randomUUID(),publisherId,seriesId,actorId,action,JSON.stringify(snapshot));
}
function safeProfile(row:Row):PublisherProfile{return{id:row.id,display_name:row.display_name,registered_at:row.registered_at,managed:true,is_official:!!row.is_official};}
/** Called once at application startup, outside metadata transactions. No login
 * account is created, and edited public names/dates are never re-seeded. */
export function initializePublisherProfiles(){
  if(one('SELECT 1 FROM publisher_profiles WHERE id=?',OFFICIAL_ID))return;
  transaction(()=>{
    if(one('SELECT 1 FROM publisher_profiles WHERE id=?',OFFICIAL_ID))return;
    const owner=config.platformOwnerUserId?one('SELECT created_at FROM users WHERE id=?',config.platformOwnerUserId):undefined;
    const date=owner?.created_at?.slice(0,10),registered=typeof date==='string'&&realDate(date)?date:today();
    const name=(config.officialCreatorName||'LingYingDrama Offical').trim().slice(0,80)||'LingYingDrama Offical';
    run('INSERT INTO publisher_profiles (id,display_name,registered_at,is_official,legacy_owner_id) VALUES (?,?,?,1,?)',OFFICIAL_ID,name,registered,config.platformOwnerUserId||null);
    event(OFFICIAL_ID,null,null,'bootstrap',{display_name:name,registered_at:registered});
  });
}
function accountProfile(userId:string):PublisherProfile{
  const user=one('SELECT name,created_at FROM users WHERE id=?',userId);assert(user,404,'NOT_FOUND','Publisher not found.');
  let mapping=one('SELECT public_id FROM account_public_publishers WHERE user_id=?',userId);
  if(!mapping){run('INSERT OR IGNORE INTO account_public_publishers (user_id,public_id) VALUES (?,?)',userId,'creator-'+crypto.randomUUID());mapping=one('SELECT public_id FROM account_public_publishers WHERE user_id=?',userId)!;}
  const date=String(user.created_at).slice(0,10);
  return{id:mapping!.public_id,display_name:user.name,registered_at:realDate(date)?date:today(),managed:false,is_official:false};
}
export function seriesPublisher(series:Row):{publisher:PublisherProfile;publisher_profile_id:string|null}{
  const explicit=one('SELECT p.* FROM series_publisher_profiles a JOIN publisher_profiles p ON p.id=a.publisher_id WHERE a.series_id=?',series.id);
  if(explicit)return{publisher:safeProfile(explicit),publisher_profile_id:explicit.id};
  const legacy=one('SELECT * FROM publisher_profiles WHERE is_official=1 AND legacy_owner_id=?',series.creator_id);
  return{publisher:legacy?safeProfile(legacy):accountProfile(series.creator_id),publisher_profile_id:null};
}
/** Assignment changes public attribution only. The authenticated financial
 * creator, storage owner and actual account registration never change. */
export function assignSeriesPublisher(actorId:string,series:Row,publisherId:string|null|undefined,{creating=false}={}){
  const actor=one('SELECT role FROM users WHERE id=?',actorId);assert(actor,401,'AUTH_REQUIRED','Sign in to continue.');
  if(publisherId===undefined){if(!creating||actor.role!=='admin')return;publisherId=OFFICIAL_ID;}
  assert(actor.role==='admin'&&series.creator_id===actorId,403,'PUBLISHER_ASSIGNMENT_FORBIDDEN','Only an administrator may choose a public profile for their own series.');
  const old=one('SELECT publisher_id FROM series_publisher_profiles WHERE series_id=?',series.id)?.publisher_id??null;
  if(publisherId===null){
    if(old!==null){run('DELETE FROM series_publisher_profiles WHERE series_id=?',series.id);event(old,series.id,actorId,'clear',{before:old,after:null});}
    return;
  }
  const profile=one('SELECT id FROM publisher_profiles WHERE id=?',publisherId);assert(profile,400,'INVALID_PUBLISHER_PROFILE','Choose an available public publisher profile.');
  if(old===publisherId)return;
  run("INSERT INTO series_publisher_profiles (series_id,publisher_id,assigned_by) VALUES (?,?,?) ON CONFLICT(series_id) DO UPDATE SET publisher_id=excluded.publisher_id,assigned_by=excluded.assigned_by,assigned_at=datetime('now')",series.id,publisherId,actorId);
  event(publisherId,series.id,actorId,'assign',{before:old,after:publisherId});
}
function subjectForId(id:string):{publisher:PublisherProfile;kind:'managed'|'account';userId?:string;legacyOwnerId?:string|null}{
  const managed=one('SELECT * FROM publisher_profiles WHERE id=?',id);if(managed)return{publisher:safeProfile(managed),kind:'managed',legacyOwnerId:managed.legacy_owner_id};
  const account=one('SELECT user_id FROM account_public_publishers WHERE public_id=?',id);assert(account,404,'NOT_FOUND','Publisher not found.');
  return{publisher:accountProfile(account.user_id),kind:'account',userId:account.user_id};
}
function subjectCondition(subject:ReturnType<typeof subjectForId>,alias='s'){
  if(subject.kind==='account')return{sql:`${alias}.creator_id=? AND NOT EXISTS(SELECT 1 FROM series_publisher_profiles a WHERE a.series_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM publisher_profiles p WHERE p.is_official=1 AND p.legacy_owner_id=${alias}.creator_id)`,params:[subject.userId]};
  return{sql:`(EXISTS(SELECT 1 FROM series_publisher_profiles a WHERE a.series_id=${alias}.id AND a.publisher_id=?)${subject.publisher.is_official?' OR (NOT EXISTS(SELECT 1 FROM series_publisher_profiles a WHERE a.series_id='+alias+'.id) AND '+alias+'.creator_id=?)':''})`,params:subject.publisher.is_official?[subject.publisher.id,subject.legacyOwnerId]:[subject.publisher.id]};
}
function adminProfile(row:Row):AdminPublisherProfile{
  const subject={publisher:safeProfile(row),kind:'managed' as const,legacyOwnerId:row.legacy_owner_id},condition=subjectCondition(subject);
  const count=one(`SELECT COUNT(*) AS n FROM series s WHERE NOT EXISTS(SELECT 1 FROM series_deletions d WHERE d.series_id=s.id) AND NOT EXISTS(SELECT 1 FROM retired_catalog_series r WHERE r.series_id=s.id) AND ${condition.sql}`,...condition.params)!.n;
  return{...safeProfile(row),created_at:row.created_at,updated_at:row.updated_at,series_count:Number(count)};
}
interface Helpers {catalogSelect:string;serializeSeries:(series:Row,userId?:string,privateView?:boolean)=>any}
export function registerPublisherProfiles(app:Express,helpers:Helpers){
  app.get('/api/admin/publishers',requireAdmin,(_req,res)=>{
    res.json({publishers:all('SELECT * FROM publisher_profiles ORDER BY is_official DESC,created_at DESC,id').map(adminProfile),default_publisher_id:OFFICIAL_ID});
  });
  app.post('/api/admin/publishers',requireAdmin,rateLimit('publisher-profile-create',30,60_000),(req,res)=>{
    const body=profileCreate.parse(req.body),id='publisher-'+crypto.randomUUID();
    transaction(()=>{
      assert(Number(one('SELECT COUNT(*) AS n FROM publisher_profiles')!.n)<200,409,'PUBLISHER_PROFILE_LIMIT','This platform already has 200 public publisher profiles.');
      uniqueName(body.display_name);
      run('INSERT INTO publisher_profiles (id,display_name,registered_at,created_by,updated_by) VALUES (?,?,?,?,?)',id,body.display_name,body.registered_at,req.user!.id,req.user!.id);
      event(id,null,req.user!.id,'create',{display_name:body.display_name,registered_at:body.registered_at});
    });res.status(201).json({publisher:adminProfile(one('SELECT * FROM publisher_profiles WHERE id=?',id)!)});
  });
  app.patch('/api/admin/publishers/:id',requireAdmin,rateLimit('publisher-profile-update',60,60_000),(req,res)=>{
    const body=profileUpdate.parse(req.body),id=String(req.params.id);
    transaction(()=>{
      const before=one('SELECT * FROM publisher_profiles WHERE id=?',id);assert(before,404,'NOT_FOUND','Publisher profile not found.');
      const after={display_name:body.display_name??before.display_name,registered_at:body.registered_at??before.registered_at};
      uniqueName(after.display_name,id);
      run("UPDATE publisher_profiles SET display_name=?,registered_at=?,updated_by=?,updated_at=datetime('now') WHERE id=?",after.display_name,after.registered_at,req.user!.id,id);
      event(id,null,req.user!.id,'update',{before:safeProfile(before),after:{...safeProfile(before),...after}});
    });res.json({publisher:adminProfile(one('SELECT * FROM publisher_profiles WHERE id=?',id)!)});
  });
  app.get('/api/publishers/:id',(req,res)=>{
    const id=z.string().min(1).max(128).parse(req.params.id),query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(50).default(24)}).parse(req.query);
    const subject=subjectForId(id),condition=subjectCondition(subject),where=`s.status='published' AND ${publicSeriesAllowedSql('s')} AND ${condition.sql}`;
    const totals=one(`SELECT COUNT(*) AS series_count,COALESCE(SUM(s.views),0) AS views,(SELECT COUNT(*) FROM episodes e JOIN series s ON s.id=e.series_id WHERE ${where}) AS episode_count,(SELECT COUNT(*) FROM series_likes l JOIN series s ON s.id=l.series_id WHERE ${where}) AS likes FROM series s WHERE ${where}`,...condition.params,...condition.params,...condition.params)!;
    assert(subject.kind==='managed'||Number(totals.series_count)>0,404,'NOT_FOUND','Publisher not found.');
    const playback=one(`SELECT COUNT(*) AS tracked_views,COALESCE(SUM(${playbackTimeSql('p')}),0) AS watched_ms FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id JOIN series s ON s.id=e.series_id WHERE p.counted_view=1 AND ${where}`,...condition.params)!;
    const series=all(`${helpers.catalogSelect} WHERE ${where} ORDER BY julianday(COALESCE(sp.published_at,s.created_at)) DESC,s.rowid DESC LIMIT ? OFFSET ?`,...condition.params,query.page_size,(query.page-1)*query.page_size).map(row=>helpers.serializeSeries(row,req.user?.id)) as Series[];
    const tracked=Number(playback.tracked_views),watched=Number(playback.watched_ms)/1000,total=Number(totals.series_count);
    const result:PublisherPage={publisher:subject.publisher,stats:{series_count:total,episode_count:Number(totals.episode_count),views:Number(totals.views),tracked_views:tracked,likes:Number(totals.likes),total_watch_seconds:watched,avg_watch_seconds:tracked?watched/tracked:0},series,pagination:{page:query.page,page_size:query.page_size,total,total_pages:Math.ceil(total/query.page_size)}};
    res.json(result);
  });
}
