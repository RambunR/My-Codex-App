import {ACTIVATION_HKD_CENTS} from './config.js';

export const PASS_PROMOTION_CODE='LINGYING58';
export const PASS_PROMOTION_HKD_CENTS=5800;
export interface PassPromotion {
  enabled:boolean;
  code:typeof PASS_PROMOTION_CODE;
  amountHkdCents:number;
  regularAmountHkdCents:number;
  currency:'hkd';
}
export function passPromotionOffer(enabled:boolean):PassPromotion{
  return{enabled,code:PASS_PROMOTION_CODE,amountHkdCents:PASS_PROMOTION_HKD_CENTS,regularAmountHkdCents:ACTIVATION_HKD_CENTS,currency:'hkd'};
}
