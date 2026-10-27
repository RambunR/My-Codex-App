import {after,before,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-payments-'));
process.env.DATA_DIR=dir;process.env.PAYMENTS_MODE='demo';process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.STRIPE_SECRET_KEY='sk_test_local_payment_fixture_only';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const signer=finance.stripe!;
let server:Server,base:string,userNumber=0;
const password='WalletPaymentTest123!';
const MIN=500,MAX=99_999_999;

async function request(route:string,body?:unknown,cookie='',expected=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);
  return{data,cookie:response.headers.getSetCookie().find(x=>x.startsWith('drama_session='))?.split(';')[0]||''};
}
async function viewer(){
  const email=`wallet-${++userNumber}@payments.test`;
  const registered=await request('/api/auth/register',{name:'Wallet Test Viewer',email,password},'',201);
  return{id:registered.data.user.id as string,cookie:registered.cookie,email};
}
function balance(id:string){return one('SELECT wallet_micros FROM users WHERE id=?',id)!.wallet_micros as number;}
function checkoutUser(){const id=randomUUID();run('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)',id,`${id}@checkout.test`,'Checkout Fixture','!fixture-password-disabled');return id;}
function sandboxStripe(){
  config.production=true;config.sandbox=true;config.payments='stripe';config.appUrl='https://aidramio-sandbox.example.test';
  config.stripeKey='rk_test_checkout_fixture_only';config.stripeWebhook='whsec_checkout_fixture_only';
  config.stripeActivationPriceId='price_fixture_activation';config.stripeWalletProductId='prod_fixture_wallet';finance.configureStripe();return finance.stripe!;
}
function activationPrice(){return{id:config.stripeActivationPriceId,object:'price',active:true,currency:'hkd',unit_amount:8800,type:'one_time',recurring:null,livemode:false,product:'prod_fixture_activation'};}
async function fund(cookie:string,cents:number){
  const checkout=await request('/api/payments/checkout',{kind:'funding',amount_cents:cents},cookie);
  await request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{},cookie);
  return checkout.data;
}
interface PaymentFixture{id:string;userId:string;session:string;amount:number;currency:string}
function payment(userId:string,amount:number,currency='usd',kind:'funding'|'activation'='funding'):PaymentFixture{
  const id=randomUUID(),session='cs_fixture_'+randomUUID();
  run('INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?,?,?,?,?)',id,userId,kind,amount,currency,'stripe',session);
  return{id,userId,session,amount,currency};
}
async function webhook(p:PaymentFixture,changes:Record<string,unknown>={},expected=200,livemode=false){
  const payload=JSON.stringify({id:'evt_fixture_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode,data:{object:{id:p.session,object:'checkout.session',mode:'payment',livemode,payment_status:'paid',amount_total:p.amount,currency:p.currency,client_reference_id:p.id,metadata:{paymentId:p.id,userId:p.userId},...changes}}});
  const signature=signer.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook||'whsec_unconfigured_fixture_only'});
  const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
}

before(async()=>{
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;config.appUrl=base;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('wallet deposits enforce the US$5 minimum, integer cents and the processor ceiling without the former US$200 cap',async()=>{
  const user=await viewer();
  for(const amount of [499,0,-500,500.5,'500','5e2',null,MAX+1,Number.MAX_SAFE_INTEGER]){
    await request('/api/payments/checkout',{kind:'funding',amount_cents:amount},user.cookie,400);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',user.id)!.n,0);
  for(const amount of [MIN,23_456,50_000,MAX]){
    const checkout=await request('/api/payments/checkout',{kind:'funding',amount_cents:amount},user.cookie);
    assert.equal(checkout.data.amount_cents,amount);assert.equal(checkout.data.currency,'usd');
    const recorded=one('SELECT amount_cents,currency,status FROM payments WHERE id=?',checkout.data.paymentId)!;
    assert.equal(recorded.amount_cents,amount);assert.equal(recorded.currency,'usd');assert.equal(recorded.status,'pending');
  }
  assert.equal(balance(user.id),0,'Creating a checkout must not credit an unpaid deposit.');
});

test('a custom US$234.56 deposit credits that exact amount once and never grants publishing access',async()=>{
  const user=await viewer();const checkout=await request('/api/payments/checkout',{kind:'funding',amount_cents:23_456},user.cookie);
  assert.equal(balance(user.id),0);
  await Promise.all(Array.from({length:4},()=>request(`/api/payments/${checkout.data.paymentId}/demo-confirm`,{amount_cents:MAX,publisher_active:1},user.cookie)));
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;
  assert.equal(account.wallet_micros,234_560_000);assert.equal(account.publisher_active,0);assert.equal(account.role,'viewer');
  assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",user.id)!.n,1);
});

test('publisher activation stays a one-time HK$88 charge separate from USD wallet funds and preserves administrator role',async()=>{
  const user=await viewer();await fund(user.cookie,500);
  const attempts=await Promise.all([0,1].map(()=>request('/api/payments/checkout',{kind:'activation',amount_cents:1,currency:'usd'},user.cookie)));
  assert.equal(attempts[0].data.paymentId,attempts[1].data.paymentId,'Reuse the pending one-time activation checkout.');
  assert.equal(attempts[0].data.amount_cents,8800);assert.equal(attempts[0].data.currency,'hkd');
  const id=attempts[0].data.paymentId;
  await Promise.all([0,1].map(()=>request(`/api/payments/${id}/demo-confirm`,{},user.cookie)));
  const activated=(await request('/api/auth/me',undefined,user.cookie)).data.user;
  assert.equal(activated.publisher_active,1);assert.equal(activated.role,'publisher');assert.equal(activated.wallet_micros,5_000_000);
  assert.equal(activated.quota_bytes,5*1024**3);
  await request('/api/payments/checkout',{kind:'activation'},user.cookie,409);
  assert.equal(one("SELECT COUNT(*) AS n FROM payments WHERE user_id=? AND kind='activation'",user.id)!.n,1);
  assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",user.id)!.n,1);
  const admin=await viewer();run("UPDATE users SET role='admin' WHERE id=?",admin.id);
  const adminCheckout=await request('/api/payments/checkout',{kind:'activation'},admin.cookie);
  await request(`/api/payments/${adminCheckout.data.paymentId}/demo-confirm`,{},admin.cookie);
  const current=(await request('/api/auth/me',undefined,admin.cookie)).data.user;assert.equal(current.role,'admin');assert.equal(current.publisher_active,1);assert.equal(current.wallet_micros,0);
});

test('signed Stripe deposit events reject mismatched amount, currency and session before exact replay-safe credit',async()=>{
  const user=await viewer();const p=payment(user.id,23_456);
  const previous={payments:config.payments,webhook:config.stripeWebhook};config.payments='stripe';config.stripeWebhook='whsec_local_wallet_fixture_only';
  try{
    await webhook(p,{payment_status:'unpaid'});assert.equal(balance(user.id),0);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
    for(const change of [{amount_total:23_455},{currency:'hkd'},{id:'cs_different_session'}]){
      const result=await webhook(p,change,400);assert.equal(result.error.code,'PAYMENT_MISMATCH');
      assert.equal(balance(user.id),0);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
    }
    await Promise.all([webhook(p),webhook(p)]);
    assert.equal(balance(user.id),234_560_000);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'paid');
    assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",user.id)!.n,1);
  }finally{config.payments=previous.payments;config.stripeWebhook=previous.webhook;}
});

test('every paid episode deducts its server price once from the wallet and records the exact 70/30 split',async()=>{
  const user=await viewer(),creator=await viewer(),empty=await viewer();await fund(user.cookie,500);
  run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",creator.id);
  const sid=randomUUID(),episodeId=randomUUID();
  run("INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status) VALUES (?,?,?,?,?,?,?,0,'published')",sid,creator.id,'Paid wallet drama','A paid drama fixture for transaction validation.','en','["romance"]',11);
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episodeId,sid,'A purchased episode',1,12,1,'fixture/not-streamed.mp4');
  const results=await Promise.all(Array.from({length:8},()=>request(`/api/episodes/${episodeId}/unlock`,{price_cents:1,amount_cents:1},user.cookie)));
  assert.ok(results.every(r=>r.data.user.wallet_micros===4_890_000));assert.equal(balance(user.id),4_890_000);
  const purchase=one('SELECT price_micros,creator_micros,platform_micros FROM purchases WHERE user_id=? AND episode_id=?',user.id,episodeId)!;
  assert.equal(purchase.price_micros,110_000);assert.equal(purchase.creator_micros,77_000);assert.equal(purchase.platform_micros,33_000);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',creator.id)!.earnings_micros,77_000);
  assert.equal(one('SELECT COUNT(*) AS n FROM purchases WHERE user_id=? AND episode_id=?',user.id,episodeId)!.n,1);
  assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='unlock'",user.id)!.n,1);
  const rejected=await request(`/api/episodes/${episodeId}/unlock`,{},empty.cookie,402);assert.equal(rejected.data.error.code,'INSUFFICIENT_FUNDS');
  assert.equal(balance(empty.id),0);assert.equal(one('SELECT COUNT(*) AS n FROM purchases WHERE user_id=?',empty.id)!.n,0);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',creator.id)!.earnings_micros,77_000);
  const body={title:'Minimum price drama',description:'A valid original series with a publisher-defined price.',language:'en',genres:['romance'],creation_type:'human',price_cents:9,free_episodes:0};
  await request('/api/studio/series',body,creator.cookie,400);
  await request('/api/studio/series',{...body,price_cents:10},creator.cookie,201);
});

test('production cannot create checkouts or settle deposits with test keys or incomplete Stripe credentials',async()=>{
  const user=await viewer(),p=payment(user.id,500);
  const previous={production:config.production,payments:config.payments,stripeKey:config.stripeKey,stripeWebhook:config.stripeWebhook,appUrl:config.appUrl};
  try{
    config.production=true;config.payments='stripe';config.appUrl='https://payments.example.test';
    for(const [key,secret] of [['sk_test_fixture_only','whsec_local_fixture_only'],['rk_test_fixture_only','whsec_local_fixture_only'],['sk_live_fixture_only',''],['','whsec_local_fixture_only']]){
      config.stripeKey=key;config.stripeWebhook=secret;finance.configureStripe();
      const provider=finance.stripe;
      const checkout=provider?mock.method(provider.checkout.sessions,'create',()=>{throw new Error('An unavailable production configuration must not call Stripe.');}):undefined;
      try{
        const funding=await request('/api/payments/checkout',{kind:'funding',amount_cents:500},user.cookie,503);assert.equal(funding.data.error.code,'PAYMENTS_UNAVAILABLE');
        const activation=await request('/api/payments/checkout',{kind:'activation'},user.cookie,503);assert.equal(activation.data.error.code,'PAYMENTS_UNAVAILABLE');
        const event=await webhook(p,{},503);assert.equal(event.error.code,'PAYMENTS_UNAVAILABLE');
        assert.equal(balance(user.id),0);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
        assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',user.id)!.n,1);
      }finally{checkout?.mock.restore();}
    }
  }finally{Object.assign(config,previous);finance.configureStripe();}
});

test('a live production payment configuration ignores signed test-mode events and requires a live session',async()=>{
  const user=await viewer(),p=payment(user.id,500);
  const previous={production:config.production,payments:config.payments,stripeKey:config.stripeKey,stripeWebhook:config.stripeWebhook,appUrl:config.appUrl};
  try{
    config.production=true;config.payments='stripe';config.appUrl='https://payments.example.test';config.stripeKey='sk_live_fixture_only';config.stripeWebhook='whsec_local_live_guard_fixture_only';finance.configureStripe();
    for(const [eventLive,sessionLive] of [[false,false],[false,true],[true,false]]){
      const result=await webhook(p,{livemode:sessionLive},200,eventLive);assert.equal(result.received,true);assert.equal(result.ignored,true);
      assert.equal(balance(user.id),0);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'pending');
    }
    const mismatched={amount:p.amount,currency:p.currency,session:p.session,livemode:false};
    assert.throws(()=>finance.settlePayment(p.id,mismatched),(e:any)=>e.status===400&&e.code==='PAYMENT_MODE_MISMATCH');
    assert.equal(balance(user.id),0);
    await webhook(p,{livemode:true},200,true);
    assert.equal(balance(user.id),5_000_000);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'paid');
    assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",user.id)!.n,1);
  }finally{Object.assign(config,previous);finance.configureStripe();}
});

test('wallet capacity checks prevent unsafe integer credit before checkout and roll back a later settlement',async()=>{
  const user=await viewer(),before=Number.MAX_SAFE_INTEGER-1_000_000;run('UPDATE users SET wallet_micros=? WHERE id=?',before,user.id);
  const rejected=await request('/api/payments/checkout',{kind:'funding',amount_cents:500},user.cookie,400);assert.equal(rejected.data.error.code,'WALLET_LIMIT_REACHED');
  assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',user.id)!.n,0);assert.equal(balance(user.id),before);
  const id=randomUUID();run('INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider) VALUES (?,?,?,?,?,?)',id,user.id,'funding',500,'usd','demo');
  assert.throws(()=>finance.settlePayment(id),(e:any)=>e.status===409&&e.code==='BALANCE_LIMIT');
  assert.equal(balance(user.id),before);assert.equal(one('SELECT status FROM payments WHERE id=?',id)!.status,'pending');
  assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',user.id)!.n,0);
});

test('an explicitly isolated sandbox accepts test payments while rejecting a live Stripe key',async()=>{
  const user=await viewer(),p=payment(user.id,500),previous={...config};
  try{
    sandboxStripe();assert.equal(finance.paymentsReady(),true);
    await webhook(p);assert.equal(balance(user.id),5_000_000);assert.equal(one('SELECT status FROM payments WHERE id=?',p.id)!.status,'paid');
    const liveEvent=payment(user.id,500);const ignored=await webhook(liveEvent,{livemode:true},200,true);
    assert.equal(ignored.ignored,true);assert.equal(balance(user.id),5_000_000);assert.equal(one('SELECT status FROM payments WHERE id=?',liveEvent.id)!.status,'pending');
    config.stripeKey='sk_live_fixture_only';finance.configureStripe();assert.equal(finance.paymentsReady(),false);
    const blocked=await request('/api/payments/checkout',{kind:'funding',amount_cents:500},user.cookie,503);assert.equal(blocked.data.error.code,'PAYMENTS_UNAVAILABLE');
    await webhook(liveEvent,{},503);assert.equal(balance(user.id),5_000_000);
  }finally{Object.assign(config,previous);finance.configureStripe();}
});

test('a configured HK$88 activation price retains one Checkout session across a timeout and concurrent retries',async()=>{
  const userId=checkoutUser(),previous={...config};const sessions=new Map<string,any>(),calls:Array<{params:any;key:string}>=[];let timeout=true;
  let create:ReturnType<typeof mock.method>|undefined,retrieve:ReturnType<typeof mock.method>|undefined,price:ReturnType<typeof mock.method>|undefined;
  try{
    const provider=sandboxStripe();
    price=mock.method(provider.prices,'retrieve',async()=>activationPrice() as any);
    create=mock.method(provider.checkout.sessions,'create',async(params:any,options:any)=>{
      assert.equal(params.mode,'payment');assert.equal(params.line_items.length,1);assert.equal(params.line_items[0].price,config.stripeActivationPriceId);assert.equal(params.line_items[0].quantity,1);assert.equal(params.line_items[0].price_data,undefined);
      assert.ok(options.idempotencyKey);calls.push({params,key:options.idempotencyKey});
      let session=sessions.get(options.idempotencyKey);
      if(!session){session={id:'cs_test_activation_'+params.metadata.paymentId,object:'checkout.session',url:'https://checkout.stripe.com/c/pay/fixture',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,amount_total:8800,currency:'hkd'};sessions.set(options.idempotencyKey,session);}
      // Emulate a provider timeout after Checkout was already created remotely.
      if(timeout){timeout=false;throw new Error('Fixture transport timeout after session creation.');}
      return session as any;
    });
    retrieve=mock.method(provider.checkout.sessions,'retrieve',async(id:string)=>{const found=[...sessions.values()].find(s=>s.id===id);assert.ok(found);return found as any;});
    await assert.rejects(finance.createCheckout(userId,'activation',500),(e:any)=>e.status===502&&e.code==='CHECKOUT_UNAVAILABLE');
    const pending=one("SELECT * FROM payments WHERE user_id=? AND kind='activation'",userId)!;assert.equal(pending.status,'pending');assert.equal(pending.provider_session,null);assert.equal(pending.amount_cents,8800);assert.equal(pending.currency,'hkd');
    const retried=await Promise.all(Array.from({length:6},()=>finance.createCheckout(userId,'activation',1)));
    assert.ok(retried.every(result=>'paymentId' in result&&result.paymentId===pending.id));assert.equal(new Set(calls.map(c=>c.key)).size,1);assert.equal(sessions.size,1);
    assert.equal(calls[0].key,'checkout:'+pending.id);assert.ok(calls.every(c=>c.params.metadata.paymentId===pending.id));
    assert.equal(one("SELECT COUNT(*) AS n FROM payments WHERE user_id=? AND kind='activation'",userId)!.n,1);
    const saved=one('SELECT provider_session FROM payments WHERE id=?',pending.id)!;
    const paid={id:pending.id,userId,session:saved.provider_session as string,amount:8800,currency:'hkd'};
    await Promise.all([webhook(paid),webhook(paid)]);
    assert.equal(one('SELECT publisher_active FROM users WHERE id=?',userId)!.publisher_active,1);assert.equal(balance(userId),0);
    assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",userId)!.n,1);
    await assert.rejects(finance.createCheckout(userId,'activation',8800),(e:any)=>e.status===409&&e.code==='ALREADY_ACTIVE');
    assert.equal(sessions.size,1);
  }finally{create?.mock.restore();retrieve?.mock.restore();price?.mock.restore();Object.assign(config,previous);finance.configureStripe();}
});

test('custom wallet Checkout uses the persistent wallet product and the exact user-selected USD amount',async()=>{
  const userId=checkoutUser(),previous={...config};let create:ReturnType<typeof mock.method>|undefined,price:ReturnType<typeof mock.method>|undefined;let checked=false;
  try{
    const provider=sandboxStripe();price=mock.method(provider.prices,'retrieve',async()=>activationPrice() as any);
    create=mock.method(provider.checkout.sessions,'create',async(params:any)=>{
      checked=true;assert.equal(params.mode,'payment');assert.equal(params.line_items.length,1);
      const line=params.line_items[0];assert.equal(line.price,undefined);assert.equal(line.quantity,1);assert.equal(line.price_data.currency,'usd');assert.equal(line.price_data.unit_amount,23456);assert.equal(line.price_data.product,config.stripeWalletProductId);assert.equal(line.price_data.product_data,undefined);
      assert.ok(params.success_url.startsWith(config.appUrl+'/wallet?checkout=success&'));
      return{id:'cs_test_custom_'+params.metadata.paymentId,object:'checkout.session',url:'https://checkout.stripe.com/c/pay/custom-fixture',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,amount_total:23456,currency:'usd'} as any;
    });
    const checkout=await finance.createCheckout(userId,'funding',23456);assert.equal(checked,true);assert.ok('paymentId' in checkout);
    const saved=one('SELECT * FROM payments WHERE id=?','paymentId' in checkout?checkout.paymentId:'')!;assert.equal(saved.amount_cents,23456);assert.equal(saved.currency,'usd');assert.equal(saved.status,'pending');assert.equal(balance(userId),0);
    const paid={id:saved.id as string,userId,session:saved.provider_session as string,amount:23456,currency:'usd'};
    await Promise.all([webhook(paid),webhook(paid)]);assert.equal(balance(userId),234_560_000);
    assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='funding'",userId)!.n,1);
  }finally{create?.mock.restore();price?.mock.restore();Object.assign(config,previous);finance.configureStripe();}
});

test('bad configured activation prices fail before creating a payment row or calling Checkout',async()=>{
  const userId=checkoutUser(),previous={...config};let create:ReturnType<typeof mock.method>|undefined,price:ReturnType<typeof mock.method>|undefined;let current:Record<string,unknown>={},failure=false,checkoutCalls=0;
  try{
    const provider=sandboxStripe();create=mock.method(provider.checkout.sessions,'create',async()=>{checkoutCalls++;throw new Error('Invalid activation price must never reach Checkout.');});
    price=mock.method(provider.prices,'retrieve',async()=>{if(failure)throw new Error('Fixture restricted price-read failure.');return{...activationPrice(),...current} as any;});
    const invalid=[{currency:'usd'},{unit_amount:8799},{active:false},{type:'recurring',recurring:{interval:'month'}},{livemode:true}];
    for(let i=0;i<=invalid.length;i++){
      config.stripeActivationPriceId='price_bad_fixture_'+i;current=invalid[i]||{};failure=i===invalid.length;
      await assert.rejects(finance.createCheckout(userId,'activation',8800),(e:any)=>e.status===503&&e.code==='PAYMENT_CONFIG_ERROR');
      assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',userId)!.n,0);assert.equal(checkoutCalls,0);assert.equal(balance(userId),0);
    }
  }finally{create?.mock.restore();price?.mock.restore();Object.assign(config,previous);finance.configureStripe();}
});
