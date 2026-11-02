import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-admin-email-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';
process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {one,all,run,transaction,db}=await import('../server/db');
const {ensureConfiguredAdminAccess,ensurePlatformOwnerAccess}=await import('../server/owner');
const {getUser,requirePublisher}=await import('../server/auth');
const digest=(email:string)=>createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
function account(email='operator-'+randomUUID()+'@example.invalid',role='viewer'){
  const id=randomUUID();run('INSERT INTO users (id,email,name,password_hash,role,wallet_micros,earnings_micros,used_bytes) VALUES (?,?,?,?,?,?,?,?)',id,email,'Configured operator','unused-local-test-hash',role,5_000_000,700_000,1024);return{id,email};
}
function verify(user:{id:string;email:string},email=user.email){run('INSERT INTO account_email_verifications (user_id,verified_email,verified_at) VALUES (?,?,?)',user.id,email,new Date().toISOString());}
function google(user:{id:string;email:string},email=user.email){run("INSERT INTO oauth_identities (provider,subject,user_id,email) VALUES ('google',?,?,?)",randomUUID(),user.id,email);}
function money(){return{users:all('SELECT id,publisher_active,wallet_micros,earnings_micros,quota_bytes,used_bytes,stripe_account_id FROM users ORDER BY id'),test:all('SELECT * FROM test_accounts ORDER BY user_id'),payments:all('SELECT * FROM payments'),testPayments:all('SELECT * FROM test_payments'),ledger:all('SELECT * FROM ledger'),testLedger:all('SELECT * FROM test_ledger'),purchases:all('SELECT * FROM purchases'),testPurchases:all('SELECT * FROM test_purchases')};}
after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});

test('missing, malformed and nonmatching deployment hashes grant no administrator access',()=>{
  const user=account();verify(user);const before=money();
  for(const hash of ['', 'invalid','a'.repeat(63),'g'.repeat(64),digest('someone-else@example.invalid')]){
    config.platformAdminEmailHash=hash;assert.equal(ensureConfiguredAdminAccess(user.id),false);assert.equal(getUser(user.id)!.role,'viewer');
  }
  assert.deepEqual(money(),before);assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events')!.n,0);
});

test('a matching claimed email or profile name without server verification never grants admin',()=>{
  const user=account();config.platformAdminEmailHash=digest(user.email);
  assert.equal(ensureConfiguredAdminAccess(user.id),false);
  run('UPDATE users SET name=? WHERE id=?','Administrator - Configured operator',user.id);
  assert.equal(getUser(user.id)!.role,'viewer');assert.equal(getUser(user.id)!.publisher_active,0);
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',user.id)!.n,0);
});

test('proofs for an old or different account email cannot satisfy the trusted email selector',()=>{
  const user=account();config.platformAdminEmailHash=digest(user.email);
  verify(user,'old-address@example.invalid');google(user,'different-address@example.invalid');
  assert.equal(ensureConfiguredAdminAccess(user.id),false);assert.equal(getUser(user.id)!.role,'viewer');
  const other=account();verify(other);assert.equal(ensureConfiguredAdminAccess(other.id),false);
  assert.equal(ensureConfiguredAdminAccess('missing-account'),false);
});

test('current verified email grants a persisted audited role without changing money or paid Pass state',()=>{
  const user=account();verify(user);config.platformAdminEmailHash=digest(user.email);
  run('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)',user.id,123_000,70_000,0);
  const before=money(),profile=one('SELECT * FROM users WHERE id=?',user.id)!;
  assert.equal(ensureConfiguredAdminAccess(user.id),true);
  const updated=one<Record<string,unknown>>('SELECT * FROM users WHERE id=?',user.id)!;
  assert.deepEqual({...updated}, {...profile,role:'admin'});
  assert.deepEqual(money(),before);
  const events=all('SELECT * FROM platform_owner_access_events WHERE user_id=?',user.id);assert.equal(events.length,1);assert.equal(events[0].previous_role,'viewer');
  const current=getUser(user.id)!;assert.equal(current.role,'admin');assert.equal(current.publisher_active,0);assert.equal(current.dramio_pass.active,false);assert.equal(current.dramio_pass.purchased_at,null);
});

test('a trusted signed-Google email proof enables authenticated access with case-insensitive email matching',()=>{
  const email='Proven.Google.'+randomUUID()+'@example.invalid',user=account(email);
  google(user,email.toUpperCase());config.platformAdminEmailHash=digest(' '+email.toLowerCase()+' ').toUpperCase();
  assert.equal(getUser(user.id)!.role,'admin');assert.equal(getUser(user.id)!.email_verified,true);
  let next=0;requirePublisher({user:getUser(user.id),method:'POST'} as any,{} as any,()=>{next++;});assert.equal(next,1);
  assert.equal(getUser(user.id)!.dramio_pass.active,false);
});

test('repeated checks are idempotent and an established administrator composes with a transaction',()=>{
  const user=account();verify(user);config.platformAdminEmailHash=digest(user.email);assert.equal(ensureConfiguredAdminAccess(user.id),true);
  for(let i=0;i<3;i++)assert.equal(ensureConfiguredAdminAccess(user.id),false);
  transaction(()=>{assert.equal(ensureConfiguredAdminAccess(user.id),false);assert.equal(getUser(user.id)!.role,'admin');});
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',user.id)!.n,1);
});

test('a failed security audit rolls back email-based role promotion',()=>{
  const user=account();verify(user);config.platformAdminEmailHash=digest(user.email);
  db.exec("CREATE TRIGGER reject_email_admin_audit BEFORE INSERT ON platform_owner_access_events BEGIN SELECT RAISE(ABORT,'simulated admin audit failure'); END;");
  assert.throws(()=>ensureConfiguredAdminAccess(user.id),/simulated admin audit failure/);
  assert.equal(one('SELECT role FROM users WHERE id=?',user.id)!.role,'viewer');
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',user.id)!.n,0);
  db.exec('DROP TRIGGER reject_email_admin_audit');assert.equal(getUser(user.id)!.role,'admin');
});

test('administrator upload permission keeps financial review holds enforced',()=>{
  const user=account();verify(user);config.platformAdminEmailHash=digest(user.email);assert.equal(getUser(user.id)!.role,'admin');
  const caseId=randomUUID();run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id) VALUES (?,?,?,?,?,?)',caseId,'default',0,'refund','local-admin-review-'+caseId,user.id);
  const held=getUser(user.id)!;assert.equal(held.payment_review,true);assert.equal(held.dramio_pass.active,false);
  assert.throws(()=>requirePublisher({user:held,method:'POST'} as any,{} as any,()=>{}),(error:any)=>error.code==='PAYMENT_REVIEW_REQUIRED'&&error.status===423);
  let read=false;requirePublisher({user:held,method:'GET'} as any,{} as any,()=>{read=true;});assert.equal(read,true);
});

test('the configured immutable owner remains independent of the verified-email fallback',()=>{
  const user=account();config.platformOwnerUserId=user.id;config.platformAdminEmailHash=digest('another-operator@example.invalid');
  assert.equal(ensurePlatformOwnerAccess(),true);assert.equal(getUser(user.id)!.role,'admin');assert.equal(getUser(user.id)!.email_verified,false);
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',user.id)!.n,1);
  config.platformOwnerUserId='';
});

test('HTTP registration and profile claims remain ordinary until verified proof unlocks audited admin studio access',async()=>{
  const {createApp,errorHandler}=await import('../server/app');
  const email='http.operator.'+randomUUID()+'@example.invalid';config.platformAdminEmailHash=digest(email);
  const app=createApp();app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let cookie='';
  async function request(route:string,body?:unknown,method=body===undefined?'GET':'POST'){
    const response=await fetch(origin+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const registered=await request('/api/auth/register',{email,name:'Ordinary registered user',password:'OnlyForLocalTesting123!',role:'admin',publisher_active:1,email_verified:true});
    assert.equal(registered.status,201);cookie=registered.cookie!;const user=registered.data.user;
    assert.equal(user.role,'viewer');assert.equal(user.publisher_active,0);assert.equal(user.email_verified,false);assert.equal(user.dramio_pass.active,false);
    assert.equal((await request('/api/admin')).status,403);
    const forged=await request('/api/account',{name:'Administrator by name only',language:'en',role:'admin',publisher_active:1,email_verified:true},'PATCH');
    assert.equal(forged.status,200);assert.equal(forged.data.user.role,'viewer');assert.equal(forged.data.user.email_verified,false);
    const before=money();
    google({id:user.id,email});
    const promoted=await request('/api/auth/me');assert.equal(promoted.status,200);assert.equal(promoted.data.user.role,'admin');assert.equal(promoted.data.user.email_verified,true);
    assert.equal(promoted.data.user.publisher_active,0);assert.equal(promoted.data.user.dramio_pass.active,false);assert.equal(promoted.data.user.dramio_pass.purchased_at,null);
    const draft=await request('/api/studio/series',{title:'An administrator original',description:'An original series created to validate actual administrator publishing access.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1});
    assert.equal(draft.status,201,JSON.stringify(draft.data));assert.equal(one('SELECT creator_id FROM series WHERE id=?',draft.data.id)!.creator_id,user.id);
    assert.equal((await request('/api/admin')).status,200);assert.deepEqual(money(),before);
    const current=await request('/api/auth/me');assert.equal(current.data.user.role,'admin');assert.equal(current.data.user.publisher_active,0);assert.equal(current.data.user.dramio_pass.active,false);
    assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',user.id)!.n,1);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
