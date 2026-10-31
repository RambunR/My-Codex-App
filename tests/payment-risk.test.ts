import {after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-payment-risk-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.PAYMENTS_MODE='stripe';
process.env.STRIPE_TEST_MODE='true';process.env.STRIPE_SECRET_KEY='rk_test_risk_fixture';process.env.STRIPE_SITE_ORIGIN='https://api.example.test';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const {recordPaymentLink,processRiskEvent,paymentAccountReview,assertPaymentAccountClear,assertPaymentPayoutsClear,adminPaymentReviews,resolvePaymentReview}=await import('../server/payment-risk');

beforeEach(()=>{config.stripeTestMode=true;config.stripeKey='rk_test_risk_fixture';config.stripeSiteOrigin='https://api.example.test';config.appUrl='https://watch.example.test';config.production=true;});
after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
function user(role='viewer',walletCents=500){
  const id=randomUUID();run('INSERT INTO users (id,email,name,password_hash,role,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?)',id,id+'@risk.test','Risk fixture','not-a-login',role,17_000_000,9_000_000);
  run('INSERT INTO test_accounts (user_id,wallet_micros) VALUES (?,?)',id,walletCents*10000);return id;
}
function payment(userId:string,kind='funding',amount=500){const id=randomUUID(),session='cs_test_'+randomUUID(),pi='pi_'+randomUUID(),charge='ch_'+randomUUID();run('INSERT INTO test_payments (id,user_id,kind,amount_cents,currency,provider,provider_session,status) VALUES (?,?,?,?,?,?,?,?)',id,userId,kind,kind==='activation'?8800:amount,kind==='activation'?'hkd':'usd','stripe',session,'paid');return{id,session,pi,charge,userId,kind,amount:kind==='activation'?8800:amount,currency:kind==='activation'?'hkd':'usd'};}
type Fixture=ReturnType<typeof payment>;
function link(p:Fixture){recordPaymentLink(p.id,{id:p.session,livemode:false,amount_total:p.amount,currency:p.currency,payment_intent:{id:p.pi,latest_charge:p.charge}});}
function refund(p:Fixture,amount=p.amount,extras:Record<string,unknown>={}){return{id:'evt_'+randomUUID(),type:'charge.refunded',livemode:false,created:100,data:{object:{id:p.charge,payment_intent:p.pi,amount:p.amount,amount_refunded:amount,currency:p.currency,refunded:amount===p.amount,...extras}}};}
function dispute(p:Fixture,id='dp_'+randomUUID(),status='needs_response',created=100){return{id:'evt_'+randomUUID(),type:status==='won'||status==='lost'?'charge.dispute.closed':'charge.dispute.created',livemode:false,created,data:{object:{id,charge:p.charge,payment_intent:p.pi,amount:p.amount,currency:p.currency,status}}};}
const note='Verified original provider payment and documented the resolution.';
function balance(id:string){return one('SELECT wallet_micros FROM test_accounts WHERE user_id=?',id)!.wallet_micros;}

test('mapped refund freezes only its recorded owner, ignoring a metadata user ID, and is durable/idempotent',()=>{
  const owner=user(),other=user(),p=payment(owner);link(p);
  const event=refund(p,500,{metadata:{userId:other}}),result=processRiskEvent(event);
  assert.equal(result.unmapped,false);assert.equal(paymentAccountReview(owner),true);assert.equal(paymentAccountReview(other),false);
  assert.throws(()=>assertPaymentAccountClear(owner),(error:any)=>error.code==='PAYMENT_REVIEW_REQUIRED'&&error.status===423);
  assert.doesNotThrow(()=>assertPaymentAccountClear(other));assert.throws(assertPaymentPayoutsClear);
  assert.equal(processRiskEvent(event).duplicate,true);assert.equal(one('SELECT COUNT(*) AS n FROM payment_risk_cases WHERE payment_id=?',p.id)!.n,1);
  assert.equal(balance(owner),5_000_000);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner)!.wallet_micros,17_000_000);
});

test('unknown events remain held globally until an exact validated late provider link attaches the owner',()=>{
  const owner=user(),p=payment(owner),result=processRiskEvent(refund(p));assert.equal(result.unmapped,true);
  assert.equal(paymentAccountReview(owner),false);assert.throws(assertPaymentPayoutsClear);
  const admin=user('admin');assert.throws(()=>resolvePaymentReview(result.caseId!,admin,{decision:'platform_loss',note}),(error:any)=>error.code==='REVIEW_UNMAPPED');
  link(p);assert.equal(paymentAccountReview(owner),true);assert.equal(adminPaymentReviews().find(c=>c.id===result.caseId)!.user_id,owner);
});

test('wrong-mode events are ignored and provider links cannot move to another owner or mismatched Session',()=>{
  const owner=user(),p=payment(owner);link(p);
  const event=refund(p);assert.deepEqual(processRiskEvent({...event,livemode:true}),{handled:true,ignored:true});assert.equal(paymentAccountReview(owner),false);
  const other=payment(user());assert.throws(()=>recordPaymentLink(other.id,{id:other.session,livemode:false,payment_intent:p.pi}),(error:any)=>error.code==='PAYMENT_LINK_CONFLICT');
  assert.throws(()=>recordPaymentLink(p.id,{id:'cs_test_wrong',livemode:false}),(error:any)=>error.code==='PAYMENT_MISMATCH');
  assert.throws(()=>recordPaymentLink(p.id,{id:p.session,livemode:false,currency:'hkd'}),(error:any)=>error.code==='PAYMENT_MISMATCH');
});

test('forged ownership tags cannot bind a refund; only a later validated matching Session can attach it',()=>{
  const owner=user(),p=payment(owner);const metadata={app:'aidramio',site:config.stripeSiteOrigin,paymentId:p.id,userId:user()};
  const forged=processRiskEvent(refund(p,500,{id:'ch_forged_'+randomUUID(),payment_intent:'pi_forged_'+randomUUID(),metadata}));assert.equal(forged.unmapped,true);assert.equal(paymentAccountReview(owner),false);
  link(p);assert.equal(adminPaymentReviews().find(c=>c.id===forged.caseId)!.mapped,false);
  const late=payment(user());const result=processRiskEvent(refund(late,500,{metadata:{...metadata,paymentId:late.id}}));assert.equal(result.unmapped,true);assert.equal(paymentAccountReview(late.userId),false);
  link(late);assert.equal(paymentAccountReview(late.userId),true);assert.equal(adminPaymentReviews().find(c=>c.id===result.caseId)!.user_id,late.userId);
  const invalid=payment(user());const unmatched=processRiskEvent(refund(invalid,500,{currency:'eur',metadata:{...metadata,paymentId:invalid.id}}));assert.equal(unmatched.unmapped,true);assert.equal(paymentAccountReview(invalid.userId),false);
  link(invalid);assert.equal(paymentAccountReview(invalid.userId),false);
});

test('admin reconciliation debits only available buyer USD credit and records one compensating audit ledger',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner);link(p);const result=processRiskEvent(refund(p));
  assert.throws(()=>resolvePaymentReview(result.caseId!,owner,{decision:'reconciled',note,wallet_debit_cents:500}),(error:any)=>error.code==='FORBIDDEN');
  assert.throws(()=>resolvePaymentReview(result.caseId!,admin,{decision:'reconciled',note:'short',wallet_debit_cents:500}),(error:any)=>error.code==='REVIEW_NOTE_REQUIRED');
  const resolved=resolvePaymentReview(result.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500});assert.equal(resolved.status,'resolved');assert.equal(balance(owner),0);assert.equal(paymentAccountReview(owner),false);
  assert.equal(resolvePaymentReview(result.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500}).alreadyResolved,true);
  assert.equal(one('SELECT COUNT(*) AS n FROM test_ledger WHERE user_id=?',owner)!.n,1);assert.equal(one('SELECT COUNT(*) AS n FROM payment_review_resolutions WHERE case_id=?',result.caseId)!.n,1);
});

test('spent-credit reviews require an explicit bounded platform loss, preserving creator balances and entitlements',()=>{
  const owner=user('viewer',100),admin=user('admin'),creator=user('publisher'),p=payment(owner);link(p);const review=processRiskEvent(refund(p));
  const beforeCreator=one('SELECT * FROM users WHERE id=?',creator)!;
  assert.throws(()=>resolvePaymentReview(review.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500}),(error:any)=>error.code==='INSUFFICIENT_FUNDS');
  assert.equal(balance(owner),1_000_000);assert.equal(paymentAccountReview(owner),true);
  const resolved=resolvePaymentReview(review.caseId!,admin,{decision:'platform_loss',note,wallet_debit_cents:100});assert.equal(balance(owner),0);assert.equal(resolved.platform_loss_cents,400);assert.equal(resolved.wallet_debit_cents,100);assert.equal(resolved.remaining_cents,0);
  assert.equal(one('SELECT earnings_micros FROM users WHERE id=?',creator)!.earnings_micros,beforeCreator.earnings_micros);
  assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',owner)!.wallet_micros,17_000_000);
});

test('partial refund increases reopen review for the incremental principal, while replays do not double debit',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner);link(p);
  const first=processRiskEvent(refund(p,200));resolvePaymentReview(first.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:200});assert.equal(balance(owner),3_000_000);
  const later=refund(p,500);later.created=200;assert.equal(processRiskEvent(later).caseId,first.caseId);assert.equal(paymentAccountReview(owner),true);
  const c=adminPaymentReviews().find(c=>c.id===first.caseId)!;assert.equal(c.remaining_cents,300);
  resolvePaymentReview(first.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:300});assert.equal(balance(owner),0);
  assert.equal(processRiskEvent(later).duplicate,true);assert.equal(balance(owner),0);
});

test('refund and dispute reviews cannot recover more than the original deposit or auto-release a second hold',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner);link(p);
  const refunded=processRiskEvent(refund(p,200)),disputed=processRiskEvent(dispute(p));
  resolvePaymentReview(refunded.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:200});assert.equal(paymentAccountReview(owner),true);
  assert.equal(adminPaymentReviews().find(c=>c.id===disputed.caseId)!.remaining_cents,300);
  resolvePaymentReview(disputed.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:300});assert.equal(balance(owner),0);assert.equal(paymentAccountReview(owner),false);
});

test('a won dispute reopens a refund previously covered by its full debit, keeping refunded credit held',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner);link(p);const providerId='dp_'+randomUUID();
  const lost=processRiskEvent(dispute(p,providerId,'lost',100));resolvePaymentReview(lost.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500});
  const refunded=processRiskEvent(refund(p,200));resolvePaymentReview(refunded.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:0});assert.equal(paymentAccountReview(owner),false);
  const won=dispute(p,providerId,'won',200);processRiskEvent(won);resolvePaymentReview(lost.caseId!,admin,{decision:'provider_reversed',note});
  assert.equal(balance(owner),5_000_000);assert.equal(paymentAccountReview(owner),true);assert.throws(()=>assertPaymentAccountClear(owner));
  assert.equal(adminPaymentReviews().find(c=>c.id===lost.caseId)!.remaining_cents,0);
  const uncovered=adminPaymentReviews().find(c=>c.id===refunded.caseId)!;assert.equal(uncovered.status,'open');assert.equal(uncovered.remaining_cents,200);
  assert.equal(processRiskEvent(won).duplicate,true);resolvePaymentReview(lost.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),5_000_000);assert.equal(paymentAccountReview(owner),true);
  resolvePaymentReview(refunded.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:200});assert.equal(balance(owner),3_000_000);assert.equal(paymentAccountReview(owner),false);
  processRiskEvent(dispute(p,providerId,'lost',150));assert.equal(paymentAccountReview(owner),false);assert.equal(balance(owner),3_000_000);
  processRiskEvent(dispute(p,providerId,'lost',300));assert.equal(paymentAccountReview(owner),true);assert.equal(adminPaymentReviews().find(c=>c.id===lost.caseId)!.remaining_cents,300);
  resolvePaymentReview(lost.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:300});assert.equal(balance(owner),0);
  processRiskEvent(dispute(p,providerId,'won',400));resolvePaymentReview(lost.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),3_000_000);assert.equal(paymentAccountReview(owner),false);
});

test('releasing a platform-loss allocation also reopens a zero-debit sibling; refund-first ordering stays covered',()=>{
  const owner=user('viewer',0),admin=user('admin'),p=payment(owner);link(p);const providerId='dp_'+randomUUID();
  const opened=processRiskEvent(dispute(p,providerId));resolvePaymentReview(opened.caseId!,admin,{decision:'platform_loss',note});
  const refunded=processRiskEvent(refund(p,200));resolvePaymentReview(refunded.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:0});
  processRiskEvent(dispute(p,providerId,'won',200));resolvePaymentReview(opened.caseId!,admin,{decision:'provider_reversed',note});
  assert.equal(balance(owner),0);assert.equal(paymentAccountReview(owner),true);assert.equal(adminPaymentReviews().find(c=>c.id===refunded.caseId)!.remaining_cents,200);
  resolvePaymentReview(refunded.caseId!,admin,{decision:'platform_loss',note});assert.equal(paymentAccountReview(owner),false);assert.equal(balance(owner),0);
  const other=user(),q=payment(other);link(q);const refundFirst=processRiskEvent(refund(q,200));resolvePaymentReview(refundFirst.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:200});
  const otherId='dp_'+randomUUID(),second=processRiskEvent(dispute(q,otherId));resolvePaymentReview(second.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:300});
  processRiskEvent(dispute(q,otherId,'won',200));resolvePaymentReview(second.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(other),3_000_000);assert.equal(paymentAccountReview(other),false);assert.equal(adminPaymentReviews().find(c=>c.id===refundFirst.caseId)!.remaining_cents,0);
});

test('conflicting terminal snapshots in the same second remain held regardless of delivery order',()=>{
  for(const first of ['won','lost']){
    const owner=user(),admin=user('admin'),p=payment(owner);link(p);const providerId='dp_'+randomUUID();
    const result=processRiskEvent(dispute(p,providerId,first,200));
    if(first==='won')resolvePaymentReview(result.caseId!,admin,{decision:'provider_reversed',note});
    else resolvePaymentReview(result.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500});
    processRiskEvent(dispute(p,providerId,first==='won'?'lost':'won',200));assert.equal(paymentAccountReview(owner),true);
    processRiskEvent(dispute(p,providerId,'needs_response',200));
    processRiskEvent(dispute(p,providerId,'won',200));assert.equal(adminPaymentReviews().find(c=>c.id===result.caseId)!.provider_status,'conflicting');
    const auditCount=one('SELECT COUNT(*) AS n FROM payment_review_resolutions WHERE case_id=?',result.caseId)!.n;
    for(const decision of ['provider_reversed','reconciled','platform_loss']as const)assert.throws(()=>resolvePaymentReview(result.caseId!,admin,{decision,note}),(error:any)=>error.code==='PROVIDER_OUTCOME_CONFLICT');
    assert.equal(one('SELECT COUNT(*) AS n FROM payment_review_resolutions WHERE case_id=?',result.caseId)!.n,auditCount);assert.equal(paymentAccountReview(owner),true);
    processRiskEvent(dispute(p,providerId,'needs_response',250));assert.equal(adminPaymentReviews().find(c=>c.id===result.caseId)!.provider_status,'conflicting');
    processRiskEvent(dispute(p,providerId,'won',300));resolvePaymentReview(result.caseId!,admin,{decision:'provider_reversed',note});assert.equal(paymentAccountReview(owner),false);assert.equal(balance(owner),5_000_000);
  }
});

test('only a verified dispute-won event permits one compensating reversal, not a UI assertion or stale provider event',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner);link(p);const id='dp_'+randomUUID(),opened=processRiskEvent(dispute(p,id));
  assert.throws(()=>resolvePaymentReview(opened.caseId!,admin,{decision:'provider_reversed',note}),(error:any)=>error.code==='PROVIDER_REVERSAL_UNVERIFIED');
  resolvePaymentReview(opened.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500});assert.equal(balance(owner),0);
  processRiskEvent(dispute(p,id,'won',200));assert.equal(paymentAccountReview(owner),true);
  resolvePaymentReview(opened.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),5_000_000);assert.equal(paymentAccountReview(owner),false);
  resolvePaymentReview(opened.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),5_000_000);
  processRiskEvent(dispute(p,id,'needs_response',50));assert.equal(paymentAccountReview(owner),false);assert.equal(balance(owner),5_000_000);
});

test('a signed won dispute cannot be finalized by zero-debit reconciliation or platform-loss acceptance',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner);link(p);const providerId='dp_'+randomUUID(),opened=processRiskEvent(dispute(p,providerId));
  resolvePaymentReview(opened.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:500});assert.equal(balance(owner),0);
  processRiskEvent(dispute(p,providerId,'won',200));
  for(const decision of ['reconciled','platform_loss']as const)assert.throws(()=>resolvePaymentReview(opened.caseId!,admin,{decision,note,wallet_debit_cents:0}),(error:any)=>error.code==='PROVIDER_REVERSAL_REQUIRED');
  assert.equal(paymentAccountReview(owner),true);assert.equal(balance(owner),0);assert.equal(one('SELECT COUNT(*) AS n FROM payment_review_resolutions WHERE case_id=?',opened.caseId)!.n,1);
  resolvePaymentReview(opened.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),5_000_000);assert.equal(paymentAccountReview(owner),false);
  resolvePaymentReview(opened.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),5_000_000);assert.equal(one('SELECT COUNT(*) AS n FROM payment_review_resolutions WHERE case_id=?',opened.caseId)!.n,2);
});

test('HKD pass review revokes future publishing without debiting USD, and a later verified won dispute restores it',()=>{
  const owner=user(),admin=user('admin'),p=payment(owner,'activation');link(p);run('UPDATE test_accounts SET publisher_active=1 WHERE user_id=?',owner);
  const providerId='dp_'+randomUUID(),review=processRiskEvent(dispute(p,providerId));
  assert.throws(()=>resolvePaymentReview(review.caseId!,admin,{decision:'reconciled',note,wallet_debit_cents:1}),(error:any)=>error.code==='INVALID_AMOUNT');
  resolvePaymentReview(review.caseId!,admin,{decision:'reconciled',note});assert.equal(balance(owner),5_000_000);assert.equal(one('SELECT publisher_active FROM test_accounts WHERE user_id=?',owner)!.publisher_active,0);
  processRiskEvent(dispute(p,providerId,'won',200));resolvePaymentReview(review.caseId!,admin,{decision:'provider_reversed',note});assert.equal(balance(owner),5_000_000);assert.equal(one('SELECT publisher_active FROM test_accounts WHERE user_id=?',owner)!.publisher_active,1);
});
