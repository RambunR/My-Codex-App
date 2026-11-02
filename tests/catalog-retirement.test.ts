import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {DEMO_CATALOG} from '../shared/catalog';
import {DEMO_PREVIEW_BYTES} from '../cloudflare/preview-meta';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-catalog-retirement-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {all,one,run,db}=await import('../server/db');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {retireBuiltInCatalogue,CATALOG_RETIREMENT_OPERATION}=await import('../server/catalog-retirement');
const origin='https://lingyingdrama.com';
const seedIds=DEMO_CATALOG.map(row=>row[0]);
interface Actor{id:string;cookie:string}
let administrator:Actor,catalog:Actor,creator:Actor,viewer:Actor,server:Server,base:string,protectedId:string,otherId:string;

function identity(name:string,role='publisher',id:string=randomUUID(),email=id+'@retirement.test'):Actor{
  const token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros,used_bytes) VALUES (?,?,?,?,?,?,?,?,?)',id,email,name,'unused-local-password-hash',role,role==='viewer'?0:1,5_000_000,700_000,1234);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);
  return{id,cookie:'drama_session='+token};
}
function series(id:string,title:string,owner:Actor,demo=0,cover='covers/'+id+'.webp'){
  run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,cover_bytes,status,views,featured,demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner.id,title,'An uploaded narrative whose ownership and original media must remain intact.','en','["drama"]','human',10,2,cover,123,'published',27,1,demo);
}
function episode(id:string,seriesId:string,number:number,key='videos/'+id+'.mp4',duration=30){run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',id,seriesId,'Original episode '+number,number,Math.min(duration,180),456,key,'Original '+number+'.mp4');if(duration>180)run('INSERT INTO episode_durations (episode_id,seconds) VALUES (?,?)',id,duration);}
function assignment(seriesId:string,displayName:string,id='publisher-'+randomUUID()){run('INSERT INTO publisher_profiles (id,display_name,registered_at,created_by,updated_by) VALUES (?,?,?,?,?)',id,displayName,'2020-01-01',administrator.id,administrator.id);run('INSERT INTO series_publisher_profiles (series_id,publisher_id,assigned_by) VALUES (?,?,?)',seriesId,id,administrator.id);return id;}
function fixture(){
  db.exec('PRAGMA foreign_keys=OFF');for(const row of all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")){assert.match(row.name,/^[a-z_]+$/);db.exec('DELETE FROM "'+row.name+'"');}db.exec('PRAGMA foreign_keys=ON');
  administrator=identity('Retirement administrator','admin');catalog=identity('Studio Afterglow','publisher','catalog-publisher','catalog@aidramio.invalid');creator=identity('DreamShortDrama');viewer=identity('An existing viewer','viewer');
  for(const[id,title,description,language,genres,image,type,featured]of DEMO_CATALOG){
    run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,status,featured,demo,views) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,catalog.id,title,description,language,JSON.stringify(genres),type,30,8,'public:/images/'+image+'.jpg','published',featured,1,19);
    for(let n=1;n<=8;n++)run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',id+'-'+n,id,'Sample preview '+n,n,12,DEMO_PREVIEW_BYTES,'demo/preview.mp4');
    run('INSERT INTO series_likes (user_id,series_id) VALUES (?,?)',viewer.id,id);run('INSERT INTO saves (user_id,series_id) VALUES (?,?)',viewer.id,id);run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer.id,id+'-1',3);
    run('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,watched_ms,reported_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,?,?,?,?)','playback-'+id,id+'-1','known-local-viewer',1000,6000,5000,5000,1,6000);
    run('INSERT INTO series_publications (series_id,published_at) VALUES (?,?)',id,'2026-10-01T00:00:00.000Z');
  }
  protectedId=randomUUID();series(protectedId,'The Godfather’s Caged Bird',creator,1);assignment(protectedId,'DreamShortDrama');episode('protected-long',protectedId,1,undefined,240);episode('protected-second',protectedId,2);
  run('INSERT INTO series_cover_layouts (series_id,aspect_ratio) VALUES (?,?)',protectedId,'9:16');run('INSERT INTO series_classifications (series_id,themes,format) VALUES (?,?,?)',protectedId,'["revenge"]','live-action');
  for(const table of ['purchases','test_purchases'])run(`INSERT INTO ${table} (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)`,randomUUID(),viewer.id,'protected-long',100_000,70_000,30_000);
  for(const table of ['ledger','test_ledger'])run(`INSERT INTO ${table} (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)`,randomUUID(),viewer.id,'unlock',-100_000,'protected-long','Retained original receipt');
  run('INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider,status) VALUES (?,?,?,?,?,?,?)','retained-payment',viewer.id,'funding',5000,'usd','stripe','paid');run('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)',viewer.id,9_000_000,2_000_000,1);
  run('INSERT INTO series_moderation_events (id,series_id,actor_id,action,reason,snapshot_json) VALUES (?,?,?,?,?,?)','retained-moderation-audit',protectedId,administrator.id,'metadata','A previous authenticated metadata correction.','{"retained":true}');
  otherId=randomUUID();series(otherId,'A real uploaded story with an accidental demo flag',identity('An independent real creator'),1);episode('unrelated-original',otherId,1);createApp();
}
const retire=()=>retireBuiltInCatalogue({environment:'production',appUrl:origin});
function dumpExceptRetirement(){const result:Record<string,unknown>={};for(const{name}of all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")){if(name==='series'||name==='retired_catalog_series'||name==='catalog_retirement_runs')continue;assert.match(name,/^[a-z_]+$/);result[name]=all('SELECT * FROM "'+name+'" ORDER BY rowid');}return result;}
function rows(){return all('SELECT * FROM series ORDER BY id');}
function assertOnlyRetirementFieldsChanged(before:ReturnType<typeof rows>,retired:string[]){const allowed=new Set(retired);for(const prior of before){const after=one('SELECT * FROM series WHERE id=?',prior.id)!;if(allowed.has(prior.id))assert.deepEqual({...after},{...prior,status:'archived',featured:0});else assert.deepEqual(after,prior);}}
async function request(route:string,actor?:Actor,status=200,body?:unknown,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,route+': '+JSON.stringify(data));return data;
}
before(async()=>{config.appUrl=origin;const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
beforeEach(()=>fixture());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('retirement applies only to the exact production application and never changes local, sandbox or lookalike origins',()=>{
  const before=dumpExceptRetirement(),seriesBefore=rows();for(const input of [{environment:'development',appUrl:origin},{environment:'sandbox',appUrl:origin},{environment:'production',appUrl:'https://lingying.jimmy-tsoi2001.workers.dev'},{environment:'production',appUrl:'https://lingyingdrama.com.attacker.test'},{environment:'production',appUrl:'http://lingyingdrama.com'}])assert.equal(retireBuiltInCatalogue(input).status,'not_applicable');assert.deepEqual(dumpExceptRetirement(),before);assert.deepEqual(rows(),seriesBefore);assert.equal(one('SELECT COUNT(*) AS n FROM retired_catalog_series')!.n,0);
});

test('retirement archives exactly the twenty built-in seeds and preserves all original media, money, accounts, audits and viewing history',()=>{
  const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'applied');assert.equal(receipt.operation,CATALOG_RETIREMENT_OPERATION);assert.deepEqual(new Set(receipt.retired_ids),new Set(seedIds));assert.equal(receipt.retired_ids.length,20);assert.ok(receipt.protected_summary.anchor_count>=1);assert.ok(receipt.protected_summary.episode_count>=2);assert.deepEqual(receipt.after_hashes,receipt.before_hashes);
  assert.deepEqual(dumpExceptRetirement(),before);assertOnlyRetirementFieldsChanged(seriesBefore,receipt.retired_ids);assert.deepEqual(new Set(all('SELECT series_id FROM retired_catalog_series').map(row=>row.series_id)),new Set(seedIds));assert.equal(one('SELECT COUNT(*) AS n FROM series_deletions')!.n,0);assert.equal(one('SELECT COUNT(*) AS n FROM series_media_deletions')!.n,0);
});

test('a real drama marked demo and its full private-media references are never mistaken for a built-in example',()=>{
  const protectedBefore=one('SELECT * FROM series WHERE id=?',protectedId),otherBefore=one('SELECT * FROM series WHERE id=?',otherId),episodesBefore=all('SELECT * FROM episodes WHERE series_id IN (?,?) ORDER BY id',protectedId,otherId);const receipt=retire();assert.equal(receipt.status,'applied');assert.deepEqual(one('SELECT * FROM series WHERE id=?',protectedId),protectedBefore);assert.deepEqual(one('SELECT * FROM series WHERE id=?',otherId),otherBefore);assert.deepEqual(all('SELECT * FROM episodes WHERE series_id IN (?,?) ORDER BY id',protectedId,otherId),episodesBefore);assert.equal(one('SELECT 1 FROM retired_catalog_series WHERE series_id IN (?,?)',protectedId,otherId),undefined);
});

test('the requested title and creator must coexist as a protected anchor before any seed can retire',()=>{
  run('UPDATE series SET title=? WHERE id=?','A different original upload',protectedId);const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'blocked');assert.equal(receipt.retired_ids.length,0);assert.deepEqual(rows(),seriesBefore);assert.deepEqual(dumpExceptRetirement(),before);assert.equal(one('SELECT COUNT(*) AS n FROM retired_catalog_series')!.n,0);const audit=all('SELECT * FROM catalog_retirement_runs ORDER BY rowid');assert.equal(audit.length,1);assert.equal(audit[0].actor_type,'SYSTEM');assert.equal(audit[0].actor_id,null);assert.equal(retire().status,'blocked');assert.deepEqual(all('SELECT * FROM catalog_retirement_runs ORDER BY rowid'),audit);
});

test('ASCII and typographic apostrophe variants identify the protected title without requiring a personal login account',()=>{
  for(const title of ["The Godfather's Caged Bird",'The Godfather’s Caged Bird','The Godfatherʼs Caged Bird','The Godfather＇s Caged Bird','  THE  GODFATHER’S   CAGED BIRD  ']){fixture();run('UPDATE series SET title=? WHERE id=?',title,protectedId);const before=dumpExceptRetirement(),receipt=retire();assert.equal(receipt.status,'applied',title);assert.ok(receipt.protected_summary.anchor_count>=1,title);assert.equal(one('SELECT status FROM series WHERE id=?',protectedId)!.status,'published');assert.deepEqual(dumpExceptRetirement(),before);}
});

test('title matches OR DreamShortDrama attribution independently protect a candidate even when other provenance looks like a seed',()=>{
  const titleMatch=seedIds[0],publisherMatch=seedIds[1];run('UPDATE series SET title=? WHERE id=?',"The Godfather's Caged Bird",titleMatch);assignment(publisherMatch,'DreamShortDrama');const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'applied');assert.equal(receipt.retired_ids.length,18);for(const id of [titleMatch,publisherMatch]){assert.equal(receipt.retired_ids.includes(id),false);assert.equal(one('SELECT status FROM series WHERE id=?',id)!.status,'published');assert.equal(one('SELECT 1 FROM retired_catalog_series WHERE series_id=?',id),undefined);}assert.deepEqual(dumpExceptRetirement(),before);assertOnlyRetirementFieldsChanged(seriesBefore,receipt.retired_ids);
});

test('pinned production series and publisher identifiers remain protected after their display names change',()=>{
  const pinnedSeries='284bc1d4-7bf3-48f8-a97b-f45abfb3bb44',pinnedPublisher='publisher-887f66b6-6d6c-42b6-846f-2bbf175f7e5c';series(pinnedSeries,'A later renamed original drama',identity('A later renamed creator'));episode('pinned-original',pinnedSeries,1);assignment(seedIds[0],'A later renamed managed brand',pinnedPublisher);
  const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'applied');assert.equal(receipt.retired_ids.length,19);assert.equal(receipt.retired_ids.includes(seedIds[0]),false);assert.equal(receipt.protected_summary.series_count,3);assert.equal(receipt.protected_summary.episode_count,11);assert.deepEqual(receipt.before_hashes,receipt.after_hashes);assert.deepEqual(dumpExceptRetirement(),before);assertOnlyRetirementFieldsChanged(seriesBefore,receipt.retired_ids);
});

test('modified ownership, titles, cover references, demo flags or seed episode evidence is skipped without widening cleanup',()=>{
  const changed=seedIds.slice(0,9);run('UPDATE series SET creator_id=? WHERE id=?',creator.id,changed[0]);run('UPDATE series SET title=? WHERE id=?','A real story reusing an old catalogue ID',changed[1]);run('UPDATE series SET cover_key=? WHERE id=?','covers/real-upload.webp',changed[2]);run('UPDATE series SET demo=0 WHERE id=?',changed[3]);run('UPDATE episodes SET storage_key=? WHERE id=?','videos/private-original.mp4',changed[4]+'-1');run('UPDATE episodes SET duration=13 WHERE id=?',changed[5]+'-1');run('UPDATE episodes SET bytes=12345 WHERE id=?',changed[6]+'-1');run('UPDATE episodes SET title=? WHERE id=?','An actual original episode',changed[7]+'-1');episode('extra-original-episode',changed[8],9);
  const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'applied');assert.equal(receipt.retired_ids.length,11);for(const id of changed){assert.equal(receipt.retired_ids.includes(id),false,id);assert.ok(receipt.skipped.some((row:any)=>row.id===id),id+' must have a skip reason');}assert.deepEqual(dumpExceptRetirement(),before);assertOnlyRetirementFieldsChanged(seriesBefore,receipt.retired_ids);
});

test('live and test purchases each prevent retiring their seed while keeping every paid record and wallet untouched',()=>{
  const bought=[seedIds[0],seedIds[1]];for(const[table,id]of [['purchases',bought[0]],['test_purchases',bought[1]]]as const)run(`INSERT INTO ${table} (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)`,randomUUID(),viewer.id,id+'-1',100_000,70_000,30_000);
  const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.retired_ids.length,18);for(const id of bought)assert.equal(receipt.retired_ids.includes(id),false);assert.deepEqual(dumpExceptRetirement(),before);assertOnlyRetirementFieldsChanged(seriesBefore,receipt.retired_ids);
});

test('pending or cleaning chunk uploads protect their series and are neither cancelled nor released by retirement',()=>{
  const active=seedIds.slice(0,4);for(const[id,index]of active.map((id,index)=>[id,index]as const)){const now=Date.now();run('INSERT INTO episode_upload_sessions (id,series_id,actor_id,creator_id,object_key,episode_id,title,number,filename,total_bytes,status,cleanup_pending,created_at_ms,expires_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)','upload-'+index,id,administrator.id,catalog.id,'videos/pending-'+index+'.mp4','pending-'+index,'Original pending episode',9,'pending.mp4',1_000_000,['creating','uploading','completing','cancelled'][index],index===3?1:0,now,now+60_000);}
  const before=dumpExceptRetirement(),receipt=retire();assert.equal(receipt.retired_ids.length,16);for(const id of active)assert.equal(receipt.retired_ids.includes(id),false);assert.deepEqual(dumpExceptRetirement(),before);
});

test('missing or already deleted seed records are skipped and no replacement series or account is fabricated',()=>{
  const missing=seedIds[0],deleted=seedIds[1];for(const table of ['playback_sessions','progress'])run(`DELETE FROM ${table} WHERE episode_id IN (SELECT id FROM episodes WHERE series_id=?)`,missing);run('DELETE FROM saves WHERE series_id=?',missing);run('DELETE FROM episodes WHERE series_id=?',missing);run('DELETE FROM series WHERE id=?',missing);run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',deleted,catalog.id,administrator.id,'{"retained":true}');const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'applied');assert.equal(receipt.retired_ids.length,18);assert.equal(one('SELECT * FROM series WHERE id=?',missing),undefined);assert.deepEqual(dumpExceptRetirement(),before);assertOnlyRetirementFieldsChanged(seriesBefore,receipt.retired_ids);
});

test('one SYSTEM operation is audited once and remains idempotent across schema and application restarts',()=>{
  const first=retire(),before=dumpExceptRetirement(),seriesBefore=rows(),marks=all('SELECT * FROM retired_catalog_series ORDER BY series_id'),audit=all('SELECT * FROM catalog_retirement_runs ORDER BY rowid');assert.equal(audit.length,1);assert.equal(audit[0].operation_key,CATALOG_RETIREMENT_OPERATION);assert.equal(audit[0].status,'applied');assert.equal(audit[0].actor_type,'SYSTEM');assert.equal(audit[0].actor_id,null);assert.deepEqual(JSON.parse(audit[0].receipt_json).retired_ids,first.retired_ids);
  db.exec(DATABASE_SCHEMA);createApp();assert.equal(retire().status,'already_applied');assert.equal(retire().status,'already_applied');assert.deepEqual(rows(),seriesBefore);assert.deepEqual(dumpExceptRetirement(),before);assert.deepEqual(all('SELECT * FROM retired_catalog_series ORDER BY series_id'),marks);assert.deepEqual(all('SELECT * FROM catalog_retirement_runs ORDER BY rowid'),audit);
});

test('a preservation mismatch rolls back all retirement markers, statuses and unintended financial or protected-media changes',()=>{
  for(const target of ['wallet','protected_media']){fixture();const statement=target==='wallet'?`UPDATE users SET wallet_micros=wallet_micros-1 WHERE id='${viewer.id}';`:"UPDATE episodes SET storage_key='videos/unexpected-mutation.mp4' WHERE id='protected-long';";db.exec(`CREATE TRIGGER retirement_regression_trigger AFTER UPDATE OF status ON series WHEN NEW.id='after-midnight' BEGIN ${statement} END`);
    try{const before=dumpExceptRetirement(),seriesBefore=rows(),receipt=retire();assert.equal(receipt.status,'blocked');assert.equal(receipt.reason,'preservation_mismatch');assert.equal(receipt.retired_ids.length,0);assert.deepEqual(rows(),seriesBefore);assert.deepEqual(dumpExceptRetirement(),before);assert.equal(one('SELECT COUNT(*) AS n FROM retired_catalog_series')!.n,0);}finally{db.exec('DROP TRIGGER retirement_regression_trigger');}
  }
});

test('retired marker excludes examples from public, administrator, Studio and history views even if status is later reset',async()=>{
  retire();run("UPDATE series SET status='published' WHERE id=?",seedIds[0]);const publicRows=(await request('/api/series')).series;assert.ok(publicRows.some((row:any)=>row.id===protectedId));assert.ok(publicRows.some((row:any)=>row.id===otherId));assert.equal(publicRows.some((row:any)=>seedIds.includes(row.id)),false);
  assert.equal((await request('/api/admin/series?limit=50',administrator)).series.some((row:any)=>seedIds.includes(row.id)),false);assert.equal((await request('/api/studio',catalog)).series.length,0);assert.equal((await request('/api/history',viewer)).history.some((row:any)=>seedIds.includes(row.id)),false);
  for(const actor of [undefined,administrator,catalog,viewer]){await request('/api/series/'+seedIds[0],actor,404);await request('/api/series/'+seedIds[0]+'/cover',actor,404);await request('/api/episodes/'+seedIds[0]+'-1/stream',actor,404);}
  await request('/api/studio/series/'+seedIds[0],catalog,404);await request('/api/studio/series/'+seedIds[0],administrator,404);await request('/api/admin/series/'+seedIds[0]+'/moderation',administrator,404);await request('/api/studio/series/'+seedIds[0]+'/status',administrator,404,{status:'published'});const retained=await request('/api/series/'+protectedId);assert.equal(retained.series.title,'The Godfather’s Caged Bird');assert.equal(retained.series.creator_name,'DreamShortDrama');assert.equal(retained.episodes.length,2);
});
