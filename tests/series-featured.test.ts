import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-series-featured-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
let server:Server,base:string;
interface Actor{id:string;cookie:string}
let owner:Actor,admin:Actor,viewer:Actor;
const details={title:'An original suggested series',description:'An original short drama used only to verify administrative homepage suggestions.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:0};
function account(role:string):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros,used_bytes) VALUES (?,?,?,?,?,?,?,?,?)',id,id+'@suggested.test','Suggestion '+role,'unused-local-hash',role,role==='publisher'?1:0,25_000_000,700_000,1234);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
function fixture(options:Record<string,any>={}){
  const id=randomUUID(),episode=randomUUID(),title=options.title??'Suggested '+id;
  run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,status,featured,views) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner.id,title,details.description,options.language??'en',JSON.stringify(options.genres??['drama']),options.creation??'human',35,options.free??0,'public:/images/midnight.jpg',options.status??'published',options.featured??0,options.views??0);
  if(options.episodes!==0)run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'Episode 001',1,60,1234,'episodes/'+episode+'.mp4');
  if(options.themes||options.format)run('INSERT INTO series_classifications (series_id,themes,format) VALUES (?,?,?)',id,JSON.stringify(options.themes??[]),options.format??null);
  return{id,episode,title};
}
async function request(route:string,actor?:Actor,body?:unknown,method=body===undefined?'GET':'PUT'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:response.status,data:await response.json()};
}
const set=(id:string,featured:unknown,actor:Actor|undefined=admin)=>request('/api/admin/series/'+id+'/featured',actor,{featured});
const events=(id:string)=>all('SELECT * FROM series_moderation_events WHERE series_id=? ORDER BY rowid',id);
const ids=(rows:any[])=>rows.map(row=>row.id).sort();
function financialState(){const state:Record<string,unknown>={};for(const table of ['users','payments','test_payments','purchases','test_purchases','ledger','test_ledger','test_accounts','wallet_funding_quotes','payment_risk_cases'])state[table]=all('SELECT * FROM '+table+' ORDER BY rowid');return state;}
before(async()=>{
  owner=account('publisher');admin=account('admin');viewer=account('viewer');
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('only administrators can suggest content, including another publisher’s own series',async()=>{
  const drama=fixture(),before=one('SELECT * FROM series WHERE id=?',drama.id);
  for(const actor of [undefined,viewer,owner])assert.equal((await request('/api/admin/series/'+drama.id+'/featured',actor,{featured:true})).status,403);
  assert.deepEqual(one('SELECT * FROM series WHERE id=?',drama.id),before);assert.equal(events(drama.id).length,0);
  const result=await set(drama.id,true);assert.equal(result.status,200);assert.deepEqual(result.data,{featured:1,alreadyApplied:false});
  assert.equal((await request('/api/admin/series?q='+encodeURIComponent(drama.title),admin)).data.series[0].featured,1);
});

test('suggestion input is a strict boolean and invalid filters never mutate content',async()=>{
  const drama=fixture(),before=one('SELECT * FROM series WHERE id=?',drama.id);
  for(const value of [null,0,1,'true','false',[],{}])assert.equal((await set(drama.id,value)).status,400);
  for(const body of [{},{featured:true,role:'admin'},{featured:true,creator_id:admin.id}])assert.equal((await request('/api/admin/series/'+drama.id+'/featured',admin,body)).status,400);
  for(const query of ['featured=false','featured=1','featured=','featured=true&featured=true'])assert.equal((await request('/api/series?'+query)).status,400);
  assert.deepEqual(one('SELECT * FROM series WHERE id=?',drama.id),before);assert.equal(events(drama.id).length,0);
  assert.equal((await set('missing-series',true)).status,404);
});

test('suggestion retries are idempotent and every change has one administrator metadata audit',async()=>{
  const drama=fixture();
  assert.deepEqual((await set(drama.id,false)).data,{featured:0,alreadyApplied:true});assert.equal(events(drama.id).length,0);
  assert.deepEqual((await set(drama.id,true)).data,{featured:1,alreadyApplied:false});
  assert.deepEqual((await set(drama.id,true)).data,{featured:1,alreadyApplied:true});
  assert.deepEqual((await set(drama.id,false)).data,{featured:0,alreadyApplied:false});
  assert.deepEqual((await set(drama.id,false)).data,{featured:0,alreadyApplied:true});
  const audit=events(drama.id);assert.equal(audit.length,2);assert.ok(audit.every(event=>event.action==='metadata'&&event.actor_id===admin.id));
  const snapshots=audit.map(event=>JSON.parse(event.snapshot_json));
  assert.deepEqual(snapshots.map(snapshot=>[snapshot.before.featured,snapshot.after.featured]),[[0,1],[1,0]]);
  assert.ok(snapshots.every(snapshot=>snapshot.operation==='homepage_suggestion'&&snapshot.creator_id===owner.id));
});

test('curation changes only the suggestion flag and audit, preserving media and both financial modes',async()=>{
  const drama=fixture();
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,drama.episode,350_000,245_000,105_000);
  run('INSERT INTO test_purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,drama.episode,350_000,245_000,105_000);
  run('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)',viewer.id,5_000_000,0,0);
  for(const table of ['payments','test_payments'])run('INSERT INTO '+table+' (id,user_id,kind,amount_cents,currency,provider,status) VALUES (?,?,?,?,?,?,?)',randomUUID(),viewer.id,'funding',500,'usd','stripe','paid');
  for(const table of ['ledger','test_ledger'])run('INSERT INTO '+table+' (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,'funding',5_000_000,randomUUID(),'A retained prior funding record');
  const before=one('SELECT * FROM series WHERE id=?',drama.id)!,media=all('SELECT * FROM episodes WHERE series_id=?',drama.id),money=financialState();
  assert.equal((await set(drama.id,true)).status,200);assert.deepEqual({...one<Record<string,unknown>>('SELECT * FROM series WHERE id=?',drama.id)!},{...before,featured:1});
  assert.deepEqual(all('SELECT * FROM episodes WHERE series_id=?',drama.id),media);assert.deepEqual(financialState(),money);
  assert.equal((await set(drama.id,false)).status,200);assert.deepEqual(one('SELECT * FROM series WHERE id=?',drama.id),before);assert.deepEqual(financialState(),money);
});

test('hidden, moderated, empty, deleted and retired content cannot be newly suggested',async()=>{
  const draft=fixture({status:'draft',featured:1}),hidden=fixture({status:'archived',featured:1}),offline=fixture({featured:1}),empty=fixture({episodes:0,featured:1}),deleted=fixture({featured:1}),retired=fixture({featured:1});
  run('INSERT INTO series_moderation (series_id,taken_down,reason,actor_id) VALUES (?,?,?,?)',offline.id,1,'Existing administrative takedown',admin.id);
  run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',deleted.id,owner.id,admin.id,'{}');
  run('INSERT INTO retired_catalog_series (series_id,operation_key) VALUES (?,?)',retired.id,'local-retirement-fixture');
  for(const drama of [draft,hidden,offline,empty]){
    assert.equal((await set(drama.id,true)).status,409);assert.equal(events(drama.id).length,0);
    assert.equal((await set(drama.id,false)).status,200);assert.equal(one('SELECT featured FROM series WHERE id=?',drama.id)!.featured,0);
  }
  for(const drama of [deleted,retired])for(const featured of [true,false])assert.equal((await set(drama.id,featured)).status,404);
  for(const drama of [draft,hidden,offline,empty])run('UPDATE series SET featured=1 WHERE id=?',drama.id);
  const visible=(await request('/api/series?featured=true')).data.series;
  for(const drama of [draft,hidden,offline,empty,deleted,retired])assert.ok(!visible.some((row:any)=>row.id===drama.id));
});

test('public suggestion filtering composes every catalogue axis without changing normal discovery',async()=>{
  const prefix='Homepage query '+randomUUID();
  const chosen=fixture({title:prefix+' chosen',free:1,language:'ja',genres:['romance'],themes:['revenge'],format:'animation',creation:'ai-assisted',views:2});
  const notChosen=fixture({title:prefix+' ordinary',free:1,language:'ja',genres:['romance'],themes:['revenge'],format:'animation',creation:'ai-assisted',views:500});
  const wrongLanguage=fixture({title:prefix+' English',free:1,genres:['romance'],themes:['revenge'],format:'animation',creation:'ai-assisted'});
  for(const row of [chosen,wrongLanguage])assert.equal((await set(row.id,true)).status,200);
  run('INSERT INTO saves (user_id,series_id) VALUES (?,?)',viewer.id,chosen.id);
  const query=new URLSearchParams({q:prefix,featured:'true',language:'ja',genre:'romance',theme:'revenge',format:'animation',creation:'ai-assisted',access:'all-free',sort:'new'});
  const filtered=await request('/api/series?'+query);assert.equal(filtered.status,200);assert.deepEqual(ids(filtered.data.series),[chosen.id]);assert.equal(filtered.data.series[0].featured,1);assert.equal(filtered.data.series[0].creator_id,undefined);
  const saved=await request('/api/series?'+query+'&saved=true',viewer);assert.deepEqual(ids(saved.data.series),[chosen.id]);
  const normal=await request('/api/series?'+new URLSearchParams({q:prefix}));assert.deepEqual(ids(normal.data.series),[chosen.id,notChosen.id,wrongLanguage.id].sort());assert.equal(normal.data.series[0].id,notChosen.id);
});

test('ordinary publishing and metadata endpoints cannot self-select homepage suggestions',async()=>{
  const drama=fixture();
  const edited=await request('/api/studio/series/'+drama.id,owner,{...details,title:'Publisher metadata edit '+randomUUID(),featured:1},'PATCH');assert.equal(edited.status,200);assert.equal(one('SELECT featured FROM series WHERE id=?',drama.id)!.featured,0);
  const created=await request('/api/studio/series',owner,{...details,featured:1},'POST');assert.equal(created.status,201);assert.equal(one('SELECT featured FROM series WHERE id=?',created.data.id)!.featured,0);
});

test('an audit write failure rolls the featured flag back atomically',async()=>{
  const drama=fixture();
  db.exec("CREATE TRIGGER fail_suggestion_audit BEFORE INSERT ON series_moderation_events WHEN NEW.reason='Homepage suggestion enabled by an administrator.' BEGIN SELECT RAISE(ABORT,'local audit fixture failure'); END");
  try{assert.equal((await set(drama.id,true)).status,500);assert.equal(one('SELECT featured FROM series WHERE id=?',drama.id)!.featured,0);assert.equal(events(drama.id).length,0);}finally{db.exec('DROP TRIGGER fail_suggestion_audit');}
});
