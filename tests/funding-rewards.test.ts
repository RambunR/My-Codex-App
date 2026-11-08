import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import Stripe from 'stripe';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-funding-rewards-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='stripe';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const {paymentTable}=await import('../server/payment-state');
const {fundingSnapshot,storeFundingQuote}=await import('../server/funding-rewards');
const {fundingRewardQuote,FUNDING_REWARD_OFFER_VERSION}=await import('../shared/funding-rewards');
const risk=await import('../server/payment-risk');
const liveKey='sk_live_funding_reward_fixture_only',testKey='sk_test_funding_reward_fixture_only';
const liveSecret='whsec_live_funding_reward_fixture_only',testSecret='whsec_test_funding_reward_fixture_only';
const signer=new Stripe(testKey),baseline={...config};
let server:Server,base:string,calls:any[]=[];
interface Actor {id:string;cookie:string}
interface Payment {id:string;userId:string;session:string;amount:number;live:boolean;pi:string}
function identity(role='viewer'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,?)',id,id+'@rewards.test','Funding reward test','!disabled-test-login',role,role==='viewer'?0:1);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
  return{id,cookie:'drama_session='+token};
}
function select(testMode:boolean){
  Object.assign(config,baseline,{production:true,sandbox:false,payments:'stripe',stripeTestMode:testMode,stripeAutoConfigureWebhook:false,payoutsEnabled:false,
    stripeLiveKey:liveKey,stripeLiveWebhook:liveSecret,stripeTestKey:testKey,stripeTestWebhook:testSecret,
    stripeKey:testMode?testKey:liveKey,stripeWebhook:testMode?testSecret:liveSecret,stripeWalletProductId:'prod_existing_wallet_fixture',stripeActivationPriceId:'',appUrl:base,stripeSiteOrigin:'https://financial-rewards.example.test'});
  finance.configureStripe();
  mock.method(finance.stripe!.checkout.sessions,'create',async(params:any)=>{
    calls.push(params);const live=/^(sk|rk)_live_/.test(config.stripeKey),id='cs_'+(live?'live':'test')+'_'+params.metadata.paymentId;
    return{id,object:'checkout.session',url:'https://checkout.stripe.com/c/pay/local-fixture',mode:'payment',status:'open',payment_status:'unpaid',livemode:live,amount_total:params.line_items[0].price_data.unit_amount,currency:params.line_items[0].price_data.currency,payment_intent:'pi_'+params.metadata.paymentId} as any;
  });
}
async function request(route:string,body?:unknown,cookie='',status=200,headers:Record<string,string>={}){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,status,route+': '+JSON.stringify(data));return{data,response};
}
async function checkout(actor:Actor,amount:number,extra:Record<string,unknown>={}):Promise<Payment>{
  const result=(await request('/api/payments/checkout',{kind:'funding',amount_cents:amount,...extra},actor.cookie)).data;
  const p=one('SELECT * FROM '+paymentTable()+' WHERE id=?',result.paymentId)!;
  return{id:p.id,userId:actor.id,session:p.provider_session,amount:p.amount_cents,live:!config.stripeTestMode,pi:'pi_'+p.id};
}
function legacyPayment(actor:Actor,amount:number,live=true):Payment{
  const id=randomUUID(),session='cs_'+(live?'live':'test')+'_'+id;
  if(!live)run('INSERT OR IGNORE INTO test_accounts (user_id) VALUES (?)',actor.id);
  run('INSERT INTO '+(live?'payments':'test_payments')+' (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?, ?,?,?,?)',id,actor.id,'funding',amount,'usd','stripe',session);
  return{id,userId:actor.id,session,amount,live,pi:'pi_'+id};
}
function event(p:Payment,change:Record<string,unknown>={}){
  return{id:'evt_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode:p.live,created:100,data:{object:{id:p.session,object:'checkout.session',mode:'payment',livemode:p.live,payment_status:'paid',amount_total:p.amount,currency:'usd',payment_intent:p.pi,client_reference_id:p.id,metadata:{app:'aidramio',site:config.stripeSiteOrigin,paymentId:p.id,userId:p.userId,financialMode:p.live?'default':'test'},...change}}};
}
async function deliver(value:any,status=200,secret=value.livemode?liveSecret:testSecret){
  const payload=JSON.stringify(value),signature=signer.webhooks.generateTestHeaderString({payload,secret});
  const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
const balance=(actor:Actor,testMode=false)=>Number(one('SELECT wallet_micros FROM '+(testMode?'test_accounts':'users')+' WHERE '+(testMode?'user_id':'id')+'=?',actor.id)?.wallet_micros||0);
const ledger=(actor:Actor,testMode=false)=>all('SELECT kind,amount_micros,reference_id FROM '+(testMode?'test_ledger':'ledger')+' WHERE user_id=? ORDER BY kind',actor.id);
before(async()=>{const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(()=>{calls=[];select(false);});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('reward arithmetic is exact and limited to the two USD amounts, including custom input',()=>{
  for(const [amount,bonus] of [[5000,500],[10000,1500],[500,0],[4999,0],[5001,0],[9999,0],[10001,0],[15000,0]]){
    const quote=fundingRewardQuote(amount);assert.equal(quote.bonusCents,bonus);assert.equal(quote.totalCreditCents,amount+bonus);assert.equal(quote.offerVersion,FUNDING_REWARD_OFFER_VERSION);
  }
  for(const amount of [-1,5000.5,NaN,Infinity])assert.throws(()=>fundingRewardQuote(amount));
});

test('wallet funding requires authentication and same-origin requests and exposes only the approved quick options',async()=>{
  const actor=identity();await request('/api/payments/checkout',{kind:'funding',amount_cents:5000},'',401);
  await request('/api/payments/checkout',{kind:'funding',amount_cents:5000},actor.cookie,403,{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'});
  assert.equal(calls.length,0);assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',actor.id)!.n,0);
  const c=(await request('/api/config')).data;assert.deepEqual(c.walletFunding.presetAmountsCents,[1000,2500,5000,10000]);assert.equal(c.limits.minWalletFundingUsd,5);
});

test('an unpaid US$50 or US$100 checkout freezes the server offer but does not credit money',async()=>{
  for(const [amount,bonus] of [[5000,500],[10000,1500]]){
    const actor=identity(),p=await checkout(actor,amount),quote=fundingSnapshot(p.id)!;
    assert.equal(quote.user_id,actor.id);assert.equal(quote.amount_cents,amount);assert.equal(quote.bonus_cents,bonus);assert.equal(quote.financial_mode,'default');assert.equal(balance(actor),0);assert.deepEqual(ledger(actor),[]);
    const params=calls.at(-1);assert.equal(params.line_items[0].price_data.unit_amount,amount);assert.equal(params.line_items[0].price_data.product,undefined);
    const copy=JSON.stringify({description:params.line_items[0].price_data.product_data.description,custom_text:params.custom_text});
    assert.ok(copy.includes((amount/100).toFixed(2)));assert.ok(copy.includes((bonus/100).toFixed(2)));assert.ok(copy.includes(((amount+bonus)/100).toFixed(2)));
    await deliver(event(p,{payment_status:'unpaid'}));assert.equal(balance(actor),0);assert.deepEqual(ledger(actor),[]);
  }
});

test('verified paid funding credits principal and gift exactly once under concurrent and repeated webhooks',async()=>{
  for(const [amount,bonus] of [[5000,500],[10000,1500]]){
    const actor=identity(),p=await checkout(actor,amount),paid=event(p);
    await Promise.all([deliver(paid),deliver(paid),deliver(event(p)),deliver(event(p))]);
    assert.equal(balance(actor),(amount+bonus)*10000);
    assert.deepEqual(ledger(actor).map(x=>[x.kind,x.amount_micros]),[['funding',amount*10000],['funding_bonus',bonus*10000]]);
    assert.equal(one('SELECT publisher_active FROM users WHERE id=?',actor.id)!.publisher_active,0);assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',actor.id)!.earnings_micros,0);
    assert.equal(one('SELECT COUNT(*) AS n FROM wallet_funding_quotes WHERE payment_id=?',p.id)!.n,1);
  }
});

test('signed amount, currency and Session mismatches cannot settle either cash or the gift',async()=>{
  const actor=identity(),p=await checkout(actor,5000);
  for(const change of [{amount_total:4999},{currency:'hkd'},{id:'cs_wrong_session'}])await deliver(event(p,change),400);
  assert.equal(balance(actor),0);assert.deepEqual(ledger(actor),[]);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
  await deliver(event(p));assert.equal(balance(actor),55_000_000);
});

test('client and provider reward or ownership fields cannot invent a larger gift or redirect wallet credit',async()=>{
  const actor=identity(),other=identity(),p=await checkout(actor,5000,{bonus_cents:999999,total_credit_cents:999999,user_id:other.id});
  await deliver(event(p,{metadata:{app:'aidramio',site:config.stripeSiteOrigin,paymentId:p.id,userId:other.id,bonusCents:'999999',totalCreditCents:'999999',financialMode:'test'}}));
  assert.equal(balance(actor),55_000_000);assert.equal(balance(other),0);assert.equal(ledger(actor).filter(x=>x.kind==='funding_bonus')[0].amount_micros,5_000_000);
});

test('old pending US$50 and US$100 payments without a stored quote receive no retroactive gift',async()=>{
  for(const amount of [5000,10000]){
    const actor=identity(),p=legacyPayment(actor,amount);assert.equal(fundingSnapshot(p.id),undefined);
    await deliver(event(p,{metadata:{app:'aidramio',site:config.stripeSiteOrigin,paymentId:p.id,userId:actor.id,bonusCents:'1500'}}));
    assert.equal(balance(actor),amount*10000);assert.equal(ledger(actor).length,1);assert.equal(ledger(actor)[0].kind,'funding');
  }
});

test('tampered frozen quote owner, amount, gift or version rejects settlement atomically',async()=>{
  const mutations=[['user_id',()=>identity().id],['amount_cents',()=>10000],['bonus_cents',()=>1500],['offer_version',()=>'untrusted-client-offer']] as const;
  for(const [field,value] of mutations){
    const actor=identity(),p=await checkout(actor,5000);run('UPDATE wallet_funding_quotes SET '+field+'=? WHERE payment_id=?',value(),p.id);
    const failed=await deliver(event(p),400);assert.equal(failed.error.code,'FUNDING_QUOTE_MISMATCH');assert.equal(balance(actor),0);assert.deepEqual(ledger(actor),[]);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
  }
});

test('both quote creation and settlement include gift credit in safe-integer wallet capacity checks',async()=>{
  const actor=identity(),before=Number.MAX_SAFE_INTEGER-51_000_000;run('UPDATE users SET wallet_micros=? WHERE id=?',before,actor.id);
  const failed=await request('/api/payments/checkout',{kind:'funding',amount_cents:5000},actor.cookie,400);assert.equal(failed.data.error.code,'WALLET_LIMIT_REACHED');assert.equal(calls.length,0);
  assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',actor.id)!.n,0);assert.equal(balance(actor),before);
  run('UPDATE users SET wallet_micros=0 WHERE id=?',actor.id);const p=await checkout(actor,5000);run('UPDATE users SET wallet_micros=? WHERE id=?',before,actor.id);
  const rejected=await deliver(event(p),409);assert.equal(rejected.error.code,'BALANCE_LIMIT');assert.equal(balance(actor),before);assert.deepEqual(ledger(actor),[]);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
});

test('live and test reward payments settle in their signed partition even after the UI mode switches',async()=>{
  for(const activeTestMode of [false,true]){
    const actor=identity();select(false);const live=await checkout(actor,5000);select(true);const testPayment=await checkout(actor,10000);select(activeTestMode);
    await Promise.all([deliver(event(live)),deliver(event(testPayment)),deliver(event(live)),deliver(event(testPayment))]);
    assert.equal(balance(actor),55_000_000);assert.equal(balance(actor,true),115_000_000);assert.equal(ledger(actor).length,2);assert.equal(ledger(actor,true).length,2);assert.equal(config.stripeTestMode,activeTestMode);
    assert.equal(fundingSnapshot(live.id,'default')!.bonus_cents,500);assert.equal(fundingSnapshot(testPayment.id,'test')!.bonus_cents,1500);assert.equal(fundingSnapshot(live.id,'test'),undefined);
  }
});

test('forged signatures and test notifications referencing a live quote cannot mint live or test bonus credit',async()=>{
  const actor=identity(),live=await checkout(actor,5000);select(true);const testPayment=await checkout(actor,10000);select(false);
  await deliver(event(live),400,'whsec_forged_reward_fixture_only');
  assert.equal((await deliver(event(live),200,testSecret)).ignored,true);
  const forged=event(testPayment);forged.data.object.metadata.paymentId=live.id;forged.data.object.id=live.session;await deliver(forged);
  assert.equal(balance(actor),0);assert.equal(balance(actor,true),0);assert.deepEqual(ledger(actor),[]);assert.deepEqual(ledger(actor,true),[]);
});

const note='Verified original payment and documented the full promotional-credit adjustment.';
function refund(p:Payment,amount=p.amount,created=100){return{id:'evt_'+randomUUID(),type:'charge.refunded',livemode:p.live,created,data:{object:{id:'ch_'+p.id,payment_intent:p.pi,amount:p.amount,amount_refunded:amount,currency:'usd'}}};}
function dispute(p:Payment,id='dp_'+randomUUID(),status='needs_response',created=100){return{id:'evt_'+randomUUID(),type:status==='won'||status==='lost'?'charge.dispute.closed':'charge.dispute.created',livemode:p.live,created,data:{object:{id,payment_intent:p.pi,charge:'ch_'+p.id,amount:p.amount,currency:'usd',status}}};}

test('a refunded bonus deposit remains held until an admin reviews principal plus the whole gift',async()=>{
  const actor=identity(),admin=identity('admin'),p=await checkout(actor,5000);await deliver(event(p));await deliver(refund(p));
  assert.equal(balance(actor),55_000_000,'Provider notifications must not debit a wallet automatically.');assert.equal(risk.paymentAccountReview(actor.id),true);
  const review=risk.adminPaymentReviews().find(x=>x.payment_id===p.id)!;assert.equal(review.funding_bonus_cents,500);assert.equal(review.remaining_cents,5500);
  assert.throws(()=>risk.resolvePaymentReview(review.id,actor.id,{decision:'reconciled',wallet_debit_cents:5500,note}),(e:any)=>e.code==='FORBIDDEN');
  risk.resolvePaymentReview(review.id,admin.id,{decision:'reconciled',wallet_debit_cents:5500,note});assert.equal(balance(actor),0);assert.equal(risk.paymentAccountReview(actor.id),false);
  const adjusted=risk.resolvePaymentReview(review.id,admin.id,{decision:'reconciled',wallet_debit_cents:5500,note});assert.equal(adjusted.alreadyResolved,true);assert.equal(balance(actor),0);
});

test('partial refunds forfeit the full gift once, then later refunds recover only incremental cash',async()=>{
  const actor=identity(),admin=identity('admin'),p=await checkout(actor,5000);await deliver(event(p));await deliver(refund(p,1000));
  const review=risk.adminPaymentReviews().find(x=>x.payment_id===p.id)!;assert.equal(review.remaining_cents,1500);
  risk.resolvePaymentReview(review.id,admin.id,{decision:'reconciled',wallet_debit_cents:1500,note});assert.equal(balance(actor),40_000_000);
  await deliver(refund(p,5000,200));assert.equal(risk.adminPaymentReviews().find(x=>x.id===review.id)!.remaining_cents,4000);
  risk.resolvePaymentReview(review.id,admin.id,{decision:'reconciled',wallet_debit_cents:4000,note});assert.equal(balance(actor),0);
});

test('overlapping refund and dispute allocations cap recovery at the paid amount plus one gift',async()=>{
  const actor=identity(),admin=identity('admin'),p=await checkout(actor,5000);await deliver(event(p));await deliver(refund(p,1000));const disputeId='dp_'+randomUUID();await deliver(dispute(p,disputeId));
  const reviews=risk.adminPaymentReviews().filter(x=>x.payment_id===p.id),refunded=reviews.find(x=>x.kind==='refund')!,disputed=reviews.find(x=>x.kind==='dispute')!;
  risk.resolvePaymentReview(refunded.id,admin.id,{decision:'reconciled',wallet_debit_cents:1500,note});assert.equal(risk.adminPaymentReviews().find(x=>x.id===disputed.id)!.remaining_cents,4000);
  risk.resolvePaymentReview(disputed.id,admin.id,{decision:'reconciled',wallet_debit_cents:4000,note});assert.equal(balance(actor),0);
  await deliver(dispute(p,disputeId,'won',200));risk.resolvePaymentReview(disputed.id,admin.id,{decision:'provider_reversed',note});assert.equal(balance(actor),40_000_000);
  assert.equal(risk.adminPaymentReviews().find(x=>x.id===refunded.id)!.remaining_cents,0);assert.equal(risk.paymentAccountReview(actor.id),false);
});

test('two independent partial review cases recover the promotional gift only once',async()=>{
  const actor=identity(),admin=identity('admin'),p=await checkout(actor,5000);await deliver(event(p));
  const a=refund(p,100),b=refund(p,200);b.data.object.id='ch_second_'+p.id;await deliver(a);await deliver(b);
  const reviews=risk.adminPaymentReviews().filter(x=>x.payment_id===p.id),first=reviews.find(x=>x.provider_object_id===a.data.object.id)!,second=reviews.find(x=>x.provider_object_id===b.data.object.id)!;
  assert.equal(first.remaining_cents,600);risk.resolvePaymentReview(first.id,admin.id,{decision:'reconciled',wallet_debit_cents:600,note});
  assert.equal(risk.adminPaymentReviews().find(x=>x.id===second.id)!.remaining_cents,200);
  risk.resolvePaymentReview(second.id,admin.id,{decision:'reconciled',wallet_debit_cents:200,note});assert.equal(balance(actor),47_000_000);
  const allocations=all('SELECT bonus_debit_cents,bonus_loss_cents FROM funding_bonus_review_allocations WHERE case_id IN (?,?)',first.id,second.id);
  assert.equal(allocations.reduce((sum,row)=>sum+row.bonus_debit_cents+row.bonus_loss_cents,0),500);
});

test('a won dispute reverses a gift-only debit and reopens a sibling with uncovered gift exposure',async()=>{
  const actor=identity(),admin=identity('admin'),p=await checkout(actor,5000);await deliver(event(p));await deliver(refund(p));
  const refunded=risk.adminPaymentReviews().find(x=>x.payment_id===p.id)!;
  // Model an already-recorded principal-only administrative adjustment. The
  // new sidecar must safely reconcile this valid legacy allocation shape.
  run("UPDATE payment_risk_cases SET wallet_debit_cents=5000,status='resolved',decision='reconciled' WHERE id=?",refunded.id);
  run('UPDATE users SET wallet_micros=5000000 WHERE id=?',actor.id);
  const providerId='dp_gift_only_'+p.id;await deliver(dispute(p,providerId));
  const disputed=risk.adminPaymentReviews().find(x=>x.provider_object_id===providerId)!;assert.equal(disputed.remaining_cents,500);
  risk.resolvePaymentReview(disputed.id,admin.id,{decision:'reconciled',wallet_debit_cents:500,note});assert.equal(balance(actor),0);
  assert.equal(one('SELECT wallet_debit_cents FROM payment_risk_cases WHERE id=?',disputed.id)!.wallet_debit_cents,0);
  await deliver(dispute(p,providerId,'won',200));assert.equal(risk.adminPaymentReviews().find(x=>x.id===disputed.id)!.status,'open');
  risk.resolvePaymentReview(disputed.id,admin.id,{decision:'provider_reversed',note});assert.equal(balance(actor),5_000_000);
  const reopened=risk.adminPaymentReviews().find(x=>x.id===refunded.id)!;assert.equal(reopened.status,'open');assert.equal(reopened.remaining_cents,500);assert.equal(risk.paymentAccountReview(actor.id),true);
  risk.resolvePaymentReview(refunded.id,admin.id,{decision:'reconciled',wallet_debit_cents:500,note});assert.equal(balance(actor),0);
});

test('a gift-funded wallet unlocks an episode with an exact fractional-cent split without making the gift withdrawable',async()=>{
  const actor=identity(),creator=identity('publisher'),p=await checkout(actor,5000);await deliver(event(p));
  const seriesId=randomUUID(),episodeId=randomUUID();
  run("INSERT INTO series (id,creator_id,title,description,language,genres,status,price_cents,free_episodes) VALUES (?,?,?,?,?,?,'published',51,0)",seriesId,creator.id,'Gift unlock fixture','An original episode verifying promotional wallet credit.','en','["drama"]');
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episodeId,seriesId,'Paid episode',1,10,1,'fixture/not-streamed.mp4');
  const purchase=(await request('/api/episodes/'+episodeId+'/unlock',{},actor.cookie)).data;
  assert.equal(purchase.paid_micros,510_000);assert.equal(purchase.creator_micros,357_000);assert.equal(purchase.platform_micros,153_000);assert.equal(balance(actor),54_490_000);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',actor.id)!.earnings_micros,0);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',creator.id)!.earnings_micros,357_000);
  await request('/api/studio/withdrawals',{amount_cents:300},actor.cookie,403);
  assert.equal(one('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id=?',actor.id)!.n,0);
});
