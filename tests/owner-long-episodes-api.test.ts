import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-owner-long-api-'));
Object.assign(process.env,{DATA_DIR:directory,NODE_ENV:'test',SEED_DEMO:'false',PAYMENTS_MODE:'disabled',STRIPE_TEST_MODE:'false',STRIPE_AUTO_CONFIGURE_WEBHOOK:'false',PLATFORM_OWNER_USER_ID:'',PLATFORM_ADMIN_EMAIL_SHA256:'',PUBLIC_APP_URL:''});
delete process.env.S3_BUCKET;
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const {episodeUploadStorage}=await import('../server/chunked-storage');
const {reservedEpisodeUploadBytes}=await import('../server/episode-upload-sessions');
const {episodeDurationSql}=await import('../server/episode-duration');
const {playbackTimeSql}=await import('../server/playback-times');
const {MAX_EPISODE_BYTES}=await import('../shared/config');
const origin='https://owner-long-episodes.example.test';
interface Actor{id:string;cookie:string}
let server:Server,base:string,owner:Actor,otherAdmin:Actor,publisher:Actor,viewer:Actor;
let ordinarySeries:string,retainedEpisode:string,longSeries:string,longEpisode:string,managedProfile:string;
let video301:Buffer,video7200:Buffer;
const details={description:'An original drama used by isolated owner-duration permission regressions.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:2};
function actor(role:'admin'|'publisher'|'viewer',email?:string):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users(id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES(?,?,?,?,?,?,?,?)',id,email||id+'@owner-long.test','Duration '+role,'!unused-local-fixture',role,role==='viewer'?0:1,12_000_000,7_000_000);
  run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+86400_000);
  return{id,cookie:'drama_session='+token};
}
function rawSeries(identity:Actor){const id=randomUUID();run('INSERT INTO series(id,creator_id,title,description,language,genres,status,cover_key,free_episodes) VALUES(?,?,?,?,?,?,?,?,?)',id,identity.id,'Owner duration '+id,details.description,'en','["drama"]','draft','public:/images/midnight.jpg',2);return id;}
const studio=(id:string)=>'/api/studio/series/'+id;
async function request(route:string,identity?:Actor,body?:unknown,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(identity?{Cookie:identity.cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
async function upload(id:string,identity:Actor|undefined,bytes:Buffer,number=1,status=201,extra:Record<string,string>={}){
  const body=new FormData();body.append('title','Long episode '+number);body.append('number',String(number));
  for(const[key,value]of Object.entries(extra))body.append(key,value);
  body.append('video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}),'episode-'+number+'.mp4');
  const response=await fetch(base+studio(id)+'/episodes',{method:'POST',headers:{Origin:origin,...(identity?{Cookie:identity.cookie}:{})},body});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
function money(){
  const snapshot:Record<string,unknown>={users:all('SELECT id,role,publisher_active,quota_bytes,wallet_micros,earnings_micros FROM users ORDER BY id')};
  for(const table of ['test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','withdrawals','withdrawal_terms','creator_pass_consents'])snapshot[table]=all('SELECT * FROM '+table+' ORDER BY rowid');
  return snapshot;
}
const used=(identity:Actor)=>Number(one('SELECT used_bytes FROM users WHERE id=?',identity.id)!.used_bytes);
const count=(id:string)=>Number(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',id)!.n);

before(async()=>{
  config.appUrl=origin;config.mailProvider='disabled';
  owner=actor('admin','jimmy.tsoi2001@gmail.com');otherAdmin=actor('admin');publisher=actor('publisher');viewer=actor('viewer');config.platformOwnerUserId=owner.id;
  ordinarySeries=rawSeries(publisher);retainedEpisode=randomUUID();
  run('INSERT INTO episodes(id,series_id,title,number,duration,bytes,storage_key) VALUES(?,?,?,?,?,?,?)',retainedEpisode,ordinarySeries,'Retained thirty-second episode',1,30,1,'retained/private-video.mp4');
  for(const table of ['purchases','test_purchases'])run('INSERT INTO '+table+'(id,user_id,episode_id,price_micros,creator_micros,platform_micros,created_at) VALUES(?,?,?,?,?,?,?)',table+'-retained',viewer.id,retainedEpisode,100_000,70_000,30_000,'2020-01-02 03:04:05');
  for(const table of ['ledger','test_ledger'])run('INSERT INTO '+table+'(id,user_id,kind,amount_micros,reference_id,description,created_at) VALUES(?,?,?,?,?,?,?)',table+'-retained',viewer.id,'unlock',-100_000,table.replace('ledger','purchases')+'-retained','Original retained purchase','2020-01-02 03:04:05');
  for(const seconds of [301,7200]){
    const file=path.join(directory,'source-'+seconds+'.mp4');
    await promisify(execFile)(config.ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=navy:s=16x16:r=1','-t',String(seconds),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',file],{timeout:60_000,maxBuffer:1024*1024});
    if(seconds===301)video301=await readFile(file);else video7200=await readFile(file);
  }
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(()=>{config.platformOwnerUserId=owner.id;config.platformAdminEmailHash='';config.stripeTestMode=false;config.production=false;config.sandbox=false;config.payments='disabled';});
afterEach(()=>{mock.restoreAll();run("UPDATE users SET role='admin' WHERE id=?",owner.id);config.platformOwnerUserId=owner.id;});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('the pinned owner can publish episodes beyond five and sixty minutes under multiple managed publisher profiles without changing money',async()=>{
  const health=await fetch(base+'/api/health');assert.equal(health.headers.get('x-lingying-upload-policy'),'owner-duration-v1');assert.deepEqual(await health.json(),{ok:true,database:true});
  const before=money();
  for(const[index,bytes,seconds]of [[0,video301,301],[1,video7200,7200]] as const){
    const profile=await request('/api/admin/publishers',owner,{display_name:'Long profile '+randomUUID(),registered_at:'2020-01-01'},201);const profileId=profile.publisher.id;
    const created=await request('/api/studio/series',owner,{...details,title:'Long managed drama '+randomUUID(),publisher_profile_id:profileId},201);
    const episode=await upload(created.id,owner,bytes);assert.equal(episode.duration,seconds);assert.ok(episode.bytes<=MAX_EPISODE_BYTES);assert.equal(episode.user.max_episode_seconds,null);
    const privateData=await request(studio(created.id),owner);assert.equal(privateData.owner_upload_limits.maxEpisodeSeconds,null);assert.equal(privateData.owner_upload_limits.maxEpisodeBytes,MAX_EPISODE_BYTES);assert.equal(privateData.series.creator_id,owner.id);assert.equal(privateData.series.publisher_profile_id,profileId);assert.equal(privateData.episodes[0].duration,seconds);
    assert.equal(one('SELECT duration FROM episodes WHERE id=?',episode.id)!.duration,180);assert.equal(one(`SELECT ${episodeDurationSql()} AS duration FROM episodes e WHERE id=?`,episode.id)!.duration,seconds);
    run("UPDATE series SET cover_key='public:/images/midnight.jpg' WHERE id=?",created.id);await request(studio(created.id)+'/status',owner,{status:'published'});
    const detail=await request('/api/series/'+created.id);assert.equal(detail.episodes[0].duration,seconds);assert.equal(detail.series.publisher_id,profileId);
    if(index===1){longSeries=created.id;longEpisode=episode.id;managedProfile=profileId;}
  }
  assert.deepEqual(money(),before);
});

test('other administrators and publishers retain five minutes even with an owner profile name or claimed request limits',async()=>{
  const otherSeries=await request('/api/studio/series',otherAdmin,{...details,title:'Other administrator drama '+randomUUID(),publisher_profile_id:managedProfile},201);
  const regular=rawSeries(publisher),before=money(),ownerUsed=used(owner),publisherUsed=used(publisher),otherUsed=used(otherAdmin);
  for(const[id,identity]of [[otherSeries.id,otherAdmin],[regular,publisher],[regular,owner]] as const){
    const result=await upload(id,identity,video301,1,422,{max_episode_seconds:'null',creator_id:owner.id,publisher_profile_id:managedProfile});assert.equal(result.error.code,'VIDEO_TOO_LONG');assert.equal(count(id),0);
  }
  assert.equal(used(owner),ownerUsed);assert.equal(used(publisher),publisherUsed);assert.equal(used(otherAdmin),otherUsed);assert.deepEqual(money(),before);assert.deepEqual(await readdir(path.join(directory,'tmp')),[]);
});

test('private upload limits follow the persisted series owner and a missing configured owner fails closed',async()=>{
  assert.equal((await request('/api/auth/me',owner)).user.max_episode_seconds,null);assert.equal((await request('/api/auth/me',otherAdmin)).user.max_episode_seconds,300);
  const edited=await request(studio(ordinarySeries),owner);assert.equal(edited.owner_upload_limits.maxEpisodeSeconds,300);assert.equal(edited.series.creator_id,publisher.id);
  config.platformOwnerUserId='';
  try{
    assert.equal((await request('/api/auth/me',owner)).user.max_episode_seconds,300);assert.equal((await request(studio(longSeries),owner)).owner_upload_limits.maxEpisodeSeconds,300);
    const target=rawSeries(owner),result=await upload(target,owner,video301,1,422);assert.equal(result.error.code,'VIDEO_TOO_LONG');assert.equal(count(target),0);
    assert.equal((await request('/api/series/'+longSeries)).episodes[0].duration,7200,'Previously accepted long media remains readable.');
  }finally{config.platformOwnerUserId=owner.id;}
});

test('unlimited duration never bypasses authentication, ownership, invalid media, payment holds or the 200 MiB file policy',async()=>{
  const id=rawSeries(owner),before=money(),beforeUsed=used(owner);
  await upload(id,undefined,video301,1,401);await upload(id,publisher,video301,1,403);await upload(id,owner,Buffer.from('not a video'),1,422);
  const hold=randomUUID();run('INSERT INTO payment_risk_cases(id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES(?,?,?,?,?,?,?)',hold,'default',0,'dispute','owner-duration-hold-'+hold,owner.id,'open');
  try{await upload(id,owner,video301,1,423);}finally{run("UPDATE payment_risk_cases SET status='resolved' WHERE id=?",hold);}
  mock.method(episodeUploadStorage,'enabled',()=>true);const calls={created:0};mock.method(episodeUploadStorage,'create',async()=>{calls.created++;return'not-created';});
  const oversized=await request(studio(id)+'/episode-uploads',owner,{title:'Oversized episode',number:1,filename:'oversized.mp4',size:MAX_EPISODE_BYTES+1},413);assert.equal(oversized.error.code,'FILE_TOO_LARGE');assert.equal(calls.created,0);assert.equal(count(id),0);assert.equal(used(owner),beforeUsed);assert.deepEqual(money(),before);
});

test('a processed file over 200 MiB is rejected and its temporary output is removed before storage or quota changes',async()=>{
  const id=rawSeries(owner),before=money(),beforeUsed=used(owner),stat=fs.stat.bind(fs);let checked=false;
  mock.method(fs,'stat',async(...args:Parameters<typeof fs.stat>)=>{
    const result=await stat(...args);if(String(args[0]).startsWith(path.join(directory,'tmp')+path.sep)&&String(args[0]).endsWith('.mp4')){checked=true;Object.defineProperty(result,'size',{value:MAX_EPISODE_BYTES+1});}return result;
  });
  const result=await upload(id,owner,video301,1,413);assert.equal(result.error.code,'FILE_TOO_LARGE');assert.equal(checked,true);assert.equal(count(id),0);assert.equal(used(owner),beforeUsed);assert.deepEqual(await readdir(path.join(directory,'tmp')),[]);assert.deepEqual(money(),before);
});

test('revoking the owner role while a direct upload processes prevents committing the long episode',async()=>{
  const id=rawSeries(owner),before=money(),beforeUsed=used(owner),stat=fs.stat.bind(fs);let revoked=false;
  mock.method(fs,'stat',async(...args:Parameters<typeof fs.stat>)=>{
    const result=await stat(...args);if(!revoked&&String(args[0]).startsWith(path.join(directory,'tmp')+path.sep)&&String(args[0]).endsWith('.mp4')){revoked=true;run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",owner.id);}return result;
  });
  try{const result=await upload(id,owner,video301,1,422);assert.equal(result.error.code,'VIDEO_TOO_LONG');assert.equal(revoked,true);assert.equal(count(id),0);assert.equal(used(owner),beforeUsed);assert.deepEqual(await readdir(path.join(directory,'tmp')),[]);}
  finally{run("UPDATE users SET role='admin' WHERE id=?",owner.id);}
  assert.deepEqual(money(),before);
});

test('chunk completion uses owner policy, remains idempotent and rejects a role removed during validation',async()=>{
  const parts=new Map<string,Map<number,Buffer>>(),objects=new Map<string,Buffer>(),limits:Array<number|null|undefined>=[];
  let revoke=false;
  mock.method(episodeUploadStorage,'enabled',()=>true);mock.method(episodeUploadStorage,'create',async(key:string)=>{parts.set(key,new Map());return randomUUID();});
  mock.method(episodeUploadStorage,'part',async(key:string,_uploadId:string,number:number,bytes:Uint8Array)=>{const value=Buffer.from(bytes);parts.get(key)!.set(number,value);return{partNumber:number,etag:createHash('sha256').update(value).digest('hex')};});
  mock.method(episodeUploadStorage,'complete',async(key:string)=>{objects.set(key,Buffer.concat([...parts.get(key)!.values()]));});mock.method(episodeUploadStorage,'head',async(key:string)=>objects.has(key)?{size:objects.get(key)!.length}:null);
  mock.method(episodeUploadStorage,'validate',async(key:string,maxSeconds?:number|null)=>{limits.push(maxSeconds);if(revoke)run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",owner.id);return{bytes:objects.get(key)!.length,duration:601};});
  mock.method(episodeUploadStorage,'abort',async()=>{});mock.method(episodeUploadStorage,'remove',async(key:string)=>{objects.delete(key);});
  async function staged(id:string,identity:Actor){const route=studio(id)+'/episode-uploads',session=await request(route,identity,{title:'Chunked episode',number:1,filename:'chunked.mp4',size:17},201);const response=await fetch(base+route+'/'+session.id+'/parts/1',{method:'PUT',headers:{Cookie:identity.cookie,'Content-Type':'application/octet-stream',Origin:origin},body:new Uint8Array(17)});assert.equal(response.status,200);await response.body?.cancel();return{route:route+'/'+session.id,session};}
  const own=rawSeries(owner),foreign=rawSeries(publisher),race=rawSeries(owner),before=money(),beforeUsed=used(owner),first=await staged(own,owner);
  const accepted=await request(first.route+'/complete',owner,{},201);assert.equal(accepted.duration,601);assert.equal(limits.at(-1),null);assert.equal(used(owner),beforeUsed+17);
  const replay=await request(first.route+'/complete',owner,{});assert.equal(replay.id,accepted.id);assert.equal(used(owner),beforeUsed+17);assert.equal(count(own),1);
  const ordinary=await staged(foreign,owner),rejected=await request(ordinary.route+'/complete',owner,{},422);assert.equal(rejected.error.code,'VIDEO_TOO_LONG');assert.equal(limits.at(-1),300);assert.equal(count(foreign),0);assert.equal(reservedEpisodeUploadBytes(publisher.id),0);
  const pending=await staged(race,owner);revoke=true;
  try{const result=await request(pending.route+'/complete',owner,{},422);assert.equal(result.error.code,'VIDEO_TOO_LONG');assert.equal(limits.at(-1),null);assert.equal(count(race),0);assert.equal(used(owner),beforeUsed+17);assert.equal(reservedEpisodeUploadBytes(owner.id),0);}
  finally{run("UPDATE users SET role='admin' WHERE id=?",owner.id);}
  assert.deepEqual(money(),before);
});

test('ordinary viewers save progress and measured watch time beyond five minutes while shorter episodes keep their bounds',async()=>{
  const before=money();let now=Date.now();mock.method(Date,'now',()=>now);
  const started=await request('/api/episodes/'+longEpisode+'/playback',viewer,{}),route='/api/playback/'+started.sessionId;
  for(let watchedMs=15_000;watchedMs<=630_000;watchedMs+=15_000){now+=15_000;const receipt=await request(route,viewer,{watchedMs},200,'PUT');assert.equal(receipt.watchedMs,watchedMs);}
  assert.equal(one(`SELECT ${playbackTimeSql()} AS watched FROM playback_sessions p WHERE id=?`,started.sessionId)!.watched,630_000);
  await request('/api/episodes/'+longEpisode+'/progress',viewer,{seconds:601.25});assert.equal(one('SELECT seconds FROM progress WHERE user_id=? AND episode_id=?',viewer.id,longEpisode)!.seconds,601.25);
  await request('/api/episodes/'+longEpisode+'/progress',viewer,{seconds:7200});await request('/api/episodes/'+longEpisode+'/progress',viewer,{seconds:7200.001},400);
  assert.equal(one('SELECT seconds FROM progress WHERE user_id=? AND episode_id=?',viewer.id,longEpisode)!.seconds,7200);
  const history=await request('/api/history',viewer);assert.equal(history.history.find((item:any)=>item.episode_id===longEpisode).duration,7200);
  run("UPDATE series SET status='published' WHERE id=?",ordinarySeries);const normal=await request('/api/episodes/'+retainedEpisode+'/playback',viewer,{});now+=15_000;
  await request('/api/playback/'+normal.sessionId,viewer,{watchedMs:300001},400,'PUT');await request('/api/episodes/'+retainedEpisode+'/progress',viewer,{seconds:300.001},400);
  assert.deepEqual(money(),before);
});
