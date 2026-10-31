import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-owner-access-'));
const ownerId='000ca929-30da-4e8b-a2a6-2135d184fe9b';
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';
process.env.PLATFORM_OWNER_USER_ID=ownerId;
process.env.OFFICIAL_CREATOR_NAME='LingYingDrama Offical';
const {config}=await import('../server/config');
const {one,all,run,transaction,db}=await import('../server/db');
const {ensurePlatformOwnerAccess,creatorDisplayName}=await import('../server/owner');
const {getUser,requirePublisher}=await import('../server/auth');
for(const[id,email,name,role,active]of [
  [ownerId,'owner@example.invalid','jimmy tsoi','viewer',0],
  ['same-display-name','lookalike@example.invalid','jimmy tsoi','viewer',0],
  ['same-public-alias','alias@example.invalid','LingYingDrama Offical','viewer',0],
  ['regular-publisher','creator@example.invalid','Another author','publisher',1],
] as const)run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros,used_bytes) VALUES (?,?,?,?,?,?,?,?,?)',id,email,name,'unused-local-test-hash',role,active,5_000_000,700_000,1024);
run('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)',ownerId,200_000,30_000,0);
after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});

test('only the configured existing immutable user ID receives audited owner access',()=>{
  const before=all('SELECT * FROM users ORDER BY id');
  const testBefore=all('SELECT * FROM test_accounts');
  config.platformOwnerUserId='';assert.equal(ensurePlatformOwnerAccess(),false);
  config.platformOwnerUserId='nonexistent-owner';assert.equal(ensurePlatformOwnerAccess(),false);
  assert.deepEqual(all('SELECT * FROM users ORDER BY id'),before);
  config.platformOwnerUserId=ownerId;
  assert.equal(ensurePlatformOwnerAccess(),true);
  const expected=before.map(user=>({...user,role:user.id===ownerId?'admin':user.role}));
  assert.deepEqual(all('SELECT * FROM users ORDER BY id').map(user=>({...user})),expected);
  assert.deepEqual(all('SELECT * FROM test_accounts'),testBefore);
  const events=all('SELECT * FROM platform_owner_access_events');
  assert.equal(events.length,1);assert.equal(events[0].user_id,ownerId);assert.equal(events[0].previous_role,'viewer');
  for(const table of ['payments','test_payments','ledger','test_ledger','purchases','test_purchases'])assert.equal(one(`SELECT COUNT(*) AS n FROM ${table}`)!.n,0);
});

test('repeated owner checks remain idempotent and compose with an already open transaction',()=>{
  for(let n=0;n<3;n++)assert.equal(ensurePlatformOwnerAccess(),false);
  transaction(()=>{assert.equal(ensurePlatformOwnerAccess(),false);assert.equal(getUser(ownerId)!.role,'admin');});
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events')!.n,1);
});

test('official publisher alias does not rewrite profile names or other publishers',()=>{
  assert.equal(creatorDisplayName(ownerId,'jimmy tsoi'),'LingYingDrama Offical');
  assert.equal(creatorDisplayName('regular-publisher','Another author'),'Another author');
  assert.equal(creatorDisplayName('same-display-name','jimmy tsoi'),'jimmy tsoi');
  const owner=getUser(ownerId)!;assert.equal(owner.name,'jimmy tsoi');assert.equal(owner.creator_display_name,'LingYingDrama Offical');
  assert.equal(owner.publisher_active,0);assert.equal(owner.dramio_pass.active,false);
  assert.equal(owner.wallet_micros,5_000_000);assert.equal(owner.earnings_micros,700_000);
  assert.equal(getUser('same-public-alias')!.role,'viewer');
});

test('administrators upload without purchasing a Pass while normal viewers still need activation',()=>{
  let next=0;
  requirePublisher({user:getUser(ownerId),method:'POST'} as any,{} as any,()=>{next++;});
  requirePublisher({user:getUser('regular-publisher'),method:'POST'} as any,{} as any,()=>{next++;});
  assert.equal(next,2);
  assert.throws(()=>requirePublisher({user:getUser('same-display-name'),method:'POST'} as any,{} as any,()=>{}),(error:any)=>error.status===403&&error.code==='ACTIVATION_REQUIRED');
  assert.equal(getUser(ownerId)!.dramio_pass.active,false);
});

test('administrator publishing exemption never bypasses a financial review hold',()=>{
  const caseId='owner-financial-review';
  run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id) VALUES (?,?,?,?,?,?)',caseId,'default',0,'refund','owner-test-refund',ownerId);
  assert.equal(getUser(ownerId)!.payment_review,true);
  assert.throws(()=>requirePublisher({user:getUser(ownerId),method:'POST'} as any,{} as any,()=>{}),(error:any)=>error.status===423&&error.code==='PAYMENT_REVIEW_REQUIRED');
  let read=false;requirePublisher({user:getUser(ownerId),method:'GET'} as any,{} as any,()=>{read=true;});assert.equal(read,true);
  run('DELETE FROM payment_risk_cases WHERE id=?',caseId);
});

test('role promotion rolls back if recording its security audit fails',()=>{
  run("UPDATE users SET role='viewer' WHERE id=?",ownerId);
  db.exec("CREATE TRIGGER reject_owner_audit BEFORE INSERT ON platform_owner_access_events BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;");
  assert.throws(()=>ensurePlatformOwnerAccess(),/simulated audit failure/);
  assert.equal(one('SELECT role FROM users WHERE id=?',ownerId)!.role,'viewer');
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events')!.n,1);
  db.exec('DROP TRIGGER reject_owner_audit');
  // The normal authentication read also establishes an existing owner session.
  assert.equal(getUser(ownerId)!.role,'admin');
  assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events')!.n,2);
});
