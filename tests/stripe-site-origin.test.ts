import {after,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-stripe-site-origin-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='stripe';process.env.STRIPE_TEST_MODE='true';
process.env.STRIPE_SITE_ORIGIN='';process.env.STRIPE_SECRET_KEY='rk_test_site_origin_fixture_only';
process.env.STRIPE_WEBHOOK_SECRET='whsec_site_origin_fixture_only';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const {stripeSiteOrigin}=await import('../server/origins');
const oldSite='https://aidramio.example.test',customSite='https://watch.example.test';
let server:Server,base:string;

async function request(route:string,body?:unknown,cookie='',expected=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:config.appUrl,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));
  return{data,cookie:response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))?.split(';')[0]||''};
}
async function viewer(){const result=await request('/api/auth/register',{name:'Stripe origin viewer',email:randomUUID()+'@site-origin.test',password:'SiteOriginPassword123!'},'',201);return{id:result.data.user.id,cookie:result.cookie};}
function pending(userId:string){const id=randomUUID(),session='cs_test_origin_'+randomUUID();run('INSERT INTO test_payments (id,user_id,kind,amount_cents,currency,provider,provider_session) VALUES (?,?,?,?,?,?,?)',id,userId,'funding',500,'usd','stripe',session);return{id,session};}
async function webhook(payment:{id:string;session:string},site:string){
  const payload=JSON.stringify({id:'evt_site_origin_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode:false,data:{object:{id:payment.session,livemode:false,payment_status:'paid',amount_total:500,currency:'usd',metadata:{paymentId:payment.id,site}}}});
  const signature=finance.stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
  const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});
  assert.equal(response.status,200);return response.json();
}

before(async()=>{const {createApp,errorHandler}=await import('../server/app');const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
beforeEach(()=>{config.production=true;config.sandbox=false;config.appUrl=customSite;config.publicUrl=customSite;config.stripeSiteOrigin=oldSite;config.payments='stripe';config.stripeTestMode=true;config.stripeActivationPriceId='';config.stripeWalletProductId='';config.mailProvider='disabled';finance.configureStripe();});
after(async()=>{mock.restoreAll();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('Stripe identity defaults to APP_URL and only changes when explicitly pinned',()=>{
  config.stripeSiteOrigin='';assert.equal(stripeSiteOrigin(),customSite);
  config.appUrl=oldSite;assert.equal(stripeSiteOrigin(),oldSite);
  config.appUrl=customSite;config.stripeSiteOrigin=oldSite;assert.equal(stripeSiteOrigin(),oldSite);
});

test('custom-domain wallet and pass Checkouts keep stable financial identity and new public return URLs',async()=>{
  const user=await viewer();const calls:any[]=[];
  const created=mock.method(finance.stripe!.checkout.sessions,'create',async(params:any):Promise<any>=>{calls.push(params);return{id:'cs_test_new_site_'+randomUUID(),livemode:false,url:'https://checkout.stripe.com/local-fixture'};});
  try{
    for(const kind of ['funding','activation'] as const){
      const result=await request('/api/payments/checkout',kind==='funding'?{kind,amount_cents:500}:{kind},user.cookie);
      const call=calls.at(-1),destination=kind==='funding'?'wallet':'studio';
      assert.equal(call.metadata.site,oldSite);assert.equal(call.metadata.financialMode,'test');
      assert.equal(call.success_url,customSite+`/${destination}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
      assert.equal(call.cancel_url,customSite+`/${destination}?checkout=cancelled`);
      assert.equal(call.line_items[0].price_data.currency,kind==='funding'?'usd':'hkd');
      assert.equal(call.line_items[0].price_data.unit_amount,kind==='funding'?500:8800);
      const payment=one('SELECT * FROM test_payments WHERE id=?',result.data.paymentId)!;assert.equal(payment.status,'pending');
    }
    assert.equal(one('SELECT wallet_micros,publisher_active FROM users WHERE id=?',user.id)!.wallet_micros,0);
    assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);
  }finally{created.mock.restore();}
});

test('old-origin pending Sessions settle after APP_URL moves, reject other site tags and replay once',async()=>{
  config.appUrl=oldSite;config.publicUrl=oldSite;config.stripeSiteOrigin='';
  const user=await viewer(),payment=pending(user.id);
  config.appUrl=customSite;config.publicUrl=customSite;config.stripeSiteOrigin=oldSite;
  for(const site of [customSite,'https://untrusted.example']){
    assert.deepEqual(await webhook(payment,site),{received:true,ignored:true});
    assert.equal(one('SELECT status FROM test_payments WHERE id=?',payment.id)!.status,'pending');
  }
  assert.deepEqual(await webhook(payment,oldSite),{received:true});
  assert.deepEqual(await webhook(payment,oldSite),{received:true});
  assert.equal((await request('/api/wallet',undefined,user.cookie)).data.user.wallet_micros,5_000_000);
  assert.equal(one("SELECT COUNT(*) AS n FROM test_ledger WHERE user_id=? AND kind='funding'",user.id)!.n,1);
  assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,0);
});

test('custom-domain reconciliation of old Sessions remains owner-only and does not duplicate credit',async()=>{
  const user=await viewer(),other=await viewer(),payment=pending(user.id);let retrieves=0;
  const retrieved=mock.method(finance.stripe!.checkout.sessions,'retrieve',async(id:string):Promise<any>=>{retrieves++;assert.equal(id,payment.session);return{id,livemode:false,payment_status:'paid',amount_total:500,currency:'usd',metadata:{site:oldSite,paymentId:payment.id}};});
  try{
    await request('/api/payments/reconcile',{session_id:payment.session},other.cookie,404);assert.equal(retrieves,0);
    for(let attempt=0;attempt<2;attempt++)assert.equal((await request('/api/payments/reconcile',{session_id:payment.session},user.cookie)).data.user.wallet_micros,5_000_000);
    assert.equal(one("SELECT COUNT(*) AS n FROM test_ledger WHERE user_id=? AND kind='funding'",user.id)!.n,1);
    assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,0);
  }finally{retrieved.mock.restore();}
});
