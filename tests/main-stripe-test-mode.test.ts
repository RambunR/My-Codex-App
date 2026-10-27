import {after,before,beforeEach,afterEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-main-stripe-test-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='stripe';process.env.STRIPE_TEST_MODE='true';
process.env.STRIPE_SECRET_KEY='rk_test_main_site_fixture_only';
process.env.STRIPE_WEBHOOK_SECRET='whsec_main_site_fixture_only';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
const {getUser}=await import('../server/auth');
const finance=await import('../server/finance');
let server:Server,base:string,userNumber=0;
const mainSiteOrigin='https://aidramio.example.test';
const password='MainSiteStripeTest123!';

async function request(route:string,body?:unknown,cookie='',expected=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:config.appUrl})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);
  return{data,cookie:response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))?.split(';')[0]||''};
}
async function viewer(){
  const registered=await request('/api/auth/register',{name:'Main Site Test',email:`main-test-${++userNumber}@payments.test`,password},'',201);
  return{id:registered.data.user.id as string,cookie:registered.cookie};
}
interface PaymentFixture{id:string;userId:string;session:string;amount:number;currency:string}
function pendingPayment(userId:string,amount:number,kind:'funding'|'activation'='funding',live=false):PaymentFixture{
  const id=randomUUID(),session='cs_'+(live?'live_':'test_')+randomUUID(),currency=kind==='funding'?'usd':'hkd';
  run(`INSERT INTO ${live?'payments':'test_payments'} (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?,?,?,?,?)`,id,userId,kind,amount,currency,'stripe',session);
  return{id,userId,session,amount,currency};
}
async function webhook(payment:PaymentFixture,changes:Record<string,unknown>={},expected=200,eventLive=false){
  const payload=JSON.stringify({id:'evt_fixture_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode:eventLive,data:{object:{id:payment.session,object:'checkout.session',mode:'payment',livemode:eventLive,payment_status:'paid',amount_total:payment.amount,currency:payment.currency,metadata:{paymentId:payment.id,userId:payment.userId},...changes}}});
  const signature=finance.stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
  const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
}
function testAccount(userId:string){return one('SELECT * FROM test_accounts WHERE user_id=?',userId)!;}
function liveAccount(userId:string){return one('SELECT * FROM users WHERE id=?',userId)!;}
function episodeFixtures(creatorId:string){
  const seriesId=randomUUID(),episodes=[randomUUID(),randomUUID(),randomUUID()];
  run("INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status) VALUES (?,?,?,?,?,?,11,0,'published')",seriesId,creatorId,'Main-site money isolation','An original story for real and test entitlement isolation.','en','["drama"]');
  episodes.forEach((episode,index)=>run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,seriesId,'Episode '+(index+1),index+1,12,1,'fixture/not-streamed.mp4'));
  return{seriesId,episodes};
}

before(async()=>{
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{
  config.production=true;config.sandbox=false;config.stripeTestMode=true;config.payments='stripe';config.appUrl=mainSiteOrigin;
  config.stripeKey='rk_test_main_site_fixture_only';config.stripeWebhook='whsec_main_site_fixture_only';
  config.stripeActivationPriceId='price_test_main_activation';config.stripeWalletProductId='prod_test_main_wallet';
  config.googleClientId='fixture-main-site.apps.googleusercontent.com';config.googleClientSecret='fixture-main-google-secret';
  finance.configureStripe();
});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('main-site Stripe test mode is explicit, visible, and keeps Google login and uploads available',async()=>{
  const response=(await request('/api/config')).data;
  assert.equal(response.sandbox,false);assert.equal(response.paymentsMode,'stripe');assert.equal(response.paymentsTestMode,true);assert.equal(response.paymentsReady,true);
  assert.equal(response.uploadsEnabled,true);assert.equal(response.auth.google,true);
  assert.equal(response.limits.activationHkd,88);assert.equal(response.limits.minWalletFundingUsd,5);
  config.stripeTestMode=false;assert.equal(finance.paymentsReady(),false,'A test key must not silently enable production payments.');
  config.stripeTestMode=true;config.stripeKey='sk_live_main_fixture_only';finance.configureStripe();assert.equal(finance.paymentsReady(),false,'Explicit test mode must reject a live key.');
  config.stripeKey='rk_test_main_site_fixture_only';config.stripeWebhook='';finance.configureStripe();assert.equal(finance.paymentsReady(),false,'A verified webhook endpoint is required for test Checkout too.');
});

test('the current-site custom wallet Checkout credits only test funds after a verified paid event, exactly once',async()=>{
  const user=await viewer();run('UPDATE users SET wallet_micros=7654321 WHERE id=?',user.id);
  let calls=0;
  mock.method(finance.stripe!.checkout.sessions,'create',async(params:any)=>{
    calls++;assert.equal(params.mode,'payment');assert.deepEqual(params.payment_method_types,['card']);
    const line=params.line_items[0];assert.equal(line.price_data.currency,'usd');assert.equal(line.price_data.unit_amount,23456);assert.equal(line.price_data.product,config.stripeWalletProductId);
    assert.equal(new URL(params.success_url).origin,mainSiteOrigin);assert.equal(new URL(params.cancel_url).origin,mainSiteOrigin);assert.equal(new URL(params.success_url).pathname,'/wallet');
    return{id:'cs_test_main_'+params.metadata.paymentId,object:'checkout.session',url:'https://checkout.stripe.com/c/pay/main-fixture',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,amount_total:23456,currency:'usd'} as any;
  });
  await request('/api/payments/checkout',{kind:'funding',amount_cents:499},user.cookie,400);
  const checkout=await request('/api/payments/checkout',{kind:'funding',amount_cents:23456},user.cookie);
  assert.equal(calls,1);assert.equal(getUser(user.id)!.wallet_micros,0);assert.equal(liveAccount(user.id).wallet_micros,7654321);
  const p=one('SELECT * FROM test_payments WHERE id=?',checkout.data.paymentId)!;
  assert.equal(p.amount_cents,23456);assert.equal(p.currency,'usd');assert.equal(p.status,'pending');assert.equal(one('SELECT id FROM payments WHERE id=?',p.id),undefined);
  const proof={id:p.id,userId:user.id,session:p.provider_session,amount:23456,currency:'usd'};
  await webhook(proof,{payment_status:'unpaid'});assert.equal(testAccount(user.id).wallet_micros,0);
  await webhook(proof,{amount_total:23455},400);assert.equal(testAccount(user.id).wallet_micros,0);
  await Promise.all([webhook(proof),webhook(proof)]);
  const wallet=(await request('/api/wallet',undefined,user.cookie)).data;
  assert.equal(wallet.user.wallet_micros,234560000);assert.equal(wallet.ledger.length,1);assert.equal(wallet.ledger[0].kind,'funding');assert.equal(wallet.payments[0].status,'paid');
  assert.equal(liveAccount(user.id).wallet_micros,7654321);assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',user.id)!.n,0);
  config.stripeTestMode=false;assert.equal((await request('/api/wallet',undefined,user.cookie)).data.user.wallet_micros,7654321);
  assert.equal((await request('/api/wallet',undefined,user.cookie)).data.ledger.length,0);
  config.stripeTestMode=true;assert.equal(getUser(user.id)!.wallet_micros,234560000);
});

test('HK$88 test activation reuses Checkout, enables the current studio, and never becomes a live activation',async()=>{
  const user=await viewer();const sessions=new Map<string,any>();let creates=0;
  mock.method(finance.stripe!.prices,'retrieve',async()=>({id:config.stripeActivationPriceId,active:true,currency:'hkd',unit_amount:8800,type:'one_time',livemode:false}) as any);
  mock.method(finance.stripe!.checkout.sessions,'create',async(params:any,options:any)=>{
    creates++;assert.equal(params.line_items[0].price,config.stripeActivationPriceId);assert.equal(new URL(params.success_url).pathname,'/studio');
    const session={id:'cs_test_activation_'+params.metadata.paymentId,url:'https://checkout.stripe.com/c/pay/activation-fixture',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,amount_total:8800,currency:'hkd'};
    sessions.set(session.id,session);assert.equal(options.idempotencyKey,'checkout:'+params.metadata.paymentId);return session as any;
  });
  mock.method(finance.stripe!.checkout.sessions,'retrieve',async(sessionId:string)=>{assert(sessions.has(sessionId));return sessions.get(sessionId);});
  const first=await request('/api/payments/checkout',{kind:'activation',amount_cents:1},user.cookie);
  const again=await request('/api/payments/checkout',{kind:'activation'},user.cookie);assert.equal(first.data.paymentId,again.data.paymentId);assert.equal(creates,1);
  const p=one('SELECT * FROM test_payments WHERE id=?',first.data.paymentId)!;assert.equal(p.amount_cents,8800);assert.equal(p.currency,'hkd');
  await webhook({id:p.id,userId:user.id,session:p.provider_session,amount:8800,currency:'hkd'});
  assert.equal(getUser(user.id)!.publisher_active,1);assert.equal(getUser(user.id)!.role,'publisher');assert.equal(getUser(user.id)!.wallet_micros,0);
  assert.equal(liveAccount(user.id).publisher_active,0);assert.equal(liveAccount(user.id).role,'viewer');
  await request('/api/payments/checkout',{kind:'activation'},user.cookie,409);
  const body={title:'Current website test drama',description:'A valid drama uploaded through the existing website studio.',language:'en',genres:['drama'],creation_type:'ai-generated',price_cents:10,free_episodes:1};
  const created=await request('/api/studio/series',body,user.cookie,201);assert.equal(one('SELECT creator_id FROM series WHERE id=?',created.data.id)!.creator_id,user.id);
  config.stripeTestMode=false;assert.equal(getUser(user.id)!.publisher_active,0);assert.equal(getUser(user.id)!.role,'viewer');
  await request('/api/studio/series',body,user.cookie,403);
  assert.ok(one('SELECT id FROM series WHERE id=?',created.data.id),'Switching payment modes preserves uploaded series.');
  config.stripeTestMode=true;assert.equal(getUser(user.id)!.publisher_active,1);
});

test('test episode charges, revenue and entitlements remain separate while real purchases stay available',async()=>{
  const buyer=await viewer(),creator=await viewer();
  run("UPDATE users SET wallet_micros=17000000 WHERE id=?",buyer.id);
  run("UPDATE users SET earnings_micros=9000000,publisher_active=1,role='publisher' WHERE id=?",creator.id);
  const {seriesId,episodes}=episodeFixtures(creator.id);
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),buyer.id,episodes[0],110000,77000,33000);
  const funding=pendingPayment(buyer.id,500);await webhook(funding);
  const preserved=await request(`/api/episodes/${episodes[0]}/unlock`,{},buyer.cookie);assert.equal(preserved.data.alreadyUnlocked,true);assert.equal(testAccount(buyer.id).wallet_micros,5000000);
  assert.equal(one('SELECT COUNT(*) AS n FROM test_purchases WHERE user_id=?',buyer.id)!.n,0);
  const purchases=await Promise.all(Array.from({length:4},()=>request(`/api/episodes/${episodes[1]}/unlock`,{price_cents:1},buyer.cookie)));
  assert.ok(purchases.every(result=>result.data.user.wallet_micros===4890000));
  const purchase=one('SELECT * FROM test_purchases WHERE user_id=? AND episode_id=?',buyer.id,episodes[1])!;
  assert.equal(purchase.price_micros,110000);assert.equal(purchase.creator_micros,77000);assert.equal(purchase.platform_micros,33000);
  assert.equal(testAccount(creator.id).earnings_micros,77000);assert.equal(liveAccount(creator.id).earnings_micros,9000000);assert.equal(liveAccount(buyer.id).wallet_micros,17000000);
  assert.equal(one('SELECT COUNT(*) AS n FROM test_purchases WHERE user_id=?',buyer.id)!.n,1);
  let catalog=(await request('/api/series/'+seriesId,undefined,buyer.cookie)).data;assert.deepEqual(catalog.episodes.map((episode:any)=>episode.unlocked),[true,true,false]);
  config.stripeTestMode=false;catalog=(await request('/api/series/'+seriesId,undefined,buyer.cookie)).data;assert.deepEqual(catalog.episodes.map((episode:any)=>episode.unlocked),[true,false,false]);
  assert.equal(getUser(buyer.id)!.wallet_micros,17000000);assert.equal(getUser(creator.id)!.earnings_micros,9000000);
  config.stripeTestMode=true;catalog=(await request('/api/series/'+seriesId,undefined,buyer.cookie)).data;assert.deepEqual(catalog.episodes.map((episode:any)=>episode.unlocked),[true,true,false]);
});

test('Stripe test mode blocks Connect, withdrawal reservations and administrator payout mutations without provider calls',async()=>{
  const publisher=await viewer(),admin=await viewer();run("UPDATE users SET publisher_active=1,role='publisher',earnings_micros=10000000,stripe_account_id='acct_live_fixture' WHERE id=?",publisher.id);run("UPDATE users SET role='admin' WHERE id=?",admin.id);
  getUser(publisher.id);run('UPDATE test_accounts SET earnings_micros=20000000 WHERE user_id=?',publisher.id);
  const withdrawalId=randomUUID();run('INSERT INTO withdrawals (id,user_id,amount_micros) VALUES (?,?,?)',withdrawalId,publisher.id,1000000);
  let providerCalls=0;
  const forbidden=async()=>{providerCalls++;throw new Error('Test-mode payout operations must not contact Stripe.');};
  mock.method(finance.stripe!.accounts,'create',forbidden);mock.method(finance.stripe!.accounts,'retrieve',forbidden);mock.method(finance.stripe!.accountLinks,'create',forbidden);mock.method(finance.stripe!.transfers,'create',forbidden);
  for(const [route,body,cookie] of [
    ['/api/studio/connect',{},publisher.cookie],
    ['/api/studio/withdrawals',{amount_cents:500,note:'Forbidden test payout'},publisher.cookie],
    ['/api/admin/withdrawals/'+withdrawalId,{approve:true},admin.cookie],
    ['/api/admin/withdrawals/'+withdrawalId,{approve:false},admin.cookie],
  ] as const){
    const response=await fetch(base+route,{method:'POST',headers:{Cookie:cookie,Origin:config.appUrl,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();assert.ok([403,503].includes(response.status),`${route}: ${JSON.stringify(result)}`);assert.ok(result.error);
  }
  assert.throws(()=>finance.requestWithdrawal(publisher.id,500),(error:any)=>[403,503].includes(error.status));
  assert.equal(providerCalls,0);assert.equal(liveAccount(publisher.id).earnings_micros,10000000);assert.equal(testAccount(publisher.id).earnings_micros,20000000);
  assert.equal(one('SELECT status FROM withdrawals WHERE id=?',withdrawalId)!.status,'pending');assert.equal(one('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id=?',publisher.id)!.n,1);
});

test('signed live-mode proofs cannot fund test balances or settle a live payment through the test endpoint',async()=>{
  const user=await viewer(),testPayment=pendingPayment(user.id,500),livePayment=pendingPayment(user.id,500,'funding',true);
  const ignored=await webhook(testPayment,{},200,true);assert.equal(ignored.ignored,true);assert.equal(getUser(user.id)!.wallet_micros,0);
  const wrongSession=await webhook(testPayment,{livemode:true});assert.equal(wrongSession.ignored,true);assert.equal(testAccount(user.id).wallet_micros,0);
  assert.throws(()=>finance.settlePayment(livePayment.id,{amount:500,currency:'usd',session:livePayment.session,livemode:false}));
  assert.equal(one('SELECT status FROM payments WHERE id=?',livePayment.id)!.status,'pending');assert.equal(liveAccount(user.id).wallet_micros,0);
  await webhook(testPayment);assert.equal(getUser(user.id)!.wallet_micros,5000000);assert.equal(one('SELECT status FROM test_payments WHERE id=?',testPayment.id)!.status,'paid');
});
