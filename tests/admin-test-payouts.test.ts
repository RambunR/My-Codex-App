import {before,after,beforeEach,afterEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-admin-test-payout-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='stripe';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
const {testPayoutClient}=await import('../server/test-payouts');
const PLATFORM='acct_1StBIYJ6Er233b9c',DEST='acct_TestPayoutDestination';
let server:Server,base:string,owner:{id:string;cookie:string},other:{id:string;cookie:string};
let available=100000,payoutStatus='pending',platform=PLATFORM,wrongMode=false;
let lastMetadata:Record<string,string>={},lastAmount=0;
let calls:{transfers:any[];payouts:any[];charges:any[]};

function actor(role='admin'){
 const id=randomUUID(),token=randomBytes(32).toString('hex');
 run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,1,123000000,456000000)',id,id+'@sandbox.test','Sandbox admin','!disabled',role);
 run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+600000);
 run('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,987000000,654000000,1)',id);
 return{id,cookie:'drama_session='+token};
}
const balances=(id:string)=>({live:one('SELECT wallet_micros,earnings_micros,stripe_account_id FROM users WHERE id=?',id),test:one('SELECT wallet_micros,earnings_micros FROM test_accounts WHERE user_id=?',id),liveWithdrawals:one('SELECT COUNT(*) AS n FROM withdrawals')!.n,liveLedger:one('SELECT COUNT(*) AS n FROM ledger')!.n,testLedger:one('SELECT COUNT(*) AS n FROM test_ledger')!.n});
async function request(route:string,body:unknown|undefined,cookie=owner.cookie,expected=200){
 const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);return data;
}
const payout=(id='po_test_bank')=>({id,livemode:wrongMode,status:payoutStatus,currency:'hkd',amount:lastAmount,metadata:lastMetadata,automatic:false});
function fixture(){
 const stripe=testPayoutClient();
 mock.method(stripe.accounts,'retrieve',async(id?:string)=>id?{id,country:'HK',default_currency:'hkd',capabilities:{transfers:'active'},payouts_enabled:true,external_accounts:{data:[{id:'ba_test',object:'bank_account',currency:'hkd',default_for_currency:true}]}}:{id:platform});
 mock.method(stripe.balance,'retrieve',async()=>({livemode:false,available:[{currency:'hkd',amount:available}]}));
 mock.method(stripe.charges,'create',async(params:any,options:any)=>{calls.charges.push({params,options});return{id:'ch_test_funds',livemode:false,paid:true,status:'succeeded',amount:params.amount,currency:params.currency};});
 const transfer=(params:any)=>({id:'tr_test_'+params.metadata.testWithdrawalId,livemode:wrongMode,amount:params.amount,currency:params.currency,destination:params.destination,destination_payment:'py_'+params.metadata.testWithdrawalId,metadata:params.metadata,reversed:false});
 mock.method(stripe.transfers,'create',async(params:any,options:any)=>{calls.transfers.push({params,options});return transfer(params);});
 mock.method(stripe.transfers,'retrieve',async(id:string)=>{const r=one('SELECT * FROM admin_test_withdrawals WHERE transfer_id=?',id)!;return transfer({amount:r.provider_amount,currency:r.currency,destination:r.connected_account_id,metadata:{testWithdrawalId:r.id}});});
 mock.method(stripe.payouts,'list',async()=>({data:[],has_more:false}));
 mock.method(stripe.balanceTransactions,'list',async()=>({data:[],has_more:false}));
 mock.method(stripe.payouts,'create',async(params:any,options:any)=>{calls.payouts.push({params,options});lastMetadata=params.metadata;lastAmount=params.amount;return payout();});
 mock.method(stripe.payouts,'retrieve',async(id:string)=>payout(id));
 return stripe;
}
async function create(amount=1000,key=randomUUID()){
 return(await request('/api/studio/test-withdrawals',{amount_cents:amount,request_key:key},owner.cookie,201)).request;
}
before(async()=>{const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
beforeEach(()=>{
 run('DELETE FROM admin_test_payout_receipts');run('DELETE FROM admin_test_withdrawal_events');run('DELETE FROM admin_test_withdrawals');
 config.production=true;config.payments='stripe';config.stripeTestMode=true;config.testPayoutsEnabled=true;config.testPayoutAccount=DEST;config.testConnectWebhook='whsec_test_connect_fixture';config.stripeTestKey='rk_test_admin_withdrawal_fixture';config.appUrl=base;config.usdToHkd=7.8;
 config.payoutsEnabled=false;owner=actor();other=actor();config.platformOwnerUserId=owner.id;
 available=100000;payoutStatus='pending';platform=PLATFORM;wrongMode=false;lastAmount=0;lastMetadata={};calls={transfers:[],payouts:[],charges:[]};fixture();
});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('unlimited allowance is private to the owner in explicit enabled test mode',async()=>{
 assert.equal((await request('/api/auth/me',undefined)).user.test_withdrawal_unlimited,true);
 assert.equal((await request('/api/auth/me',undefined,other.cookie)).user.test_withdrawal_unlimited,undefined);
 await request('/api/studio/test-withdrawals',undefined,other.cookie,403);
 await request('/api/studio/test-withdrawals',undefined,'',401);
 config.stripeTestMode=false;await request('/api/studio/test-withdrawals',undefined,owner.cookie,403);
 config.stripeTestMode=true;config.testPayoutsEnabled=false;await request('/api/studio/test-withdrawals',undefined,owner.cookie,403);
 assert.equal(calls.transfers.length,0);
});

test('live keys and another sandbox are rejected before any provider write',async()=>{
 config.stripeTestKey='sk_live_forbidden_fixture';await request('/api/studio/test-withdrawals',undefined,owner.cookie,503);
 config.stripeTestKey='rk_test_admin_withdrawal_fixture';platform='acct_other_sandbox';await request('/api/studio/test-withdrawals',undefined,owner.cookie,503);
 assert.equal(calls.transfers.length,0);assert.equal(calls.charges.length,0);assert.equal(calls.payouts.length,0);
});

test('a finite quote reserves no real/test earnings and has an immutable gross, fee, net and HKD amount',async()=>{
 const before=balances(owner.id),key=randomUUID();
 const r=await create(1000,key);assert.equal(r.gross_cents,1000);assert.equal(r.fee_cents,100);assert.equal(r.net_cents,900);assert.equal(r.provider_amount,7020);assert.equal(r.currency,'hkd');
 config.usdToHkd=9;
 const replay=await create(1000,key);assert.equal(replay.id,r.id);assert.equal(replay.provider_amount,7020);
 await request('/api/studio/test-withdrawals',{amount_cents:2000,request_key:key},owner.cookie,409);
 await request('/api/studio/test-withdrawals',{amount_cents:999,request_key:randomUUID()},owner.cookie,400);
 await request('/api/studio/test-withdrawals',{amount_cents:Infinity,request_key:randomUUID()},owner.cookie,400);
 await request('/api/studio/test-withdrawals',{amount_cents:10000001,request_key:randomUUID()},owner.cookie,400);
 await request('/api/studio/test-withdrawals',{amount_cents:1000,request_key:randomUUID(),connected_account_id:'acct_attacker'},owner.cookie,400);
 assert.deepEqual(balances(owner.id),before);
 assert.equal((await request('/api/studio/test-withdrawals',undefined)).unlimited,true);
});

test('transfer and bank payout are separate; refresh marks paid only after the provider reports it',async()=>{
 const before=balances(owner.id),r=await create();
 const result=(await request(`/api/studio/test-withdrawals/${r.id}/process`,{})).request;
 assert.equal(result.status,'payout_pending');assert.equal(result.transfer_id,'tr_test_'+r.id);assert.equal(result.payout_id,'po_test_bank');
 assert.equal(calls.transfers[0].params.amount,7020);assert.equal(calls.payouts[0].params.amount,7020);assert.equal(calls.payouts[0].options.stripeAccount,DEST);
 assert.equal(calls.transfers[0].options.idempotencyKey,'test-withdrawal:transfer:'+r.id);
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{});assert.equal(calls.transfers.length,1);assert.equal(calls.payouts.length,1);
 payoutStatus='paid';assert.equal((await request(`/api/studio/test-withdrawals/${r.id}/sync`,{})).request.status,'paid');
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,409);
 assert.deepEqual(balances(owner.id),before);
});

test('test funds are replenished with a fixed sandbox token only when needed',async()=>{
 available=0;const before=balances(owner.id),r=await create();
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{});
 assert.equal(calls.charges.length,1);assert.equal(calls.charges[0].params.source,'tok_bypassPending');assert.equal(calls.charges[0].params.currency,'hkd');assert.equal(calls.charges[0].options.idempotencyKey,'test-withdrawal:fund:'+r.id);
 assert.equal(one('SELECT funding_charge_id FROM admin_test_withdrawals WHERE id=?',r.id)!.funding_charge_id,'ch_test_funds');assert.deepEqual(balances(owner.id),before);
});

test('lost transfer responses retain the same quote and provider retry key',async()=>{
 const stripe=testPayoutClient(),original=stripe.transfers.create.bind(stripe.transfers);let lost=true;
 mock.method(stripe.transfers,'create',async(...args:any[])=>{const result=await(original as any)(...args);if(lost){lost=false;throw new Error('Simulated lost response');}return result;});
 const r=await create();await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,503);
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{});
 assert.equal(calls.transfers.length,2);assert.deepEqual(calls.transfers[0],calls.transfers[1]);assert.equal(calls.payouts.length,1);
});

test('payout permission failure leaves the transfer visible and retry does not transfer again',async()=>{
 const stripe=testPayoutClient(),original=stripe.payouts.create.bind(stripe.payouts);let denied=true;
 mock.method(stripe.payouts,'create',async(...args:any[])=>{if(denied)throw{statusCode:403};return(original as any)(...args);});
 const r=await create();const error=await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,503);assert.equal(error.error.code,'TEST_PAYOUT_PERMISSION_REQUIRED');
 assert.equal(one('SELECT status FROM admin_test_withdrawals WHERE id=?',r.id)!.status,'transferred');denied=false;
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{});assert.equal(calls.transfers.length,1);
});

test('expired retries, overlapping processing, non-owner actions and rejection after a provider attempt are blocked',async()=>{
 const r=await create();await request(`/api/studio/test-withdrawals/${r.id}/process`,{},other.cookie,403);
 run('UPDATE admin_test_withdrawals SET lease_until_ms=? WHERE id=?',Date.now()+120000,r.id);
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,409);
 run("UPDATE admin_test_withdrawals SET lease_until_ms=0,first_attempt_ms=?,status='processing' WHERE id=?",Date.now()-24*60*60_000,r.id);
 await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,409);
 await request(`/api/studio/test-withdrawals/${r.id}/reject`,{},owner.cookie,409);
 assert.equal(calls.transfers.length,0);assert.equal(calls.payouts.length,0);
});

test('pending test requests can be rejected without changing any balance',async()=>{
 const before=balances(owner.id),r=await create();await request(`/api/studio/test-withdrawals/${r.id}/reject`,{});
 await request(`/api/studio/test-withdrawals/${r.id}/reject`,{},owner.cookie,409);assert.deepEqual(balances(owner.id),before);
});

async function webhook(id:string,live=false,expected=200,account=DEST){
 const payload=JSON.stringify({id,type:'payout.paid',object:'event',livemode:live,account,data:{object:{id:'po_test_bank',livemode:live}}});
 const signature=testPayoutClient().webhooks.generateTestHeaderString({payload,secret:config.testConnectWebhook});
 const response=await fetch(base+'/api/test-payouts/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});
 assert.equal(response.status,expected,await response.text());
}
test('signed late sandbox events update only test requests even after live UI selection; replay and wrong mode are rejected',async()=>{
 const before=balances(owner.id),r=await create();await request(`/api/studio/test-withdrawals/${r.id}/process`,{});
 config.stripeTestMode=false;payoutStatus='paid';const id='evt_'+randomUUID();await webhook(id);await webhook(id);
 assert.equal(one('SELECT status FROM admin_test_withdrawals WHERE id=?',r.id)!.status,'paid');assert.equal(one('SELECT COUNT(*) AS n FROM admin_test_payout_receipts WHERE event_id=?',id)!.n,1);
 await webhook('evt_'+randomUUID(),true,409);await webhook('evt_'+randomUUID(),false,200,'acct_unrelated');
 assert.deepEqual(balances(owner.id),before);
});

test('failed bank payouts are shown as failed rather than paid',async()=>{
 const r=await create();await request(`/api/studio/test-withdrawals/${r.id}/process`,{});payoutStatus='failed';
 assert.equal((await request(`/api/studio/test-withdrawals/${r.id}/sync`,{})).request.status,'failed');
});

test('bank failures remain observable after Stripe disables payouts on the receiving account',async()=>{
 const r=await create();await request(`/api/studio/test-withdrawals/${r.id}/process`,{});payoutStatus='failed';
 const stripe=testPayoutClient();mock.method(stripe.accounts,'retrieve',async(id?:string)=>id?{id,default_currency:'hkd',capabilities:{transfers:'active'},payouts_enabled:false}:{id:PLATFORM});
 assert.equal((await request('/api/studio/test-withdrawals',undefined)).ready,false);
 assert.equal((await request(`/api/studio/test-withdrawals/${r.id}/sync`,{})).request.status,'failed');
 const fresh=await request('/api/studio/test-withdrawals',{amount_cents:1000,request_key:randomUUID()},owner.cookie,409);assert.equal(fresh.error.code,'TEST_PAYOUT_ACCOUNT_NOT_READY');
});

test('automatic bank batches are correlated through the transfer payment rather than arbitrary payout amounts',async()=>{
 const stripe=testPayoutClient();mock.method(stripe.payouts,'create',async()=>{throw{statusCode:403};});
 const r=await create();await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,503);
 mock.method(stripe.payouts,'list',async()=>({data:[{id:'po_auto_batch',livemode:false,currency:'hkd',amount:99999,status:'paid',automatic:true,metadata:{}}],has_more:false}));
 mock.method(stripe.balanceTransactions,'list',async()=>({data:[{source:'py_'+r.id}],has_more:false}));
 assert.equal((await request(`/api/studio/test-withdrawals/${r.id}/process`,{})).request.status,'paid');assert.equal(calls.transfers.length,1);
});

test('an unexpected live transfer response cannot mark a test request transferred or paid',async()=>{
 const r=await create(),before=balances(owner.id);wrongMode=true;
 const error=await request(`/api/studio/test-withdrawals/${r.id}/process`,{},owner.cookie,409);assert.equal(error.error.code,'TEST_PAYOUT_MODE_MISMATCH');
 assert.equal(one('SELECT transfer_id FROM admin_test_withdrawals WHERE id=?',r.id)!.transfer_id,null);assert.equal(calls.payouts.length,0);assert.deepEqual(balances(owner.id),before);
});
