import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-taxonomy-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.PAYMENTS_MODE='disabled';process.env.SEED_DEMO='false';process.env.PLATFORM_OWNER_USER_ID='';
delete process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_WEBHOOK_SECRET;
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {seriesDetailsErrors}=await import('../shared/series-validation');
const {STANDARD_GENRES,GENRES,STORY_THEMES,SERIES_FORMATS,CREATION_TYPES}=await import('../shared/taxonomy');
let server:Server,base:string;
const owner='taxonomy-owner',admin='taxonomy-admin',viewer='taxonomy-viewer',other='taxonomy-other',cookies=new Map<string,string>();
const details={title:'A classified short drama',description:'An original story with independently selected classifications.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
function account(id:string,role:string,active=0){
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?,?)',id,id+'@example.invalid',id,'local-unused-hash',role,active,1_000_000,70_000);
  const token=randomBytes(32).toString('hex');run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+60*60_000);cookies.set(id,'drama_session='+token);
}
async function request(route:string,body?:unknown,actor?:string,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:cookies.get(actor)!}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:response.status,data:await response.json()};
}
async function create(input:Record<string,unknown>={},actor=owner){const result=await request('/api/studio/series',{...details,...input},actor);assert.equal(result.status,201,JSON.stringify(result.data));return result.data.id as string;}
async function read(id:string,actor=owner){const response=await request('/api/studio/series/'+id,undefined,actor);assert.equal(response.status,200);return response.data.series;}
async function change(id:string,input:Record<string,unknown>,actor=owner){return request('/api/studio/series/'+id,{...details,...input},actor,'PATCH');}
async function list(filters:Record<string,string>){const response=await request('/api/series?'+new URLSearchParams(filters));assert.equal(response.status,200,JSON.stringify(response.data));return response.data.series as any[];}
function publish(id:string){run("UPDATE series SET status='published' WHERE id=?",id);}
function money(){return{users:all('SELECT id,publisher_active,wallet_micros,earnings_micros,quota_bytes,used_bytes FROM users ORDER BY id'),payments:all('SELECT * FROM payments ORDER BY id'),testPayments:all('SELECT * FROM test_payments ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id')};}
before(async()=>{
  account(owner,'publisher',1);account(other,'publisher',1);account(viewer,'viewer');account(admin,'admin');
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('configuration exposes independent stable genre, theme, format and production vocabularies',async()=>{
  const response=await request('/api/config');assert.equal(response.status,200);
  assert.deepEqual(response.data.standardGenres,[...STANDARD_GENRES]);assert.deepEqual(response.data.genres,[...GENRES]);assert.deepEqual(response.data.storyThemes,[...STORY_THEMES]);assert.deepEqual(response.data.formats,[...SERIES_FORMATS]);assert.deepEqual(response.data.creationTypes,[...CREATION_TYPES]);
  assert.equal(STANDARD_GENRES.length,29);assert.ok(!STANDARD_GENRES.includes('animation' as any));assert.ok(GENRES.includes('animation'));
});

test('new genre, themes and format persist in private/public series, studio, admin and history',async()=>{
  const id=await create({genres:['psychological','thriller'],themes:['revenge','hidden-identity'],format:'animation',creation_type:'ai-assisted'});
  const draft=await read(id);assert.deepEqual(draft.genres,['psychological','thriller']);assert.deepEqual(draft.themes,['revenge','hidden-identity']);assert.equal(draft.format,'animation');assert.equal(draft.creation_type,'ai-assisted');
  const stored=one('SELECT * FROM series_classifications WHERE series_id=?',id)!;assert.equal(stored.themes,'["revenge","hidden-identity"]');
  publish(id);const publicResult=await request('/api/series/'+id);assert.equal(publicResult.status,200);assert.deepEqual(publicResult.data.series.themes,draft.themes);assert.equal(publicResult.data.series.format,'animation');
  const studio=await request('/api/studio',undefined,owner);assert.equal(studio.data.series.find((s:any)=>s.id===id).format,'animation');
  const managed=await request('/api/admin/series',undefined,admin);assert.deepEqual(managed.data.series.find((s:any)=>s.id===id).themes,draft.themes);
  const episode=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'An original episode',1,1,1,'taxonomy/private.mp4');run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer,episode,0.5);
  const history=await request('/api/history',undefined,viewer);assert.equal(history.data.history.find((s:any)=>s.id===id).format,'animation');
});

test('legacy clients and existing series remain valid without fabricated format assignments or writes during reads',async()=>{
  const ordinary=await create(),animated=await create({genres:['animation','sci-fi']});publish(ordinary);publish(animated);
  assert.equal(one('SELECT * FROM series_classifications WHERE series_id=?',ordinary),undefined);assert.equal(one('SELECT * FROM series_classifications WHERE series_id=?',animated),undefined);
  assert.deepEqual((await read(ordinary)).themes,[]);assert.equal((await read(ordinary)).format,null);assert.equal((await read(animated)).format,'animation');
  await list({format:'animation'});await request('/api/series/'+animated);await request('/api/admin/series',undefined,admin);
  assert.equal(one('SELECT * FROM series_classifications WHERE series_id=?',animated),undefined);
  assert.equal((await change(animated,{genres:['sci-fi']})).status,200);assert.equal((await read(animated)).format,'animation','Changing genre from an older editor must retain proven format');
});

test('older edits preserve classification while explicit empty themes and null format clear only those fields',async()=>{
  const id=await create({themes:['contract-marriage','billionaire-ceo'],format:'live-action'});
  assert.equal((await change(id,{title:'An older client edit'})).status,200);let current=await read(id);assert.deepEqual(current.themes,['contract-marriage','billionaire-ceo']);assert.equal(current.format,'live-action');
  assert.equal((await change(id,{themes:['secret-baby']})).status,200);current=await read(id);assert.deepEqual(current.themes,['secret-baby']);assert.equal(current.format,'live-action');
  assert.equal((await change(id,{format:'motion-comic'})).status,200);current=await read(id);assert.deepEqual(current.themes,['secret-baby']);assert.equal(current.format,'motion-comic');
  assert.equal((await change(id,{themes:[],format:null})).status,200);current=await read(id);assert.deepEqual(current.themes,[]);assert.equal(current.format,null);
  const legacy=await create({genres:['animation']});assert.equal((await change(legacy,{genres:['animation'],format:null})).status,200);assert.equal((await read(legacy)).format,null,'Explicit null must not be inferred back from legacy genre');
});

test('all browse axes combine with AND semantics and old animation links retain animated discoveries',async()=>{
  const title='A unique taxonomy browse '+randomUUID();
  const target={title,language:'ja',genres:['thriller'],themes:['revenge'],format:'animation',creation_type:'ai-generated'};
  const wanted=await create(target);publish(wanted);
  for(const variation of [{language:'ko'},{genres:['horror']},{themes:['betrayal-secrets']},{format:'live-action'},{creation_type:'human'}])publish(await create({...target,...variation}));
  const filters={q:title,language:'ja',genre:'thriller',theme:'revenge',format:'animation',creation:'ai-generated'};
  assert.deepEqual((await list(filters)).map(s=>s.id),[wanted]);
  assert.ok((await list({q:title,theme:'revenge'})).length>1);
  assert.equal((await list({...filters,theme:'secret-baby'})).length,0);
  const legacy=await create({genres:['animation']}),anime=await create({genres:['adventure'],format:'anime-donghua'}),motion=await create({genres:['comedy'],format:'motion-comic'});for(const id of [legacy,anime,motion])publish(id);
  const animated=(await list({genre:'animation'})).map(s=>s.id);for(const id of [wanted,legacy,anime,motion])assert.ok(animated.includes(id));
  assert.ok((await list({format:'anime-donghua'})).some(s=>s.id===anime));assert.ok(!(await list({format:'animation'})).some(s=>s.id===anime));
});

test('unknown, duplicate and oversized classification values fail instead of being silently accepted',async()=>{
  const invalid=[{genres:['unknown']},{genres:['drama','drama']},{themes:['revenge','revenge']},{themes:['unknown']},{themes:[...STORY_THEMES.slice(0,6)]},{themes:'revenge'},{themes:null},{format:'Animation'},{format:''},{format:'unknown'}];
  const before=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const values of invalid){const response=await request('/api/studio/series',{...details,...values},owner);assert.equal(response.status,400,JSON.stringify(values));}
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,before);
  for(const params of [{theme:'unknown'},{theme:'revenge\" OR 1=1 --'},{format:'unknown'},{genre:'Animation'},{creation:'AI'},{theme:['revenge','mafia']}]){
    const query=new URLSearchParams();for(const[key,value]of Object.entries(params))if(Array.isArray(value))for(const item of value)query.append(key,item);else query.set(key,value);
    assert.equal((await request('/api/series?'+query)).status,400,query.toString());
  }
});

test('classification editing retains publisher ownership, takedown locks and administrator metadata audit',async()=>{
  assert.equal((await request('/api/studio/series',details)).status,401);assert.equal((await request('/api/studio/series',details,viewer)).status,403);
  const id=await create({format:'live-action',themes:['revenge']});
  assert.equal((await change(id,{format:'animation'},other)).status,403);assert.equal((await read(id)).format,'live-action');
  assert.equal((await request('/api/admin/series/'+id+'/moderation',{action:'takedown',reason:'A content complaint requires a private review.'},admin)).status,200);
  assert.equal((await change(id,{format:'animation'})).status,423);assert.equal((await read(id)).format,'live-action');
  assert.equal((await change(id,{format:'anime-donghua',themes:['strong-heroine']},admin)).status,200);
  const events=await request('/api/admin/series/'+id+'/moderation',undefined,admin),edit=events.data.events.find((event:any)=>event.action==='metadata');
  assert.equal(edit.snapshot.before.format,'live-action');assert.deepEqual(edit.snapshot.before.themes,['revenge']);assert.equal(edit.snapshot.after.format,'anime-donghua');assert.deepEqual(edit.snapshot.after.themes,['strong-heroine']);
  assert.equal((await request('/api/series/'+id)).status,404);
});

test('additive initialization preserves classification, media references, purchases, balances and entitlements',async()=>{
  const id=await create({format:'animation',themes:['against-all-odds']});publish(id);
  const episode=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'Retained purchase evidence',1,1,1234,'private/existing-episode.mp4');run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer,episode,100_000,70_000,30_000);
  const beforeMoney=money(),beforeEpisode=one('SELECT * FROM episodes WHERE id=?',episode);
  assert.equal((await change(id,{format:'live-action',themes:['second-chance-love']})).status,200);
  db.exec(DATABASE_SCHEMA);createApp();
  assert.deepEqual(money(),beforeMoney);assert.deepEqual(one('SELECT * FROM episodes WHERE id=?',episode),beforeEpisode);
  assert.deepEqual((await read(id)).themes,['second-chance-love']);assert.equal((await read(id)).format,'live-action');
});

test('client validation shares expanded vocabulary, optional compatibility and bounds with server validation',()=>{
  assert.deepEqual(seriesDetailsErrors(details),{});
  assert.deepEqual(seriesDetailsErrors({...details,genres:['medical','legal'],themes:['hidden-identity'],format:'animation'}),{});
  assert.deepEqual(seriesDetailsErrors({...details,themes:[],format:null}),{});
  assert.equal(seriesDetailsErrors({...details,genres:['drama','drama']}).genres,'seriesGenresInvalid');
  assert.equal(seriesDetailsErrors({...details,themes:['revenge','revenge']}).themes,'taxonomyThemesInvalid');
  assert.equal(seriesDetailsErrors({...details,themes:[...STORY_THEMES.slice(0,6)]}).themes,'taxonomyThemesInvalid');
  assert.equal(seriesDetailsErrors({...details,themes:['unknown']}).themes,'taxonomyThemesInvalid');
  assert.equal(seriesDetailsErrors({...details,format:'unknown'}).format,'taxonomyFormatInvalid');
});


test('all added story themes save through create and PATCH and remain independently filterable with the other browse axes',async()=>{
  const added=['entrepreneurship','business-rivalry','inheritance-succession','family-feud','love-triangle','redemption','friendship','self-discovery','survival','found-family'];
  const prefix='Expanded theme coverage '+randomUUID(),beforeMoney=money();
  const selected={language:'ja',genres:['workplace'],format:'live-action',creation_type:'ai-assisted'};
  // A matching new-theme record in another language must not bypass AND filters.
  publish(await create({...selected,title:prefix+' distractor',language:'ko',themes:['entrepreneurship']}));
  for(const theme of added){
    const title=prefix+' '+theme,id=await create({...selected,title,themes:[theme]});publish(id);
    assert.deepEqual((await read(id)).themes,[theme]);
    const first=await request('/api/series/'+id);assert.equal(first.status,200);assert.deepEqual(first.data.series.themes,[theme]);
    assert.equal((await change(id,{...selected,title,themes:['revenge',theme]})).status,200);
    assert.deepEqual((await read(id)).themes,['revenge',theme]);assert.deepEqual(JSON.parse(one('SELECT themes FROM series_classifications WHERE series_id=?',id)!.themes),['revenge',theme]);
    const filters={q:prefix,theme,language:'ja',genre:'workplace',format:'live-action',creation:'ai-assisted'};
    assert.deepEqual((await list(filters)).map(series=>series.id),[id]);
    assert.equal((await list({...filters,format:'animation'})).length,0);
  }
  assert.deepEqual(money(),beforeMoney);
});

test('new and retained themes share the five-choice unique limit and omitted edits preserve stored metadata',async()=>{
  const themes=['entrepreneurship','revenge','business-rivalry','baby-sweetheart','found-family'];
  const id=await create({themes,format:'animation'}),retained=await create({themes:['billionaire-ceo','baby-sweetheart'],format:'live-action'});
  const stored=one('SELECT * FROM series_classifications WHERE series_id=?',id),oldMetadata=one('SELECT * FROM series_classifications WHERE series_id=?',retained),beforeMoney=money(),beforeCount=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const invalid of [[...themes,'survival'],['entrepreneurship','entrepreneurship'],['entrepreneurship','not-a-story-theme']]){
    assert.equal((await request('/api/studio/series',{...details,themes:invalid},owner)).status,400);
    assert.equal((await change(id,{themes:invalid})).status,400);
    assert.deepEqual(one('SELECT * FROM series_classifications WHERE series_id=?',id),stored);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,beforeCount);
  assert.equal((await change(id,{title:'An older editor retains the expanded theme selection'})).status,200);
  assert.deepEqual((await read(id)).themes,themes);assert.equal((await read(id)).format,'animation');
  db.exec(DATABASE_SCHEMA);
  assert.deepEqual((await read(id)).themes,themes);assert.deepEqual(one('SELECT * FROM series_classifications WHERE series_id=?',retained),oldMetadata);
  assert.deepEqual((await read(retained)).themes,['billionaire-ceo','baby-sweetheart']);assert.deepEqual(money(),beforeMoney);
});
