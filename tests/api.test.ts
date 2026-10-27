import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-api-'));
process.env.DATA_DIR=dir;process.env.PAYMENTS_MODE='demo';process.env.NODE_ENV='test';process.env.SEED_DEMO='true';
process.env.STRIPE_SECRET_KEY='sk_test_local_signature_test_only';
const {createApp,errorHandler}=await import('../server/app');
const {seed}=await import('../server/seed');
const {one,run,db}=await import('../server/db');
let server:Server;let base:string;let viewer='';let publisher='';let admin='';let other='';let publisherId='';let seriesId='';let uploadedId='';
const password='CorrectHorse123!';
async function request(route:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST'){
  const r=await fetch(`${base}${route}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
async function upload(route:string,file:Buffer,name:string,cookie:string,fields:Record<string,string>={},field='video'){
  const body=new FormData();for(const[k,v]of Object.entries(fields))body.append(k,v);body.append(field,new Blob([new Uint8Array(file)]),name);
  const r=await fetch(base+route,{method:'POST',headers:{Cookie:cookie},body});return{status:r.status,data:await r.json()};
}
before(async()=>{await seed();const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
  const v=await request('/api/auth/register',{name:'Test Viewer',email:'viewer@example.test',password});assert.equal(v.status,201);viewer=v.cookie;
  const p=await request('/api/auth/register',{name:'Test Publisher',email:'publisher@example.test',password,role:'admin',publisher_active:1});publisher=p.cookie;publisherId=p.data.user.id;assert.equal(p.data.user.role,'viewer');assert.equal(p.data.user.publisher_active,0);
  const o=await request('/api/auth/register',{name:'Other Person',email:'other@example.test',password});other=o.cookie;
  const a=await request('/api/auth/login',{email:'admin@demo.aidramio.test',password:'DemoPass123!'});admin=a.cookie;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('public catalogue and private episode access enforce free versus paid',async()=>{
  const catalog=await request('/api/series');assert.equal(catalog.status,200);assert.equal(catalog.data.series.length,20);assert.ok(catalog.data.series.every((s:any)=>!('cover_key'in s)));
  const detail=await request('/api/series/after-midnight');assert.equal(detail.data.episodes.length,8);assert.ok(!('storage_key'in detail.data.episodes[0]));assert.equal(detail.data.episodes[2].unlocked,false);
  const free=await fetch(`${base}/api/episodes/after-midnight-1/stream`,{headers:{Range:'bytes=0-31'}});assert.equal(free.status,206);assert.equal((await free.arrayBuffer()).byteLength,32);
  const locked=await request('/api/episodes/after-midnight-3/stream');assert.equal(locked.status,403);assert.equal(locked.data.error.code,'EPISODE_LOCKED');
  const invalid=await fetch(`${base}/api/episodes/after-midnight-1/stream`,{headers:{Range:'bytes=999999999-'}});assert.equal(invalid.status,416);
});
test('authentication rejects invalid passwords, weak registration, duplicate email and cross-origin mutations',async()=>{
  assert.equal((await request('/api/auth/login',{email:'viewer@example.test',password:'wrong'})).status,401);
  assert.equal((await request('/api/auth/register',{email:'weak@example.test',name:'Weak',password:'123'})).status,400);
  assert.equal((await request('/api/auth/register',{email:'VIEWER@example.test',name:'Duplicate',password})).status,409);
  const me=await request('/api/auth/me',undefined,viewer);assert.ok(me.data.user.id);assert.equal(me.data.user.password_hash,undefined);
  const cross=await fetch(base+'/api/account',{method:'PATCH',headers:{Cookie:viewer,Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({name:'Attacker',language:'en'})});assert.equal(cross.status,403);
});
test('publisher activation costs HK$88, cannot be confirmed by another user, and settles once',async()=>{
  const before=await request('/api/studio/series',{},publisher);assert.equal(before.status,403);assert.equal(before.data.error.code,'ACTIVATION_REQUIRED');
  const checkout=await request('/api/payments/checkout',{kind:'activation',amount_cents:500},publisher);assert.equal(checkout.data.amount_cents,8800);assert.equal(checkout.data.currency,'hkd');
  assert.equal((await request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{},viewer)).status,404);
  const results=await Promise.all([request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{},publisher),request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{},publisher)]);assert.ok(results.every(r=>r.status===200));
  const me=await request('/api/auth/me',undefined,publisher);assert.equal(me.data.user.publisher_active,1);assert.equal(me.data.user.quota_bytes,5*1024**3);assert.equal(me.data.user.wallet_micros,0);
  assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",publisherId)!.n,1);
});
test('wallet funding is idempotent and cannot be forged by client amounts',async()=>{
  assert.equal((await request('/api/payments/checkout',{kind:'funding',amount_cents:10},viewer)).status,400);
  const checkout=await request('/api/payments/checkout',{kind:'funding',amount_cents:500},viewer);
  await Promise.all([request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{amount:1000000},viewer),request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{},viewer)]);
  const me=await request('/api/auth/me',undefined,viewer);assert.equal(me.data.user.wallet_micros,5_000_000);
});
test('concurrent episode unlocks charge once and record the exact 70/30 split including fractional cents',async()=>{
  run('UPDATE series SET price_cents=11 WHERE id=?','after-midnight');const before=one('SELECT earnings_micros FROM users WHERE id=?','demo-creator')!.earnings_micros;
  const results=await Promise.all(Array.from({length:8},()=>request('/api/episodes/after-midnight-3/unlock',{price_cents:1},viewer)));assert.ok(results.every(r=>r.status===200));
  const me=await request('/api/auth/me',undefined,viewer);assert.equal(me.data.user.wallet_micros,4_890_000);
  const purchase=one('SELECT * FROM purchases WHERE episode_id=?','after-midnight-3')!;assert.equal(purchase.price_micros,110_000);assert.equal(purchase.creator_micros,77_000);assert.equal(purchase.platform_micros,33_000);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?','demo-creator')!.earnings_micros-before,77_000);
  const stream=await fetch(base+'/api/episodes/after-midnight-3/stream',{headers:{Cookie:viewer,Range:'bytes=0-15'}});assert.equal(stream.status,206);await stream.arrayBuffer();
  assert.equal((await request('/api/episodes/after-midnight-3/stream',undefined,other)).status,403);
  assert.equal((await request('/api/episodes/after-midnight-4/unlock',{},other)).status,402);
});
test('series metadata validates price and language and enforces ownership',async()=>{
  const body={title:'Integration Series',description:'An original test series for the publishing flow.',language:'zh-TW',genres:['romance'],creation_type:'human',price_cents:10,free_episodes:1};
  assert.equal((await request('/api/studio/series',{...body,price_cents:9},publisher)).status,400);
  assert.equal((await request('/api/studio/series',{...body,language:'not-a-language'},publisher)).status,400);
  const created=await request('/api/studio/series',body,publisher);assert.equal(created.status,201);seriesId=created.data.id;
  assert.equal((await request(`/api/series/${seriesId}`,undefined,viewer)).status,404);
  assert.equal((await request(`/api/studio/series/${seriesId}`,body,other,'PATCH')).status,403);
  assert.equal((await request(`/api/studio/series/${seriesId}/status`,{status:'published'},publisher)).status,400);
});
test('server rejects episodes longer than 180 seconds and videos over 75 MB',async()=>{
  const long=path.join(dir,'long.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=16x16:r=1','-t','181','-c:v','libx264','-y',long]);
  const duration=await upload(`/api/studio/series/${seriesId}/episodes`,await readFile(long),'episode.mp4',publisher,{title:'Too long',number:'1',duration:'12'});assert.equal(duration.status,422);assert.equal(duration.data.error.code,'VIDEO_TOO_LONG');
  const oversize=await upload(`/api/studio/series/${seriesId}/episodes`,Buffer.alloc(75*1024*1024+1),'big.mp4',publisher,{title:'Too big',number:'1'});assert.equal(oversize.status,413);
  assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',seriesId)!.n,0);
});
test('quota, real video processing, cover upload, publishing and episode edits work together',async()=>{
  const sample=await readFile(path.join(dir,'objects','demo','preview.mp4'));
  run('UPDATE users SET quota_bytes=20 WHERE id=?',publisherId);
  const quota=await upload(`/api/studio/series/${seriesId}/episodes`,sample,'01 Opening.mp4',publisher,{title:'Opening',number:'1'});assert.equal(quota.status,413);assert.equal(quota.data.error.code,'QUOTA_EXCEEDED');
  run('UPDATE users SET quota_bytes=? WHERE id=?',5*1024**3,publisherId);
  const video=await upload(`/api/studio/series/${seriesId}/episodes`,sample,'01 Opening.mp4',publisher,{title:'Opening',number:'1'});assert.equal(video.status,201,JSON.stringify(video.data));uploadedId=video.data.id;assert.ok(video.data.duration<=180);assert.ok(video.data.bytes>0);
  assert.equal((await upload(`/api/studio/series/${seriesId}/cover`,Buffer.from('not an image'),'bad.png',publisher,{},'cover')).status,422);
  const image=await readFile(path.resolve('public/images/midnight.jpg'));const cover=await upload(`/api/studio/series/${seriesId}/cover`,image,'poster.jpg',publisher,{},'cover');assert.equal(cover.status,200);
  const usage=one('SELECT used_bytes FROM users WHERE id=?',publisherId)!.used_bytes;assert.ok(usage>video.data.bytes);
  assert.equal((await request(`/api/studio/series/${seriesId}/status`,{status:'published'},publisher)).status,200);
  const detail=await request(`/api/series/${seriesId}`);assert.equal(detail.data.series.language,'zh-TW');assert.equal(detail.data.episodes[0].title,'Opening');
  assert.equal((await request(`/api/studio/episodes/${uploadedId}`,{title:'A New Opening',number:1},publisher,'PATCH')).status,200);
});
test('payout minimum, reservation, rejection refund and duplicate processing are enforced',async()=>{
  run('UPDATE users SET earnings_micros=? WHERE id=?',5_000_000,publisherId);
  assert.equal((await request('/api/studio/withdrawals',{amount_cents:200},publisher)).status,400);
  const withdrawal=await request('/api/studio/withdrawals',{amount_cents:300},publisher);assert.equal(withdrawal.status,201);assert.equal(withdrawal.data.user.earnings_micros,2_000_000);
  assert.equal((await request(`/api/admin/withdrawals/${withdrawal.data.id}`,{approve:true},viewer)).status,403);
  assert.equal((await request(`/api/admin/withdrawals/${withdrawal.data.id}`,{approve:false},admin)).status,200);
  assert.equal((await request(`/api/admin/withdrawals/${withdrawal.data.id}`,{approve:false},admin)).status,409);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',publisherId)!.earnings_micros,5_000_000);
  const paid=await request('/api/studio/withdrawals',{amount_cents:300},publisher);assert.equal((await request(`/api/admin/withdrawals/${paid.data.id}`,{approve:true},admin)).status,200);assert.equal((await request(`/api/admin/withdrawals/${paid.data.id}`,{approve:true},admin)).status,409);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',publisherId)!.earnings_micros,2_000_000);
});
test('storage expansion requires administrator approval and preserves the original allowance until approved',async()=>{
  const r=await request('/api/studio/storage-requests',{requested_gb:10,reason:'A larger catalogue of original short dramas.'},publisher);assert.equal(r.status,201);
  assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',publisherId)!.quota_bytes,5*1024**3);
  const pending=one('SELECT id FROM storage_requests WHERE user_id=?',publisherId)!;
  assert.equal((await request(`/api/admin/storage-requests/${pending.id}`,{approve:true},publisher)).status,403);
  assert.equal((await request(`/api/admin/storage-requests/${pending.id}`,{approve:true},admin)).status,200);
  assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',publisherId)!.quota_bytes,10*1024**3);
});
test('Stripe webhooks reject forged signatures and settle a correctly signed paid event only once',async()=>{
  const{config}=await import('../server/config');const{stripe}=await import('../server/finance');const previous=config.payments;config.payments='stripe';config.stripeWebhook='whsec_local_signature_test_only';
  try{
    const paymentId='signed-payment-test';const user=one('SELECT id,wallet_micros FROM users WHERE email=?','viewer@example.test')!;
    run('INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?,?,?,?,?)',paymentId,user.id,'funding',500,'usd','stripe','cs_test_signed');
    const payload=JSON.stringify({id:'evt_local',object:'event',type:'checkout.session.completed',data:{object:{id:'cs_test_signed',object:'checkout.session',payment_status:'paid',amount_total:500,currency:'usd',metadata:{paymentId}}}});
    const forged=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'invalid'},body:payload});assert.equal(forged.status,400);await forged.arrayBuffer();
    const signature=stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
    for(let n=0;n<2;n++){const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});assert.equal(response.status,200);await response.arrayBuffer();}
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,user.wallet_micros+5_000_000);
  }finally{config.payments=previous;config.stripeWebhook='';}
});
