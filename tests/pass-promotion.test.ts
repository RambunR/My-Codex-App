import {after,before,beforeEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-pass-promotion-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='stripe';
process.env.STRIPE_SECRET_KEY='sk_test_promotion_fixture_only';process.env.STRIPE_WEBHOOK_SECRET='whsec_promotion_fixture_only';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const {paymentTable,ledgerTable}=await import('../server/payment-state');
const baseline={...config};
let server:Server,base:string;

before(async()=>{const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
beforeEach(()=>{Object.assign(config,baseline,{passPromotionEnabled:true,appUrl:base,stripeAutoConfigureWebhook:false});finance.configureStripe();});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

async function request(route:string,body?:unknown,cookie='',expected=200){
 const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);return{data,cookie:response.headers.getSetCookie().find(x=>x.startsWith('drama_session='))?.split(';')[0]||''};
}
async function viewer(){const registered=await request('/api/auth/register',{name:'Promotion Test',email:`${randomUUID()}@promotion.test`,password:'PromotionTestPass123!'},'',201);return{id:registered.data.user.id as string,cookie:registered.cookie};}
function stripeFixture(){
 const provider=finance.stripe!,sessions=new Map<string,any>(),creates:any[]=[];let timeout=false;
 const create=mock.method(provider.checkout.sessions,'create',async(params:any,options:any)=>{
  creates.push({params,key:options.idempotencyKey});let session=sessions.get(options.idempotencyKey);
  if(!session){session={id:'cs_fixture_'+params.metadata.paymentId,url:'https://checkout.stripe.com/c/pay/promotion-fixture',livemode:false,status:'open',payment_status:'unpaid',currency:'hkd',amount_total:params.line_items[0].price_data?.unit_amount||8800,metadata:params.metadata,client_reference_id:params.client_reference_id};sessions.set(options.idempotencyKey,session);}
  if(timeout){timeout=false;throw new Error('Fixture transport timeout after remote creation.');}return session;
 });
 const retrieve=mock.method(provider.checkout.sessions,'retrieve',async(id:string)=>{const found=[...sessions.values()].find(value=>value.id===id);assert.ok(found);return found;});
 const expire=mock.method(provider.checkout.sessions,'expire',async(id:string)=>{const found=[...sessions.values()].find(value=>value.id===id);assert.ok(found);found.status='expired';return found;});
 const price=mock.method(provider.prices,'retrieve',async()=>({id:config.stripeActivationPriceId,active:true,type:'one_time',currency:'hkd',unit_amount:8800,livemode:false}));
 return{sessions,creates,provider,setTimeout:()=>{timeout=true;},restore:()=>{create.mock.restore();retrieve.mock.restore();expire.mock.restore();price.mock.restore();}};
}
function payment(id:string){return one(`SELECT * FROM ${paymentTable()} WHERE id=?`,id)!;}
function rawPayment(userId:string,amount=5800){const id=randomUUID();run(`INSERT INTO ${paymentTable()} (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,'activation',?,'hkd','stripe',?)`,id,userId,amount,'cs_raw_'+id);return payment(id);}
async function webhook(p:Record<string,any>,changes:Record<string,unknown>={},expected=200,eventLive=false){
 const payload=JSON.stringify({id:'evt_promo_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode:eventLive,data:{object:{id:p.provider_session,livemode:false,payment_status:'paid',amount_total:p.amount_cents,currency:p.currency,metadata:{paymentId:p.id,userId:p.user_id,promotionCode:'LINGYING58'},...changes}}});
 const signature=finance.stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
 const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
}

test('public offer advertises explicit activation-only HKD prices and can be disabled',async()=>{
 const offer=(await request('/api/config')).data.passPromotion;
 assert.deepEqual(offer,{enabled:true,code:'LINGYING58',amountHkdCents:5800,regularAmountHkdCents:8800,currency:'hkd'});
 config.passPromotionEnabled=false;assert.equal((await request('/api/config')).data.passPromotion.enabled,false);
});

test('normalized promo creates exact HK$58 inline Checkout and immutable server proof without funding a wallet',async()=>{
 const user=await viewer(),f=stripeFixture();config.stripeActivationPriceId='price_regular_88_fixture';
 try{
  const result=await request('/api/payments/checkout',{kind:'activation',promo_code:' lingying58 ',amount_cents:1,currency:'usd'},user.cookie),p=payment(result.data.paymentId);
  assert.equal(p.amount_cents,5800);assert.equal(p.currency,'hkd');assert.equal(p.status,'pending');
  const quote=one('SELECT * FROM activation_promotion_quotes WHERE payment_id=? AND financial_mode=?',p.id,'default')!;assert.equal(quote.code,'LINGYING58');assert.equal(quote.amount_cents,5800);assert.equal(quote.regular_amount_cents,8800);
  const params=f.creates[0].params;assert.equal(params.line_items[0].price,undefined);assert.equal(params.line_items[0].price_data.unit_amount,5800);assert.equal(params.line_items[0].price_data.currency,'hkd');assert.equal(params.metadata.promotionCode,'LINGYING58');assert.equal(params.payment_intent_data.metadata.promotionCode,'LINGYING58');assert.ok(params.success_url.includes('promo=LINGYING58'));assert.ok(params.cancel_url.includes('promo=LINGYING58'));
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.wallet_micros,0);assert.equal(account.publisher_active,0);assert.equal(account.dramio_pass.active,false);
 }finally{f.restore();}
});

test('invalid, disabled and funding promo codes cannot create a payment or call Stripe',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  for(const code of ['', 'WRONG',false,58,'a'.repeat(65)])await request('/api/payments/checkout',{kind:'activation',promo_code:code},user.cookie,400);
  config.passPromotionEnabled=false;const disabled=await request('/api/payments/checkout',{kind:'activation',promo_code:'LINGYING58'},user.cookie,400);assert.equal(disabled.data.error.code,'INVALID_PROMOTION');
  config.passPromotionEnabled=true;await request('/api/payments/checkout',{kind:'funding',amount_cents:500,promo_code:'LINGYING58'},user.cookie,400);
  await assert.rejects(finance.createCheckout(user.id,'funding',500,'en','LINGYING58'),(error:any)=>error.code==='PROMOTION_NOT_APPLICABLE');
  assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',user.id)!.n,0);assert.equal(f.creates.length,0);
 }finally{f.restore();}
});

test('signed discounted settlement requires exact session, currency and amount; issued quotes survive offer disable and replay',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  const result=await finance.createCheckout(user.id,'activation',1,'en','LINGYING58'),p=payment('paymentId' in result?result.paymentId||'':'');config.passPromotionEnabled=false;
  for(const change of [{amount_total:5799},{amount_total:8800},{currency:'usd'},{id:'cs_wrong'}]){const rejected=await webhook(p,change,400);assert.equal(rejected.error.code,'PAYMENT_MISMATCH');assert.equal(payment(p.id).status,'pending');}
  const ignored=await webhook(p,{livemode:true},200,true);assert.equal(ignored.ignored,true);assert.equal(payment(p.id).status,'pending');
  await Promise.all([webhook(p),webhook(p)]);
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.publisher_active,1);assert.equal(account.wallet_micros,0);assert.equal(account.earnings_micros,0);assert.equal(account.dramio_pass.active,true);assert.ok(account.dramio_pass.purchased_at);assert.equal(account.quota_bytes,5*1024**3);
  const ledger=one("SELECT COUNT(*) AS n,MAX(description) AS description FROM ledger WHERE user_id=? AND kind='activation'",user.id)!;assert.equal(ledger.n,1);assert.match(ledger.description,/HK\$58.*LINGYING58/);
  await assert.rejects(finance.createCheckout(user.id,'activation',8800),(error:any)=>error.code==='ALREADY_ACTIVE');
 }finally{f.restore();}
});

test('a forged discounted payment or promotion metadata without server quote never activates publishing',async()=>{
 const user=await viewer(),p=rawPayment(user.id);await webhook(p,{},400);assert.equal(payment(p.id).status,'pending');assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);
 run('INSERT INTO activation_promotion_quotes (payment_id,financial_mode,code,amount_cents,currency,regular_amount_cents) VALUES (?,?,?,?,?,?)',p.id,'default','OTHER',5800,'hkd',8800);await webhook(p,{},400);
 assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",user.id)!.n,0);
});

test('regular HK$88 legacy payments and configured regular prices remain valid when the offer is enabled',async()=>{
 const legacy=await viewer(),p=rawPayment(legacy.id,8800);await webhook(p);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',legacy.id)!.publisher_active,1);
 const user=await viewer(),f=stripeFixture();config.stripeActivationPriceId='price_regular_fixture';
 try{const checkout=await finance.createCheckout(user.id,'activation',5800);assert.equal(payment('paymentId' in checkout?checkout.paymentId||'':'').amount_cents,8800);assert.equal(f.creates[0].params.line_items[0].price,'price_regular_fixture');assert.equal(f.creates[0].params.metadata.promotionCode,undefined);assert.equal(one('SELECT COUNT(*) AS n FROM activation_promotion_quotes WHERE payment_id=?','paymentId' in checkout?checkout.paymentId||'':'')!.n,0);}finally{f.restore();}
});

test('promotion retries after provider timeout use one immutable payment and idempotency key',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  f.setTimeout();await assert.rejects(finance.createCheckout(user.id,'activation',1,'en','LINGYING58'),(error:any)=>error.code==='CHECKOUT_UNAVAILABLE');
  const p=one("SELECT * FROM payments WHERE user_id=? AND kind='activation'",user.id)!;
  const results=await Promise.all(Array.from({length:5},()=>finance.createCheckout(user.id,'activation',1,'en','LINGYING58')));
  assert.ok(results.every(result=>'paymentId' in result&&result.paymentId===p.id));assert.equal(f.sessions.size,1);assert.equal(new Set(f.creates.map(value=>value.key)).size,1);assert.equal(f.creates[0].key,'checkout:'+p.id);assert.equal(one('SELECT COUNT(*) AS n FROM activation_promotion_quotes WHERE payment_id=?',p.id)!.n,1);
 }finally{f.restore();}
});

test('different-price concurrent requests cannot open duplicate checkouts and explicit unpaid cancellation permits switching',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  const outcomes=await Promise.allSettled([finance.createCheckout(user.id,'activation',8800),finance.createCheckout(user.id,'activation',1,'en','LINGYING58')]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);const conflict=outcomes.find(result=>result.status==='rejected') as PromiseRejectedResult;assert.equal(conflict.reason.code,'ACTIVATION_CHECKOUT_CONFLICT');
  const old=one("SELECT * FROM payments WHERE user_id=? AND kind='activation' AND status='pending'",user.id)!;assert.equal(conflict.reason.details.paymentId,old.id);assert.equal(f.sessions.size,1);
  const conflictingBody=old.amount_cents===8800?{kind:'activation',promo_code:'LINGYING58'}:{kind:'activation'};
  const apiConflict=await request('/api/payments/checkout',conflictingBody,user.cookie,409);assert.equal(apiConflict.data.error.details.paymentId,old.id);
  const other=await viewer();await request(`/api/payments/${old.id}/cancel`,{},other.cookie,404);
  await request(`/api/payments/${old.id}/cancel`,{},user.cookie);assert.equal(payment(old.id).status,'expired');
  const next=await finance.createCheckout(user.id,'activation',1,'en','LINGYING58');assert.notEqual('paymentId' in next?next.paymentId||'':'',old.id);assert.equal(payment('paymentId' in next?next.paymentId||'':'').amount_cents,5800);assert.equal([...f.sessions.values()].filter(value=>value.status==='open').length,1);
 }finally{f.restore();}
});

test('explicit test-mode promotion uses isolated quote, receipt and financial tables, never real Pass or wallet state',async()=>{
 config.stripeTestMode=true;config.production=true;const user=await viewer(),f=stripeFixture();
 try{
  const result=await finance.createCheckout(user.id,'activation',1,'en','LINGYING58'),id='paymentId' in result?result.paymentId||'':'',p=payment(id);assert.equal(paymentTable(),'test_payments');assert.equal(one('SELECT id FROM payments WHERE id=?',id),undefined);assert.equal(one('SELECT financial_mode FROM activation_promotion_quotes WHERE payment_id=?',id)!.financial_mode,'test');
  await Promise.all([webhook(p),webhook(p)]);assert.equal(one('SELECT publisher_active FROM test_accounts WHERE user_id=?',user.id)!.publisher_active,1);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);assert.equal(ledgerTable(),'test_ledger');assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=?",user.id)!.n,0);
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.dramio_pass.test,true);assert.ok(account.dramio_pass.purchased_at);
  config.stripeTestMode=false;const live=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(live.dramio_pass.active,false);assert.equal(live.wallet_micros,0);
 }finally{f.restore();}
});
