export type CheckoutMethod='card'|'wechat_pay';
export interface CheckoutChoice {method:CheckoutMethod;fundingQuoteId?:string}
export interface WechatFundingQuote {id:string;amountUsdCents:number;amountHkdCents:number;rateMicros:number;expiresAt:number}
export const WECHAT_RATE_SCALE=1_000_000;
export const MAX_STRIPE_CHARGE_CENTS=99_999_999;
export function wechatRateMicros(rate:number):number{
  const value=Math.round(rate*WECHAT_RATE_SCALE);
  if(!Number.isFinite(rate)||rate<=0||!Number.isSafeInteger(value)||value<1||Math.abs(value/WECHAT_RATE_SCALE-rate)>1e-9)throw new RangeError('Invalid HKD conversion rate.');
  return value;
}
/** Round the disclosed HKD charge once, using integer arithmetic. */
export function wechatHkdCents(usdCents:number,rateMicros:number):number{
  if(!Number.isSafeInteger(usdCents)||usdCents<1||!Number.isSafeInteger(rateMicros)||rateMicros<1)throw new RangeError('Invalid wallet quote.');
  const value=(BigInt(usdCents)*BigInt(rateMicros)+500_000n)/1_000_000n;
  if(value<1n||value>BigInt(MAX_STRIPE_CHARGE_CENTS))throw new RangeError('This amount exceeds the WeChat Pay payment limit.');
  return Number(value);
}
/** Refund exposure in USD cents. Round partial amounts down; full refunds
 * recover the exact original principal. Cumulative refunds share one case. */
export function wechatRefundUsdCents(refundHkdCents:number,chargeHkdCents:number,creditUsdCents:number):number{
  if(![refundHkdCents,chargeHkdCents,creditUsdCents].every(Number.isSafeInteger)||refundHkdCents<0||chargeHkdCents<1||creditUsdCents<1||refundHkdCents>chargeHkdCents)throw new RangeError('Invalid refund quote.');
  return Number(BigInt(refundHkdCents)*BigInt(creditUsdCents)/BigInt(chargeHkdCents));
}
