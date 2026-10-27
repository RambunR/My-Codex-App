import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-pass-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {getUser}=await import('../server/auth');
const {one,run,db}=await import('../server/db');
let server:Server,base:string;

function account(active=0){
  const id=randomUUID();
  run('INSERT INTO users (id,email,name,password_hash,publisher_active,role) VALUES (?,?,?,?,?,?)',id,id+'@pass.test','Pass fixture','unusable-fixture-password',active,active?'publisher':'viewer');
  return id;
}
function payment(userId:string,{test=false,kind='activation',status='paid',created='2026-10-12 10:20:30',provider='stripe'}:{test?:boolean;kind?:'activation'|'funding';status?:string;created?:string;provider?:string}={}){
  run(`INSERT INTO ${test?'test_payments':'payments'} (id,user_id,kind,amount_cents,currency,provider,status,created_at) VALUES (?,?,?,?,?,?,?,?)`,randomUUID(),userId,kind,kind==='activation'?8800:500,kind==='activation'?'hkd':'usd',provider,status,created);
}
async function request(route:string,body?:unknown,cookie='',expected=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:config.appUrl})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));
  return{data,cookie:response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))?.split(';')[0]||''};
}
before(async()=>{
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{config.production=true;config.payments='stripe';config.stripeTestMode=false;config.sandbox=false;config.appUrl='https://aidramio.example.test';});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('registration and profile edits cannot forge Dramio Pass ownership or its receipt',async()=>{
  const forged={active:true,test:false,purchased_at:'2026-01-01T00:00:00.000Z'};
  const user=await request('/api/auth/register',{name:'Pass Viewer',email:'viewer@pass.test',password:'PassViewerPassword123!',publisher_active:1,role:'publisher',dramio_pass:forged},'',201);
  assert.deepEqual(user.data.user.dramio_pass,{active:false,test:false,purchased_at:null});
  assert.equal(user.data.user.publisher_active,0);assert.equal(user.data.user.role,'viewer');
  await request('/api/account',{name:'Updated Viewer',language:'en',publisher_active:1,dramio_pass:forged},user.cookie,200,'PATCH');
  const me=(await request('/api/auth/me',undefined,user.cookie)).data.user;
  assert.deepEqual(me.dramio_pass,{active:false,test:false,purchased_at:null});assert.equal(me.publisher_active,0);
  assert.equal(one('SELECT publisher_active FROM users WHERE id=?',me.id)!.publisher_active,0);
});

test('existing publisher activation is recognized as Dramio Pass without inventing a purchase date',()=>{
  const id=account(1);assert.deepEqual(getUser(id)!.dramio_pass,{active:true,test:false,purchased_at:null});
  config.stripeTestMode=true;
  assert.deepEqual(getUser(id)!.dramio_pass,{active:true,test:false,purchased_at:null});
  assert.equal(one('SELECT publisher_active FROM users WHERE id=?',id)!.publisher_active,1);
});

test('Dramio Pass purchase dates come only from the matching paid activation receipt',()=>{
  const id=account(1);
  payment(id,{kind:'funding',created:'2026-10-26 10:00:00'});
  payment(id,{status:'pending',created:'2026-10-25 10:00:00'});
  payment(id,{status:'failed',created:'2026-10-24 10:00:00'});
  assert.equal(getUser(id)!.dramio_pass?.purchased_at,null);
  payment(id);
  const pass=getUser(id)!.dramio_pass!;assert.equal(pass.active,true);assert.equal(pass.test,false);assert.equal(pass.purchased_at,'2026-10-12T10:20:30.000Z');
});

test('test-only Dramio Pass ownership is labelled and remains separate when switching to live payments',()=>{
  const id=account();config.stripeTestMode=true;
  run('INSERT INTO test_accounts (user_id,publisher_active) VALUES (?,1)',id);payment(id,{test:true,created:'2026-10-13 11:22:33'});
  assert.deepEqual(getUser(id)!.dramio_pass,{active:true,test:true,purchased_at:'2026-10-13T11:22:33.000Z'});
  const real=one('SELECT publisher_active,role FROM users WHERE id=?',id)!;assert.equal(real.publisher_active,0);assert.equal(real.role,'viewer');
  config.stripeTestMode=false;assert.deepEqual(getUser(id)!.dramio_pass,{active:false,test:false,purchased_at:null});
  config.stripeTestMode=true;assert.equal(getUser(id)!.dramio_pass?.active,true);assert.equal(getUser(id)!.dramio_pass?.test,true);
});

test('an existing real Dramio Pass and receipt take precedence over a test activation',()=>{
  const id=account(1);payment(id,{created:'2026-10-01 01:02:03'});
  run('INSERT INTO test_accounts (user_id,publisher_active) VALUES (?,1)',id);payment(id,{test:true,created:'2026-10-20 11:22:33'});
  config.stripeTestMode=true;
  assert.deepEqual(getUser(id)!.dramio_pass,{active:true,test:false,purchased_at:'2026-10-01T01:02:03.000Z'});
  config.stripeTestMode=false;
  assert.deepEqual(getUser(id)!.dramio_pass,{active:true,test:false,purchased_at:'2026-10-01T01:02:03.000Z'});
});

test('local demo Dramio Pass receipts and seeded activations are explicitly marked as test passes',()=>{
  config.production=false;config.payments='demo';
  const paid=account(1);payment(paid,{provider:'demo'});
  assert.deepEqual(getUser(paid)!.dramio_pass,{active:true,test:true,purchased_at:'2026-10-12T10:20:30.000Z'});
  const legacy=account(1);assert.deepEqual(getUser(legacy)!.dramio_pass,{active:true,test:true,purchased_at:null});
});
