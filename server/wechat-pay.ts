import {randomUUID} from 'node:crypto';
import type Stripe from 'stripe';
import {config} from './config.js';
import {one,run} from './db.js';
import {assert} from './errors.js';
import {usingTestPaymentState} from './payment-state.js';
import {MIN_WALLET_FUNDING_CENTS,MAX_WALLET_FUNDING_CENTS} from '../shared/config.js';
import {wechatRateMicros,wechatHkdCents,type CheckoutMethod,type WechatFundingQuote} from '../shared/wechat-pay.js';
type FinancialMode='default'|'test';
interface QuoteRow {id:string;financial_mode:FinancialMode;user_id:string;usd_cents:number;hkd_cents:number;rate_micros:number;expires_at:number;payment_id:string|null}
const mode=():FinancialMode=>usingTestPaymentState()?'test':'default';
export const wechatPayEnabled=()=>config.wechatPayEnabled&&config.payments==='stripe';
export function createWechatFundingQuote(userId:string,usdCents:number):WechatFundingQuote{
  assert(wechatPayEnabled(),503,'WECHAT_UNAVAILABLE','WeChat Pay is not available.');
  assert(Number.isSafeInteger(usdCents)&&usdCents>=MIN_WALLET_FUNDING_CENTS&&usdCents<=MAX_WALLET_FUNDING_CENTS,400,'INVALID_AMOUNT','Enter a valid USD credit amount of at least $5.00.');
  let rate:number,hkd:number;try{rate=wechatRateMicros(config.usdToHkd);hkd=wechatHkdCents(usdCents,rate);}catch{assert(false,400,'WECHAT_AMOUNT_LIMIT','This amount exceeds the supported WeChat Pay range.');}
  const quote={id:randomUUID(),amountUsdCents:usdCents,amountHkdCents:hkd!,rateMicros:rate!,expiresAt:Date.now()+15*60_000};
  run('INSERT INTO wechat_funding_quotes (id,financial_mode,user_id,usd_cents,hkd_cents,rate_micros,expires_at) VALUES (?,?,?,?,?,?,?)',quote.id,mode(),userId,usdCents,quote.amountHkdCents,quote.rateMicros,quote.expiresAt);
  return quote;
}
function validQuote(q:QuoteRow){
  assert(Number.isSafeInteger(q.usd_cents)&&q.usd_cents>=MIN_WALLET_FUNDING_CENTS&&q.usd_cents<=MAX_WALLET_FUNDING_CENTS&&Number.isSafeInteger(q.rate_micros)&&q.rate_micros>0,400,'WECHAT_QUOTE_MISMATCH','The saved WeChat Pay quote is invalid.');
  let expected:number;try{expected=wechatHkdCents(q.usd_cents,q.rate_micros);}catch{assert(false,400,'WECHAT_QUOTE_MISMATCH','The saved WeChat Pay quote is invalid.');}
  assert(q.hkd_cents===expected!,400,'WECHAT_QUOTE_MISMATCH','The saved WeChat Pay amount does not match.');return q;
}
export function requestedWechatQuote(id:unknown,userId:string,usdCents:number){
  assert(typeof id==='string',400,'WECHAT_QUOTE_REQUIRED','Review the HKD payment amount before continuing.');
  const q=one<QuoteRow>('SELECT * FROM wechat_funding_quotes WHERE id=? AND user_id=? AND financial_mode=?',id,userId,mode());
  assert(q&&q.usd_cents===usdCents,400,'WECHAT_QUOTE_MISMATCH','The WeChat Pay quote does not match this account and amount.');validQuote(q);
  assert(q.payment_id||q.expires_at>Date.now(),409,'WECHAT_QUOTE_EXPIRED','Refresh the HKD payment amount and confirm it again.');return q;
}
export function bindWechatQuote(id:string,paymentId:string){
  run('UPDATE wechat_funding_quotes SET payment_id=? WHERE id=? AND financial_mode=? AND payment_id IS NULL',paymentId,id,mode());
  assert(one<QuoteRow>('SELECT * FROM wechat_funding_quotes WHERE id=? AND financial_mode=?',id,mode())?.payment_id===paymentId,409,'WECHAT_QUOTE_USED','This quote already belongs to another checkout.');
}
export function checkoutMethod(paymentId:string,financialMode:FinancialMode=mode()):CheckoutMethod{return one<{method:CheckoutMethod}>('SELECT method FROM payment_checkout_methods WHERE payment_id=? AND financial_mode=?',paymentId,financialMode)?.method||'card';}
export function storeCheckoutMethod(paymentId:string,method:CheckoutMethod){run('INSERT INTO payment_checkout_methods (payment_id,financial_mode,method) VALUES (?,?,?)',paymentId,mode(),method);}
export function wechatFundingSnapshot(payment:Record<string,any>,financialMode:FinancialMode=mode()){
  const q=one<QuoteRow>('SELECT * FROM wechat_funding_quotes WHERE payment_id=? AND financial_mode=?',payment.id,financialMode);
  assert(q&&q.user_id===payment.user_id&&payment.kind==='funding'&&payment.currency==='hkd'&&payment.amount_cents===q.hkd_cents&&checkoutMethod(payment.id,financialMode)==='wechat_pay',400,'WECHAT_QUOTE_MISMATCH','Wallet credit requires its original WeChat Pay quote.');return validQuote(q);
}
export function verifyWechatSession(payment:Record<string,any>,session:Stripe.Checkout.Session|undefined){
  if(checkoutMethod(payment.id)!=='wechat_pay')return;
  assert(session&&session.payment_method_types?.includes('wechat_pay')&&session.metadata?.checkoutMethod==='wechat_pay'&&session.metadata?.userId===payment.user_id&&session.metadata?.paymentId===payment.id,400,'PAYMENT_MISMATCH','The WeChat Pay session does not match this payment.');
  if(payment.kind==='funding')assert(session.metadata?.fundingQuoteId===wechatFundingSnapshot(payment).id,400,'WECHAT_QUOTE_MISMATCH','The payment does not match its original wallet quote.');
}
