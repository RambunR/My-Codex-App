import {after,before,beforeEach,afterEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-withdrawals-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='demo';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
let server:Server,base:string;

function actor(role='publisher',earnings=15_000_000){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,earnings_micros) VALUES (?,?,?,?,?,1,?)',id,id+'@withdrawals.test','Withdrawal test','!disabled',role,earnings);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+60_000);
  return{id,cookie:'drama_session='+token};
}
async function request(route:string,body:unknown|undefined,cookie='',expected=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
}
const earnings=(id:string)=>one('SELECT earnings_micros FROM users WHERE id=?',id)!.earnings_micros;
before(async()=>{const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
beforeEach(()=>{config.production=false;config.payments='demo';config.sandbox=false;config.stripeTestMode=false;config.payoutsEnabled=true;config.stripeAutoConfigureWebhook=false;config.appUrl=base;config.usdToHkd=7.8;config.stripeKey='';config.stripeWebhook='';finance.configureStripe();});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('minimum is USD10 regardless of FX; new requests reserve gross and persist a USD1 fee',async()=>{
  const creator=actor();
  config.usdToHkd=100;
  const invalid=await request('/api/studio/withdrawals',{amount_cents:999},creator.cookie,400);assert.equal(invalid.error.code,'MIN_WITHDRAWAL');
  assert.equal(earnings(creator.id),15_000_000);
  config.usdToHkd=0.01;
  const result=await request('/api/studio/withdrawals',{amount_cents:1000,fee_micros:0,payout_micros:10_000_000},creator.cookie,201);
  assert.equal(earnings(creator.id),5_000_000);
  const terms=one('SELECT * FROM withdrawal_terms WHERE withdrawal_id=?',result.id)!;
  assert.equal(terms.gross_micros,10_000_000);assert.equal(terms.fee_micros,1_000_000);assert.equal(terms.payout_micros,9_000_000);
  assert.equal(terms.processing_min_days,3);assert.equal(terms.processing_max_days,5);
  const history=(await request('/api/studio',undefined,creator.cookie)).withdrawals[0];
  assert.equal(history.fee_micros,1_000_000);assert.equal(history.payout_micros,9_000_000);
  await request('/api/studio/withdrawals',{amount_cents:1000},creator.cookie,400);
  assert.equal(one('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id=?',creator.id)!.n,1);
  const publicConfig=await request('/api/config',undefined);
  assert.equal(publicConfig.limits.minimumPayoutUsd,10);assert.equal(publicConfig.withdrawalPolicy.feeCents,100);
});

test('rejection restores the entire reserved amount exactly once, including the fee',async()=>{
  const creator=actor(),admin=actor('admin');
  const withdrawal=await request('/api/studio/withdrawals',{amount_cents:1000},creator.cookie,201);
  await request('/api/admin/withdrawals/'+withdrawal.id,{approve:false},admin.cookie);
  await request('/api/admin/withdrawals/'+withdrawal.id,{approve:false},admin.cookie,409);
  assert.equal(earnings(creator.id),15_000_000);
  assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE reference_id=? AND kind='withdrawal_refund'",withdrawal.id)!.n,1);
});

function stripeFixture(creatorId:string){
  config.production=true;config.payments='stripe';config.stripeKey='sk_live_local_withdrawal_fixture_only';config.stripeWebhook='whsec_local_withdrawal_fixture_only';finance.configureStripe();
  run('UPDATE users SET stripe_account_id=? WHERE id=?','acct_local_withdrawal_fixture',creatorId);
  mock.method(finance.stripe!.accounts,'retrieve',async()=>({id:'acct_local_withdrawal_fixture',payouts_enabled:true}));
}

test('Stripe retry sends the saved net amount with the same idempotency key and never deducts earnings twice',async()=>{
  const creator=actor(),admin=actor('admin');stripeFixture(creator.id);
  const withdrawal=await request('/api/studio/withdrawals',{amount_cents:1000},creator.cookie,201);
  const calls:Array<{amount:number;key:string}>=[];
  mock.method(finance.stripe!.transfers,'create',async(params:any,options:any)=>{
    calls.push({amount:params.amount,key:options.idempotencyKey});
    if(calls.length===1)throw new Error('Simulated lost transfer response');
    return{id:'tr_local_withdrawal_fixture'};
  });
  await request('/api/admin/withdrawals/'+withdrawal.id,{approve:true},admin.cookie,500);
  await request('/api/admin/withdrawals/'+withdrawal.id,{approve:true},admin.cookie);
  await request('/api/admin/withdrawals/'+withdrawal.id,{approve:true},admin.cookie,409);
  assert.deepEqual(calls,[{amount:900,key:'withdrawal:'+withdrawal.id},{amount:900,key:'withdrawal:'+withdrawal.id}]);
  assert.equal(earnings(creator.id),5_000_000);
  const history=(await request('/api/admin',undefined,admin.cookie)).withdrawals.find((row:any)=>row.id===withdrawal.id);
  assert.equal(history.fee_micros,1_000_000);assert.equal(history.payout_micros,9_000_000);
});

test('historical pending requests keep their original transfer amount with zero retroactive fee',async()=>{
  const creator=actor(),admin=actor('admin');stripeFixture(creator.id);
  const id=randomUUID();run('INSERT INTO withdrawals (id,user_id,amount_micros) VALUES (?,?,?)',id,creator.id,3_000_000);
  let amount=0;mock.method(finance.stripe!.transfers,'create',async(params:any)=>{amount=params.amount;return{id:'tr_legacy_fixture'};});
  await request('/api/admin/withdrawals/'+id,{approve:true},admin.cookie);
  assert.equal(amount,300);
  const history=(await request('/api/studio',undefined,creator.cookie)).withdrawals.find((row:any)=>row.id===id);
  assert.equal(history.fee_micros,0);assert.equal(history.payout_micros,3_000_000);
});

test('sandbox and paused modes remain unable to reserve or release real earnings',async()=>{
  const creator=actor();config.stripeTestMode=true;
  const result=await request('/api/studio/withdrawals',{amount_cents:1000},creator.cookie,503);
  assert.equal(result.error.code,'TEST_PAYOUTS_DISABLED');assert.equal(earnings(creator.id),15_000_000);
  config.stripeTestMode=false;config.payoutsEnabled=false;
  await request('/api/studio/withdrawals',{amount_cents:1000},creator.cookie,503);
  assert.equal(one('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id=?',creator.id)!.n,0);
});
