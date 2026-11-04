import {config} from './config.js';
export const TEST_PAYOUT_PLATFORM='acct_1StBIYJ6Er233b9c';
export function adminTestPayoutAccess(user:{id:string;role:string}|undefined){
  return !!user&&user.role==='admin'&&!!config.platformOwnerUserId&&user.id===config.platformOwnerUserId&&
    config.testPayoutsEnabled&&config.stripeTestMode&&config.payments==='stripe';
}
