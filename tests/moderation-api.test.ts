import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-moderation-api-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';
process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';
delete process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_WEBHOOK_SECRET;
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
let server:Server,base:string,video:Buffer,cover:Buffer;
const administrator='api-content-admin',viewer='api-content-viewer',other='api-content-other';
const cookies=new Map<string,string>();
const details={title:'An original moderation test',description:'An original short drama used only for local moderation tests.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:0};

function account(id:string,role='viewer',active=0){
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros) VALUES (?,?,?,?,?,?,?)',id,id+'@example.invalid',id,'unused-local-test-password',role,active,10_000_000);
  const token=randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+60_000);
  cookies.set(id,'drama_session='+token);return id;
}
async function request(route:string,body?:unknown,actor?:string,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:cookies.get(actor)!}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:response.status,data:await response.json()};
}
async function bytes(route:string,actor?:string){
  const response=await fetch(base+route,{headers:{...(actor?{Cookie:cookies.get(actor)!}:{}),Range:'bytes=0-15'}});
  return{status:response.status,body:Buffer.from(await response.arrayBuffer()),cache:response.headers.get('cache-control')};
}
async function upload(route:string,file:Buffer,name:string,actor:string,fields:Record<string,string>={},field='video'){
  const body=new FormData();for(const[k,v]of Object.entries(fields))body.append(k,v);body.append(field,new Blob([new Uint8Array(file)]),name);
  const response=await fetch(base+route,{method:'POST',headers:{Cookie:cookies.get(actor)!},body});
  return{status:response.status,data:await response.json()};
}
function fixture(status='published'){
  const owner=account('creator-'+randomUUID(),'publisher',1),id=randomUUID(),episode=randomUUID();
  run('INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status,cover_key,cover_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,owner,details.title,details.description,'en','["drama"]',10,0,status,'moderation/cover.jpg',cover.length);
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'A privately owned episode',1,1,video.length,'moderation/episode.mp4');
  run('UPDATE users SET used_bytes=? WHERE id=?',cover.length+video.length,owner);
  return{id,episode,owner};
}
function moneySnapshot(){return{users:all('SELECT id,publisher_active,wallet_micros,earnings_micros FROM users ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id'),payments:all('SELECT * FROM payments ORDER BY id'),testPayments:all('SELECT * FROM test_payments ORDER BY id')};}
before(async()=>{
  await mkdir(path.join(dir,'objects','moderation'),{recursive:true});
  const file=path.join(dir,'objects','moderation','episode.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=32x32:r=1','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-y',file]);
  video=await readFile(file);cover=await readFile(path.resolve('public/images/midnight.jpg'));
  await copyFile(path.resolve('public/images/midnight.jpg'),path.join(dir,'objects','moderation','cover.jpg'));
  account(administrator,'admin');account(viewer);account(other);
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('content administration requires an administrator and leaves paid Pass ownership unchanged',async()=>{
  const drama=fixture();
  for(const actor of [undefined,viewer,drama.owner]){
    assert.equal((await request('/api/admin/series',undefined,actor)).status,403);
    assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,undefined,actor)).status,403);
    assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,{action:'takedown',reason:'A reported rights complaint needs investigation.'},actor)).status,403);
    assert.equal((await bytes(`/api/admin/episodes/${drama.episode}/stream`,actor)).status,403);
  }
  const before=moneySnapshot();
  const created=await request('/api/studio/series',{...details,title:'Administrator original '+randomUUID()},administrator);assert.equal(created.status,201,JSON.stringify(created.data));
  const me=await request('/api/auth/me',undefined,administrator);assert.equal(me.data.user.publisher_active,0);assert.equal(me.data.user.dramio_pass.active,false);
  assert.deepEqual(moneySnapshot(),before);
  const list=await request('/api/admin/series?limit=1&page=1',undefined,administrator);assert.equal(list.status,200);assert.equal(list.data.series.length,1);assert.equal(list.data.limit,1);assert.ok(list.data.total>=2);
  assert.equal((await request('/api/admin/series?limit=51',undefined,administrator)).status,400);
});

test('takedown blocks discovery, public media and all paid-viewer mutations without changing balances or purchases',async()=>{
  const drama=fixture();
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer,drama.episode,100_000,70_000,30_000);
  run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer,drama.episode,0.5);
  await request(`/api/series/${drama.id}/save`,{},viewer);await request(`/api/series/${drama.id}/like`,{liked:true},viewer,'PUT');
  const started=await request(`/api/episodes/${drama.episode}/playback`,{},viewer);assert.equal(started.status,200);const playback=started.data.sessionId;
  assert.equal((await bytes(`/api/episodes/${drama.episode}/stream`,viewer)).status,206);
  const before=moneySnapshot(),episodeBefore=one('SELECT * FROM episodes WHERE id=?',drama.episode),seriesBefore=one('SELECT * FROM series WHERE id=?',drama.id),progressBefore=one('SELECT * FROM progress WHERE user_id=? AND episode_id=?',viewer,drama.episode),playbackBefore=one('SELECT * FROM playback_sessions WHERE id=?',playback);
  const action=await request(`/api/admin/series/${drama.id}/moderation`,{action:'takedown',reason:'A licence complaint requires investigation before playback.'},administrator);assert.equal(action.status,200,JSON.stringify(action.data));
  for(const actor of [undefined,viewer,drama.owner,administrator]){
    const catalogue=await request('/api/series',undefined,actor);assert.ok(!catalogue.data.series.some((row:any)=>row.id===drama.id));
    assert.equal((await request(`/api/series/${drama.id}`,undefined,actor)).status,404);
    assert.equal((await bytes(`/api/series/${drama.id}/cover`,actor)).status,404);
    assert.equal((await bytes(`/api/episodes/${drama.episode}/stream`,actor)).status,404);
    assert.equal((await request(`/api/episodes/${drama.episode}/playback`,{},actor)).status,404);
  }
  for(const actor of [viewer,other,drama.owner,administrator]){
    assert.equal((await request(`/api/episodes/${drama.episode}/unlock`,{},actor)).status,404);
    assert.equal((await request(`/api/episodes/${drama.episode}/progress`,{seconds:1},actor)).status,404);
    assert.equal((await request(`/api/series/${drama.id}/save`,{},actor)).status,404);
    assert.equal((await request(`/api/series/${drama.id}/like`,{liked:true},actor,'PUT')).status,404);
  }
  assert.equal((await request(`/api/playback/${playback}`,{watchedMs:1000},viewer,'PUT')).status,404);
  assert.ok(!(await request('/api/history',undefined,viewer)).data.history.some((row:any)=>row.id===drama.id));
  assert.ok(!(await request('/api/series?saved=true',undefined,viewer)).data.series.some((row:any)=>row.id===drama.id));
  assert.deepEqual(moneySnapshot(),before);assert.deepEqual(one('SELECT * FROM episodes WHERE id=?',drama.episode),episodeBefore);assert.deepEqual(one('SELECT * FROM series WHERE id=?',drama.id),seriesBefore);assert.deepEqual(one('SELECT * FROM progress WHERE user_id=? AND episode_id=?',viewer,drama.episode),progressBefore);assert.deepEqual(one('SELECT * FROM playback_sessions WHERE id=?',playback),playbackBefore);
});

test('offline editor and admin preview are private, audited metadata fixes retain the takedown until explicit restoration',async()=>{
  const drama=fixture();
  await request(`/api/admin/series/${drama.id}/moderation`,{action:'takedown',reason:'The title and rights information require correction.'},administrator);
  for(const actor of [drama.owner,administrator]){
    const editor=await request(`/api/studio/series/${drama.id}`,undefined,actor);assert.equal(editor.status,200,JSON.stringify(editor.data));assert.equal(editor.data.series.taken_down,true);assert.equal(editor.data.episodes[0].id,drama.episode);assert.equal(editor.data.owner_storage.used_bytes,cover.length+video.length);
    assert.ok(!('storage_key'in editor.data.episodes[0]));assert.ok(!('cover_key'in editor.data.series));
    assert.equal((await bytes(`/api/studio/series/${drama.id}/cover`,actor)).status,206);
  }
  for(const actor of [undefined,viewer,other]){
    assert.ok([401,403].includes((await request(`/api/studio/series/${drama.id}`,undefined,actor)).status));
    assert.ok([401,403].includes((await bytes(`/api/studio/series/${drama.id}/cover`,actor)).status));
  }
  const before=moneySnapshot(),views=one('SELECT views FROM series WHERE id=?',drama.id)!.views,count=one('SELECT COUNT(*) AS n FROM playback_sessions')!.n;
  const preview=await bytes(`/api/admin/episodes/${drama.episode}/stream`,administrator);assert.equal(preview.status,206);assert.equal(preview.body.length,16);assert.match(preview.cache||'',/private/);assert.match(preview.cache||'',/no-store/);
  assert.deepEqual(moneySnapshot(),before);assert.equal(one('SELECT views FROM series WHERE id=?',drama.id)!.views,views);assert.equal(one('SELECT COUNT(*) AS n FROM playback_sessions')!.n,count);
  assert.equal((await request(`/api/studio/series/${drama.id}`,{...details,title:'A corrected title'},administrator,'PATCH')).status,200);
  const history=await request(`/api/admin/series/${drama.id}/moderation`,undefined,administrator);assert.equal(history.status,200);assert.ok(history.data.events.some((event:any)=>event.action==='metadata'&&event.actor_id===administrator));
  assert.equal((await request(`/api/studio/series/${drama.id}/status`,{status:'published'},administrator)).status,423);
  assert.equal((await request(`/api/series/${drama.id}`)).status,404);
  assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,{action:'restore',reason:'Verified distribution rights and corrected series details.'},administrator)).status,200);
  assert.equal((await request(`/api/series/${drama.id}`)).data.series.title,'A corrected title');
  assert.deepEqual(moneySnapshot(),before);
});

test('a creator cannot change content or republish a series under administrative takedown',async()=>{
  const drama=fixture();
  await request(`/api/admin/series/${drama.id}/moderation`,{action:'takedown',reason:'A reported content violation is awaiting review.'},administrator);
  assert.equal((await request(`/api/studio/series/${drama.id}`,{...details,title:'A prohibited change'},drama.owner,'PATCH')).status,423);
  assert.equal((await request(`/api/studio/episodes/${drama.episode}`,{title:'A prohibited episode title',number:1},drama.owner,'PATCH')).status,423);
  assert.equal((await request(`/api/studio/episodes/${drama.episode}`,undefined,drama.owner,'DELETE')).status,423);
  assert.equal((await upload(`/api/studio/series/${drama.id}/cover`,cover,'cover.jpg',drama.owner,{},'cover')).status,423);
  assert.equal((await upload(`/api/studio/series/${drama.id}/episodes`,video,'02.mp4',drama.owner,{title:'A prohibited episode',number:'2'})).status,423);
  for(const status of ['published','draft','archived'])assert.equal((await request(`/api/studio/series/${drama.id}/status`,{status},drama.owner)).status,423);
  assert.equal(one('SELECT title FROM series WHERE id=?',drama.id)!.title,details.title);assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',drama.id)!.n,1);
  const studio=await request('/api/studio',undefined,drama.owner);assert.equal(studio.data.series.find((row:any)=>row.id===drama.id).taken_down,true);
});

test('admin uploads meter the series owner storage and cannot evade owner quota or delete purchased episodes',async()=>{
  const drama=fixture();
  const adminBefore=one('SELECT used_bytes,quota_bytes FROM users WHERE id=?',administrator)!;
  run('UPDATE users SET quota_bytes=1 WHERE id=?',administrator);
  const coverBefore=one('SELECT cover_bytes FROM series WHERE id=?',drama.id)!.cover_bytes,usedBefore=one('SELECT used_bytes FROM users WHERE id=?',drama.owner)!.used_bytes;
  const changed=await upload(`/api/studio/series/${drama.id}/cover`,cover,'replacement.jpg',administrator,{},'cover');assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal(changed.data.user.id,administrator);
  const coverAfter=one('SELECT cover_bytes FROM series WHERE id=?',drama.id)!.cover_bytes;
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner)!.used_bytes,usedBefore-coverBefore+coverAfter);
  const uploaded=await upload(`/api/studio/series/${drama.id}/episodes`,video,'02.mp4',administrator,{title:'A corrected second episode',number:'2'});assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));assert.equal(uploaded.data.user.id,administrator);
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner)!.used_bytes,usedBefore-coverBefore+coverAfter+uploaded.data.bytes);
  assert.ok(one('SELECT storage_key FROM episodes WHERE id=?',uploaded.data.id)!.storage_key.startsWith(`videos/${drama.owner}/`));
  assert.equal(one('SELECT used_bytes FROM users WHERE id=?',administrator)!.used_bytes,adminBefore.used_bytes);
  run('UPDATE users SET quota_bytes=? WHERE id=?',adminBefore.quota_bytes,administrator);
  const used=one('SELECT used_bytes FROM users WHERE id=?',drama.owner)!.used_bytes;run('UPDATE users SET quota_bytes=? WHERE id=?',used,drama.owner);
  const rejected=await upload(`/api/studio/series/${drama.id}/episodes`,video,'03.mp4',administrator,{title:'Over owner quota',number:'3'});assert.equal(rejected.status,413);assert.equal(rejected.data.error.code,'QUOTA_EXCEEDED');assert.equal(one('SELECT used_bytes FROM users WHERE id=?',drama.owner)!.used_bytes,used);
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer,drama.episode,100_000,70_000,30_000);
  assert.equal((await request(`/api/studio/episodes/${drama.episode}`,undefined,administrator,'DELETE')).status,409);
  assert.ok(one('SELECT id FROM episodes WHERE id=?',drama.episode));assert.ok(one('SELECT id FROM purchases WHERE episode_id=?',drama.episode));
});

test('moderation validates reasons and repeated actions do not duplicate audit entries or publish a draft',async()=>{
  const drama=fixture('draft');
  assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,{action:'takedown',reason:'short'},administrator)).status,400);
  const body={action:'takedown',reason:'This draft requires review before it can be published.'};
  assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,body,administrator)).status,200);assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,body,administrator)).status,200);
  let events=await request(`/api/admin/series/${drama.id}/moderation`,undefined,administrator);assert.equal(events.data.events.length,1);
  const found=await request('/api/admin/series?status=taken_down',undefined,administrator);assert.ok(found.data.series.some((row:any)=>row.id===drama.id));
  assert.equal((await request(`/api/admin/series/${drama.id}/moderation`,{action:'restore',reason:'The draft content has been reviewed and may be edited.'},administrator)).status,200);
  assert.equal(one('SELECT status FROM series WHERE id=?',drama.id)!.status,'draft');assert.equal((await request(`/api/series/${drama.id}`)).status,404);
  events=await request(`/api/admin/series/${drama.id}/moderation`,undefined,administrator);assert.equal(events.data.events.length,2);
});
