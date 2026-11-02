import {randomUUID} from 'node:crypto';
import {one,all,run,transaction} from './db.js';
import {config} from './config.js';
import {assert} from './errors.js';
import {ACTIVATION_HKD_CENTS} from '../shared/config.js';
import {PASS_PROMOTION_CODE,PASS_PROMOTION_HKD_CENTS,MIN_PASS_HKD_CENTS,type AdminPromotion,type PassPromotionQuote} from '../shared/pass-promotion.js';
import {verifiedStripeEventContext} from './stripe-event-context.js';

type Row=Record<string,any>;
export interface PromotionInput {code:string;enabled:boolean;discount_type:'amount'|'percent';discount_value:number;max_redemptions:number|null}
export interface ManagedPromotionQuote extends PassPromotionQuote {id:string;discount_type:'amount'|'percent';discount_value:number}
const testing=()=>verifiedStripeEventContext()?.testState??config.stripeTestMode;
const mode=()=>testing()?'test':'default';
const table=()=>testing()?'test_payments':'payments';
function requireAdministrator(id:string){assert(one("SELECT 1 FROM users WHERE id=? AND role='admin'",id),403,'FORBIDDEN','Administrator access required.');}
export function discountedAmount(type:string,value:number){
  if(type==='amount'&&Number.isSafeInteger(value)&&value>0&&value<=ACTIVATION_HKD_CENTS-MIN_PASS_HKD_CENTS)return ACTIVATION_HKD_CENTS-value;
  if(type==='percent'&&Number.isSafeInteger(value)&&value>0&&value<=95)return Math.round(ACTIVATION_HKD_CENTS*(100-value)/100);
  return null;
}
function normalize(code:unknown){return typeof code==='string'?code.trim().toUpperCase():'';}
function validCode(code:string){return /^[A-Z0-9_-]{3,32}$/.test(code);}
function input(value:PromotionInput):PromotionInput{
  const code=normalize(value.code);assert(validCode(code),400,'INVALID_PROMOTION_SETTINGS','Use a code of 3–32 letters, numbers, underscores or hyphens.');
  assert(typeof value.enabled==='boolean'&&discountedAmount(value.discount_type,value.discount_value)!==null,400,'INVALID_PROMOTION_SETTINGS','Enter a positive discount that leaves at least HK$4.00 to pay.');
  assert(value.max_redemptions===null||Number.isSafeInteger(value.max_redemptions)&&value.max_redemptions>0&&value.max_redemptions<=1_000_000,400,'INVALID_PROMOTION_SETTINGS','Use unlimited redemptions or a whole-number limit from 1 to 1,000,000.');
  return{...value,code};
}
/** One-time import. Dashboard controls become authoritative after this marker. */
export function initializePromotions(){
  if(one('SELECT 1 FROM managed_pass_promotion_init WHERE id=1'))return;
  transaction(()=>{
    if(one('SELECT 1 FROM managed_pass_promotion_init WHERE id=1'))return;
    run('INSERT OR IGNORE INTO managed_pass_promotions (id,code,enabled,discount_type,discount_value,max_redemptions) VALUES (?,?,?,\'amount\',?,NULL)','creator-launch-lingying58',PASS_PROMOTION_CODE,config.passPromotionEnabled?1:0,ACTIVATION_HKD_CENTS-PASS_PROMOTION_HKD_CENTS);
    run('INSERT INTO managed_pass_promotion_init (id) VALUES (1)');
  });
}
function counts(id:string,userId?:string){
  const row=one(`SELECT COALESCE(SUM(CASE WHEN p.status='paid' THEN 1 ELSE 0 END),0) AS paid,COALESCE(SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END),0) AS pending,COALESCE(SUM(CASE WHEN p.status='pending' AND p.user_id=? THEN 1 ELSE 0 END),0) AS own_pending FROM activation_promotion_quotes q JOIN ${table()} p ON p.id=q.payment_id LEFT JOIN managed_pass_promotion_quotes m ON m.payment_id=q.payment_id AND m.financial_mode=q.financial_mode WHERE q.financial_mode=? AND (m.promotion_id=? OR m.payment_id IS NULL AND q.code=(SELECT code FROM managed_pass_promotions WHERE id=?) AND q.code=? AND q.amount_cents=? AND q.regular_amount_cents=?)`,userId||'',mode(),id,id,PASS_PROMOTION_CODE,PASS_PROMOTION_HKD_CENTS,ACTIVATION_HKD_CENTS)!;
  return{paid:Number(row.paid),pending:Number(row.pending),ownPending:Number(row.own_pending)};
}
function serialize(row:Row):AdminPromotion{const usage=counts(row.id);return{...row,enabled:!!row.enabled,amount_hkd_cents:discountedAmount(row.discount_type,row.discount_value)!,regular_amount_hkd_cents:ACTIVATION_HKD_CENTS,paid_redemptions:usage.paid,pending_redemptions:usage.pending} as AdminPromotion;}
export function adminPromotions(actorId:string){
  requireAdministrator(actorId);initializePromotions();
  const promotions=all('SELECT * FROM managed_pass_promotions ORDER BY created_at DESC,rowid DESC LIMIT 1000').map(serialize);
  const events=all('SELECT * FROM managed_pass_promotion_events ORDER BY created_at DESC,rowid DESC LIMIT 100').map(row=>{const{before_json,after_json,...event}=row;return{...event,before:before_json?JSON.parse(before_json):null,after:JSON.parse(after_json)};});
  return{promotions,events};
}
export function createPromotion(actorId:string,value:PromotionInput){
  requireAdministrator(actorId);initializePromotions();const valid=input(value);
  return transaction(()=>{
    assert(!one('SELECT 1 FROM managed_pass_promotions WHERE code=?',valid.code),409,'PROMOTION_EXISTS','This promotion code already exists.');
    assert(Number(one('SELECT COUNT(*) AS n FROM managed_pass_promotions')!.n)<1000,409,'PROMOTION_LIMIT','At most 1,000 promotion codes are supported. Disable an existing code when it is no longer needed.');
    const id=randomUUID();run('INSERT INTO managed_pass_promotions (id,code,enabled,discount_type,discount_value,max_redemptions) VALUES (?,?,?,?,?,?)',id,valid.code,valid.enabled?1:0,valid.discount_type,valid.discount_value,valid.max_redemptions);
    const after=serialize(one('SELECT * FROM managed_pass_promotions WHERE id=?',id)!);
    run('INSERT INTO managed_pass_promotion_events (id,promotion_id,actor_id,action,after_json) VALUES (?,?,?,?,?)',randomUUID(),id,actorId,'create',JSON.stringify(after));return after;
  });
}
export function updatePromotion(actorId:string,id:string,patch:Partial<Omit<PromotionInput,'code'>>){
  requireAdministrator(actorId);initializePromotions();
  return transaction(()=>{
    const old=one('SELECT * FROM managed_pass_promotions WHERE id=?',id);assert(old,404,'NOT_FOUND','Promotion not found.');
    const valid=input({code:old.code,enabled:!!old.enabled,discount_type:old.discount_type,discount_value:old.discount_value,max_redemptions:old.max_redemptions,...patch}),usage=counts(id);
    assert(valid.max_redemptions===null||valid.max_redemptions>=usage.paid+usage.pending,409,'PROMOTION_LIMIT_IN_USE','The limit must include completed redemptions and pending Checkouts.');
    const before=serialize(old);run("UPDATE managed_pass_promotions SET enabled=?,discount_type=?,discount_value=?,max_redemptions=?,revision=revision+1,updated_at=datetime('now') WHERE id=?",valid.enabled?1:0,valid.discount_type,valid.discount_value,valid.max_redemptions,id);
    const after=serialize(one('SELECT * FROM managed_pass_promotions WHERE id=?',id)!);
    run('INSERT INTO managed_pass_promotion_events (id,promotion_id,actor_id,action,before_json,after_json) VALUES (?,?,?,?,?,?)',randomUUID(),id,actorId,'update',JSON.stringify(before),JSON.stringify(after));return after;
  });
}
/** Authenticated validation; no Stripe call, payment row or quota reservation. */
export function quotePromotion(userId:string,code:unknown):ManagedPromotionQuote{
  initializePromotions();const normalized=normalize(code),row=validCode(normalized)?one('SELECT * FROM managed_pass_promotions WHERE code=? AND enabled=1',normalized):undefined;
  assert(row,400,'INVALID_PROMOTION','This Dramio Pass promotion code is invalid or unavailable.');
  const amount=discountedAmount(row.discount_type,row.discount_value),usage=counts(row.id,userId);
  assert(amount!==null&&(row.max_redemptions===null||usage.paid+usage.pending-usage.ownPending<row.max_redemptions),400,'INVALID_PROMOTION','This Dramio Pass promotion code is invalid or unavailable.');
  return{id:row.id,code:row.code,amountHkdCents:amount,regularAmountHkdCents:ACTIVATION_HKD_CENTS,currency:'hkd',revision:row.revision,discount_type:row.discount_type,discount_value:row.discount_value};
}
/** Called within the payment insertion transaction, with a freshly rechecked quote. */
export function storePromotionQuote(paymentId:string,quote:ManagedPromotionQuote){
  run('INSERT INTO activation_promotion_quotes (payment_id,financial_mode,code,amount_cents,currency,regular_amount_cents) VALUES (?,?,?,?,?,?)',paymentId,mode(),quote.code,quote.amountHkdCents,'hkd',ACTIVATION_HKD_CENTS);
  run('INSERT INTO managed_pass_promotion_quotes (payment_id,financial_mode,promotion_id,code,revision,discount_type,discount_value,amount_cents,regular_amount_cents) VALUES (?,?,?,?,?,?,?,?,?)',paymentId,mode(),quote.id,quote.code,quote.revision,quote.discount_type,quote.discount_value,quote.amountHkdCents,ACTIVATION_HKD_CENTS);
}
export function promotionSnapshot(paymentId:string,financialMode=mode()){return one('SELECT * FROM activation_promotion_quotes WHERE payment_id=? AND financial_mode=?',paymentId,financialMode);}
/** Quotes are immutable receipts, independent of a promotion's current settings. */
export function validPromotionPayment(payment:Row,financialMode=mode()){
  const quote=promotionSnapshot(payment.id,financialMode);if(!quote||quote.currency!=='hkd'||payment.currency!=='hkd'||quote.amount_cents!==payment.amount_cents||quote.regular_amount_cents!==ACTIVATION_HKD_CENTS)return false;
  const managed=one('SELECT * FROM managed_pass_promotion_quotes WHERE payment_id=? AND financial_mode=?',payment.id,financialMode);
  if(managed)return managed.code===quote.code&&managed.amount_cents===quote.amount_cents&&managed.regular_amount_cents===ACTIVATION_HKD_CENTS&&managed.amount_cents===discountedAmount(managed.discount_type,managed.discount_value);
  // Previous releases issued this exact server-controlled quote before the
  // managed table existed. Never reinterpret historical Checkouts after edits.
  return quote.code===PASS_PROMOTION_CODE&&quote.amount_cents===PASS_PROMOTION_HKD_CENTS;
}
