import {LUCKY_DRAW_INITIAL_CHANCES,LUCKY_DRAW_MAX_BALANCE,LUCKY_DRAW_MAX_POOL,LUCKY_DRAW_MAX_GRANT} from '../shared/lucky-draw.js';
import {randomInt,randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {requireAuth,requireAdmin,rateLimit} from './auth.js';
import {publicSeriesAllowedSql} from './moderation.js';
import {episodeFreeSql} from './episode-access.js';

type Row=Record<string,any>;
interface Dependencies {catalogSelect:string;serializeSeries:(series:Row,userId?:string,privateView?:boolean)=>Row}
const INITIAL_CHANCES=LUCKY_DRAW_INITIAL_CHANCES,MAX_BALANCE=LUCKY_DRAW_MAX_BALANCE,MAX_POOL=LUCKY_DRAW_MAX_POOL;
const paid=`s.price_cents>0 AND EXISTS(SELECT 1 FROM episodes e WHERE e.series_id=s.id AND NOT ${episodeFreeSql()})`;
const available=`s.status='published' AND ${publicSeriesAllowedSql('s')}`;
const eligible=`${available} AND ${paid}`;
const identifier=z.string().min(1).max(120);
const requestId=z.uuid();
function administrator(actorId:string){assert(one("SELECT 1 FROM users WHERE id=? AND role='admin'",actorId),403,'FORBIDDEN','Administrator access required.');}
function account(userId:string){const row=one('SELECT remaining,used,added FROM lucky_draw_accounts WHERE user_id=?',userId);return row||{remaining:INITIAL_CHANCES,used:0,added:0};}
function ensureAccount(userId:string){assert(one('SELECT 1 FROM users WHERE id=?',userId),404,'NOT_FOUND','Account not found.');run('INSERT OR IGNORE INTO lucky_draw_accounts (user_id) VALUES (?)',userId);}
/** Exclude awards, the creator's own uploads, and series whose currently paid
 * episodes all have real purchase receipts. Test receipts never become awards. */
function viewerEligibility(userId:string){return {
 sql:`s.creator_id<>? AND NOT EXISTS(SELECT 1 FROM lucky_draw_results won WHERE won.user_id=? AND won.series_id=s.id) AND EXISTS(SELECT 1 FROM episodes e WHERE e.series_id=s.id AND NOT ${episodeFreeSql()} AND NOT EXISTS(SELECT 1 FROM purchases p WHERE p.user_id=? AND p.episode_id=e.id))`,
 values:[userId,userId,userId],
};}
export function registerLuckyDraw(app:Express,{catalogSelect,serializeSeries}:Dependencies){
  function pool(userId?:string){const filter=userId?viewerEligibility(userId):null;return all(`${catalogSelect}, lucky_draw_pool pool WHERE pool.series_id=s.id AND pool.enabled=1 AND ${eligible} ORDER BY pool.updated_at DESC,s.id`).map(series=>({...serializeSeries(series,userId),eligible:userId?!!one(`SELECT 1 FROM series s WHERE s.id=? AND ${filter!.sql}`,series.id,...filter!.values):false}));}
  function result(row:Row){const series=one(`${catalogSelect} WHERE s.id=? AND ${available}`,row.series_id);return{id:row.id,request_id:row.request_id,title:row.title,drawn_at:row.drawn_at,series:series?{...serializeSeries(series,row.user_id),uploaded_at:one("SELECT strftime('%Y-%m-%dT%H:%M:%fZ',created_at) AS uploaded_at FROM episodes WHERE series_id=? AND julianday(created_at) IS NOT NULL ORDER BY julianday(created_at),id LIMIT 1",row.series_id)?.uploaded_at??null}:null};}
  function state(userId:string,page=1){return{...account(userId),initialChances:INITIAL_CHANCES,page,pageSize:30,unlockedTotal:one('SELECT COUNT(*) AS n FROM lucky_draw_results WHERE user_id=?',userId)!.n,unlocked:all('SELECT * FROM lucky_draw_results WHERE user_id=? ORDER BY drawn_at DESC,id DESC LIMIT 30 OFFSET ?',userId,(page-1)*30).map(result)};}
  app.get('/api/lucky-draw/pool',(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('X-LingYing-Lucky-Draw','gift-reveal-v2');res.json({series:pool(req.user?.id),initialChances:INITIAL_CHANCES});});
  app.get('/api/lucky-draw',requireAuth,(req,res)=>{res.setHeader('Cache-Control','private, no-store');const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);res.json(state(req.user!.id,page));});
  app.get('/api/lucky-draw/draws/:requestId',requireAuth,(req,res)=>{res.setHeader('Cache-Control','private, no-store');const key=requestId.parse(req.params.requestId),row=one('SELECT * FROM lucky_draw_results WHERE user_id=? AND request_id=?',req.user!.id,key);assert(row,404,'DRAW_NOT_FOUND','No saved draw matches this request.');res.json({draw:result(row),...account(req.user!.id)});});
  app.post('/api/lucky-draw/draw',requireAuth,rateLimit('lucky-draw',30,60_000),(req,res)=>{
    const body=z.object({request_id:requestId}).strict().parse(req.body),userId=req.user!.id;
    const row=transaction(()=>{
      const previous=one('SELECT * FROM lucky_draw_results WHERE user_id=? AND request_id=?',userId,body.request_id);if(previous)return previous;
      ensureAccount(userId);assert(account(userId).remaining>0,409,'DRAW_NO_CHANCES','You have no draw chances left.');
      const filter=viewerEligibility(userId),candidates=all(`SELECT s.id,s.title FROM series s JOIN lucky_draw_pool pool ON pool.series_id=s.id AND pool.enabled=1 WHERE ${eligible} AND ${filter.sql} ORDER BY s.id`,...filter.values);
      assert(candidates.length>0,409,'DRAW_POOL_EMPTY','There are no new eligible series to draw. Your chance has not been used.');
      const selected=candidates[randomInt(candidates.length)],id=randomUUID(),drawnAt=new Date().toISOString();
      run('UPDATE lucky_draw_accounts SET remaining=remaining-1,used=used+1 WHERE user_id=? AND remaining>0',userId);
      run('INSERT INTO lucky_draw_results (id,user_id,series_id,request_id,title,drawn_at) VALUES (?,?,?,?,?,?)',id,userId,selected.id,body.request_id,selected.title,drawnAt);
      return one('SELECT * FROM lucky_draw_results WHERE id=?',id)!;
    });
    res.setHeader('Cache-Control','private, no-store');res.json({draw:result(row),...account(userId)});
  });
  app.get('/api/admin/lucky-draw/pool',requireAdmin,(req,res)=>{
    const query=z.object({q:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)}).parse(req.query),offset=(query.page-1)*30;
    const condition=`${eligible} AND s.title LIKE ?`,search='%'+query.q+'%';
    const selected=all('SELECT series_id FROM lucky_draw_pool WHERE enabled=1 ORDER BY updated_at DESC,series_id').map(entry=>{const series=one(`${catalogSelect} WHERE s.id=? AND NOT EXISTS(SELECT 1 FROM series_deletions d WHERE d.series_id=s.id) AND NOT EXISTS(SELECT 1 FROM retired_catalog_series r WHERE r.series_id=s.id)`,entry.series_id);return series?{...serializeSeries(series,req.user!.id,true),available:!!one(`SELECT 1 FROM series s WHERE s.id=? AND ${eligible}`,series.id)}:{id:entry.series_id,title:null,available:false};});
    res.setHeader('Cache-Control','private, no-store');res.json({selected,series:all(`${catalogSelect} WHERE ${condition} ORDER BY s.created_at DESC,s.id LIMIT 30 OFFSET ?`,search,offset).map(series=>({...serializeSeries(series,req.user!.id,true),selected:selected.some(row=>row.id===series.id)})),total:one(`SELECT COUNT(*) AS n FROM series s WHERE ${condition}`,search)!.n,page:query.page,pageSize:30,maxPool:MAX_POOL,events:all('SELECT id,series_id,title,enabled,created_at FROM lucky_draw_pool_events ORDER BY created_at DESC,id DESC LIMIT 20')});
  });
  app.put('/api/admin/lucky-draw/pool/:seriesId',requireAdmin,rateLimit('lucky-admin',60,60_000),(req,res)=>{
    const seriesId=identifier.parse(req.params.seriesId),body=z.object({enabled:z.boolean()}).strict().parse(req.body);
    transaction(()=>{administrator(req.user!.id);const series=one('SELECT id,title FROM series WHERE id=?',seriesId);assert(series,404,'NOT_FOUND','Series not found.');
      if(body.enabled)assert(one(`SELECT 1 FROM series s WHERE s.id=? AND ${eligible}`,seriesId),409,'DRAW_SERIES_UNAVAILABLE','Choose a published, available series with paid episodes.');
      const before=one('SELECT enabled FROM lucky_draw_pool WHERE series_id=?',seriesId);if(!!before?.enabled===body.enabled)return;
      if(body.enabled)assert(one('SELECT COUNT(*) AS n FROM lucky_draw_pool WHERE enabled=1')!.n<MAX_POOL,409,'DRAW_POOL_LIMIT','The draw pool supports up to 200 selected series.');
      const now=new Date().toISOString();run('INSERT INTO lucky_draw_pool (series_id,enabled,actor_id,updated_at) VALUES (?,?,?,?) ON CONFLICT(series_id) DO UPDATE SET enabled=excluded.enabled,actor_id=excluded.actor_id,updated_at=excluded.updated_at',seriesId,body.enabled?1:0,req.user!.id,now);
      run('INSERT INTO lucky_draw_pool_events (id,actor_id,series_id,enabled,title,created_at) VALUES (?,?,?,?,?,?)',randomUUID(),req.user!.id,seriesId,body.enabled?1:0,series.title,now);
    });res.json({ok:true,enabled:body.enabled});
  });
  app.get('/api/admin/lucky-draw/users',requireAdmin,rateLimit('lucky-admin-search',60,60_000),(req,res)=>{
    const query=z.object({q:z.string().trim().max(120).default('')}).parse(req.query),search='%'+query.q+'%';
    res.setHeader('Cache-Control','private, no-store');res.json({users:all('SELECT id,name,email FROM users WHERE name LIKE ? OR email LIKE ? OR id=? ORDER BY created_at DESC,id LIMIT 30',search,search,query.q).map(user=>({...user,...account(user.id)}))});
  });
  app.get('/api/admin/lucky-draw/users/:userId',requireAdmin,(req,res)=>{
    const userId=identifier.parse(req.params.userId),user=one('SELECT id,name,email FROM users WHERE id=?',userId);assert(user,404,'NOT_FOUND','Account not found.');res.setHeader('Cache-Control','private, no-store');res.json({user:{...user,...account(userId)},unlocked:state(userId).unlocked,grants:all('SELECT id,request_id,amount,reason,created_at FROM lucky_draw_grants WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 30',userId)});
  });
  app.post('/api/admin/lucky-draw/users/:userId/chances',requireAdmin,rateLimit('lucky-admin-grant',60,60_000),(req,res)=>{
    const userId=identifier.parse(req.params.userId),body=z.object({amount:z.number().int().min(1).max(LUCKY_DRAW_MAX_GRANT),reason:z.string().trim().min(3).max(500),request_id:requestId}).strict().parse(req.body);
    const grant=transaction(()=>{administrator(req.user!.id);const previous=one('SELECT * FROM lucky_draw_grants WHERE actor_id=? AND request_id=?',req.user!.id,body.request_id);
      if(previous){assert(previous.user_id===userId&&previous.amount===body.amount&&previous.reason===body.reason,409,'DRAW_REQUEST_CONFLICT','This request was already used with different details.');return previous;}
      ensureAccount(userId);const before=account(userId);assert(before.remaining+body.amount<=MAX_BALANCE,409,'DRAW_BALANCE_LIMIT','This account has reached the draw chance limit.');
      const id=randomUUID(),now=new Date().toISOString();run('UPDATE lucky_draw_accounts SET remaining=remaining+?,added=added+? WHERE user_id=?',body.amount,body.amount,userId);
      run('INSERT INTO lucky_draw_grants (id,actor_id,user_id,request_id,amount,reason,created_at) VALUES (?,?,?,?,?,?,?)',id,req.user!.id,userId,body.request_id,body.amount,body.reason,now);return one('SELECT id,amount,reason,created_at FROM lucky_draw_grants WHERE id=?',id)!;
    });res.json({grant:{id:grant.id,amount:grant.amount,reason:grant.reason,created_at:grant.created_at},...account(userId)});
  });
}
