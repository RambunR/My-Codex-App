import {randomUUID} from 'node:crypto';
import {config} from './config.js';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {stripeSiteOrigin} from './origins.js';
import {usingTestPaymentState,paymentTable,accountTable,accountIdColumn,ledgerTable,financeAccount} from './payment-state.js';

type Row=Record<string,any>;
export interface PaymentSessionLink {id:string;livemode?:boolean;amount_total?:number|null;currency?:string|null;payment_intent?:unknown}
export interface PaymentRiskEvent {id:string;type:string;livemode:boolean;created?:number;data:{object:any}}
export interface PaymentReviewDecision {decision:'reconciled'|'platform_loss'|'provider_reversed';note:string;wallet_debit_cents?:number}
const events=new Set(['charge.refunded','charge.dispute.created','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated']);
const partition=()=>({group:usingTestPaymentState()?'test':'default',live:/^(sk|rk)_live_/.test(config.stripeKey)?1:0});
const objectId=(value:unknown):string|null=>{const id=typeof value==='string'?value:value&&typeof value==='object'&&(value as any).id;return typeof id==='string'&&/^[A-Za-z0-9_-]{2,255}$/.test(id)?id:null;};
const cents=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const currency=(value:unknown)=>typeof value==='string'&&/^[a-z]{3}$/.test(value)?value:'';
function payment(id:string){return one(`SELECT * FROM ${paymentTable()} WHERE id=? AND provider='stripe'`,id);}
function matchesCase(p:Row,c:Row){return p.currency===c.currency&&cents(c.amount_cents)!==null&&c.amount_cents<=p.amount_cents;}
function referencesAgree(link:Row,c:Row){return(!link.payment_intent||!c.payment_intent||link.payment_intent===c.payment_intent)&&(!link.charge_id||!c.charge_id||link.charge_id===c.charge_id);}

/** Synchronous and composable with an existing settlement transaction; no nested BEGIN. */
export function recordPaymentLink(paymentId:string,session:PaymentSessionLink){
  const part=partition(),p=payment(paymentId);assert(p,404,'PAYMENT_NOT_FOUND','Recorded payment not found.');
  assert(objectId(session.id)&&p.provider_session===session.id,400,'PAYMENT_MISMATCH','The provider session does not match the payment.');
  assert(typeof session.livemode==='boolean'&&Number(session.livemode)===part.live,400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
  if(session.amount_total!==undefined&&session.amount_total!==null)assert(session.amount_total===p.amount_cents,400,'PAYMENT_MISMATCH','Payment amount does not match.');
  if(session.currency)assert(session.currency===p.currency,400,'PAYMENT_MISMATCH','Payment currency does not match.');
  const pi=objectId(session.payment_intent),charge=typeof session.payment_intent==='object'&&session.payment_intent?objectId((session.payment_intent as any).latest_charge):null;
  const existing=one('SELECT * FROM payment_provider_links WHERE table_group=? AND livemode=? AND payment_id=?',part.group,part.live,paymentId);
  assert(!existing||(!pi||!existing.payment_intent||existing.payment_intent===pi)&&(!charge||!existing.charge_id||existing.charge_id===charge),409,'PAYMENT_LINK_CONFLICT','Provider references conflict with the recorded payment.');
  for(const [field,value]of [['payment_intent',pi],['charge_id',charge]]as const)if(value)assert(!one(`SELECT 1 FROM payment_provider_links WHERE table_group=? AND livemode=? AND ${field}=? AND payment_id<>?`,part.group,part.live,value,paymentId),409,'PAYMENT_LINK_CONFLICT','Provider reference belongs to another payment.');
  run(`INSERT INTO payment_provider_links (table_group,livemode,payment_id,user_id,provider_session,payment_intent,charge_id,amount_cents,currency) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(table_group,livemode,payment_id) DO UPDATE SET payment_intent=COALESCE(excluded.payment_intent,payment_provider_links.payment_intent),charge_id=COALESCE(excluded.charge_id,payment_provider_links.charge_id)`,part.group,part.live,p.id,p.user_id,session.id,pi,charge,p.amount_cents,p.currency);
  // A crash before attachment leaves a safe unresolved hold; a later validated
  // settlement/link replay attaches it without changing financial balances.
  const recorded=one('SELECT * FROM payment_provider_links WHERE table_group=? AND livemode=? AND payment_id=?',part.group,part.live,paymentId)!;
  for(const c of all('SELECT * FROM payment_risk_cases WHERE table_group=? AND livemode=? AND payment_id IS NULL AND ((payment_intent IS NOT NULL AND payment_intent=?) OR (charge_id IS NOT NULL AND charge_id=?))',part.group,part.live,pi,charge))if(matchesCase(p,c)&&referencesAgree(recorded,c))run("UPDATE payment_risk_cases SET payment_id=?,user_id=?,updated_at=datetime('now') WHERE id=? AND payment_id IS NULL",p.id,p.user_id,c.id);
}

function ownerFor(snapshot:Row):Row|undefined{
  const part=partition();
  const links=all('SELECT * FROM payment_provider_links WHERE table_group=? AND livemode=? AND ((payment_intent IS NOT NULL AND payment_intent=?) OR (charge_id IS NOT NULL AND charge_id=?))',part.group,part.live,snapshot.payment_intent,snapshot.charge_id);
  if(new Set(links.map(link=>link.payment_id)).size>1)return undefined;
  // Metadata is descriptive, never authority to freeze or debit an account.
  // An out-of-order event stays unmapped until a validated Session links it.
  if(links.length){const p=payment(links[0].payment_id);return p&&matchesCase(p,snapshot)&&referencesAgree(links[0],snapshot)?p:undefined;}
  return undefined;
}

function remaining(c:Row){
  if(c.kind==='dispute'&&c.provider_status==='won')return 0;
  if(!c.payment_id)return c.amount_cents;
  const p=payment(c.payment_id);if(!p)return c.amount_cents;
  if(p.kind==='activation'&&c.pass_revoked)return 0;
  const others=one('SELECT COALESCE(SUM(wallet_debit_cents+platform_loss_cents),0) AS n FROM payment_risk_cases WHERE table_group=? AND livemode=? AND payment_id=? AND id<>?',c.table_group,c.livemode,c.payment_id,c.id)!.n;
  return Math.max(0,Math.min(c.amount_cents,Math.max(0,p.amount_cents-others))-c.wallet_debit_cents-c.platform_loss_cents);
}

function reopenUncoveredSiblings(c:Row){
  // Reversing one allocation can expose a refund previously covered by that
  // allocation. Keep the account held until that exposure is reviewed again.
  for(const sibling of all("SELECT * FROM payment_risk_cases WHERE table_group=? AND livemode=? AND payment_id=? AND id<>? AND status='resolved' AND amount_cents>0 AND NOT(kind='dispute' AND provider_status='won')",c.table_group,c.livemode,c.payment_id,c.id))if(remaining(sibling)>0)run("UPDATE payment_risk_cases SET status='open',resolved_at=NULL,updated_at=datetime('now') WHERE id=?",sibling.id);
}

export function processRiskEvent(event:PaymentRiskEvent):{handled:boolean;ignored?:boolean;duplicate?:boolean;caseId?:string;unmapped?:boolean}{
  if(!events.has(event.type))return{handled:false};
  const part=partition();if(typeof event.livemode!=='boolean'||Number(event.livemode)!==part.live)return{handled:true,ignored:true};
  assert(objectId(event.id),400,'INVALID_EVENT','Provider event identifier is missing.');
  return transaction(()=>{
    const duplicate=one('SELECT case_id FROM payment_risk_events WHERE table_group=? AND livemode=? AND event_id=?',part.group,part.live,event.id);
    if(duplicate)return{handled:true,duplicate:true,caseId:duplicate.case_id||undefined};
    const object=event.data?.object&&typeof event.data.object==='object'?event.data.object:{};
    const kind=event.type==='charge.refunded'?'refund':'dispute';
    const statuses=new Set(['warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented']);
    const amount=cents(kind==='refund'?object.amount_refunded:object.amount);
    const snapshot:Row={kind,provider_object_id:objectId(object.id)||event.id,payment_intent:objectId(object.payment_intent),charge_id:kind==='refund'?objectId(object.id):objectId(object.charge),amount_cents:amount??0,currency:amount===null?'':currency(object.currency),provider_status:kind==='refund'?'refunded':statuses.has(object.status)?object.status:'unknown',provider_updated_at:cents(event.created)??0};
    const p=ownerFor(snapshot);
    const explicitlyForeign=!p&&object.metadata&&(typeof object.metadata.app==='string'&&object.metadata.app!=='aidramio'||typeof object.metadata.site==='string'&&object.metadata.site!==stripeSiteOrigin());
    if(explicitlyForeign){run('INSERT INTO payment_risk_events (table_group,livemode,event_id,event_type,case_id,snapshot_json) VALUES (?,?,?,?,NULL,?)',part.group,part.live,event.id,event.type,JSON.stringify(snapshot));return{handled:true,ignored:true};}
    let c=one('SELECT * FROM payment_risk_cases WHERE table_group=? AND livemode=? AND kind=? AND provider_object_id=?',part.group,part.live,kind,snapshot.provider_object_id);
    if(c){
      const terminals=['won','lost'];
      const terminalConflict=c.provider_status==='conflicting'&&(snapshot.provider_updated_at<=c.provider_updated_at||!terminals.includes(snapshot.provider_status))||snapshot.provider_updated_at===c.provider_updated_at&&terminals.includes(snapshot.provider_status)&&terminals.includes(c.provider_status)&&c.provider_status!==snapshot.provider_status;
      const newer=snapshot.provider_updated_at>c.provider_updated_at||snapshot.provider_updated_at===c.provider_updated_at&&!terminalConflict&&(terminals.includes(snapshot.provider_status)||!terminals.includes(c.provider_status));
      const increased=snapshot.amount_cents>c.amount_cents;
      const state=terminalConflict?'conflicting':newer?snapshot.provider_status:c.provider_status;
      const needsReturn=state==='won'&&c.provider_status!=='won'&&(c.wallet_debit_cents>0||c.platform_loss_cents>0||c.pass_revoked);
      const reopen=c.status==='resolved'&&(increased||needsReturn||terminalConflict||newer&&state==='lost'&&c.decision==='provider_reversed');
      const canAttach=p&&matchesCase(p,{...c,amount_cents:Math.max(c.amount_cents,snapshot.amount_cents),currency:c.currency||snapshot.currency})&&referencesAgree(c,snapshot);
      run(`UPDATE payment_risk_cases SET payment_intent=COALESCE(payment_intent,?),charge_id=COALESCE(charge_id,?),payment_id=COALESCE(payment_id,?),user_id=COALESCE(user_id,?),amount_cents=MAX(amount_cents,?),currency=CASE WHEN currency='' THEN ? ELSE currency END,provider_status=?,provider_updated_at=MAX(provider_updated_at,?),status=?,updated_at=datetime('now'),resolved_at=CASE WHEN ? THEN NULL ELSE resolved_at END WHERE id=?`,snapshot.payment_intent,snapshot.charge_id,canAttach?p.id:null,canAttach?p.user_id:null,snapshot.amount_cents,snapshot.currency,state,snapshot.provider_updated_at,reopen?'open':c.status,reopen?1:0,c.id);
    }else{
      const id=randomUUID();run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,payment_intent,charge_id,payment_id,user_id,amount_cents,currency,provider_status,provider_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,part.group,part.live,kind,snapshot.provider_object_id,snapshot.payment_intent,snapshot.charge_id,p?.id||null,p?.user_id||null,snapshot.amount_cents,snapshot.currency,snapshot.provider_status,snapshot.provider_updated_at);c={id};
    }
    run('INSERT INTO payment_risk_events (table_group,livemode,event_id,event_type,case_id,snapshot_json) VALUES (?,?,?,?,?,?)',part.group,part.live,event.id,event.type,c.id,JSON.stringify(snapshot));
    return{handled:true,caseId:c.id,unmapped:!p&&!one('SELECT payment_id FROM payment_risk_cases WHERE id=?',c.id)?.payment_id};
  });
}

export function paymentAccountReview(userId:string){const p=partition();return!!one("SELECT 1 FROM payment_risk_cases WHERE table_group=? AND livemode=? AND user_id=? AND status='open' LIMIT 1",p.group,p.live,userId);}
export function assertPaymentAccountClear(userId:string){assert(!paymentAccountReview(userId),423,'PAYMENT_REVIEW_REQUIRED','Your payment account is on hold for review. Contact support before adding funds, purchasing or publishing.');}
export function assertPaymentPayoutsClear(){const p=partition();assert(!one("SELECT 1 FROM payment_risk_cases WHERE table_group=? AND livemode=? AND status='open' LIMIT 1",p.group,p.live),423,'PAYMENT_REVIEW_REQUIRED','Creator payouts are paused while payment reviews remain unresolved.');}

export interface PaymentReviewCase extends Row {id:string;status:'open'|'resolved';mode:'test'|'live';payment_id:string|null;user_id:string|null;payment_kind:'funding'|'activation'|null;remaining_cents:number;mapped:boolean;provider_reversed_available:boolean;alreadyResolved?:boolean}
function view(c:Row):PaymentReviewCase{const p=c.payment_id?payment(c.payment_id):undefined;return{...c,id:c.id,status:c.status,payment_id:c.payment_id,user_id:c.user_id,mode:c.livemode?'live':'test',payment_kind:p?.kind||null,remaining_cents:remaining(c),mapped:!!(c.payment_id&&c.user_id),provider_reversed_available:c.kind==='dispute'&&c.provider_status==='won'};}
export function adminPaymentReviews(){const p=partition();return all("SELECT c.*,u.name AS user_name,u.email AS user_email FROM payment_risk_cases c LEFT JOIN users u ON u.id=c.user_id WHERE c.table_group=? AND c.livemode=? ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END,c.updated_at DESC,c.id LIMIT 200",p.group,p.live).map(view);}

export function resolvePaymentReview(id:string,actorId:string,input:PaymentReviewDecision){
  const part=partition();assert(one("SELECT 1 FROM users WHERE id=? AND role='admin'",actorId),403,'FORBIDDEN','Administrator access required.');
  const note=typeof input.note==='string'?input.note.trim():'';assert(note.length>=10&&note.length<=2000,400,'REVIEW_NOTE_REQUIRED','Explain the verified resolution in at least 10 characters.');
  assert(['reconciled','platform_loss','provider_reversed'].includes(input.decision),400,'INVALID_REVIEW_DECISION','Choose a valid review decision.');
  const debit=input.wallet_debit_cents??0;assert(cents(debit)!==null,400,'INVALID_AMOUNT','Enter a whole, nonnegative number of USD cents.');
  return transaction(()=>{
    const c=one('SELECT * FROM payment_risk_cases WHERE id=? AND table_group=? AND livemode=?',id,part.group,part.live);assert(c,404,'NOT_FOUND','Payment review not found.');
    assert(c.payment_id&&c.user_id,409,'REVIEW_UNMAPPED','This event must first be linked to its validated original payment.');
    const p=payment(c.payment_id);assert(p&&p.user_id===c.user_id&&matchesCase(p,c)&&p.status==='paid',409,'PAYMENT_MISMATCH','A settled matching original payment is required.');
    assert(c.provider_status!=='conflicting',409,'PROVIDER_OUTCOME_CONFLICT','Conflicting provider outcomes require a newer signed terminal outcome before resolution.');
    assert(c.kind!=='dispute'||c.provider_status!=='won'||input.decision==='provider_reversed',409,'PROVIDER_REVERSAL_REQUIRED','A signed dispute-won outcome must be resolved by recording its provider reversal.');
    if(c.status==='resolved'){assert(c.decision===input.decision,409,'REVIEW_ALREADY_RESOLVED','This review is already resolved.');return{...view(c),alreadyResolved:true};}
    const account=financeAccount(c.user_id);assert(account,404,'NOT_FOUND','Payment owner not found.');
    let walletDelta=0,lossDelta=0,passDelta=0;
    if(input.decision==='provider_reversed'){
      assert(c.kind==='dispute'&&c.provider_status==='won',409,'PROVIDER_REVERSAL_UNVERIFIED','A signed provider dispute-won outcome is required.');assert(debit===0,400,'INVALID_AMOUNT','A provider reversal does not debit the wallet.');
      walletDelta=c.wallet_debit_cents*10000;assert(Number.isSafeInteger(account.wallet_micros)&&account.wallet_micros>=0&&account.wallet_micros<=Number.MAX_SAFE_INTEGER-walletDelta,409,'BALANCE_LIMIT','This reversal exceeds the wallet limit.');
      lossDelta=-c.platform_loss_cents;
      if(walletDelta)run(`UPDATE ${accountTable()} SET wallet_micros=wallet_micros+? WHERE ${accountIdColumn()}=?`,walletDelta,c.user_id);
      if(p.kind==='activation'&&c.pass_revoked&&!one("SELECT 1 FROM payment_risk_cases WHERE table_group=? AND livemode=? AND payment_id=? AND id<>? AND amount_cents>0 AND provider_status<>'won' LIMIT 1",part.group,part.live,p.id,c.id)){run(`UPDATE ${accountTable()} SET publisher_active=1 WHERE ${accountIdColumn()}=?`,c.user_id);if(!usingTestPaymentState())run("UPDATE users SET role=CASE WHEN role='admin' THEN 'admin' ELSE 'publisher' END WHERE id=?",c.user_id);passDelta=1;}
      run('UPDATE payment_risk_cases SET wallet_debit_cents=0,platform_loss_cents=0,pass_revoked=0 WHERE id=?',id);
      reopenUncoveredSiblings(c);
    }else{
      const due=remaining(c);assert(debit<=due,400,'INVALID_AMOUNT','The debit exceeds the remaining review amount.');
      if(p.kind==='funding'){
        assert(p.currency==='usd',409,'CURRENCY_REVIEW_REQUIRED','Only USD wallet funding can be adjusted from the wallet.');
        assert(input.decision==='platform_loss'||debit===due,400,'REVIEW_AMOUNT_REQUIRED','Reconcile the full remaining amount or explicitly record the unrecovered platform loss.');
        assert(account.wallet_micros>=debit*10000,409,'INSUFFICIENT_FUNDS','The wallet cannot cover this debit. Reduce it and explicitly accept the remaining platform loss.');
        walletDelta=-debit*10000;if(debit)run(`UPDATE ${accountTable()} SET wallet_micros=wallet_micros-? WHERE ${accountIdColumn()}=?`,debit*10000,c.user_id);
        lossDelta=input.decision==='platform_loss'?due-debit:0;
      }else{
        assert(p.kind==='activation'&&p.currency==='hkd'&&debit===0,400,'INVALID_AMOUNT','Dramio Pass reviews cannot debit the USD wallet.');
        run(`UPDATE ${accountTable()} SET publisher_active=0 WHERE ${accountIdColumn()}=?`,c.user_id);if(!usingTestPaymentState())run("UPDATE users SET role=CASE WHEN role='admin' THEN 'admin' ELSE 'viewer' END WHERE id=?",c.user_id);passDelta=-1;lossDelta=input.decision==='platform_loss'?due:0;
      }
      run('UPDATE payment_risk_cases SET wallet_debit_cents=wallet_debit_cents+?,platform_loss_cents=platform_loss_cents+?,pass_revoked=MAX(pass_revoked,?) WHERE id=?',debit,lossDelta,passDelta===-1?1:0,id);
    }
    const resolutionId=randomUUID();
    if(walletDelta)run(`INSERT INTO ${ledgerTable()} (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)`,randomUUID(),c.user_id,walletDelta<0?'payment_review_debit':'payment_review_reversal',walletDelta,resolutionId,walletDelta<0?'Verified payment review adjustment':'Verified dispute reversal');
    run('INSERT INTO payment_review_resolutions (id,case_id,actor_id,decision,wallet_delta_micros,platform_loss_delta_cents,pass_delta,note) VALUES (?,?,?,?,?,?,?,?)',resolutionId,id,actorId,input.decision,walletDelta,lossDelta,passDelta,note);
    run("UPDATE payment_risk_cases SET status='resolved',decision=?,note=?,updated_at=datetime('now'),resolved_at=datetime('now') WHERE id=?",input.decision,note,id);
    return view(one('SELECT * FROM payment_risk_cases WHERE id=?',id)!);
  });
}
