import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-subtitle-languages-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const {config}=await import('../server/config');
const {LANGUAGES}=await import('../shared/config');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {setSeriesModeration}=await import('../server/moderation');
const origin='https://subtitle-languages.example.test';
const details={title:'A multilingual original',description:'A complete original drama with publisher-declared subtitle languages.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
interface Actor{id:string;cookie:string}
let owner:Actor,other:Actor,viewer:Actor,admin:Actor,server:Server,base:string;
function identity(role='publisher'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,?)',id,id+'@subtitle.test','Local subtitle creator','unused-local-hash',role,role==='viewer'?0:1);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);
  return{id,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,actor?:Actor,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
async function create(values:Record<string,unknown>={}){return(await request('/api/studio/series',{...details,title:'Subtitle metadata '+randomUUID(),...values},owner,201)).id as string;}
async function edit(id:string,values:Record<string,unknown>={},actor=owner,status=200){const current=one('SELECT title FROM series WHERE id=?',id)!;return request('/api/studio/series/'+id,{...details,title:current.title,...values},actor,status,'PATCH');}
async function read(id:string){return(await request('/api/studio/series/'+id,undefined,owner)).series;}
function preserved(){return{users:all('SELECT * FROM users ORDER BY id'),episodes:all('SELECT * FROM episodes ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),payments:all('SELECT * FROM payments ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id')};}
before(async()=>{
  config.appUrl=origin;owner=identity();other=identity();viewer=identity('viewer');admin=identity('admin');
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('subtitle declarations default empty without creating tracks or backfilling old records',async()=>{
  const id=await create();assert.deepEqual((await read(id)).subtitle_languages,[]);assert.equal(one('SELECT * FROM series_subtitle_languages WHERE series_id=?',id),undefined);
  const old=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres) VALUES (?,?,?,?,?,?)',old,owner.id,details.title,details.description,'en','["drama"]');
  const before=one('SELECT * FROM series WHERE id=?',old);db.exec(DATABASE_SCHEMA);assert.deepEqual((await read(old)).subtitle_languages,[]);assert.deepEqual(one('SELECT * FROM series WHERE id=?',old),before);
  assert.equal(one('SELECT * FROM series_subtitle_languages WHERE series_id=?',old),undefined);
});

test('all 21 supported languages persist in canonical order and omitted edits preserve while empty clears',async()=>{
  const codes=LANGUAGES.map(item=>item.code),id=await create({subtitle_languages:[...codes].reverse()});
  assert.deepEqual((await read(id)).subtitle_languages,codes);const before=preserved();
  await edit(id,{title:'An older editor changes only the title'});assert.deepEqual((await read(id)).subtitle_languages,codes);
  await edit(id,{subtitle_languages:[]});assert.deepEqual((await read(id)).subtitle_languages,[]);
  await edit(id,{subtitle_languages:['ja','en','zh-TW']});assert.deepEqual((await read(id)).subtitle_languages,['en','zh-TW','ja']);
  db.exec(DATABASE_SCHEMA);assert.deepEqual((await read(id)).subtitle_languages,['en','zh-TW','ja']);assert.deepEqual(preserved(),before);
});

test('duplicate, unknown, non-array and oversized subtitle declarations reject atomically',async()=>{
  const id=await create({subtitle_languages:['en']}),before=one('SELECT * FROM series WHERE id=?',id),stored=one('SELECT * FROM series_subtitle_languages WHERE series_id=?',id),count=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const subtitle_languages of [['en','en'],['xx'],['EN'],['zh'],null,'en,ja',{},[42],Array(22).fill('en')]){
    await request('/api/studio/series',{...details,subtitle_languages},owner,400);await edit(id,{title:'An invalid edit must roll back',subtitle_languages},owner,400);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);assert.deepEqual(one('SELECT * FROM series WHERE id=?',id),before);assert.deepEqual(one('SELECT * FROM series_subtitle_languages WHERE series_id=?',id),stored);
});

test('subtitle languages appear consistently in public, Studio, history, administrator and publisher metadata',async()=>{
  const id=await create({subtitle_languages:['ko','en']}),episode=randomUUID();run("UPDATE series SET status='published' WHERE id=?",id);run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'Unchanged episode',1,1,64,'private/original.mp4');run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer.id,episode,.5);
  const detail=(await request('/api/series/'+id)).series,listing=(await request('/api/series')).series.find((row:any)=>row.id===id),studio=(await request('/api/studio',undefined,owner)).series.find((row:any)=>row.id===id),managed=(await request('/api/admin/series?limit=50',undefined,admin)).series.find((row:any)=>row.id===id),history=(await request('/api/history',undefined,viewer)).history.find((row:any)=>row.id===id),publisher=(await request('/api/publishers/'+detail.publisher_id)).series.find((row:any)=>row.id===id);
  for(const row of [detail,listing,studio,managed,history,publisher,await read(id)])assert.deepEqual(row.subtitle_languages,['en','ko']);assert.equal(detail.creator_id,undefined);
});

test('subtitle metadata retains ownership and takedown guards and records accurate admin changes',async()=>{
  const id=await create({subtitle_languages:['en']}),before=preserved();await request('/api/studio/series',{...details,subtitle_languages:['ja']},undefined,401);await request('/api/studio/series',{...details,subtitle_languages:['ja']},viewer,403);await edit(id,{subtitle_languages:['ja']},other,403);
  setSeriesModeration(admin.id,id,'takedown','A rights complaint requires private review before changes.');await edit(id,{subtitle_languages:['ja']},owner,423);await edit(id,{subtitle_languages:['zh-TW','ja']},admin);
  const audit=(await request('/api/admin/series/'+id+'/moderation',undefined,admin)).events.find((item:any)=>item.action==='metadata');assert.deepEqual(audit.snapshot.before.subtitle_languages,['en']);assert.deepEqual(audit.snapshot.after.subtitle_languages,['zh-TW','ja']);assert.equal(one('SELECT creator_id FROM series WHERE id=?',id)!.creator_id,owner.id);assert.deepEqual(preserved(),before);await request('/api/series/'+id,undefined,undefined,404);
});
