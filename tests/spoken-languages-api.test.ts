import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-spoken-languages-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {LANGUAGES}=await import('../shared/config');
const {SPOKEN_LANGUAGES,SPOKEN_LANGUAGE_CODES,isLegacyChineseLanguage,defaultSpokenLanguage}=await import('../shared/spoken-languages');
const {seriesDetailsErrors}=await import('../shared/series-validation');
const {recordCreatorPassConsent}=await import('../server/creator-pass-consent');
const {LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION}=await import('../shared/creator-pass-consent');
const consent={accepted:true,policy_version:LEGAL_POLICY_VERSION,disclosure_version:CREATOR_PASS_DISCLOSURE_VERSION};
const origin='https://spoken-languages.example.test';
const details={title:'An original spoken-language drama',description:'A complete original synopsis with independent audio and subtitle declarations.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
interface Actor{id:string;cookie:string}
let server:Server,base:string,owner:Actor,viewer:Actor,admin:Actor;
function identity(role='publisher'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');run('INSERT INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,?)',id,id+'@spoken-language.test','Spoken language '+role,'unused-local-hash',role,role==='viewer'?0:1);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,actor?:Actor,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
async function create(values:Record<string,unknown>={}){return(await request('/api/studio/series',{...details,title:'Spoken audio '+randomUUID(),...values},owner,201)).id as string;}
async function edit(id:string,values:Record<string,unknown>={},status=200){const row=one('SELECT title,description,language,genres,creation_type,price_cents,free_episodes FROM series WHERE id=?',id)!;return request('/api/studio/series/'+id,{...row,genres:JSON.parse(row.genres),...values},owner,status,'PATCH');}
const read=async(id:string)=>(await request('/api/studio/series/'+id,undefined,owner)).series;
function publish(id:string){run("UPDATE series SET status='published',cover_key='public:/images/midnight.jpg' WHERE id=?",id);}
function episode(seriesId:string){const id=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',id,seriesId,'Original retained audio',1,10,1234,'private/retained-'+id+'.mp4','original.mp4');return id;}
function financial(){const result:Record<string,unknown>={};for(const table of ['users','test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','creator_pass_consents'])result[table]=all('SELECT * FROM '+table+' ORDER BY rowid');return result;}
async function list(filters:Record<string,string>){return(await request('/api/series?'+new URLSearchParams(filters))).series as any[];}
before(async()=>{config.appUrl=origin;config.mailProvider='disabled';owner=identity();viewer=identity('viewer');admin=identity('admin');const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('spoken choices expose Mandarin and Cantonese independently from the unchanged 21 interface and subtitle codes',async()=>{
  const publicConfig=await request('/api/config'),codes=publicConfig.spokenLanguages.map((language:any)=>language.code),interfaceCodes=publicConfig.languages.map((language:any)=>language.code);
  assert.deepEqual(publicConfig.spokenLanguages,SPOKEN_LANGUAGES);assert.equal(codes.length,21);assert.ok(codes.includes('cmn'));assert.ok(codes.includes('yue'));assert.ok(!codes.includes('zh-TW'));assert.ok(!codes.includes('zh-CN'));assert.equal(new Set(codes).size,codes.length);
  assert.equal(interfaceCodes.length,21);assert.deepEqual(publicConfig.languages,LANGUAGES);assert.ok(interfaceCodes.includes('zh-TW'));assert.ok(interfaceCodes.includes('zh-CN'));assert.ok(!interfaceCodes.includes('cmn'));assert.ok(!interfaceCodes.includes('yue'));
  for(const language of ['cmn','yue','zh-TW','zh-CN']){assert.ok(SPOKEN_LANGUAGE_CODES.includes(language as any));assert.deepEqual(seriesDetailsErrors({...details,language}),{});}
  assert.equal(isLegacyChineseLanguage('zh-TW'),true);assert.equal(isLegacyChineseLanguage('zh-CN'),true);assert.equal(isLegacyChineseLanguage('yue'),false);
  assert.equal(defaultSpokenLanguage('zh-TW'),'cmn');assert.equal(defaultSpokenLanguage('zh-CN'),'cmn');assert.equal(defaultSpokenLanguage('ja'),'ja');assert.equal(defaultSpokenLanguage('en'),'en');
});

test('Mandarin and Cantonese persist through create, public and private metadata, history, publisher pages and explicit audio edits',async()=>{
  for(const language of ['cmn','yue']){
    const id=await create({language,subtitle_languages:['zh-TW','zh-CN']}),ep=episode(id);publish(id);run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer.id,ep,1);
    const detail=(await request('/api/series/'+id)).series,sources=[detail,(await request('/api/series')).series.find((s:any)=>s.id===id),await read(id),(await request('/api/studio',undefined,owner)).series.find((s:any)=>s.id===id),(await request('/api/admin/series?limit=50',undefined,admin)).series.find((s:any)=>s.id===id),(await request('/api/history',undefined,viewer)).history.find((s:any)=>s.id===id),(await request('/api/publishers/'+detail.publisher_id+'?page_size=50')).series.find((s:any)=>s.id===id)];
    for(const series of sources){assert.equal(series.language,language);assert.deepEqual(series.subtitle_languages,['zh-TW','zh-CN']);}
    const beforeFinancial=financial(),beforeMedia=one('SELECT * FROM episodes WHERE id=?',ep),replacement=language==='cmn'?'yue':'cmn';await edit(id,{language:replacement});assert.equal((await read(id)).language,replacement);assert.equal(one('SELECT language FROM series WHERE id=?',id)!.language,replacement);assert.deepEqual((await read(id)).subtitle_languages,['zh-TW','zh-CN']);assert.deepEqual(one('SELECT * FROM episodes WHERE id=?',ep),beforeMedia);assert.deepEqual(financial(),beforeFinancial);
  }
});

test('spoken-language filters use exact codes with other browse axes and never infer speech from legacy Chinese tags',async()=>{
  const prefix='Exact audio filters '+randomUUID(),expected=new Map<string,string>();
  for(const language of ['cmn','yue','zh-TW','zh-CN']){const id=await create({title:prefix+' '+language,language,genres:['workplace'],themes:['entrepreneurship'],format:'live-action',creation_type:'ai-assisted'});publish(id);expected.set(language,id);}
  const mismatch=await create({title:prefix+' another genre',language:'cmn',genres:['thriller'],themes:['entrepreneurship'],format:'live-action',creation_type:'ai-assisted'});publish(mismatch);
  for(const[language,id]of expected){const filters={q:prefix,language,genre:'workplace',theme:'entrepreneurship',format:'live-action',creation:'ai-assisted'};assert.deepEqual((await list(filters)).map(s=>s.id),[id]);assert.equal((await list({...filters,format:'animation'})).length,0);}
  const cantonese=await list({q:prefix,language:'yue'});assert.deepEqual(cantonese.map(s=>s.id),[expected.get('yue')]);for(const series of cantonese)assert.ok(series.id!==expected.get('zh-TW')&&series.id!==expected.get('zh-CN'));
});

test('legacy stored Chinese metadata and older client saves survive unrelated edits and additive restart without retagging media or purchases',async()=>{
  for(const language of ['zh-TW','zh-CN']){
    const id=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres,cover_key,cover_bytes,status) VALUES (?,?,?,?,?,?,?,?,?)',id,owner.id,'Legacy spoken tag '+language,details.description,language,'["drama"]','private/legacy-cover-'+id+'.webp',4321,'published');const ep=episode(id);
    for(const table of ['purchases','test_purchases'])run('INSERT INTO '+table+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,ep,100_000,70_000,30_000);
    const original=one('SELECT * FROM series WHERE id=?',id)!,media=one('SELECT * FROM episodes WHERE id=?',ep),beforeFinancial=financial();assert.equal((await read(id)).language,language);assert.equal((await request('/api/series/'+id)).series.language,language);
    await edit(id,{title:'An old editor changes a legacy title'});db.exec(DATABASE_SCHEMA);createApp();const retained=one('SELECT * FROM series WHERE id=?',id)!;assert.equal(retained.language,language);assert.equal(retained.cover_key,original.cover_key);assert.equal(retained.cover_bytes,original.cover_bytes);assert.equal(retained.creator_id,original.creator_id);assert.deepEqual(one('SELECT * FROM episodes WHERE id=?',ep),media);assert.deepEqual(financial(),beforeFinancial);assert.equal((await read(id)).language,language);
  }
});

test('unknown or malformed spoken codes and repeated filters reject atomically instead of guessing aliases',async()=>{
  const id=await create({language:'cmn'}),before=one('SELECT * FROM series WHERE id=?',id),beforeFinancial=financial(),count=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const language of ['zh','zh-HK','cmn-Hans','yue-Hant','CMN','mandarin','cantonese','unknown','',null,1,{},['cmn']]){await request('/api/studio/series',{...details,language},owner,400);await edit(id,{title:'An invalid language must not change this title',language},400);}
  await request('/api/series?language=cmn&language=yue',undefined,undefined,400);await request('/api/series?language=zh-HK',undefined,undefined,400);assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);assert.deepEqual(one('SELECT * FROM series WHERE id=?',id),before);assert.deepEqual(financial(),beforeFinancial);assert.equal(seriesDetailsErrors({...details,language:'zh-HK'}).language,'seriesLanguageInvalid');
});

test('spoken-only codes cannot replace account, registration, Checkout or consent interface languages',async()=>{
  await request('/api/account',{name:'Script preference preserved',language:'zh-TW'},viewer,200,'PATCH');const payment=randomUUID();run("INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider) VALUES (?,?,'activation',8800,'hkd','stripe')",payment,viewer.id);const before=financial(),users=one('SELECT COUNT(*) AS n FROM users')!.n;
  for(const language of ['cmn','yue']){
    await request('/api/auth/register',{name:'Invalid UI audio code',email:randomUUID()+'@spoken-ui.test',password:'SpokenLanguageTest123!',language},undefined,400);
    await request('/api/account',{name:'Wrong account language',language},viewer,400,'PATCH');await request('/api/payments/checkout',{kind:'funding',amount_cents:500,language},viewer,400);await request('/api/payments/checkout',{kind:'activation',language,creator_consent:consent},viewer,400);
    assert.throws(()=>recordCreatorPassConsent(payment,viewer.id,consent,language),(error:any)=>error.status===400&&error.code==='CREATOR_CONSENT_REQUIRED');
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM users')!.n,users);assert.equal((await request('/api/auth/me',undefined,viewer)).user.language,'zh-TW');assert.deepEqual(financial(),before);
});

test('subtitle script choices remain independent of audio: preserve on omission, reject audio-only codes and clear explicitly',async()=>{
  const id=await create({language:'cmn',subtitle_languages:['zh-CN','zh-TW']});assert.deepEqual((await read(id)).subtitle_languages,['zh-TW','zh-CN']);await edit(id,{language:'yue'});assert.equal((await read(id)).language,'yue');assert.deepEqual((await read(id)).subtitle_languages,['zh-TW','zh-CN']);
  const stored=one('SELECT * FROM series_subtitle_languages WHERE series_id=?',id),beforeCount=one('SELECT COUNT(*) AS n FROM series')!.n,beforeFinancial=financial();
  for(const subtitle_languages of [['cmn'],['yue'],['zh-TW','cmn']]){await request('/api/studio/series',{...details,language:'yue',subtitle_languages},owner,400);await edit(id,{subtitle_languages},400);assert.deepEqual(one('SELECT * FROM series_subtitle_languages WHERE series_id=?',id),stored);}
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,beforeCount);await edit(id,{subtitle_languages:[]});assert.deepEqual((await read(id)).subtitle_languages,[]);assert.equal((await read(id)).language,'yue');const scripts=LANGUAGES.map(language=>language.code);await edit(id,{subtitle_languages:scripts});assert.deepEqual((await read(id)).subtitle_languages,scripts);assert.equal((await read(id)).language,'yue');assert.deepEqual(financial(),beforeFinancial);
});
