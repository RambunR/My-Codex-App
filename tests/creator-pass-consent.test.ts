import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-creator-consent-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='stripe';process.env.STRIPE_TEST_MODE='false';process.env.STRIPE_AUTO_CONFIGURE_WEBHOOK='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
process.env.STRIPE_SECRET_KEY='sk_live_consent_fixture_only';process.env.STRIPE_WEBHOOK_SECRET='whsec_live_consent_fixture_only';process.env.STRIPE_TEST_SECRET_KEY='sk_test_consent_fixture_only';process.env.STRIPE_TEST_WEBHOOK_SECRET='whsec_test_consent_fixture_only';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const {LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION}=await import('../shared/creator-pass-consent');
const consent={accepted:true,policy_version:LEGAL_POLICY_VERSION,disclosure_version:CREATOR_PASS_DISCLOSURE_VERSION};
const site='https://creator-consent.example.test',nativeFetch=globalThis.fetch;
interface Actor{id:string;cookie:string}
let server:Server,base:string;
function actor(language='en'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,language) VALUES (?,?,?,?,?)',id,id+'@consent.test','Consent fixture','unused-local-hash',language);
  run('INSERT INTO test_accounts (user_id) VALUES (?)',id);run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,user?:Actor,status=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:site,...(user?{Cookie:user.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,route+': '+JSON.stringify(data));return data;
}
const proofs=()=>all('SELECT * FROM creator_pass_consents ORDER BY rowid');
const proof=(id:string,mode='default')=>one('SELECT * FROM creator_pass_consents WHERE payment_id=? AND financial_mode=?',id,mode)!;
const table=()=>config.stripeTestMode?'test_payments':'payments';
function snapshot(){const result:Record<string,unknown>={};for(const name of ['users','test_accounts','payments','test_payments','ledger','test_ledger','creator_pass_consents'])result[name]=all('SELECT * FROM '+name+' ORDER BY rowid');return result;}
function selectMode(testMode=false){config.stripeTestMode=testMode;config.stripeKey=testMode?'sk_test_consent_fixture_only':'sk_live_consent_fixture_only';config.stripeWebhook=testMode?'whsec_test_consent_fixture_only':'whsec_live_consent_fixture_only';finance.configureStripe();}
function provider(){
  const sessions=new Map<string,any>(),creates:Array<{params:any;key:string}>=[];let timeout=false;
  mock.method(finance.stripe!.checkout.sessions,'create',async(params:any,options:any)=>{
    creates.push({params,key:options.idempotencyKey});let session=sessions.get(options.idempotencyKey);
    if(!session){session={id:'cs_consent_'+params.metadata.paymentId,url:'https://checkout.stripe.com/local-consent-fixture',object:'checkout.session',mode:'payment',status:'open',payment_status:'unpaid',livemode:!config.stripeTestMode,amount_total:params.line_items[0].price_data.unit_amount,currency:params.line_items[0].price_data.currency,metadata:params.metadata,client_reference_id:params.client_reference_id};sessions.set(options.idempotencyKey,session);}
    if(timeout){timeout=false;throw new Error('Local provider timeout after creating the session.');}return session;
  });
  mock.method(finance.stripe!.checkout.sessions,'retrieve',async(id:string)=>{const session=[...sessions.values()].find(value=>value.id===id);assert.ok(session,'Only local recorded sessions may be retrieved.');return session;});
  mock.method(finance.stripe!.checkout.sessions,'expire',async(id:string)=>{const session=[...sessions.values()].find(value=>value.id===id);assert.ok(session);session.status='expired';return session;});
  return{sessions,creates,timeout:()=>{timeout=true;}};
}
function legacyPayment(user:Actor,providerName='stripe'){
  const id=randomUUID(),sessionId='cs_legacy_consent_'+id;
  run(`INSERT INTO ${table()} (id,user_id,kind,amount_cents,currency,provider,provider_session,created_at) VALUES (?,?,'activation',8800,'hkd',?,?,'2026-10-01 00:00:00')`,id,user.id,providerName,sessionId);
  return{id,user_id:user.id,provider_session:sessionId,amount_cents:8800,currency:'hkd'};
}
function legacySession(payment:ReturnType<typeof legacyPayment>,paid=false){return{id:payment.provider_session,object:'checkout.session',mode:'payment',status:paid?'complete':'open',payment_status:paid?'paid':'unpaid',livemode:!config.stripeTestMode,amount_total:payment.amount_cents,currency:payment.currency,client_reference_id:payment.id,metadata:{app:'aidramio',site,financialMode:config.stripeTestMode?'test':'default',paymentId:payment.id,userId:payment.user_id},url:'https://checkout.stripe.com/local-legacy-consent-fixture'};}
async function webhook(payment:ReturnType<typeof legacyPayment>){
  const payload=JSON.stringify({id:'evt_consent_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode:!config.stripeTestMode,data:{object:legacySession(payment,true)}}),signature=finance.stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
  const response=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});assert.equal(response.status,200,await response.text());
}
before(async()=>{const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
beforeEach(()=>{
  mock.restoreAll();Object.assign(config,{production:true,sandbox:false,payments:'stripe',appUrl:site,publicUrl:site,stripeSiteOrigin:site,payoutsEnabled:false,stripeAutoConfigureWebhook:false,stripeActivationPriceId:'',stripeWalletProductId:'',passPromotionEnabled:false,mailProvider:'disabled'});selectMode();
  mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=input instanceof Request?input.url:String(input);assert.equal(new URL(url).origin,base,'Consent tests must not call any external service.');return nativeFetch(input,init);});
});
afterEach(()=>mock.restoreAll());
after(async()=>{mock.restoreAll();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('config declares the required versions and API or direct service calls cannot bypass affirmative current consent',async()=>{
  const publicConfig=await request('/api/config');assert.deepEqual(publicConfig.creatorPassConsent,{policyVersion:LEGAL_POLICY_VERSION,disclosureVersion:CREATOR_PASS_DISCLOSURE_VERSION});
  const user=actor(),f=provider(),before=snapshot();
  const invalid:Array<[unknown,number,string]>=[
    [undefined,400,'CREATOR_CONSENT_REQUIRED'],[null,400,'CREATOR_CONSENT_REQUIRED'],['true',400,'CREATOR_CONSENT_REQUIRED'],[{...consent,accepted:false},400,'CREATOR_CONSENT_REQUIRED'],[{...consent,accepted:'true'},400,'CREATOR_CONSENT_REQUIRED'],[{accepted:true},400,'CREATOR_CONSENT_REQUIRED'],[{...consent,policy_version:''},400,'CREATOR_CONSENT_REQUIRED'],[{...consent,accepted_at:'2020-01-01'},400,'CREATOR_CONSENT_REQUIRED'],[{...consent,policy_version:'2026-11-07'},409,'CREATOR_POLICY_CHANGED'],[{...consent,disclosure_version:'creator-pass-ack-v1'},409,'CREATOR_POLICY_CHANGED'],
  ];
  for(const[value,status,code]of invalid){
    const rejected=await request('/api/payments/checkout',{kind:'activation',creator_consent:value},user,status);assert.equal(rejected.error.code,code);
    await assert.rejects(finance.createCheckout(user.id,'activation',1,'en',undefined,undefined,value as any),(error:any)=>error.status===status&&error.code===code);
  }
  assert.deepEqual(snapshot(),before);assert.equal(f.creates.length,0);
});

test('an accepted checkout records authenticated identity, selected language, current versions and a server timestamp without granting a paid Pass',async()=>{
  const user=actor('en'),other=actor(),f=provider(),earliest=Date.now();
  const checkout=await request('/api/payments/checkout',{kind:'activation',amount_cents:1,currency:'usd',language:'zh-TW',user_id:other.id,creator_consent:consent},user),latest=Date.now(),saved=proof(checkout.paymentId);
  assert.equal(saved.user_id,user.id);assert.equal(saved.accepted,1);assert.equal(saved.financial_mode,'default');assert.equal(saved.policy_version,LEGAL_POLICY_VERSION);assert.equal(saved.disclosure_version,CREATOR_PASS_DISCLOSURE_VERSION);assert.equal(saved.language,'zh-TW');
  const accepted=Date.parse(saved.accepted_at.replace(' ','T')+'Z');assert.ok(accepted>=earliest-1000&&accepted<=latest,'The acknowledgement time comes from the server.');
  const payment=one('SELECT * FROM payments WHERE id=?',checkout.paymentId)!;assert.equal(payment.user_id,user.id);assert.equal(payment.amount_cents,8800);assert.equal(payment.currency,'hkd');assert.equal(payment.status,'pending');assert.equal(f.creates[0].params.customer_email,one('SELECT email FROM users WHERE id=?',user.id)!.email);
  assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,0);assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?',user.id)!.n,0);
});

test('provider timeout and concurrent retries retain one append-only acknowledgement, original language, payment and provider key',async()=>{
  const user=actor(),f=provider();f.timeout();await request('/api/payments/checkout',{kind:'activation',language:'zh-TW',creator_consent:consent},user,502);
  const pending=one("SELECT * FROM payments WHERE user_id=? AND kind='activation'",user.id)!,original=proof(pending.id),beforeCount=proofs().length;
  const resumed=await Promise.all(Array.from({length:6},()=>finance.createCheckout(user.id,'activation',1,'ar',undefined,undefined,consent)));assert.ok(resumed.every(result=>'paymentId' in result&&result.paymentId===pending.id));
  assert.equal(f.sessions.size,1);assert.equal(new Set(f.creates.map(call=>call.key)).size,1);assert.equal(f.creates[0].key,'checkout:'+pending.id);assert.deepEqual(proof(pending.id),original);assert.equal(proofs().length,beforeCount);assert.equal(original.language,'zh-TW');
  assert.throws(()=>run("UPDATE creator_pass_consents SET language='ar' WHERE payment_id=?",pending.id));assert.throws(()=>run('DELETE FROM creator_pass_consents WHERE payment_id=?',pending.id));assert.deepEqual(proof(pending.id),original);
  // SQLite REPLACE can otherwise delete and reinsert without firing DELETE
  // guards when recursive triggers are off. The insert guard must retain proof.
  for(const conflict of ['REPLACE','IGNORE']){run(`INSERT OR ${conflict} INTO creator_pass_consents (payment_id,financial_mode,user_id,policy_version,disclosure_version,language,accepted,accepted_at) VALUES (?,?,?,?,?,?,1,?)`,pending.id,'default',user.id,LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION,'ar','2000-01-01 00:00:00');assert.deepEqual(proof(pending.id),original);assert.equal(one('SELECT COUNT(*) AS n FROM creator_pass_consents WHERE payment_id=?',pending.id)!.n,1);}
});

test('the same user has separate live and test payment acknowledgements without converting balances or activation',async()=>{
  const user=actor(),liveProvider=provider(),live=await request('/api/payments/checkout',{kind:'activation',language:'en',creator_consent:consent},user);assert.equal(liveProvider.creates.length,1);const liveProof=proof(live.paymentId),beforeUsers=all('SELECT * FROM users ORDER BY id'),beforeTestAccounts=all('SELECT * FROM test_accounts ORDER BY user_id');
  selectMode(true);const testProvider=provider(),testCheckout=await request('/api/payments/checkout',{kind:'activation',language:'ja',creator_consent:consent},user),testProof=proof(testCheckout.paymentId,'test');
  assert.notEqual(testCheckout.paymentId,live.paymentId);assert.equal(testProof.user_id,user.id);assert.equal(testProof.language,'ja');assert.equal(testProvider.creates.length,1);assert.equal(one('SELECT id FROM payments WHERE id=?',testCheckout.paymentId),undefined);assert.equal(one('SELECT id FROM test_payments WHERE id=?',live.paymentId),undefined);assert.deepEqual(proof(live.paymentId),liveProof);assert.deepEqual(all('SELECT * FROM users ORDER BY id'),beforeUsers);assert.deepEqual(all('SELECT * FROM test_accounts ORDER BY user_id'),beforeTestAccounts);
});

test('an acknowledgement audit failure rolls back the new activation payment before contacting the provider',async()=>{
  const user=actor(),f=provider(),before=snapshot();run(`CREATE TRIGGER fail_creator_consent_fixture BEFORE INSERT ON creator_pass_consents WHEN NEW.user_id='${user.id}' BEGIN SELECT RAISE(ABORT,'Local consent audit failure.'); END`);
  try{await assert.rejects(finance.createCheckout(user.id,'activation',8800,'en',undefined,undefined,consent));assert.deepEqual(snapshot(),before);assert.equal(f.creates.length,0);}finally{run('DROP TRIGGER fail_creator_consent_fixture');}
});

test('wallet funding requires no creator agreement and never writes creator acknowledgements, even with unrelated consent input',async()=>{
  const user=actor(),f=provider(),beforeProofs=proofs();const funded=await request('/api/payments/checkout',{kind:'funding',amount_cents:500},user);const payment=one('SELECT * FROM payments WHERE id=?',funded.paymentId)!;assert.equal(payment.amount_cents,500);assert.equal(payment.currency,'usd');
  await finance.createCheckout(user.id,'funding',1234,'en',undefined,undefined,{...consent,accepted:false});const invalid=await request('/api/payments/checkout',{kind:'funding',amount_cents:499},user,400);assert.equal(invalid.error.code,'VALIDATION');assert.deepEqual(proofs(),beforeProofs);assert.equal(f.creates.length,2);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,0);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);
});

test('resuming a legacy unpaid activation requires current consent but preserves its saved price, identity and creation date',async()=>{
  const user=actor(),f=provider(),old=legacyPayment(user);f.sessions.set('legacy:'+old.id,legacySession(old));
  run("INSERT INTO creator_pass_consents (payment_id,financial_mode,user_id,policy_version,disclosure_version,language,accepted_at) VALUES (?,'default',?,?,'creator-pass-ack-v1','en','2026-11-08 08:00:00')",old.id,user.id,LEGAL_POLICY_VERSION);
  const original=one('SELECT * FROM payments WHERE id=?',old.id)!,previous=proof(old.id),before=proofs();
  const rejected=await request('/api/payments/checkout',{kind:'activation'},user,400);assert.equal(rejected.error.code,'CREATOR_CONSENT_REQUIRED');assert.deepEqual(proofs(),before);assert.equal(f.creates.length,0);
  const resumed=await request('/api/payments/checkout',{kind:'activation',language:'zh-CN',creator_consent:consent},user);assert.equal(resumed.paymentId,old.id);assert.equal(f.creates.length,0);const saved=one('SELECT * FROM payments WHERE id=?',old.id)!;assert.equal(saved.provider_session,original.provider_session);assert.equal(saved.created_at,original.created_at);assert.equal(saved.amount_cents,original.amount_cents);const current=one('SELECT * FROM creator_pass_consents WHERE payment_id=? AND disclosure_version=?',old.id,CREATOR_PASS_DISCLOSURE_VERSION)!;assert.equal(current.language,'zh-CN');assert.notEqual(current.accepted_at,original.created_at);assert.deepEqual(proof(old.id),previous);assert.equal(one('SELECT COUNT(*) n FROM creator_pass_consents WHERE payment_id=?',old.id)!.n,2);
});

test('legacy payments missing a saved provider session distinguish cached unpaid consent from already paid history',async()=>{
  const f=provider();
  for(const paid of [false,true]){
    const user=actor(),old=legacyPayment(user),cached=legacySession(old,paid);run('UPDATE payments SET provider_session=NULL WHERE id=?',old.id);
    const original=one('SELECT * FROM payments WHERE id=?',old.id)!,beforeProofs=proofs(),beforeCreates=f.creates.length;
    // Model a pre-deployment timeout after Stripe already created the session,
    // while the database still lacks both its session ID and any consent proof.
    f.sessions.set('checkout:'+old.id,cached);
    const result=await request('/api/payments/checkout',{kind:'activation',amount_cents:1,language:'zh-TW',creator_consent:consent},user),saved=one('SELECT * FROM payments WHERE id=?',old.id)!;
    assert.equal(f.creates.length,beforeCreates+1);assert.equal(f.creates.at(-1)!.key,'checkout:'+old.id);assert.equal(f.creates.at(-1)!.params.metadata.paymentId,old.id);assert.equal(saved.provider_session,cached.id);assert.equal(saved.created_at,original.created_at);assert.equal(saved.amount_cents,original.amount_cents);assert.equal(saved.currency,'hkd');
    if(paid){
      assert.equal(result.alreadyPaid,true);assert.equal(result.url,undefined);assert.equal(saved.status,'paid');assert.deepEqual(proofs(),beforeProofs);
      await webhook(old);await webhook(old);assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",user.id)!.n,1);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,1);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.id)!.wallet_micros,0);assert.deepEqual(proofs(),beforeProofs);
    }else{
      assert.equal(result.paymentId,old.id);assert.equal(result.url,cached.url);assert.equal(saved.status,'pending');const acknowledged=proof(old.id);assert.equal(acknowledged.user_id,user.id);assert.equal(acknowledged.language,'zh-TW');assert.notEqual(acknowledged.accepted_at,original.created_at);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',user.id)!.publisher_active,0);
    }
  }
});

test('legacy signed settlement, reconciliation, cancellation and demo confirmation do not demand or invent retrospective consent',async()=>{
  const f=provider(),before=proofs(),webhookUser=actor(),webhookPayment=legacyPayment(webhookUser);await webhook(webhookPayment);await webhook(webhookPayment);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',webhookUser.id)!.publisher_active,1);assert.equal(one("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND kind='activation'",webhookUser.id)!.n,1);
  const reconcileUser=actor(),reconcilePayment=legacyPayment(reconcileUser);f.sessions.set('legacy:'+reconcilePayment.id,legacySession(reconcilePayment,true));await request('/api/payments/reconcile',{session_id:reconcilePayment.provider_session},reconcileUser);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',reconcileUser.id)!.publisher_active,1);
  const cancelUser=actor(),cancelPayment=legacyPayment(cancelUser);f.sessions.set('legacy:'+cancelPayment.id,legacySession(cancelPayment));await request('/api/payments/'+cancelPayment.id+'/cancel',{},cancelUser);assert.equal(one('SELECT status FROM payments WHERE id=?',cancelPayment.id)!.status,'expired');assert.equal(one('SELECT publisher_active FROM users WHERE id=?',cancelUser.id)!.publisher_active,0);
  config.production=false;config.payments='demo';const demoUser=actor(),demo=legacyPayment(demoUser,'demo');await request('/api/payments/'+demo.id+'/demo-confirm',{},demoUser);assert.equal(one('SELECT publisher_active FROM users WHERE id=?',demoUser.id)!.publisher_active,1);assert.deepEqual(proofs(),before);
});
