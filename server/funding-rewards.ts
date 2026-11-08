import {wechatFundingSnapshot} from './wechat-pay.js';
import {one,run} from './db.js';
import {assert} from './errors.js';
import {usingTestPaymentState} from './payment-state.js';
import {fundingRewardQuote,fundingRewardForVersion,type FundingRewardQuote} from '../shared/funding-rewards.js';

type FinancialMode='default'|'test';
interface FundingSnapshot {payment_id:string;financial_mode:FinancialMode;user_id:string;amount_cents:number;bonus_cents:number;offer_version:string;created_at:string}
const mode=():FinancialMode=>usingTestPaymentState()?'test':'default';

// Insert only, in the same transaction as the new payment. There is no quote
// update or reseed path: a later offer cannot alter an existing pending payment.
export function storeFundingQuote(paymentId:string,userId:string,amountCents:number){
  const quote=fundingRewardQuote(amountCents);
  run('INSERT INTO wallet_funding_quotes (payment_id,financial_mode,user_id,amount_cents,bonus_cents,offer_version) VALUES (?,?,?,?,?,?)',paymentId,mode(),userId,amountCents,quote.bonusCents,quote.offerVersion);
  return quote;
}
export function fundingSnapshot(paymentId:string,financialMode:FinancialMode=mode()){
  return one<FundingSnapshot>('SELECT * FROM wallet_funding_quotes WHERE payment_id=? AND financial_mode=?',paymentId,financialMode);
}
export function fundingCreditForPayment(payment:Record<string,any>,financialMode:FinancialMode=mode()):FundingRewardQuote {
  assert(typeof payment.id==='string'&&typeof payment.user_id==='string'&&payment.kind==='funding'&&(payment.currency==='usd'||payment.currency==='hkd')&&Number.isSafeInteger(payment.amount_cents)&&payment.amount_cents>0,400,'PAYMENT_MISMATCH','Wallet funding details do not match.');
  const amountCents=payment.currency==='hkd'?wechatFundingSnapshot(payment,financialMode).usd_cents:payment.amount_cents;
  const quote=fundingSnapshot(payment.id,financialMode);
  // Historical pending payments predate this offer and retain their exact paid
  // credit. Neither the amount nor provider metadata can invent a missing proof.
  if(!quote){assert(payment.currency==='usd',400,'FUNDING_QUOTE_MISMATCH','The original wallet credit quote is required.');return{amountCents,bonusCents:0,totalCreditCents:amountCents,currency:'usd',offerVersion:null};}
  const expected=fundingRewardForVersion(quote.offer_version,amountCents);
  assert(quote.user_id===payment.user_id&&quote.amount_cents===amountCents&&Number.isSafeInteger(quote.bonus_cents)&&expected!==null&&quote.bonus_cents===expected,400,'FUNDING_QUOTE_MISMATCH','Wallet credit does not match its recorded funding offer.');
  const totalCreditCents=amountCents+quote.bonus_cents;
  assert(Number.isSafeInteger(totalCreditCents),400,'FUNDING_QUOTE_MISMATCH','Wallet credit exceeds the supported range.');
  return{amountCents,bonusCents:quote.bonus_cents,totalCreditCents,currency:'usd',offerVersion:quote.offer_version};
}
