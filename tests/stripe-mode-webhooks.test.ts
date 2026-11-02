import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import Stripe from 'stripe';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-mode-webhooks-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='stripe';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,run}=await import('../server/db');
const finance=await import('../server/finance');
const {usingTestPaymentState,paymentTable}=await import('../server/payment-state');
const {verifiedStripeEventContext,runWithVerifiedStripeEventContext}=await import('../server/stripe-event-context');
const baseline={...config};
const liveKey='sk_live_dual_mode_fixture_only',testKey='sk_test_dual_mode_fixture_only';
const liveSecret='whsec_live_dual_mode_fixture_only',testSecret='whsec_test_dual_mode_fixture_only';
const signer=new Stripe(testKey);
let server:Server,base:string;

function select(testMode:boolean){
 Object.assign(config,baseline,{production:true,sandbox:false,payments:'stripe',stripeTestMode:testMode,stripeAutoConfigureWebhook:false,
  stripeLiveKey:liveKey,stripeLiveWebhook:liveSecret,stripeTestKey:testKey,stripeTestWebhook:testSecret,
  stripeKey:testMode?testKey:liveKey,stripeWebhook:testMode?testSecret:liveSecret,appUrl:base,stripeSiteOrigin:'https://financial-identity.example'});
 finance.configureStripe();
}
before(async()=>{const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
beforeEach(()=>select(false));
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

function user(){const id=randomUUID();run('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)',id,`${id}@mode.test`,'Mode fixture','!disabled-password');return id;}
interface Payment{id:string;userId:string;session:string;live:boolean;amount:number;currency:string;kind:'funding'|'activation'}
function payment(userId:string,live:boolean,kind:'funding'|'activation'='funding',amount=kind==='activation'?5800:500,legacyDefault=false):Payment{
 const id=randomUUID(),session=`cs_${live?'live':'test'}_${id.replaceAll('-','')}`,table=live||legacyDefault?'payments':'test_payments';
 if(!live&&!legacyDefault)run('INSERT OR IGNORE INTO test_accounts (user_id) VALUES (?)',userId);
 const currency=kind==='activation'?'hkd':'usd';
 run(`INSERT INTO ${table} (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?,?,?,'stripe',?)`,id,userId,kind,amount,currency,session);
 if(kind==='activation'&&amount===5800)run("INSERT INTO activation_promotion_quotes (payment_id,financial_mode,code,amount_cents,currency,regular_amount_cents) VALUES (?,?,?,5800,'hkd',8800)",id,live||legacyDefault?'default':'test','LINGYING58');
 return{id,userId,session,live,amount,currency,kind};
}
function checkoutEvent(p:Payment,type='checkout.session.completed',changes:Record<string,unknown>={}){
 return{id:'evt_'+randomUUID().replaceAll('-',''),object:'event',type,livemode:p.live,created:Math.floor(Date.now()/1000),data:{object:{id:p.session,object:'checkout.session',livemode:p.live,payment_status:type==='checkout.session.completed'?'paid':'unpaid',amount_total:p.amount,currency:p.currency,payment_intent:'pi_'+p.id.replaceAll('-',''),metadata:{app:'aidramio',site:config.stripeSiteOrigin,paymentId:p.id,userId:p.userId,financialMode:p.live?'default':'test'},...changes}}};
}
async function deliver(event:any,secret=event.livemode?liveSecret:testSecret,expected=200){
 const payload=JSON.stringify(event),signature=signer.webhooks.generateTestHeaderString({payload,secret});
 const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});
 const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
}
const wallet=(id:string,testState=false)=>one(`SELECT wallet_micros FROM ${testState?'test_accounts':'users'} WHERE ${testState?'user_id':'id'}=?`,id)?.wallet_micros??0;

test('live and test settlements remain partitioned when both signatures arrive concurrently in either UI mode',async()=>{
 for(const testMode of [false,true]){
  select(testMode);const id=user(),live=payment(id,true),testPayment=payment(id,false),a=checkoutEvent(live),b=checkoutEvent(testPayment);
  await Promise.all([deliver(a),deliver(b),deliver(a),deliver(b)]);
  assert.equal(wallet(id),5_000_000);assert.equal(wallet(id,true),5_000_000);
  assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",id)!.n,1);
  assert.equal(one("SELECT COUNT(*) AS n FROM test_ledger WHERE user_id=? AND kind='funding'",id)!.n,1);
  assert.equal(one('SELECT financial_mode FROM stripe_webhook_receipts WHERE payment_id=?',live.id)!.financial_mode,'live');
  assert.equal(one('SELECT financial_mode FROM stripe_webhook_receipts WHERE payment_id=?',testPayment.id)!.financial_mode,'test');
  assert.equal(config.stripeTestMode,testMode);assert.equal(usingTestPaymentState(),testMode);assert.equal(verifiedStripeEventContext(),undefined);
 }
});

test('a missing active test pair does not drop a valid saved live payment or live refund hold',async()=>{
 select(true);config.stripeKey='';config.stripeWebhook='';config.stripeTestKey='';config.stripeTestWebhook='';finance.configureStripe();assert.equal(finance.stripeConfigured(),false);
 const id=user(),p=payment(id,true);await deliver(checkoutEvent(p));assert.equal(wallet(id),5_000_000);assert.equal(wallet(id,true),0);
 await deliver({id:'evt_refund_'+p.id,type:'charge.refunded',livemode:true,created:10,data:{object:{id:'ch_'+p.id,payment_intent:'pi_'+p.id.replaceAll('-',''),amount_refunded:500,currency:'usd'}}});
 const review=one('SELECT table_group,livemode,user_id,status FROM payment_risk_cases WHERE user_id=?',id)!;
 assert.deepEqual({...review},{table_group:'default',livemode:1,user_id:id,status:'open'});assert.equal(wallet(id),5_000_000);assert.equal(config.stripeTestMode,true);assert.equal(finance.stripeConfigured(),false);
});

test('late dispute creation and closure remain in the signed financial partition without automatically moving money',async()=>{
 for(const live of [false,true]){
  select(live);const id=user(),p=payment(id,live);await deliver(checkoutEvent(p));
  const disputeId='dp_'+p.id.replaceAll('-','');
  const event=(type:string,status:string,created:number)=>({id:'evt_'+randomUUID().replaceAll('-',''),type,livemode:live,created,data:{object:{id:disputeId,payment_intent:'pi_'+p.id.replaceAll('-',''),amount:500,currency:'usd',status}}});
  await deliver(event('charge.dispute.created','needs_response',10));await deliver(event('charge.dispute.closed','won',11));
  const review=one('SELECT table_group,livemode,user_id,provider_status,status FROM payment_risk_cases WHERE provider_object_id=?',disputeId)!;
  assert.deepEqual({...review},{table_group:live?'default':'test',livemode:live?1:0,user_id:id,provider_status:'won',status:'open'});
  assert.equal(wallet(id, !live),5_000_000);assert.equal(wallet(id,live),0);assert.equal(config.stripeTestMode,live);
 }
});

test('late live and test Pass payments use their own immutable promo proof and never activate the other account state',async()=>{
 select(true);const a=user(),live=payment(a,true,'activation');await deliver(checkoutEvent(live));
 assert.equal(one('SELECT publisher_active FROM users WHERE id=?',a)!.publisher_active,1);assert.equal(one('SELECT publisher_active FROM test_accounts WHERE user_id=?',a),undefined);
 select(false);const b=user(),testPass=payment(b,false,'activation');await deliver(checkoutEvent(testPass));
 assert.equal(one('SELECT publisher_active FROM users WHERE id=?',b)!.publisher_active,0);assert.equal(one('SELECT publisher_active FROM test_accounts WHERE user_id=?',b)!.publisher_active,1);
 assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",b)!.n,0);
 assert.equal(one("SELECT COUNT(*) AS n FROM test_ledger WHERE user_id=? AND kind='activation'",b)!.n,1);
});

test('late expiration and asynchronous failure close only their signed mode and record the matching receipt',async()=>{
 select(true);const id=user(),live=payment(id,true),testPayment=payment(id,false);
 await deliver(checkoutEvent(live,'checkout.session.expired'));assert.equal(one('SELECT status FROM payments WHERE id=?',live.id)!.status,'expired');assert.equal(one('SELECT status FROM test_payments WHERE id=?',testPayment.id)!.status,'pending');
 select(false);await deliver(checkoutEvent(testPayment,'checkout.session.async_payment_failed'));assert.equal(one('SELECT status FROM test_payments WHERE id=?',testPayment.id)!.status,'failed');
 assert.equal(wallet(id),0);assert.equal(wallet(id,true),0);
});

test('forged signatures, secret/mode mismatches and signed test references to real payments cannot fund live wallets',async()=>{
 const id=user(),live=payment(id,true),testPayment=payment(id,false);
 await deliver(checkoutEvent(live),'whsec_unconfigured_fixture_only',400);
 const wrong=await deliver(checkoutEvent(live),testSecret);assert.equal(wrong.ignored,true);
 const forged=checkoutEvent(testPayment);forged.data.object.id=live.session;forged.data.object.metadata.paymentId=live.id;
 assert.equal((await deliver(forged)).ignored,true);assert.equal(wallet(id),0);assert.equal(wallet(id,true),0);
 const mislabeled=checkoutEvent(testPayment);mislabeled.data.object.metadata.financialMode='default';await deliver(mislabeled);assert.equal(wallet(id),0);assert.equal(wallet(id,true),5_000_000);
});

test('inactive-mode settlement still rejects signed amount, currency and Session mismatches and ignores foreign sites',async()=>{
 select(true);const id=user(),p=payment(id,true);
 for(const change of [{amount_total:501},{currency:'hkd'},{id:'cs_wrong_session'}])await deliver(checkoutEvent(p,'checkout.session.completed',change),liveSecret,400);
 const foreign=checkoutEvent(p);foreign.data.object.metadata.site='https://foreign.example';assert.equal((await deliver(foreign)).ignored,true);assert.equal(wallet(id),0);
 const wrongSessionMode=checkoutEvent(p,'checkout.session.completed',{livemode:false});assert.equal((await deliver(wrongSessionMode)).ignored,true);
});

test('active legacy test-key fixtures retain their existing default tables without giving inactive test events that privilege',async()=>{
 select(false);config.production=false;config.stripeKey=testKey;config.stripeWebhook=testSecret;config.stripeLiveKey='';config.stripeLiveWebhook='';finance.configureStripe();
 const id=user(),p=payment(id,false,'funding',500,true);await deliver(checkoutEvent(p));assert.equal(wallet(id),5_000_000);assert.equal(wallet(id,true),0);assert.equal(one('SELECT table_group FROM payment_provider_links WHERE payment_id=?',p.id)!.table_group,'default');
});

test('verified mode contexts survive interleaved awaits and restore the original app mode without global mutation',async()=>{
 select(false);const activeKey=config.stripeKey;
 await Promise.all([false,true,false,true].map(testState=>runWithVerifiedStripeEventContext({testState,livemode:!testState,configured:true},async()=>{
  await Promise.resolve();assert.equal(usingTestPaymentState(),testState);assert.equal(paymentTable(),testState?'test_payments':'payments');assert.equal(finance.stripeModeMatches(!testState),true);
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(usingTestPaymentState(),testState);assert.equal(config.stripeTestMode,false);assert.equal(config.stripeKey,activeKey);
 })));
 assert.equal(verifiedStripeEventContext(),undefined);assert.equal(usingTestPaymentState(),false);assert.equal(config.stripeKey,activeKey);
});
