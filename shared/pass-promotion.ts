import {ACTIVATION_HKD_CENTS} from './config.js';

export const PASS_PROMOTION_CODE='LINGYING58';
export const PASS_PROMOTION_HKD_CENTS=5800;
export const MIN_PASS_HKD_CENTS=400;
export interface PassPromotion {
  enabled:boolean;
}
export interface PassPromotionQuote {
  code:string;
  amountHkdCents:number;
  regularAmountHkdCents:number;
  currency:'hkd';
  revision:number;
}
export function passPromotionOffer(enabled:boolean):PassPromotion{
  return{enabled};
}
export interface AdminPromotion {
  id:string;code:string;enabled:boolean;discount_type:'amount'|'percent';discount_value:number;max_redemptions:number|null;
  amount_hkd_cents:number;regular_amount_hkd_cents:number;revision:number;paid_redemptions:number;pending_redemptions:number;
  created_at:string;updated_at:string;
}
