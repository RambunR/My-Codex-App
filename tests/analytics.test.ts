import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-analytics-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='demo';process.env.STRIPE_TEST_MODE='false';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
let server:Server,base:string;
interface Identity{id:string;cookie:string}
let owner:Identity,otherPublisher:Identity,viewerA:Identity,viewerB:Identity;
const origin='https://analytics.example.test';
async function request(route:string,body?:unknown,cookie='',expected:number|number[]=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);
  return{data,status:response.status,cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
}
async function register(name:string):Promise<Identity>{
  const registered=await request('/api/auth/register',{name,email:name.replaceAll(' ','-').toLowerCase()+'@analytics.test',password:'AnalyticsPassword123!'},'',201);
  return{id:registered.data.user.id,cookie:registered.cookie};
}
function fixture({creator=owner.id,status='published',free=1,duration=60}:{creator?:string;status?:'published'|'draft';free?:number;duration?:number}={}){
  const seriesId=randomUUID(),episodeIds=[randomUUID(),randomUUID(),randomUUID()];
  run('INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status) VALUES (?,?,?,?,?,?,10,?,?)',seriesId,creator,'Measured drama','A series for privacy, playback and date-range statistics.','en','["drama"]',free,status);
  episodeIds.forEach((episodeId,index)=>run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episodeId,seriesId,'Episode '+(index+1),index+1,duration,64,'analytics/fixture.mp4'));
  return{seriesId,episodeIds};
}

before(async()=>{
  await mkdir(path.join(dir,'objects','analytics'),{recursive:true});await writeFile(path.join(dir,'objects','analytics','fixture.mp4'),Buffer.alloc(64));
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
  config.appUrl=origin;
  owner=await register('Analytics owner');otherPublisher=await register('Other publisher');viewerA=await register('First viewer');viewerB=await register('Second viewer');
  for(const identity of [owner,otherPublisher])run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",identity.id);
});
beforeEach(()=>{config.production=false;config.sandbox=false;config.stripeTestMode=false;config.payments='demo';config.appUrl=origin;});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('series likes are authenticated, idempotent per account and independent of saved series',async()=>{
  const {seriesId}=fixture();
  const initial=(await request('/api/series/'+seriesId)).data.series;assert.equal(initial.likes,0);assert.equal(initial.liked,false);
  await request('/api/series/'+seriesId+'/like',{liked:true},'',401,'PUT');
  await request('/api/series/'+seriesId+'/save',{},viewerA.cookie);
  const liked=await Promise.all(Array.from({length:4},()=>request('/api/series/'+seriesId+'/like',{liked:true},viewerA.cookie,200,'PUT')));
  assert.ok(liked.every(result=>result.data.liked===true&&result.data.likes===1));
  await request('/api/series/'+seriesId+'/like',{liked:true},viewerB.cookie,200,'PUT');
  let series=(await request('/api/series/'+seriesId,undefined,viewerA.cookie)).data.series;assert.equal(series.likes,2);assert.equal(series.liked,true);assert.equal(series.saved,true);
  await Promise.all([0,1].map(()=>request('/api/series/'+seriesId+'/like',{liked:false},viewerA.cookie,200,'PUT')));
  series=(await request('/api/series/'+seriesId,undefined,viewerA.cookie)).data.series;assert.equal(series.likes,1);assert.equal(series.liked,false);assert.equal(series.saved,true);
  assert.equal((await request('/api/series/'+seriesId,undefined,viewerB.cookie)).data.series.liked,true);
  assert.equal((await request('/api/series/'+seriesId)).data.series.liked,false);
  const draft=fixture({status:'draft'});await request('/api/series/'+draft.seriesId+'/like',{liked:true},viewerA.cookie,404,'PUT');
});

test('analytics remain private to the owning publisher and expose only aggregate data',async()=>{
  const {seriesId}=fixture();const route='/api/studio/series/'+seriesId+'/analytics?period=7d';
  await request(route,undefined,'',401);await request(route,undefined,viewerA.cookie,403);await request(route,undefined,otherPublisher.cookie,403);
  const result=(await request(route,undefined,owner.cookie)).data;
  assert(!JSON.stringify(result).includes(viewerA.id));assert(!JSON.stringify(result).includes('@analytics.test'));
  assert(!JSON.stringify(result).includes('password_hash'));assert(!JSON.stringify(result).includes('viewer_key'));
  await request('/api/studio/series/'+seriesId+'/analytics?start=2026-02-30&end=2026-03-01',undefined,owner.cookie,400);
  await request('/api/studio/series/'+seriesId+'/analytics?start=2026-10-03&end=2026-10-02',undefined,owner.cookie,400);
  await request('/api/studio/series/'+seriesId+'/analytics?start=2024-01-01&end=2026-01-01',undefined,owner.cookie,400);
});

test('metadata and range requests do not count as views or manufacture watching time',async()=>{
  const {seriesId,episodeIds}=fixture();
  for(const method of ['HEAD','GET','GET']){
    const stream=await fetch(base+'/api/episodes/'+episodeIds[0]+'/stream',{method,headers:{Range:'bytes=0-15'}});assert.equal(stream.status,206);await stream.arrayBuffer();
  }
  assert.equal(one('SELECT views FROM series WHERE id=?',seriesId)!.views,0);
  const detail=(await request('/api/series/'+seriesId)).data;
  assert.equal(detail.episodes[0].views,0);
  await request('/api/episodes/'+episodeIds[1]+'/playback',{},'',403);
});

test('publisher previews are excluded and paid playback rechecks access before accepting watch time',async()=>{
  const {seriesId,episodeIds}=fixture({free:0});
  const preview=(await request('/api/episodes/'+episodeIds[0]+'/playback',{},owner.cookie)).data;assert.equal(preview.excluded,true);
  assert.equal(one('SELECT COUNT(*) AS n FROM playback_sessions WHERE episode_id=?',episodeIds[0])!.n,0);
  await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerA.cookie,403);
  const purchase=randomUUID();run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',purchase,viewerA.id,episodeIds[0],100_000,70_000,30_000);
  const allowed=(await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerA.cookie)).data;assert(allowed.sessionId);
  run('DELETE FROM purchases WHERE id=?',purchase);
  await request('/api/playback/'+allowed.sessionId,{watchedMs:3000},viewerA.cookie,403,'PUT');
  assert.equal(one('SELECT watched_ms FROM playback_sessions WHERE id=?',allowed.sessionId)!.watched_ms,0);assert.equal(one('SELECT views FROM series WHERE id=?',seriesId)!.views,0);
  const draft=fixture({status:'draft'});await request('/api/episodes/'+draft.episodeIds[0]+'/playback',{},viewerA.cookie,404);
});

test('guest playback is browser-bound, wall-time limited, replay-safe and durable across application restart',async()=>{
  const {seriesId,episodeIds}=fixture();let now=Date.now();mock.method(Date,'now',()=>now);
  const start=await request('/api/episodes/'+episodeIds[0]+'/playback',{});assert(start.cookie);assert.equal(start.data.watchedMs,0);assert.equal(start.data.viewCounted,false);
  const playback='/api/playback/'+start.data.sessionId;
  const instant=await request(playback,{watchedMs:0},start.cookie,200,'PUT');assert.equal(instant.data.watchedMs,0);assert.equal(instant.data.viewCounted,false);
  now+=2000;const below=await request(playback,{watchedMs:2000},start.cookie,200,'PUT');assert.equal(below.data.watchedMs,2000);assert.equal(below.data.viewCounted,false);
  now+=1000;const qualified=await request(playback,{watchedMs:3000},start.cookie,200,'PUT');assert.equal(qualified.data.watchedMs,3000);assert.equal(qualified.data.viewCounted,true);
  await request(playback,{watchedMs:3000},start.cookie,200,'PUT');assert.equal(one('SELECT views FROM series WHERE id=?',seriesId)!.views,1);
  now+=5000;const later=await request(playback,{watchedMs:8000},start.cookie,200,'PUT');assert.equal(later.data.watchedMs,8000);
  await request(playback,{watchedMs:9000},viewerA.cookie,[403,404],'PUT');await request(playback,{watchedMs:9000},'',[403,404],'PUT');
  await request(playback,{watchedMs:-1},start.cookie,400,'PUT');await request(playback,{watchedMs:1.5},start.cookie,400,'PUT');
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  const restarted=createApp();restarted.use(errorHandler);server=restarted.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
  const resumed=await request('/api/episodes/'+episodeIds[0]+'/playback',{},start.cookie);assert.equal(resumed.data.sessionId,start.data.sessionId);assert.equal(resumed.data.watchedMs,8000);assert.equal(resumed.data.viewCounted,true);
  const publicEpisode=(await request('/api/series/'+seriesId)).data.episodes[0];assert.equal(publicEpisode.views,1);
  now+=30*60_000+1;await request(playback,{watchedMs:9000},start.cookie,409,'PUT');
  const next=await request('/api/episodes/'+episodeIds[0]+'/playback',{},start.cookie);assert.notEqual(next.data.sessionId,start.data.sessionId);assert.equal(next.data.viewCounted,false);
});

test('authenticated playback reuses one durable viewer window and cannot inflate a view by seeking to the end',async()=>{
  const {seriesId,episodeIds}=fixture({duration:12});let now=Date.now();mock.method(Date,'now',()=>now);
  const started=await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerA.cookie);
  const again=await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerA.cookie);assert.equal(again.data.sessionId,started.data.sessionId);
  now+=500;const seek=await request('/api/playback/'+started.data.sessionId,{watchedMs:12_000},viewerA.cookie,200,'PUT');assert.equal(seek.data.watchedMs,500);assert.equal(seek.data.viewCounted,false);
  now+=3500;const replay=await request('/api/playback/'+started.data.sessionId,{watchedMs:12_000},viewerA.cookie,200,'PUT');assert.equal(replay.data.watchedMs,500);assert.equal(replay.data.viewCounted,false);
  now+=30_000;const capped=await request('/api/playback/'+started.data.sessionId,{watchedMs:180_000},viewerA.cookie,200,'PUT');assert.equal(capped.data.watchedMs,12_000);
  await request('/api/playback/'+started.data.sessionId,{watchedMs:180_000},viewerA.cookie,200,'PUT');assert.equal(one('SELECT views FROM series WHERE id=?',seriesId)!.views,1);
  const distinctViewer=await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerB.cookie);assert.notEqual(distinctViewer.data.sessionId,started.data.sessionId);
  const result=(await request('/api/studio/series/'+seriesId+'/analytics?period=7d',undefined,owner.cookie)).data;assert.equal(result.totals.views,1);assert.equal(result.totals.avgWatchSeconds,12);
});

test('replaying a clipped cumulative heartbeat cannot reclaim discarded watch time later',async()=>{
  const {seriesId,episodeIds}=fixture();let now=Date.now();mock.method(Date,'now',()=>now);
  const started=await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerA.cookie),route='/api/playback/'+started.data.sessionId;
  now+=5000;const clipped=await request(route,{watchedMs:180_000},viewerA.cookie,200,'PUT');assert.equal(clipped.data.watchedMs,5000);assert.equal(clipped.data.viewCounted,true);
  now+=5000;const replayed=await request(route,{watchedMs:180_000},viewerA.cookie,200,'PUT');assert.equal(replayed.data.watchedMs,5000);
  now+=5000;const lowered=await request(route,{watchedMs:170_000},viewerA.cookie,200,'PUT');assert.equal(lowered.data.watchedMs,5000);
  now+=5000;const repeated=await request(route,{watchedMs:180_000},viewerA.cookie,200,'PUT');assert.equal(repeated.data.watchedMs,5000);
  const resumed=(await request('/api/episodes/'+episodeIds[0]+'/playback',{},viewerA.cookie)).data;assert.equal(resumed.sessionId,started.data.sessionId);assert.equal(resumed.watchedMs,5000);assert.equal(resumed.reportedMs,180_000);
  const analytics=(await request('/api/studio/series/'+seriesId+'/analytics?period=7d',undefined,owner.cookie)).data;assert.equal(analytics.totals.views,1);assert.equal(analytics.totals.watchSeconds,5);assert.equal(analytics.totals.avgWatchSeconds,5);
});

test('UTC date ranges aggregate real viewing time, zero-fill days and count distinct paid viewers per episode and series',async()=>{
  const {seriesId,episodeIds}=fixture({free:0});
  function session(episodeId:string,viewer:string,qualifiedAt:string,watchedMs:number,counted=true){
    const at=Date.parse(qualifiedAt),id=randomUUID(),viewerKey=createHash('sha256').update(viewer).digest('hex');
    run('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,watched_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,?,?,?)',id,episodeId,viewerKey,at-watchedMs,at,watchedMs,counted?1:0,counted?at:null);
  }
  function purchase(episodeId:string,userId:string,createdAt:string,testMode=false,price=100_000){
    run(`INSERT INTO ${testMode?'test_purchases':'purchases'} (id,user_id,episode_id,price_micros,creator_micros,platform_micros,created_at) VALUES (?,?,?,?,?,?,?)`,randomUUID(),userId,episodeId,price,price*.7,price*.3,createdAt);
  }
  session(episodeIds[0],'outside-before','2026-10-01T23:59:59Z',9000);
  session(episodeIds[0],'first','2026-10-02T00:00:00Z',6000);
  session(episodeIds[0],'second','2026-10-02T12:00:00Z',12_000);
  session(episodeIds[1],'first','2026-10-03T23:59:59Z',30_000);
  session(episodeIds[0],'outside-after','2026-10-04T00:00:00Z',20_000);
  session(episodeIds[0],'unqualified','2026-10-02T15:00:00Z',2000,false);
  purchase(episodeIds[0],viewerA.id,'2026-10-02 00:00:00');purchase(episodeIds[1],viewerA.id,'2026-10-03 23:59:59');purchase(episodeIds[0],viewerB.id,'2026-10-03 12:00:00');
  purchase(episodeIds[2],viewerB.id,'2026-10-04 00:00:00');purchase(episodeIds[2],viewerA.id,'2026-10-02 12:00:00',false,0);
  await request('/api/series/'+seriesId+'/like',{liked:true},viewerA.cookie,200,'PUT');
  const route='/api/studio/series/'+seriesId+'/analytics?start=2026-10-02&end=2026-10-03';
  const result=(await request(route,undefined,owner.cookie)).data;
  assert.equal(result.range.period,'custom');assert.equal(result.range.start,'2026-10-02');assert.equal(result.range.end,'2026-10-03');
  assert.deepEqual(result.totals,{views:3,watchSeconds:48,avgWatchSeconds:16,paidViewers:2,paidUnlocks:3,likes:1});
  assert.deepEqual(result.daily.map((day:any)=>({date:day.date,views:day.views,avg:day.avgWatchSeconds})),[{date:'2026-10-02',views:2,avg:9},{date:'2026-10-03',views:1,avg:30}]);
  assert.deepEqual(result.episodes.map((episode:any)=>({number:episode.number,views:episode.views,avg:episode.avgWatchSeconds,paidViewers:episode.paidViewers})),[{number:1,views:2,avg:9,paidViewers:2},{number:2,views:1,avg:30,paidViewers:1},{number:3,views:0,avg:0,paidViewers:0}]);
  const empty=(await request('/api/studio/series/'+seriesId+'/analytics?start=2026-10-05&end=2026-10-06',undefined,owner.cookie)).data;
  assert.deepEqual(empty.daily.map((day:any)=>({date:day.date,views:day.views,avg:day.avgWatchSeconds,paid:day.paidViewers})),[{date:'2026-10-05',views:0,avg:0,paid:0},{date:'2026-10-06',views:0,avg:0,paid:0}]);
  assert.equal(empty.totals.watchSeconds,0);assert.equal(empty.totals.paidViewers,0);
  assert(!JSON.stringify(result).includes(viewerA.id));assert(!JSON.stringify(result).includes('@analytics.test'));assert(!JSON.stringify(result).includes('viewer_key'));
  purchase(episodeIds[1],viewerB.id,'2026-10-02 12:00:00',true);
  config.payments='stripe';config.stripeTestMode=true;
  const testResult=(await request(route,undefined,owner.cookie)).data;assert.equal(testResult.testPayments,true);assert.equal(testResult.totals.views,3);assert.equal(testResult.totals.paidViewers,1);assert.equal(testResult.totals.paidUnlocks,1);assert.deepEqual(testResult.episodes.map((episode:any)=>episode.paidViewers),[0,1,0]);
  config.stripeTestMode=false;
  const restored=(await request(route,undefined,owner.cookie)).data;assert.equal(restored.testPayments,false);assert.equal(restored.totals.paidViewers,2);assert.equal(restored.totals.paidUnlocks,3);
});
