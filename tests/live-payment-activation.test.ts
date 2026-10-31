import {after,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

// No Stripe network calls: all provider operations exercised below are mocked.
const dir=await mkdtemp(path.join(tmpdir(),'lingying-live-payment-activation-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='stripe';process.env.STRIPE_TEST_MODE='false';
process.env.PAYOUTS_ENABLED='false';
process.env.STRIPE_SECRET_KEY='sk_live_activation_fixture_only';
process.env.STRIPE_WEBHOOK_SECRET='whsec_activation_fixture_only';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const paymentState=await import('../server/payment-state');
const site='https://watch.example.test',identity='https://original.example.test';
const nativeFetch=globalThis.fetch;
let server:Server,base:string;

async function request(route:string,body?:unknown,cookie='',expected=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:config.appUrl,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);
  return{data,cookie:response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))?.split(';')[0]||''};
}
async function viewer(){
  const result=await request('/api/auth/register',{name:'Live setup fixture',email:randomUUID()+'@live-activation.test',password:'LiveActivationFixture123!'},'',201);
  return{id:result.data.user.id,cookie:result.cookie};
}
function pending(userId:string){
  const id=randomUUID(),session='cs_live_fixture_'+randomUUID().replaceAll('-','');
  run('INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?,?,?,?,?)',id,userId,'funding',500,'usd','stripe',session);
  return{id,session,userId};
}
function session(payment:ReturnType<typeof pending>,overrides:Record<string,unknown>={}){
  return{id:payment.session,object:'checkout.session',livemode:true,status:'open',payment_status:'unpaid',amount_total:500,currency:'usd',client_reference_id:payment.id,payment_intent:'pi_fixture_'+payment.id.replaceAll('-',''),
    metadata:{app:'aidramio',paymentId:payment.id,userId:payment.userId,site:identity,financialMode:'default'},...overrides};
}

before(async()=>{
  const {createApp,errorHandler}=await import('../server/app');
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{
  mock.restoreAll();config.production=true;config.sandbox=false;config.appUrl=site;config.publicUrl=site;config.stripeSiteOrigin=identity;
  config.payments='stripe';config.stripeTestMode=false;config.payoutsEnabled=false;
  config.stripeKey='sk_live_activation_fixture_only';config.stripeWebhook='whsec_activation_fixture_only';
  config.stripeActivationPriceId='';config.stripeWalletProductId='';config.mailProvider='disabled';
  mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{
    const url=input instanceof Request?input.url:String(input);
    assert.equal(new URL(url).origin,base,'Unexpected external provider request in an isolated fixture.');
    return nativeFetch(input,init);
  });
  finance.configureStripe();
});
after(async()=>{mock.restoreAll();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('live mode reports live Checkout readiness independently from paused creator payouts',async()=>{
  const {data}=await request('/api/config');
  assert.equal(data.paymentsMode,'stripe');assert.equal(data.paymentsReady,true);assert.equal(data.paymentsConfigured,true);
  assert.equal(data.paymentsTestMode,false);assert.equal(data.payoutsEnabled,false);
  assert.equal(data.sandbox,false);assert.equal(data.uploadsEnabled,true);
  config.stripeKey='rk_test_mismatched_fixture_only';finance.configureStripe();
  assert.equal((await request('/api/config')).data.paymentsReady,false,'Test credentials must not silently enable live payments.');
});

test('inline live Checkout retains exact USD/HKD prices, trusted linkage and custom-domain returns without crediting funds',async()=>{
  const user=await viewer(),calls:any[]=[];
  const created=mock.method(finance.stripe!.checkout.sessions,'create',async(params:any):Promise<any>=>{
    calls.push(params);return{id:'cs_live_created_'+randomUUID().replaceAll('-',''),object:'checkout.session',livemode:true,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/local-live-fixture',metadata:params.metadata,payment_intent:'pi_created_'+params.metadata.paymentId.replaceAll('-','')};
  });
  try{
    for(const kind of ['funding','activation'] as const){
      const result=await request('/api/payments/checkout',kind==='funding'?{kind,amount_cents:2345}:{kind},user.cookie);
      const call=calls.at(-1),where=kind==='funding'?'wallet':'studio';
      assert.equal(call.mode,'payment');assert.deepEqual(call.payment_method_types,['card']);
      assert.equal(call.line_items.length,1);assert.equal(call.line_items[0].quantity,1);
      assert.equal(call.line_items[0].price_data.currency,kind==='funding'?'usd':'hkd');
      assert.equal(call.line_items[0].price_data.unit_amount,kind==='funding'?2345:8800);
      assert.equal(call.metadata.paymentId,result.data.paymentId);assert.equal(call.metadata.userId,user.id);assert.equal(call.metadata.site,identity);
      assert.notEqual(call.metadata.financialMode,'test');
      assert.equal(call.payment_intent_data.metadata.paymentId,result.data.paymentId);
      assert.equal(call.payment_intent_data.metadata.userId,user.id);assert.equal(call.payment_intent_data.metadata.site,identity);
      assert.equal(call.success_url,site+`/${where}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
      assert.equal(call.cancel_url,site+`/${where}?checkout=cancelled`);
      const payment=one('SELECT * FROM payments WHERE id=?',result.data.paymentId)!;assert.equal(payment.status,'pending');
      assert.equal(payment.amount_cents,kind==='funding'?2345:8800);
    }
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,0);
    assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);
    assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',user.id)!.n,0);
  }finally{created.mock.restore();}
});

test('an owner can expire an unpaid live Checkout once, without a wallet credit or ledger entry',async()=>{
  const owner=await viewer(),stranger=await viewer(),payment=pending(owner.id);let retrieves=0,expires=0;
  const retrieved=mock.method(finance.stripe!.checkout.sessions,'retrieve',async(id:string):Promise<any>=>{retrieves++;assert.equal(id,payment.session);return session(payment);});
  const expired=mock.method(finance.stripe!.checkout.sessions,'expire',async(id:string):Promise<any>=>{expires++;assert.equal(id,payment.session);return session(payment,{status:'expired'});});
  try{
    await request(`/api/payments/${payment.id}/cancel`,{},stranger.cookie,404);
    await request(`/api/payments/${payment.id}/cancel`,{},'',401);
    assert.equal(retrieves,0);assert.equal(expires,0,'Unauthorized callers must not contact Stripe.');
    assert.equal((await request(`/api/payments/${payment.id}/cancel`,{},owner.cookie)).data.cancelled,true);
    assert.equal((await request(`/api/payments/${payment.id}/cancel`,{},owner.cookie)).data.cancelled,true);
    assert.equal(expires,1);assert.equal(one('SELECT status FROM payments WHERE id=?',payment.id)!.status,'expired');
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner.id)!.wallet_micros,0);
    assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',owner.id)!.n,0);
  }finally{retrieved.mock.restore();expired.mock.restore();}
});

test('cancellation never expires an externally completed payment and reconciles a paid proof only once',async()=>{
  const owner=await viewer(),paid=pending(owner.id),processing=pending(owner.id);let expires=0;
  const retrieved=mock.method(finance.stripe!.checkout.sessions,'retrieve',async(id:string):Promise<any>=>id===paid.session?session(paid,{status:'complete',payment_status:'paid'}):session(processing,{status:'complete',payment_status:'unpaid'}));
  const expired=mock.method(finance.stripe!.checkout.sessions,'expire',async():Promise<any>=>{expires++;throw new Error('A completed Checkout must never be expired.');});
  try{
    const first=(await request(`/api/payments/${paid.id}/cancel`,{},owner.cookie)).data;
    assert.equal(first.cancelled,false);assert.equal(first.alreadyPaid,true);
    const repeat=(await request(`/api/payments/${paid.id}/cancel`,{},owner.cookie)).data;
    assert.equal(repeat.cancelled,false);assert.equal(repeat.alreadyPaid,true);
    const blocked=await request(`/api/payments/${processing.id}/cancel`,{},owner.cookie,409);assert.equal(blocked.data.error.code,'PAYMENT_PROCESSING');
    assert.equal(expires,0);assert.equal(one('SELECT status FROM payments WHERE id=?',paid.id)!.status,'paid');
    assert.equal(one('SELECT status FROM payments WHERE id=?',processing.id)!.status,'pending');
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner.id)!.wallet_micros,5_000_000);
    assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",owner.id)!.n,1);
  }finally{retrieved.mock.restore();expired.mock.restore();}
});

test('cancellation rejects a Session from the wrong payment mode before any expiry or wallet change',async()=>{
  const owner=await viewer(),payment=pending(owner.id);let expires=0;
  const retrieved=mock.method(finance.stripe!.checkout.sessions,'retrieve',async():Promise<any>=>session(payment,{livemode:false}));
  const expired=mock.method(finance.stripe!.checkout.sessions,'expire',async():Promise<any>=>{expires++;throw new Error('Wrong-mode Session must never be expired.');});
  try{
    const response=await request(`/api/payments/${payment.id}/cancel`,{},owner.cookie,400);assert.equal(response.data.error.code,'PAYMENT_MODE_MISMATCH');
    assert.equal(expires,0);assert.equal(one('SELECT status FROM payments WHERE id=?',payment.id)!.status,'pending');
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner.id)!.wallet_micros,0);
  }finally{retrieved.mock.restore();expired.mock.restore();}
});

test('cancellation validates provider amount, currency and recorded identity before expiring a Session',async()=>{
  const owner=await viewer(),payment=pending(owner.id);let expires=0,proof=session(payment);
  const retrieved=mock.method(finance.stripe!.checkout.sessions,'retrieve',async():Promise<any>=>proof);
  const expired=mock.method(finance.stripe!.checkout.sessions,'expire',async():Promise<any>=>{expires++;throw new Error('Mismatched Session must never be expired.');});
  try{
    for(const override of [
      {id:'cs_live_other_fixture'},
      {amount_total:501},
      {currency:'hkd'},
      {client_reference_id:randomUUID()},
      {metadata:{...session(payment).metadata,site:'https://untrusted.example.test'}},
      {metadata:{...session(payment).metadata,paymentId:randomUUID()}},
      {metadata:{...session(payment).metadata,userId:randomUUID()}},
    ]){
      proof=session(payment,override);
      const response=await request(`/api/payments/${payment.id}/cancel`,{},owner.cookie,400);assert.equal(response.data.error.code,'PAYMENT_MISMATCH');
    }
    assert.equal(expires,0);assert.equal(one('SELECT status FROM payments WHERE id=?',payment.id)!.status,'pending');
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner.id)!.wallet_micros,0);
  }finally{retrieved.mock.restore();expired.mock.restore();}
});

test('a payment completing during unpaid cancellation is reconciled once rather than recorded expired',async()=>{
  const owner=await viewer(),payment=pending(owner.id);let retrieves=0,expires=0;
  const retrieved=mock.method(finance.stripe!.checkout.sessions,'retrieve',async():Promise<any>=>{
    retrieves++;return session(payment,retrieves===1?{}:{status:'complete',payment_status:'paid'});
  });
  const expired=mock.method(finance.stripe!.checkout.sessions,'expire',async():Promise<any>=>{expires++;throw new Error('Fixture: Checkout completed between inspection and expiry.');});
  try{
    const result=(await request(`/api/payments/${payment.id}/cancel`,{},owner.cookie)).data;
    assert.equal(result.cancelled,false);assert.equal(result.alreadyPaid,true);
    assert.equal(retrieves,2);assert.equal(expires,1);
    assert.equal(one('SELECT status FROM payments WHERE id=?',payment.id)!.status,'paid');
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner.id)!.wallet_micros,5_000_000);
    assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",owner.id)!.n,1);
  }finally{retrieved.mock.restore();expired.mock.restore();}
});

test('only a verified matching live webhook creates an owner-visible receipt, once, without charging or crediting funds',async()=>{
  const owner=await viewer(),stranger=await viewer(),payment=pending(owner.id);
  const eventId='evt_live_receipt_fixture_'+randomUUID().replaceAll('-','');
  const event={id:eventId,object:'event',type:'checkout.session.expired',livemode:true,data:{object:session(payment,{status:'expired'})}};
  async function deliver(proof:typeof event,expected=200,forged=false){
    const payload=JSON.stringify(proof);
    const signature=forged?'t=1,v1=invalid':finance.stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
    const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature},body:payload});
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  }
  const statusPath=`/api/payments/${payment.id}/status`;
  await request(statusPath,undefined,'',401);await request(statusPath,undefined,stranger.cookie,404);
  assert.deepEqual((await request(statusPath,undefined,owner.cookie)).data.webhooks,[]);

  assert.equal((await deliver(event,400,true)).error.code,'INVALID_SIGNATURE');
  await deliver({...event,id:eventId+'_event_test',livemode:false});
  await deliver({...event,id:eventId+'_object_test',data:{object:session(payment,{status:'expired',livemode:false})}});
  await deliver({...event,id:eventId+'_foreign_session',data:{object:session(payment,{id:'cs_live_other_receipt_fixture',status:'expired'})}});
  await deliver({...event,id:eventId+'_foreign_site',data:{object:session(payment,{status:'expired',metadata:{...event.data.object.metadata,site:'https://unrelated.example.test'}})}});
  assert.equal(one('SELECT COUNT(*) AS n FROM stripe_webhook_receipts WHERE payment_id=?',payment.id)!.n,0);
  assert.deepEqual((await request(statusPath,undefined,owner.cookie)).data.webhooks,[]);
  assert.equal(one('SELECT status FROM payments WHERE id=?',payment.id)!.status,'pending');

  await deliver(event);await deliver(event);
  const status=(await request(statusPath,undefined,owner.cookie)).data;
  assert.deepEqual(status.payment,{id:payment.id,status:'expired',kind:'funding',amount_cents:500,currency:'usd'});
  assert.equal(status.webhooks.length,1);assert.equal(status.webhooks[0].type,'checkout.session.expired');
  assert.equal(status.webhooks[0].endpoint_host,new URL(base).host);assert.equal(typeof status.webhooks[0].received_at,'string');
  assert.equal(one('SELECT COUNT(*) AS n FROM stripe_webhook_receipts WHERE payment_id=?',payment.id)!.n,1);
  assert.equal(one('SELECT financial_mode FROM stripe_webhook_receipts WHERE event_id=?',eventId)!.financial_mode,'live');
  assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner.id)!.wallet_micros,0);
  assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',owner.id)!.n,0);
  await request(statusPath,undefined,stranger.cookie,404);
});

test('payout pause prevents onboarding, reservations and administrator transfers before provider or balance side effects',async()=>{
  const publisher=await viewer(),admin=await viewer();
  run("UPDATE users SET publisher_active=1,role='publisher',earnings_micros=10000000,stripe_account_id='acct_fixture_publisher' WHERE id=?",publisher.id);
  run("UPDATE users SET role='admin' WHERE id=?",admin.id);
  const withdrawal=randomUUID();run('INSERT INTO withdrawals (id,user_id,amount_micros) VALUES (?,?,?)',withdrawal,publisher.id,3_000_000);
  let providerCalls=0;
  const provider=async():Promise<any>=>{providerCalls++;throw new Error('Paused payouts must not contact Stripe.');};
  const mocks=[mock.method(finance.stripe!.accounts,'create',provider),mock.method(finance.stripe!.accounts,'retrieve',provider),mock.method(finance.stripe!.accountLinks,'create',provider),mock.method(finance.stripe!.transfers,'create',provider)];
  try{
    for(const [route,body,cookie] of [
      ['/api/studio/connect',{},publisher.cookie],
      ['/api/studio/withdrawals',{amount_cents:300},publisher.cookie],
      [`/api/admin/withdrawals/${withdrawal}`,{approve:true},admin.cookie],
    ] as const){
      const response=await request(route,body,cookie,503);assert.equal(response.data.error.code,'PAYOUTS_PAUSED');
    }
    assert.throws(()=>finance.requestWithdrawal(publisher.id,300),(error:any)=>error.status===503&&error.code==='PAYOUTS_PAUSED');
    assert.equal(providerCalls,0);
    assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',publisher.id)!.earnings_micros,10_000_000);
    assert.equal(one('SELECT status FROM withdrawals WHERE id=?',withdrawal)!.status,'pending');
    assert.equal(one('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id=?',publisher.id)!.n,1);
    assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',publisher.id)!.n,0);
  }finally{mocks.forEach(method=>method.mock.restore());}
});

test('live activation does not convert test wallet credit, passes or episode purchases into real entitlements',async()=>{
  const user=await viewer(),series=randomUUID(),episode=randomUUID(),purchase=randomUUID();
  run('INSERT INTO test_accounts (user_id,wallet_micros,publisher_active) VALUES (?,?,?)',user.id,5_000_000,1);
  run('INSERT INTO test_payments (id,user_id,kind,amount_cents,currency,provider,provider_session,status) VALUES (?,?,?,?,?,?,?,?)',randomUUID(),user.id,'activation',8800,'hkd','stripe','cs_test_activation_fixture_'+randomUUID(),'paid');
  run('INSERT INTO series (id,creator_id,title,description,language,genres,status,free_episodes) VALUES (?,?,?,?,?,?,?,?)',series,user.id,'Fixture series','A fixture for live/test financial separation.','en','["romance"]','published',0);
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,series,'Fixture episode',1,12,32,'fixture.mp4');
  run('INSERT INTO test_purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',purchase,user.id,episode,100_000,70_000,30_000);
  const real=(await request('/api/auth/me',undefined,user.cookie)).data.user;
  assert.equal(real.wallet_micros,0);assert.equal(real.publisher_active,0);assert.equal(real.dramio_pass.active,false);
  assert.equal(paymentState.hasEpisodePurchase(user.id,episode),false);
  config.stripeTestMode=true;
  const testAccount=(await request('/api/auth/me',undefined,user.cookie)).data.user;
  assert.equal(testAccount.wallet_micros,5_000_000);assert.equal(testAccount.publisher_active,1);assert.equal(testAccount.dramio_pass.active,true);assert.equal(testAccount.dramio_pass.test,true);
  assert.equal(paymentState.hasEpisodePurchase(user.id,episode),true);
  config.stripeTestMode=false;
  assert.equal(one('SELECT wallet_micros,publisher_active FROM users WHERE id=?',user.id)!.wallet_micros,0);
  assert.equal(one('SELECT wallet_micros FROM test_accounts WHERE user_id=?',user.id)!.wallet_micros,5_000_000);
});
