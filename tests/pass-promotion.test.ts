import {LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION} from '../shared/creator-pass-consent';
import {after,before,beforeEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const creatorConsent={accepted:true,policy_version:LEGAL_POLICY_VERSION,disclosure_version:CREATOR_PASS_DISCLOSURE_VERSION};

const dir=await mkdtemp(path.join(tmpdir(),'lingying-pass-promotion-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='stripe';
process.env.STRIPE_SECRET_KEY='sk_test_promotion_fixture_only';process.env.STRIPE_WEBHOOK_SECRET='whsec_promotion_fixture_only';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const promos=await import('../server/promotions');
const {paymentTable,ledgerTable}=await import('../server/payment-state');
const baseline={...config};
let server:Server,base:string,registrationCount=0;

before(async()=>{const app=createApp();app.set('trust proxy','loopback');app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
beforeEach(()=>{Object.assign(config,baseline,{passPromotionEnabled:true,appUrl:base,stripeAutoConfigureWebhook:false});finance.configureStripe();promos.initializePromotions();run("UPDATE managed_pass_promotions SET enabled=1,discount_type='amount',discount_value=3000,max_redemptions=NULL,revision=1 WHERE code='LINGYING58'");});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

async function request(route:string,body?:unknown,cookie='',expected=200,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+route,{method,headers:{...(route==='/api/auth/register'?{'X-Forwarded-For':`192.0.2.${++registrationCount}`}:{ }),...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);return{data,cookie:response.headers.getSetCookie().find(x=>x.startsWith('drama_session='))?.split(';')[0]||''};
}
async function viewer(){const registered=await request('/api/auth/register',{name:'Promotion Test',email:`${randomUUID()}@promotion.test`,password:'PromotionTestPass123!'},'',201);return{id:registered.data.user.id as string,cookie:registered.cookie};}
function stripeFixture(){
 const provider=finance.stripe!,sessions=new Map<string,any>(),creates:any[]=[];let timeout=false;
 const create=mock.method(provider.checkout.sessions,'create',async(params:any,options:any)=>{
  creates.push({params,key:options.idempotencyKey});let session=sessions.get(options.idempotencyKey);
  if(!session){session={id:'cs_fixture_'+params.metadata.paymentId,url:'https://checkout.stripe.com/c/pay/promotion-fixture',livemode:false,status:'open',payment_status:'unpaid',currency:params.line_items[0].price_data?.currency||'hkd',amount_total:params.line_items[0].price_data?.unit_amount||8800,metadata:params.metadata,client_reference_id:params.client_reference_id};sessions.set(options.idempotencyKey,session);}
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

test('public config exposes only a blank promo field capability and bootstrap flag cannot override managed controls',async()=>{
 const publicConfig=(await request('/api/config')).data;assert.deepEqual(publicConfig.passPromotion,{enabled:true});assert.equal(JSON.stringify(publicConfig).includes('LINGYING58'),false);
 config.passPromotionEnabled=false;assert.equal(promos.quotePromotion('unknown','LINGYING58').amountHkdCents,5800);
 run("UPDATE managed_pass_promotions SET enabled=0 WHERE code='LINGYING58'");config.passPromotionEnabled=true;promos.initializePromotions();assert.throws(()=>promos.quotePromotion('unknown','LINGYING58'),(error:any)=>error.code==='INVALID_PROMOTION');
});

test('normalized promo creates exact HK$58 inline Checkout and immutable server proof without funding a wallet',async()=>{
 const user=await viewer(),f=stripeFixture();config.stripeActivationPriceId='price_regular_88_fixture';
 try{
  const result=await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:' lingying58 ',amount_cents:1,currency:'usd'},user.cookie),p=payment(result.data.paymentId);
  assert.equal(p.amount_cents,5800);assert.equal(p.currency,'hkd');assert.equal(p.status,'pending');
  const quote=one('SELECT * FROM activation_promotion_quotes WHERE payment_id=? AND financial_mode=?',p.id,'default')!;assert.equal(quote.code,'LINGYING58');assert.equal(quote.amount_cents,5800);assert.equal(quote.regular_amount_cents,8800);
  const params=f.creates[0].params;assert.equal(params.line_items[0].price,undefined);assert.equal(params.line_items[0].price_data.unit_amount,5800);assert.equal(params.line_items[0].price_data.currency,'hkd');assert.equal(params.metadata.promotionCode,'LINGYING58');assert.equal(params.customer_email,one('SELECT email FROM users WHERE id=?',user.id)!.email);assert.equal(params.payment_intent_data.metadata.promotionCode,'LINGYING58');assert.ok(params.success_url.includes('promo=LINGYING58'));assert.ok(params.cancel_url.includes('promo=LINGYING58'));
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.wallet_micros,0);assert.equal(account.publisher_active,0);assert.equal(account.dramio_pass.active,false);
 }finally{f.restore();}
});

test('invalid, disabled and funding promo codes cannot create a payment or call Stripe',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  for(const code of ['', 'WRONG',false,58,'a'.repeat(65)])await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:code},user.cookie,400);
  run("UPDATE managed_pass_promotions SET enabled=0 WHERE code='LINGYING58'");const disabled=await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:'LINGYING58'},user.cookie,400);assert.equal(disabled.data.error.code,'INVALID_PROMOTION');
  run("UPDATE managed_pass_promotions SET enabled=1 WHERE code='LINGYING58'");await request('/api/payments/checkout',{kind:'funding',amount_cents:500,promo_code:'LINGYING58'},user.cookie,400);
  await assert.rejects(finance.createCheckout(user.id,'funding',500,'en','LINGYING58'),(error:any)=>error.code==='PROMOTION_NOT_APPLICABLE');
  assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',user.id)!.n,0);assert.equal(f.creates.length,0);
 }finally{f.restore();}
});

test('signed discounted settlement requires exact session, currency and amount; issued quotes survive offer disable and replay',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  const result=await finance.createCheckout(user.id,'activation',1,'en','LINGYING58',undefined,creatorConsent),p=payment('paymentId' in result?result.paymentId||'':'');config.passPromotionEnabled=false;
  for(const change of [{amount_total:5799},{amount_total:8800},{currency:'usd'},{id:'cs_wrong'}]){const rejected=await webhook(p,change,400);assert.equal(rejected.error.code,'PAYMENT_MISMATCH');assert.equal(payment(p.id).status,'pending');}
  const ignored=await webhook(p,{livemode:true},200,true);assert.equal(ignored.ignored,true);assert.equal(payment(p.id).status,'pending');
  await Promise.all([webhook(p),webhook(p)]);
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.publisher_active,1);assert.equal(account.wallet_micros,0);assert.equal(account.earnings_micros,0);assert.equal(account.dramio_pass.active,true);assert.ok(account.dramio_pass.purchased_at);assert.equal(account.quota_bytes,10*1024**3);
  const ledger=one("SELECT COUNT(*) AS n,MAX(description) AS description FROM ledger WHERE user_id=? AND kind='activation'",user.id)!;assert.equal(ledger.n,1);assert.match(ledger.description,/HK\$58.*LINGYING58/);
  await assert.rejects(finance.createCheckout(user.id,'activation',8800,undefined,undefined,undefined,creatorConsent),(error:any)=>error.code==='ALREADY_ACTIVE');
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
 try{const checkout=await finance.createCheckout(user.id,'activation',5800,undefined,undefined,undefined,creatorConsent);assert.equal(payment('paymentId' in checkout?checkout.paymentId||'':'').amount_cents,8800);assert.equal(f.creates[0].params.line_items[0].price,'price_regular_fixture');assert.equal(f.creates[0].params.metadata.promotionCode,undefined);assert.equal(one('SELECT COUNT(*) AS n FROM activation_promotion_quotes WHERE payment_id=?','paymentId' in checkout?checkout.paymentId||'':'')!.n,0);}finally{f.restore();}
});

test('promotion retries after provider timeout use one immutable payment and idempotency key',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  f.setTimeout();await assert.rejects(finance.createCheckout(user.id,'activation',1,'en','LINGYING58',undefined,creatorConsent),(error:any)=>error.code==='CHECKOUT_UNAVAILABLE');
  const p=one("SELECT * FROM payments WHERE user_id=? AND kind='activation'",user.id)!;
  const results=await Promise.all(Array.from({length:5},()=>finance.createCheckout(user.id,'activation',1,'en','LINGYING58',undefined,creatorConsent)));
  assert.ok(results.every(result=>'paymentId' in result&&result.paymentId===p.id));assert.equal(f.sessions.size,1);assert.equal(new Set(f.creates.map(value=>value.key)).size,1);assert.equal(f.creates[0].key,'checkout:'+p.id);assert.equal(one('SELECT COUNT(*) AS n FROM activation_promotion_quotes WHERE payment_id=?',p.id)!.n,1);
 }finally{f.restore();}
});

test('different-price concurrent requests cannot open duplicate checkouts and explicit unpaid cancellation permits switching',async()=>{
 const user=await viewer(),f=stripeFixture();
 try{
  const outcomes=await Promise.allSettled([finance.createCheckout(user.id,'activation',8800,undefined,undefined,undefined,creatorConsent),finance.createCheckout(user.id,'activation',1,'en','LINGYING58',undefined,creatorConsent)]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);const conflict=outcomes.find(result=>result.status==='rejected') as PromiseRejectedResult;assert.equal(conflict.reason.code,'ACTIVATION_CHECKOUT_CONFLICT');
  const old=one("SELECT * FROM payments WHERE user_id=? AND kind='activation' AND status='pending'",user.id)!;assert.equal(conflict.reason.details.paymentId,old.id);assert.equal(f.sessions.size,1);
  const conflictingBody=old.amount_cents===8800?{kind:'activation',creator_consent:creatorConsent,promo_code:'LINGYING58'}:{kind:'activation',creator_consent:creatorConsent};
  const apiConflict=await request('/api/payments/checkout',conflictingBody,user.cookie,409);assert.equal(apiConflict.data.error.details.paymentId,old.id);
  const other=await viewer();await request(`/api/payments/${old.id}/cancel`,{},other.cookie,404);
  await request(`/api/payments/${old.id}/cancel`,{},user.cookie);assert.equal(payment(old.id).status,'expired');
  const next=await finance.createCheckout(user.id,'activation',1,'en','LINGYING58',undefined,creatorConsent);assert.notEqual('paymentId' in next?next.paymentId||'':'',old.id);assert.equal(payment('paymentId' in next?next.paymentId||'':'').amount_cents,5800);assert.equal([...f.sessions.values()].filter(value=>value.status==='open').length,1);
 }finally{f.restore();}
});

test('explicit test-mode promotion uses isolated quote, receipt and financial tables, never real Pass or wallet state',async()=>{
 config.stripeTestMode=true;config.production=true;const user=await viewer(),f=stripeFixture();
 try{
  const result=await finance.createCheckout(user.id,'activation',1,'en','LINGYING58',undefined,creatorConsent),id='paymentId' in result?result.paymentId||'':'',p=payment(id);assert.equal(paymentTable(),'test_payments');assert.equal(one('SELECT id FROM payments WHERE id=?',id),undefined);assert.equal(one('SELECT financial_mode FROM activation_promotion_quotes WHERE payment_id=?',id)!.financial_mode,'test');
  await Promise.all([webhook(p),webhook(p)]);assert.equal(one('SELECT publisher_active FROM test_accounts WHERE user_id=?',user.id)!.publisher_active,1);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);assert.equal(ledgerTable(),'test_ledger');assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=?",user.id)!.n,0);
  const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.dramio_pass.test,true);assert.ok(account.dramio_pass.purchased_at);
  config.stripeTestMode=false;const live=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(live.dramio_pass.active,false);assert.equal(live.wallet_micros,0);
 }finally{f.restore();}
});

async function administrator(){const user=await viewer();run("UPDATE users SET role='admin' WHERE id=?",user.id);return user;}
const uniqueCode=()=>('CREATOR_'+randomUUID().slice(0,8)).toUpperCase();
async function managed(admin:{id:string;cookie:string},settings:Record<string,unknown>={}){
 const created=await request('/api/admin/promotions',{code:uniqueCode(),enabled:true,discount_type:'amount',discount_value:2000,max_redemptions:null,...settings},admin.cookie,201);return created.data.promotion;
}

test('administrator promotion management is private, validated and durably audited, with immutable unique codes',async()=>{
 const admin=await administrator(),ordinary=await viewer();await request('/api/admin/promotions',undefined,'',403);await request('/api/admin/promotions',undefined,ordinary.cookie,403);
 await request('/api/admin/promotions',{code:'FORGED',enabled:true,discount_type:'amount',discount_value:1,max_redemptions:null},ordinary.cookie,403);
 for(const settings of [{discount_value:0},{discount_value:8800},{discount_value:8401},{discount_type:'percent',discount_value:100},{discount_type:'percent',discount_value:96},{discount_type:'percent',discount_value:1.5},{max_redemptions:0},{max_redemptions:-1},{code:'a'},{code:'WITH SPACE'}])await request('/api/admin/promotions',{code:uniqueCode(),enabled:true,discount_type:'amount',discount_value:1000,max_redemptions:null,...settings},admin.cookie,400);
 const p=await managed(admin,{discount_type:'percent',discount_value:25});assert.equal(p.amount_hkd_cents,6600);assert.equal(p.max_redemptions,null);assert.equal(p.paid_redemptions,0);assert.equal(p.pending_redemptions,0);
 await request('/api/admin/promotions',{code:p.code.toLowerCase(),discount_type:'amount',discount_value:1000},admin.cookie,409);
 await request(`/api/admin/promotions/${p.id}`,{code:'RENAME'},admin.cookie,400,'PATCH');await request(`/api/admin/promotions/${p.id}`,{},admin.cookie,400,'PATCH');
 const changed=(await request(`/api/admin/promotions/${p.id}`,{enabled:false,discount_value:50},admin.cookie,200,'PATCH')).data.promotion;assert.equal(changed.revision,2);assert.equal(changed.enabled,false);assert.equal(changed.amount_hkd_cents,4400);
 const listing=(await request('/api/admin/promotions',undefined,admin.cookie)).data;const events=listing.events.filter((event:any)=>event.promotion_id===p.id);assert.equal(events.length,2);assert.equal(events[0].actor_id,admin.id);assert.equal(events[0].before.discount_value,25);assert.equal(events[0].after.discount_value,50);
 config.passPromotionEnabled=true;promos.initializePromotions();assert.equal(promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!.enabled,false);
});

test('authenticated code quote reveals only the supplied code, sends no email and creates no payment or usage reservation',async()=>{
 const admin=await administrator(),user=await viewer(),p=await managed(admin);await request('/api/payments/promotion/quote',{promo_code:p.code},'',401);
 const before=one('SELECT COUNT(*) AS n FROM payments')!.n;
 const response=await request('/api/payments/promotion/quote',{promo_code:' '+p.code.toLowerCase()+' '},user.cookie);
 assert.deepEqual(response.data.promotion,{code:p.code,amountHkdCents:6800,regularAmountHkdCents:8800,currency:'hkd',revision:1});
 assert.equal(one('SELECT COUNT(*) AS n FROM payments')!.n,before);assert.equal(promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!.pending_redemptions,0);
 const publicText=JSON.stringify((await request('/api/config')).data);assert.equal(publicText.includes(p.code),false);assert.equal(publicText.includes('LINGYING58'),false);
 await request('/api/payments/promotion/quote',{promo_code:'NOT_A_CODE'},user.cookie,400);
});

test('changed quote revision cannot silently charge another price and an already issued dynamic quote remains valid after edits or disable',async()=>{
 const admin=await administrator(),user=await viewer(),p=await managed(admin),f=stripeFixture();
 try{
  const quoted=(await request('/api/payments/promotion/quote',{promo_code:p.code},user.cookie)).data.promotion;
  await request(`/api/admin/promotions/${p.id}`,{discount_value:1000},admin.cookie,200,'PATCH');
  const stale=await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:p.code,promo_revision:quoted.revision},user.cookie,409);assert.equal(stale.data.error.code,'PROMOTION_CHANGED');assert.equal(f.creates.length,0);assert.equal(one('SELECT COUNT(*) AS n FROM payments WHERE user_id=?',user.id)!.n,0);
  const fresh=(await request('/api/payments/promotion/quote',{promo_code:p.code},user.cookie)).data.promotion;assert.equal(fresh.amountHkdCents,7800);
  const opened=await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:p.code,promo_revision:fresh.revision},user.cookie),record=payment(opened.data.paymentId);assert.equal(record.amount_cents,7800);
  await request(`/api/admin/promotions/${p.id}`,{enabled:false,discount_value:4000},admin.cookie,200,'PATCH');
  await webhook(record);await webhook(record);const account=(await request('/api/auth/me',undefined,user.cookie)).data.user;assert.equal(account.dramio_pass.active,true);assert.ok(account.dramio_pass.purchased_at);assert.equal(account.wallet_micros,0);
  const row=(await request('/api/wallet',undefined,user.cookie)).data.ledger.find((entry:any)=>entry.kind==='activation');assert.equal(row.payment_amount_cents,7800);assert.match(row.description,new RegExp(p.code));
 }finally{f.restore();}
});

test('finite promotion limits reserve pending checkouts atomically and cancellation releases one slot while paid redemption remains consumed',async()=>{
 const admin=await administrator(),a=await viewer(),b=await viewer(),p=await managed(admin,{max_redemptions:1}),f=stripeFixture();
 try{
  const results=await Promise.allSettled([finance.createCheckout(a.id,'activation',1,'en',p.code,p.revision,creatorConsent),finance.createCheckout(b.id,'activation',1,'en',p.code,p.revision,creatorConsent)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const loser=results.find(result=>result.status==='rejected') as PromiseRejectedResult;assert.equal(loser.reason.code,'INVALID_PROMOTION');assert.equal(f.sessions.size,1);
  const winnerIndex=results.findIndex(result=>result.status==='fulfilled'),winner=winnerIndex===0?a:b,other=winnerIndex===0?b:a,opened=(results[winnerIndex] as PromiseFulfilledResult<any>).value,record=payment(opened.paymentId);
  const pending=promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!;assert.equal(pending.pending_redemptions,1);assert.equal(pending.paid_redemptions,0);
  await assert.rejects(finance.createCheckout(other.id,'activation',1,'en',p.code,p.revision,creatorConsent),(error:any)=>error.code==='INVALID_PROMOTION');
  const resumed=await finance.createCheckout(winner.id,'activation',1,'en',p.code,p.revision,creatorConsent);assert.equal('paymentId' in resumed?resumed.paymentId:'',record.id);
  await finance.cancelCheckout(winner.id,record.id);assert.equal(promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!.pending_redemptions,0);
  const second=await finance.createCheckout(other.id,'activation',1,'en',p.code,p.revision,creatorConsent),secondRecord=payment('paymentId' in second?second.paymentId||'':'');await webhook(secondRecord);
  const paid=promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!;assert.equal(paid.pending_redemptions,0);assert.equal(paid.paid_redemptions,1);
  await request(`/api/admin/promotions/${p.id}`,{max_redemptions:1},admin.cookie,200,'PATCH');const c=await viewer();await request('/api/payments/promotion/quote',{promo_code:p.code},c.cookie,400);
  await request(`/api/admin/promotions/${p.id}`,{max_redemptions:null},admin.cookie,200,'PATCH');assert.equal((await request('/api/payments/promotion/quote',{promo_code:p.code},c.cookie)).data.promotion.amountHkdCents,6800);
 }finally{f.restore();}
});

test('unlimited promotions have independent test usage and do not let test reservations consume the live limit',async()=>{
 const admin=await administrator(),a=await viewer(),b=await viewer(),p=await managed(admin,{max_redemptions:1}),f=stripeFixture();
 try{
  config.stripeTestMode=true;const test=await finance.createCheckout(a.id,'activation',1,'en',p.code,p.revision,creatorConsent);await webhook(payment('paymentId' in test?test.paymentId||'':''));assert.equal(promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!.paid_redemptions,1);
  config.stripeTestMode=false;assert.equal(promos.adminPromotions(admin.id).promotions.find(row=>row.id===p.id)!.paid_redemptions,0);const live=await finance.createCheckout(b.id,'activation',1,'en',p.code,p.revision,creatorConsent);assert.ok('paymentId' in live);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',a.id)!.publisher_active,0);
 }finally{f.restore();}
});

test('old static HK$58 server quotes still settle and count after the managed launch offer is edited or disabled',async()=>{
 const admin=await administrator(),user=await viewer(),old=rawPayment(user.id);run('INSERT INTO activation_promotion_quotes (payment_id,financial_mode,code,amount_cents,currency,regular_amount_cents) VALUES (?,\'default\',\'LINGYING58\',5800,\'hkd\',8800)',old.id);
 const initial=promos.adminPromotions(admin.id).promotions.find(row=>row.code==='LINGYING58')!,beforePaid=initial.paid_redemptions;
 await request(`/api/admin/promotions/${initial.id}`,{enabled:false,discount_value:1000},admin.cookie,200,'PATCH');await webhook(old);assert.equal((await request('/api/auth/me',undefined,user.cookie)).data.user.dramio_pass.active,true);
 const after=promos.adminPromotions(admin.id).promotions.find(row=>row.id===initial.id)!;assert.equal(after.paid_redemptions,beforePaid+1);assert.equal(after.enabled,false);
});

test('promotion management and its audit are atomic when recording an audit fails',async()=>{
 const admin=await administrator(),code=uniqueCode();run("CREATE TRIGGER fail_promotion_audit BEFORE INSERT ON managed_pass_promotion_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
 try{assert.throws(()=>promos.createPromotion(admin.id,{code,enabled:true,discount_type:'amount',discount_value:1000,max_redemptions:null}),/audit failure/);assert.equal(one('SELECT 1 FROM managed_pass_promotions WHERE code=?',code),undefined);}finally{run('DROP TRIGGER fail_promotion_audit');}
});

test('Stripe receipt customer email always comes from the authenticated account for Pass and funding',async()=>{
 const user=await viewer(),f=stripeFixture(),email=one('SELECT email FROM users WHERE id=?',user.id)!.email;
 try{
  await request('/api/payments/checkout',{kind:'activation',creator_consent:creatorConsent,promo_code:'LINGYING58',customer_email:'attacker@example.test'},user.cookie);assert.equal(f.creates[0].params.customer_email,email);assert.equal(f.creates[0].params.payment_intent_data.receipt_email,undefined);
  await request('/api/payments/checkout',{kind:'funding',amount_cents:500,customer_email:'attacker@example.test'},user.cookie);assert.equal(f.creates[1].params.customer_email,email);assert.equal(f.creates[1].params.payment_intent_data.receipt_email,undefined);
 }finally{f.restore();}
});
