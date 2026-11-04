import {one} from './db.js';

export function withdrawalTerms(withdrawalId:string,grossMicros:number){
  // Historical requests retain their original gross transfer, with no new fee.
  return one<{fee_micros:number;payout_micros:number}>(
    'SELECT fee_micros,payout_micros FROM withdrawal_terms WHERE withdrawal_id=?',withdrawalId,
  )??{fee_micros:0,payout_micros:grossMicros};
}

export const WITHDRAWAL_TERMS_SQL=`COALESCE(wt.fee_micros,0) AS fee_micros,
  COALESCE(wt.payout_micros,w.amount_micros) AS payout_micros`;
