import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-publisher-profiles-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {setSeriesModeration}=await import('../server/moderation');
const {writeEpisodeDuration}=await import('../server/episode-duration');
const origin='https://publisher-profiles.example.test';
const profileAdmin='/api/admin/publishers';
const details={title:'Original publisher series',description:'An original short drama used to test public publisher identities.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
interface Actor {id:string;cookie:string;email:string}
let server:Server,base:string,officialOwner:Actor,ordinary:Actor,viewer:Actor,other:Actor;
function identity(role='publisher',createdAt='2020-04-05 06:07:08'):Actor{
  const id=randomUUID(),email='private-'+id+'@profile.test',token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros,used_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,email,'Private account '+id,'!private-fixture-hash',role,role==='viewer'?0:1,777000,444000,1234,createdAt);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
  return{id,email,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,actor?:Actor,status:number|number[]=200,method=body===undefined?'GET':'POST',headers:Record<string,string>={}){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),method+' '+route+': '+response.status+' '+JSON.stringify(data));return{response,status:response.status,data};
}
const publicPath=(id:string)=>'/api/publishers/'+encodeURIComponent(id);
async function createProfile(actor:Actor,input:Record<string,unknown>={}){return(await request(profileAdmin,{display_name:'Public studio '+randomUUID(),registered_at:'2001-02-03',...input},actor,201)).data.publisher;}
async function createSeries(actor:Actor,input:Record<string,unknown>={}){const created=await request('/api/studio/series',{...details,title:'Source series '+randomUUID(),...input},actor,201);return created.data.id as string;}
function legacySeries(actor:Actor,title='Legacy series '+randomUUID()){
  const id=randomUUID();run("INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,status,cover_key,price_cents,free_episodes) VALUES (?,?,?,?,?,?,?,'published','public:/images/midnight.jpg',10,1)",id,actor.id,title,details.description,'en','["drama"]','human');return id;
}
function publish(id:string,status='published',views=0){run("UPDATE series SET status=?,views=?,cover_key='public:/images/midnight.jpg' WHERE id=?",status,views,id);}
function episode(seriesId:string,number:number,duration=30){
  const id=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',id,seriesId,'Episode '+number,number,Math.min(duration,180),64,'private/'+id+'.mp4','private-export.mp4');
  writeEpisodeDuration(id,duration);return id;
}
function playback(episodeId:string,watchedMs:number){
  const id=randomUUID(),now=Date.now();run('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,watched_ms,reported_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,?,?,?,?)',id,episodeId,createHash('sha256').update(id).digest('hex'),now-watchedMs,now,Math.min(watchedMs,180000),Math.min(watchedMs,180000),1,now);
  if(watchedMs>180000)run('INSERT INTO playback_session_times (session_id,watched_ms,reported_ms) VALUES (?,?,?)',id,Math.min(watchedMs,240000),Math.min(watchedMs,240000));
  if(watchedMs>240000)run('INSERT INTO playback_session_times_extended (session_id,watched_ms,reported_ms) VALUES (?,?,?)',id,watchedMs,watchedMs);return id;
}
function financial(){return{users:all('SELECT * FROM users ORDER BY id'),testAccounts:all('SELECT * FROM test_accounts ORDER BY user_id'),sessions:all('SELECT * FROM sessions ORDER BY token_hash'),payments:all('SELECT * FROM payments ORDER BY id'),testPayments:all('SELECT * FROM test_payments ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id')};}
function assertPublic(value:unknown){
  const forbidden=new Set(['creator_id','user_id','account_id','email','user_email','owner_email','password_hash','wallet_micros','earnings_micros','quota_bytes','used_bytes','stripe_account_id','actor_id','created_by','snapshot_json','provider_session','storage_key','original_name','cover_key','cover_bytes']);
  const walk=(current:unknown)=>{if(Array.isArray(current))return current.forEach(walk);if(current&&typeof current==='object')for(const[key,nested]of Object.entries(current)){assert.equal(forbidden.has(key),false,'Private field leaked: '+key);walk(nested);}};walk(value);
}
before(async()=>{
  officialOwner=identity('admin');ordinary=identity();viewer=identity('viewer');other=identity();config.appUrl=origin;config.platformOwnerUserId=officialOwner.id;config.officialCreatorName='LingYingDrama Offical';
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as any).port;
});
beforeEach(()=>{config.production=false;config.payments='disabled';config.stripeTestMode=false;config.appUrl=origin;config.platformOwnerUserId=officialOwner.id;});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('only an authenticated same-origin administrator can create or edit managed public publisher identities',async()=>{
  const admin=identity('admin'),body={display_name:'A safe public brand',registered_at:'2000-02-29'};
  await request(profileAdmin,body,undefined,[401,403]);await request(profileAdmin,undefined,ordinary,403);await request(profileAdmin,body,ordinary,403);await request(profileAdmin,body,viewer,403);
  await request(profileAdmin,body,admin,403,'POST',{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'});
  const profile=await createProfile(admin,body);await request(profileAdmin+'/'+profile.id,{...body,display_name:'Unauthorized edit'},ordinary,403,'PATCH');
  const fetched=(await request(publicPath(profile.id))).data;assert.equal(fetched.publisher.display_name,body.display_name);assertPublic(fetched);
});

test('managed profile creation and edits do not create fake login accounts or alter account dates, roles or money',async()=>{
  const admin=identity('admin'),before=financial(),profile=await createProfile(admin,{display_name:'Independent public identity',registered_at:'1999-01-02'});
  await request(profileAdmin+'/'+profile.id,{display_name:'Renamed public identity',registered_at:'2000-02-29'},admin,200,'PATCH');assert.deepEqual(financial(),before);
  const publicData=(await request(publicPath(profile.id))).data;assert.equal(publicData.publisher.id,profile.id);assert.equal(publicData.publisher.managed,true);assert.equal(publicData.publisher.is_official,false);assert.equal(publicData.publisher.registered_at,'2000-02-29');assertPublic(publicData);
});

test('registered dates require a genuine past calendar date and profile text has bounded fields',async()=>{
  const admin=identity('admin'),future=(new Date(Date.UTC(new Date().getUTCFullYear()+1,0,1))).toISOString().slice(0,10);
  for(const registered_at of ['1900-02-29','2025-02-30','2025-13-01','2025-2-01','1899-12-31',future,'not-a-date'])await request(profileAdmin,{display_name:'Invalid date fixture',registered_at},admin,400);
  for(const display_name of ['', ' ', 'x'.repeat(81)])await request(profileAdmin,{display_name,registered_at:'2001-01-01'},admin,400);
  const profile=await createProfile(admin,{display_name:'靈映 · 日本語',registered_at:'2000-02-29'});assert.equal(profile.registered_at,'2000-02-29');
});

test('normalized duplicate public brands are rejected atomically on creation and editing',async()=>{
  const admin=identity('admin'),suffix=randomUUID(),name='Studio '+suffix,profile=await createProfile(admin,{display_name:name}),second=await createProfile(admin),before=all('SELECT * FROM publisher_profiles ORDER BY id'),audit=all('SELECT * FROM publisher_profile_events ORDER BY id');
  for(const display_name of [name.toUpperCase(),'  '+name+'  ','Ｓｔｕｄｉｏ '+suffix]){
    const created=await request(profileAdmin,{display_name,registered_at:'2001-01-01'},admin,409);assert.equal(created.data.error.code,'PUBLISHER_NAME_EXISTS');
    const edited=await request(profileAdmin+'/'+second.id,{display_name},admin,409,'PATCH');assert.equal(edited.data.error.code,'PUBLISHER_NAME_EXISTS');
  }
  assert.deepEqual(all('SELECT * FROM publisher_profiles ORDER BY id'),before);assert.deepEqual(all('SELECT * FROM publisher_profile_events ORDER BY id'),audit);
  await request(profileAdmin+'/'+profile.id,{display_name:name},admin,200,'PATCH');
});

test('profile payloads cannot forge account ownership, official status or audit identity',async()=>{
  const admin=identity('admin'),profile=await createProfile(admin),before=financial(),profiles=all('SELECT * FROM publisher_profiles ORDER BY id'),audit=all('SELECT * FROM publisher_profile_events ORDER BY id');
  for(const extra of [{id:'official'},{is_official:true},{legacy_owner_id:ordinary.id},{created_by:ordinary.id},{actor_id:ordinary.id},{role:'admin'}]){
    await request(profileAdmin,{display_name:'Forged profile',registered_at:'2001-01-01',...extra},admin,400);
    await request(profileAdmin+'/'+profile.id,{display_name:'Forged changed profile',...extra},admin,400,'PATCH');
  }
  assert.deepEqual(financial(),before);assert.deepEqual(all('SELECT * FROM publisher_profiles ORDER BY id'),profiles);assert.deepEqual(all('SELECT * FROM publisher_profile_events ORDER BY id'),audit);
});

test('ordinary uploaders and administrators editing another account cannot forge managed publisher assignment',async()=>{
  const admin=identity('admin'),profile=await createProfile(admin),id=await createSeries(ordinary),before=one('SELECT * FROM series WHERE id=?',id);
  for(const value of [profile.id,'official',null]){
    await request('/api/studio/series',{...details,publisher_profile_id:value},ordinary,403);
    await request('/api/studio/series/'+id,{...details,publisher_profile_id:value},ordinary,403,'PATCH');
    await request('/api/studio/series/'+id,{...details,publisher_profile_id:value},admin,403,'PATCH');
  }
  assert.deepEqual(one('SELECT * FROM series WHERE id=?',id),before);
});

test('admin assignment changes public attribution while retaining the real creator, purchases, storage and financial owner',async()=>{
  const admin=identity('admin'),profile=await createProfile(admin),id=await createSeries(admin),episodeId=episode(id,1);publish(id);
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer.id,episodeId,100000,70000,30000);
  const before=financial();await request('/api/studio/series/'+id,{...details,title:one('SELECT title FROM series WHERE id=?',id)!.title,publisher_profile_id:profile.id},admin,200,'PATCH');
  assert.deepEqual(financial(),before);assert.equal(one('SELECT creator_id FROM series WHERE id=?',id)!.creator_id,admin.id);
  const privateData=(await request('/api/studio/series/'+id,undefined,admin)).data.series;assert.equal(privateData.creator_id,admin.id);assert.equal(privateData.publisher_profile_id,profile.id);
  const publicData=(await request('/api/series/'+id,undefined,viewer)).data;assert.equal(publicData.series.publisher.id,profile.id);assert.equal(publicData.series.creator_name,profile.display_name);assert.equal(publicData.episodes[0].unlocked,true);assertPublic(publicData);
  const managed=(await request('/api/admin/series',undefined,admin)).data.series.find((row:any)=>row.id===id);assert.equal(managed.creator_id,admin.id);assert.equal(managed.publisher_id,profile.id);
});

test('public publisher statistics include only eligible published series and actual five-minute watch totals',async()=>{
  const admin=identity('admin'),profile=await createProfile(admin),visible=await createSeries(admin,{publisher_profile_id:profile.id});publish(visible,'published',9);
  const long=episode(visible,1,300),short=episode(visible,2,30);playback(long,300000);playback(short,30000);
  run('INSERT INTO series_likes (user_id,series_id) VALUES (?,?)',viewer.id,visible);run('INSERT INTO series_likes (user_id,series_id) VALUES (?,?)',ordinary.id,visible);
  for(const status of ['draft','archived','takedown','deleted']){
    const hidden=await createSeries(admin,{publisher_profile_id:profile.id});publish(hidden,status==='draft'||status==='archived'?status:'published',1000);playback(episode(hidden,1),30000);run('INSERT INTO series_likes (user_id,series_id) VALUES (?,?)',viewer.id,hidden);
    if(status==='takedown')setSeriesModeration(admin.id,hidden,'takedown','An active rights review must not appear in public profiles.');
    if(status==='deleted')run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',hidden,admin.id,admin.id,'{}');
  }
  const another=await createSeries(admin);publish(another,'published',9999);playback(episode(another,1),30000);
  for(const actor of [undefined,admin,ordinary]){
    const data=(await request(publicPath(profile.id),undefined,actor)).data;
    assert.deepEqual(data.series.map((s:any)=>s.id),[visible]);assert.deepEqual(data.stats,{series_count:1,episode_count:2,views:9,tracked_views:2,likes:2,total_watch_seconds:330,avg_watch_seconds:165});assertPublic(data);
    assert.deepEqual(Object.keys(data.publisher).sort(),['display_name','id','is_official','managed','registered_at']);
  }
});

test('managed profile identifiers stay stable after edits and current publisher names are searchable',async()=>{
  const admin=identity('admin'),oldName='Old unique brand '+randomUUID(),newName='New unique brand '+randomUUID(),profile=await createProfile(admin,{display_name:oldName}),id=await createSeries(admin,{publisher_profile_id:profile.id});publish(id);episode(id,1);
  assert.ok((await request('/api/series?'+new URLSearchParams({q:oldName}))).data.series.some((s:any)=>s.id===id));
  await request(profileAdmin+'/'+profile.id,{display_name:newName,registered_at:'2002-03-04'},admin,200,'PATCH');
  const updated=(await request(publicPath(profile.id))).data;assert.equal(updated.publisher.id,profile.id);assert.equal(updated.publisher.display_name,newName);assert.equal(updated.publisher.registered_at,'2002-03-04');assert.equal(updated.series[0].creator_name,newName);
  assert.ok((await request('/api/series?'+new URLSearchParams({q:newName}))).data.series.some((s:any)=>s.id===id));assert.equal((await request('/api/series?'+new URLSearchParams({q:oldName}))).data.series.some((s:any)=>s.id===id),false);
});

test('ordinary publishers receive stable opaque public IDs and their actual registration date only when content is public',async()=>{
  const actor=identity('publisher','2020-04-05 06:07:08'),first=await createSeries(actor),second=await createSeries(actor);publish(first);publish(second);episode(first,1);episode(second,1);
  const a=(await request('/api/series/'+first)).data.series,b=(await request('/api/series/'+second)).data.series;assert.equal(a.publisher_id,b.publisher_id);assert.notEqual(a.publisher_id,actor.id);assert.equal(a.publisher.managed,false);assert.equal(a.publisher.registered_at,'2020-04-05');
  const page=(await request(publicPath(a.publisher_id))).data;assert.equal(page.stats.series_count,2);assert.deepEqual(new Set(page.series.map((s:any)=>s.id)),new Set([first,second]));assertPublic(page);
  publish(first,'archived');publish(second,'draft');await request(publicPath(a.publisher_id),undefined,undefined,404);
});

test('new administrator uploads default to Official while legacy non-owner uploads keep their derived identity',async()=>{
  const admin=identity('admin'),newId=await createSeries(admin),legacyId=legacySeries(admin),ownerLegacy=legacySeries(officialOwner);publish(newId);episode(newId,1);episode(legacyId,1);episode(ownerLegacy,1);
  const current=(await request('/api/series/'+newId)).data.series,legacy=(await request('/api/series/'+legacyId)).data.series,owned=(await request('/api/series/'+ownerLegacy)).data.series;
  assert.equal(current.publisher_id,'official');assert.equal(owned.publisher_id,'official');assert.equal(current.publisher.is_official,true);assert.notEqual(legacy.publisher_id,'official');assert.equal(legacy.publisher.managed,false);
  await request('/api/studio/series/'+legacyId,{...details,title:'Legacy metadata edit'},admin,200,'PATCH');assert.equal((await request('/api/series/'+legacyId)).data.series.publisher_id,legacy.publisher_id);
});

test('official public name and date edits remain authoritative across additive initialization without creating an account',async()=>{
  const admin=identity('admin'),before=financial();await request(profileAdmin+'/official',{display_name:'Edited official studio',registered_at:'2003-04-05'},admin,200,'PATCH');
  db.exec(DATABASE_SCHEMA);createApp();createApp();const official=(await request(publicPath('official'))).data.publisher;
  assert.equal(official.id,'official');assert.equal(official.display_name,'Edited official studio');assert.equal(official.registered_at,'2003-04-05');assert.equal(official.is_official,true);assert.deepEqual(financial(),before);
});

test('public pagination and invalid publisher identifiers cannot expose private users or unbounded content',async()=>{
  const admin=identity('admin'),profile=await createProfile(admin),ids=[];
  for(let i=0;i<3;i++){const id=await createSeries(admin,{publisher_profile_id:profile.id});publish(id);episode(id,1);ids.push(id);}
  const found=[];for(let page=1;page<=3;page++){const result=(await request(publicPath(profile.id)+'?'+new URLSearchParams({page:String(page),page_size:'1'}))).data;assert.equal(result.series.length,1);assert.equal(result.pagination.total,3);assert.equal(result.pagination.total_pages,3);found.push(result.series[0].id);assertPublic(result);}
  assert.deepEqual(new Set(found),new Set(ids));
  for(const query of ['page=0','page=-1','page_size=51','page_size=1000000','page_size=0'])await request(publicPath(profile.id)+'?'+query,undefined,undefined,400);
  await request(publicPath('missing-profile'),undefined,undefined,404);await request(publicPath("' OR 1=1 --"),undefined,undefined,[400,404]);
});

test('profile creation, editing, assignment and clearing leave append-only authenticated audit records',async()=>{
  const admin=identity('admin'),profile=await createProfile(admin,{display_name:'Audited initial brand'}),initial=all('SELECT * FROM publisher_profile_events WHERE publisher_id=? ORDER BY rowid',profile.id);
  assert.equal(initial.length,1);assert.equal(initial[0].action,'create');assert.equal(initial[0].actor_id,admin.id);
  await request(profileAdmin+'/'+profile.id,{display_name:'Audited changed brand',registered_at:'2002-03-04'},admin,200,'PATCH');
  const id=await createSeries(admin,{publisher_profile_id:profile.id});publish(id);episode(id,1);
  await request('/api/studio/series/'+id,{...details,title:one('SELECT title FROM series WHERE id=?',id)!.title,publisher_profile_id:null},admin,200,'PATCH');
  const events=all('SELECT * FROM publisher_profile_events WHERE publisher_id=? OR series_id=? ORDER BY rowid',profile.id,id);
  for(const action of ['create','update','assign','clear'])assert.ok(events.some(event=>event.action===action),action+' must be audited');
  assert.ok(events.every(event=>event.actor_id===admin.id));assert.deepEqual(one('SELECT * FROM publisher_profile_events WHERE id=?',initial[0].id),initial[0]);
  assert.equal(one('SELECT * FROM series_publisher_profiles WHERE series_id=?',id),undefined);assert.equal(one('SELECT creator_id FROM series WHERE id=?',id)!.creator_id,admin.id);
  const publicData=(await request('/api/series/'+id)).data.series;assert.equal(publicData.publisher.managed,false);assert.notEqual(publicData.publisher_id,'official');assert.notEqual(publicData.publisher_id,profile.id);assertPublic(publicData);
});
