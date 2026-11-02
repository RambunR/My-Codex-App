import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {SERIES_ACCESS_FILTERS,type SeriesAccessType} from '../shared/catalog-access';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-catalog-access-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
interface Actor{id:string;cookie:string}
let server:Server,base:string,owner:Actor,admin:Actor,viewer:Actor;
function account(role='publisher'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?,?)',id,id+'@access.test','Access creator '+id,'unused-local-hash',role,role==='viewer'?0:1,12_000_000,700_000);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
function fixture(prefix:string,options:Record<string,any>={}){
  const id=randomUUID(),numbers:number[]=options.numbers??[1,2,3],free=options.free??1;
  run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,status,views) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,owner.id,prefix+' '+id,'An original story for public episode-access filtering.','en',JSON.stringify(options.genres??['drama']),options.creation??'human',10,free,'public:/images/midnight.jpg',options.status??'published',options.views??0);
  if(options.language)run('UPDATE series SET language=? WHERE id=?',options.language,id);
  if(options.themes||options.format)run('INSERT INTO series_classifications (series_id,themes,format) VALUES (?,?,?)',id,JSON.stringify(options.themes??[]),options.format??null);
  const episodes=numbers.map(number=>{const episode=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'Episode '+number,number,10,1234,'videos/'+episode+'.mp4');return episode;});return{id,episodes};
}
async function request(route:string,actor?:Actor,status=200){const response=await fetch(base+route,{headers:actor?{Cookie:actor.cookie}:undefined});const body=await response.json();assert.equal(response.status,status,route+': '+JSON.stringify(body));return body;}
async function list(q:string,filters:Record<string,string>={},actor?:Actor){return(await request('/api/series?'+new URLSearchParams({q,...filters}),actor)).series as any[];}
const ids=(rows:{id:string}[])=>rows.map(row=>row.id).sort();
function financialState(){const result:Record<string,unknown>={};for(const table of ['users','payments','test_payments','purchases','test_purchases','ledger','test_ledger','test_accounts','wallet_funding_quotes','payment_risk_cases'])result[table]=all('SELECT * FROM '+table+' ORDER BY rowid');return result;}
before(async()=>{owner=account();admin=account('admin');viewer=account('viewer');const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('access filters partition nonempty series at free-episode boundaries and omission preserves empty legacy rows',async()=>{
  const q='Access boundaries '+randomUUID(),expected:Record<SeriesAccessType,string[]>={'all-free':[],'all-paid':[],'free-then-paid':[]};
  for(const[count,free,access]of [[3,3,'all-free'],[3,8,'all-free'],[1,1,'all-free'],[3,0,'all-paid'],[1,0,'all-paid'],[3,1,'free-then-paid'],[3,2,'free-then-paid']]as const){const row=fixture(q,{numbers:Array.from({length:count},(_,i)=>i+1),free});expected[access].push(row.id);}
  const empty=[fixture(q,{numbers:[],free:0}),fixture(q,{numbers:[],free:8})];
  const baseline=await list(q);assert.equal(baseline.length,9);for(const row of empty)assert.equal(baseline.find(item=>item.id===row.id).access_type,null);
  for(const access of SERIES_ACCESS_FILTERS){const rows=await list(q,{access});assert.deepEqual(ids(rows),expected[access].sort());assert.ok(rows.every(row=>row.access_type===access));}
});

test('sparse episode numbering is classified by the same free boundary as actual playback',async()=>{
  const q='Sparse access '+randomUUID();
  const mixed=fixture(q,{numbers:[1,9],free:3}),paid=fixture(q,{numbers:[4,9],free:3}),free=fixture(q,{numbers:[1,2],free:8});
  for(const[entry,access]of [[mixed,'free-then-paid'],[paid,'all-paid'],[free,'all-free']]as const){
    assert.deepEqual(ids(await list(q,{access})),[entry.id]);const detail=await request('/api/series/'+entry.id);assert.equal(detail.series.access_type,access);
    const flags=detail.episodes.map((episode:any)=>episode.free);assert.equal(flags.some(Boolean),access!=='all-paid');assert.equal(flags.some((flag:boolean)=>!flag),access!=='all-free');
  }
});

test('access composes with search, spoken language, genre, theme, format, production method, saved filter and ordering',async()=>{
  const q='Combined access '+randomUUID(),target={language:'ja',genres:['thriller'],themes:['revenge'],format:'animation',creation:'ai-generated',free:1};
  const first=fixture(q,{...target,views:10}),second=fixture(q,{...target,views:80});
  for(const variation of [{language:'ko'},{genres:['horror']},{themes:['secret-baby']},{format:'live-action'},{creation:'human'},{free:3},{free:0},{numbers:[]}])fixture(q,{...target,...variation});
  run('INSERT INTO series_publications (series_id,published_at) VALUES (?,?)',first.id,'2026-10-01T00:00:00Z');run('INSERT INTO series_publications (series_id,published_at) VALUES (?,?)',second.id,'2026-10-02T00:00:00Z');
  run('INSERT INTO saves (user_id,series_id) VALUES (?,?)',viewer.id,first.id);run('INSERT INTO saves (user_id,series_id) VALUES (?,?)',admin.id,first.id);run('INSERT INTO saves (user_id,series_id) VALUES (?,?)',viewer.id,second.id);
  const filters={access:'free-then-paid',language:'ja',genre:'thriller',theme:'revenge',format:'animation',creation:'ai-generated'};
  assert.deepEqual((await list(q,{...filters,sort:'popular'})).map(row=>row.id),[second.id,first.id]);assert.deepEqual((await list(q,{...filters,sort:'new'})).map(row=>row.id),[second.id,first.id]);assert.deepEqual((await list(q,{...filters,sort:'saved'})).map(row=>row.id),[first.id,second.id]);
  assert.deepEqual(ids(await list(q,{...filters,saved:'true'},viewer)),[first.id,second.id].sort());assert.deepEqual(ids(await list(q,{...filters,saved:'true'},admin)),[first.id]);assert.equal((await list(q,{...filters,theme:'betrayal-secrets'})).length,0);
});

test('invalid and repeated access query values fail closed without modifying content or financial state',async()=>{
  const q='Rejected access '+randomUUID();fixture(q);const before=financialState(),content=all('SELECT * FROM series ORDER BY id');
  for(const access of ['', 'free','paid','all','ALL-FREE','all-free,all-paid',"all-free' OR 1=1 --",'null',' free-then-paid '])await request('/api/series?'+new URLSearchParams({q,access}),undefined,400);
  await request('/api/series?'+new URLSearchParams([['q',q],['access','all-free'],['access','all-paid']]),undefined,400);assert.deepEqual(financialState(),before);assert.deepEqual(all('SELECT * FROM series ORDER BY id'),content);
});

test('access filters never expose draft, archived, taken-down, deleted or retired series even to owner or administrator',async()=>{
  const q='Visibility access '+randomUUID(),visible=fixture(q,{free:3});fixture(q,{free:3,status:'draft'});fixture(q,{free:3,status:'archived'});
  const taken=fixture(q,{free:3}),deleted=fixture(q,{free:3}),retired=fixture(q,{free:3});
  run('INSERT INTO series_moderation (series_id,taken_down,reason,actor_id) VALUES (?,1,?,?)',taken.id,'A content complaint requires private review.',admin.id);run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',deleted.id,owner.id,admin.id,'{"retained":true}');run('INSERT INTO retired_catalog_series (series_id,operation_key) VALUES (?,?)',retired.id,'test-retired-fixture');
  for(const actor of [undefined,viewer,owner,admin])assert.deepEqual(ids(await list(q,{access:'all-free'},actor)),[visible.id]);
});

test('existing live and test purchases do not reclassify a paid series or mutate wallet, pricing and purchase records',async()=>{
  const q='Purchased access '+randomUUID(),paid=fixture(q,{free:0}),mixed=fixture(q,{free:1});
  for(const entry of [paid,mixed])for(const episode of entry.episodes)for(const table of ['purchases','test_purchases'])run('INSERT INTO '+table+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,episode,100_000,70_000,30_000);
  const before=financialState(),episodes=all('SELECT * FROM episodes ORDER BY id'),series=all('SELECT * FROM series ORDER BY id');
  for(const actor of [undefined,viewer,owner,admin]){assert.deepEqual(ids(await list(q,{access:'all-paid'},actor)),[paid.id]);assert.deepEqual(ids(await list(q,{access:'free-then-paid'},actor)),[mixed.id]);}
  const detail=await request('/api/series/'+paid.id,viewer);assert.equal(detail.series.access_type,'all-paid');assert.ok(detail.episodes.every((episode:any)=>episode.unlocked&&!episode.free));assert.deepEqual(financialState(),before);assert.deepEqual(all('SELECT * FROM episodes ORDER BY id'),episodes);assert.deepEqual(all('SELECT * FROM series ORDER BY id'),series);
});

test('access metadata is consistent in public, private, publisher and history responses and follows actual episode changes',async()=>{
  const q='Access serialization '+randomUUID(),entry=fixture(q,{free:3});
  const detail=(await request('/api/series/'+entry.id)).series;
  run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer.id,entry.episodes[0],2);
  const sources=[detail,(await request('/api/studio',owner)).series.find((row:any)=>row.id===entry.id),(await request('/api/studio/series/'+entry.id,owner)).series,(await request('/api/admin/series?q='+encodeURIComponent(q),admin)).series.find((row:any)=>row.id===entry.id),(await request('/api/publishers/'+detail.publisher_id)).series.find((row:any)=>row.id===entry.id),(await request('/api/history',viewer)).history.find((row:any)=>row.id===entry.id)];
  for(const row of sources)assert.equal(row.access_type,'all-free');
  const oldPrice=one('SELECT price_cents FROM series WHERE id=?',entry.id)!.price_cents;run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',randomUUID(),entry.id,'New paid episode',4,10,1234,'videos/later-paid.mp4');
  assert.equal((await list(q,{access:'all-free'})).length,0);assert.deepEqual(ids(await list(q,{access:'free-then-paid'})),[entry.id]);assert.equal((await request('/api/studio/series/'+entry.id,owner)).series.access_type,'free-then-paid');assert.equal(one('SELECT price_cents FROM series WHERE id=?',entry.id)!.price_cents,oldPrice);
});
