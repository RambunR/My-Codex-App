import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {normalizeSeriesTitle} from '../shared/series-titles';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-series-titles-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='demo';process.env.STRIPE_TEST_MODE='false';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
let server:Server,base:string,clock=Date.now();
const origin='https://titles.example.test';
interface Identity{id:string;cookie:string}
let owner:Identity,other:Identity,viewer:Identity,admin:Identity;
const details=(title:string)=>({title,description:'An original story with enough detail to save safely.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1});

async function request(route:string,body?:unknown,identity?:Identity,expected=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(identity?{Cookie:identity.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  assert.equal(response.status,expected,`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);
  return{data,headers:response.headers};
}
async function register(name:string):Promise<Identity>{
  const result=await request('/api/auth/register',{name,email:name.toLowerCase().replaceAll(' ','-')+'@titles.test',password:'TitlesPassword123!'},undefined,201);
  return{id:result.data.user.id,cookie:result.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
}
async function startServer(){
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
}
async function create(title:string,identity=owner,expected=201){return(await request('/api/studio/series',details(title),identity,expected)).data;}
async function availability(title:string,identity:Identity|undefined=owner,exclude?:string,expected=200){
  const query=new URLSearchParams({title,...(exclude?{exclude}:{})});
  return request('/api/studio/title-availability?'+query,undefined,identity,expected);
}
function legacy(title:string,creator=owner.id,status='draft'){
  const id=randomUUID();
  run('INSERT INTO series (id,creator_id,title,description,language,genres,status) VALUES (?,?,?,?,?,?,?)',id,creator,title,details(title).description,'en','["drama"]',status);
  return id;
}

before(async()=>{
  config.production=false;config.sandbox=false;config.stripeTestMode=false;config.payments='demo';config.appUrl=origin;
  await startServer();
  owner=await register('Title Owner');other=await register('Other Title Publisher');viewer=await register('Title Viewer');admin=await register('Title Administrator');
  for(const identity of [owner,other])run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",identity.id);
  run("UPDATE users SET role='admin' WHERE id=?",admin.id);
});
beforeEach(()=>{
  config.production=false;config.sandbox=false;config.stripeTestMode=false;config.payments='demo';config.appUrl=origin;
  clock+=61_000;mock.method(Date,'now',()=>clock);
});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('title comparison normalizes Unicode width, composed text, case and whitespace without erasing punctuation or word boundaries',()=>{
  assert.equal(normalizeSeriesTitle('  ＬＯＶＥ\u00a0\u3000STORY\n '),'love story');
  assert.equal(normalizeSeriesTitle('Cafe\u0301 Memories'),normalizeSeriesTitle('CAFÉ MEMORIES'));
  assert.equal(normalizeSeriesTitle('  靈映\t短劇 '),'靈映 短劇');
  assert.notEqual(normalizeSeriesTitle('Love Story'),normalizeSeriesTitle('LoveStory'));
  assert.notEqual(normalizeSeriesTitle('Love-Story'),normalizeSeriesTitle('Love Story'));
  assert.notEqual(normalizeSeriesTitle('Love!'),normalizeSeriesTitle('Love?'));
});

test('new series reject duplicates across creators without changing the original creator spelling',async()=>{
  const title='  Ｔｈｅ   Hidden Moon  ';
  const saved=await create(title),before=one('SELECT * FROM series WHERE id=?',saved.id);
  assert.equal(before!.title,'Ｔｈｅ   Hidden Moon');
  const count=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const duplicate of ['The Hidden Moon','the hidden moon',' THE\tHIDDEN\nMOON ']){
    assert.deepEqual((await availability(duplicate,other)).data,{available:false});
    const result=await create(duplicate,other,409);
    assert.equal(result.error.code,'SERIES_TITLE_EXISTS');
    assert.deepEqual(Object.keys(result.error).sort(),['code','message']);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);
  assert.deepEqual(one('SELECT * FROM series WHERE id=?',saved.id),before);
});

test('Unicode-equivalent names collide while distinct punctuation and word boundaries remain available',async()=>{
  await create('Café Memory');await create('Cafe\u0301 Memory',other,409);
  for(const title of ['Moon Song','MoonSong','Moon-Song','Moon Song!'])assert((await create(title)).id);
});

test('a title-changing edit is rejected atomically before description and classification can change',async()=>{
  const target=await create('The Reserved Harbor',other),editing=await create('The Open Harbor');
  const before=one('SELECT * FROM series WHERE id=?',editing.id),classification=all('SELECT * FROM series_classifications WHERE series_id=?',editing.id);
  const response=await request('/api/studio/series/'+editing.id,{...details(' THE  RESERVED HARBOR '),description:'This description must not replace the saved synopsis.',genres:['romance'],themes:['revenge']},owner,409,'PATCH');
  assert.equal(response.data.error.code,'SERIES_TITLE_EXISTS');
  assert.deepEqual(one('SELECT * FROM series WHERE id=?',editing.id),before);
  assert.deepEqual(all('SELECT * FROM series_classifications WHERE series_id=?',editing.id),classification);
  assert.equal(one('SELECT title FROM series WHERE id=?',target.id)!.title,'The Reserved Harbor');
});

test('own-title saves and legacy duplicates remain editable without reserving a new conflicting name',async()=>{
  const first=legacy('Legacy Echo'),second=legacy('  LEGACY   ECHO  ',other.id);
  assert.deepEqual((await availability('legacy echo')).data,{available:false});
  assert.deepEqual((await availability('legacy echo',owner,first)).data,{available:true});
  await request('/api/studio/series/'+first,{...details('LEGACY ECHO'),description:'A legitimately updated legacy synopsis.'},owner,200,'PATCH');
  assert.equal(one('SELECT description FROM series WHERE id=?',first)!.description,'A legitimately updated legacy synopsis.');
  assert.equal(one('SELECT title FROM series WHERE id=?',second)!.title,'  LEGACY   ECHO  ');
  await create('legacy echo',other,409);
  await request('/api/studio/series/'+first,details('A Distinct Echo'),owner,200,'PATCH');
  assert.deepEqual((await availability('A Distinct Echo',owner,first)).data,{available:true});
  assert.deepEqual((await availability('legacy echo')).data,{available:false});
});

test('private drafts, hidden and moderated titles stay reserved while availability exposes only a boolean',async()=>{
  for(const [title,status,moderated]of [['A Private Draft','draft',false],['An Archived Story','archived',false],['A Moderated Story','published',true]]as const){
    const id=legacy(title,other.id,status);
    if(moderated)run('INSERT INTO series_moderation (series_id,taken_down,reason,actor_id) VALUES (?,1,?,?)',id,'A locally moderated test series.',admin.id);
    const result=await availability(title);
    assert.deepEqual(result.data,{available:false});assert.equal(result.headers.get('cache-control'),'private, no-store');
    const text=JSON.stringify(result.data);assert(!text.includes(id));assert(!text.includes(other.id));assert(!text.includes(title));
    await create(title,owner,409);
  }
});

test('permanently deleted and retired titles are released without modifying their historical rows',async()=>{
  const deleted=legacy('A Deleted Name',other.id),retired=legacy('A Retired Name',other.id);
  run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',deleted,other.id,other.id,'{}');
  run('INSERT INTO retired_catalog_series (series_id,operation_key) VALUES (?,?)',retired,'local-title-reuse-fixture');
  for(const title of ['A Deleted Name','A Retired Name']){
    assert.deepEqual((await availability(title)).data,{available:true});assert((await create(title)).id);
  }
  assert.equal(one('SELECT title FROM series WHERE id=?',deleted)!.title,'A Deleted Name');
  assert.equal(one('SELECT title FROM series WHERE id=?',retired)!.title,'A Retired Name');
  await availability('A Deleted Name',other,deleted,404);await availability('A Retired Name',other,retired,404);
});

test('preflight requires publisher access, validates bounded input and authorizes exclusions before returning availability',async()=>{
  const foreign=legacy('A Foreign Exclusion',other.id);
  await request('/api/studio/title-availability?title=Valid%20Title',undefined,undefined,401);
  await availability('Valid Title',viewer,undefined,403);
  await availability('A Foreign Exclusion',owner,foreign,403);
  assert.deepEqual((await availability('A Foreign Exclusion',admin,foreign)).data,{available:true});
  await availability('Valid Title',owner,randomUUID(),404);
  for(const title of ['', ' ', 'a', 'x'.repeat(121), ' '.repeat(1024)+'xy'])await availability(title,owner,undefined,400);
  for(const query of ['title=First&title=Second','title=Valid&exclude=','title=Valid&exclude=a&exclude=b','title=Valid&other=private'])await request('/api/studio/title-availability?'+query,undefined,owner,400);
  await request('/api/studio/series/'+foreign,details('A Blocked Foreign Rename'),owner,403,'PATCH');
});

test('simultaneous creates are checked inside the write transaction after optimistic preflights',async()=>{
  const title='One Winning Title';
  assert.deepEqual((await availability(title,owner)).data,{available:true});assert.deepEqual((await availability(title,other)).data,{available:true});
  const variants=[title,'one winning title',' ONE  WINNING TITLE ',title,'One\tWinning Title','Ｏｎｅ Winning Title'];
  const results=await Promise.all(variants.map(async(value,index)=>{
    const response=await fetch(base+'/api/studio/series',{method:'POST',headers:{Cookie:(index%2?owner:other).cookie,'Content-Type':'application/json',Origin:origin},body:JSON.stringify(details(value))});
    return{status:response.status,data:await response.json()};
  }));
  assert.equal(results.filter(value=>value.status===201).length,1);
  assert.equal(results.filter(value=>value.status===409&&value.data.error.code==='SERIES_TITLE_EXISTS').length,5);
  assert.equal(all<{title:string}>('SELECT title FROM series').filter(row=>normalizeSeriesTitle(row.title)===normalizeSeriesTitle(title)).length,1);
});

test('duplicate prevention reads durable titles after an application restart and permits a valid rename',async()=>{
  const id=(await create('A Persistent Title')).id;
  await new Promise<void>(resolve=>server.close(()=>resolve()));await startServer();
  assert.deepEqual((await availability('a persistent title',other)).data,{available:false});await create('A Persistent Title',other,409);
  assert.deepEqual((await availability('A Persistent Title',owner,id)).data,{available:true});
  await request('/api/studio/series/'+id,details('A Newly Available Title'),owner,200,'PATCH');
  assert.deepEqual((await availability('A Persistent Title',other)).data,{available:true});assert((await create('A Persistent Title',other)).id);
});

test('availability checks are rate-limited independently from writes',async()=>{
  for(let i=0;i<30;i++)assert.deepEqual((await availability('An Unused Rate Probe')).data,{available:true});
  assert.equal((await availability('An Unused Rate Probe',owner,undefined,429)).data.error.code,'RATE_LIMIT');
  assert((await create('Writes Still Enforce Their Own Check')).id);
});
