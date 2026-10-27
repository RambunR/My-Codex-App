import {config} from './config.js';
import {one,run} from './db.js';

export interface FinanceAccount {
  wallet_micros:number;
  earnings_micros:number;
  publisher_active:number;
}

// Test Checkout uses the same identities and content, while its financial state
// is kept out of the balances, entitlements and activation used for live money.
export function usingTestPaymentState(){return config.stripeTestMode===true;}
export function paymentTable(){return usingTestPaymentState()?'test_payments':'payments';}
export function purchaseTable(){return usingTestPaymentState()?'test_purchases':'purchases';}
export function ledgerTable(){return usingTestPaymentState()?'test_ledger':'ledger';}
export function accountTable(){return usingTestPaymentState()?'test_accounts':'users';}
export function accountIdColumn(){return usingTestPaymentState()?'user_id':'id';}

export function financeAccount(userId:string):FinanceAccount|undefined {
  const live=one<FinanceAccount>('SELECT wallet_micros,earnings_micros,publisher_active FROM users WHERE id=?',userId);
  if(!live||!usingTestPaymentState())return live;
  run('INSERT OR IGNORE INTO test_accounts (user_id) VALUES (?)',userId);
  const test=one<FinanceAccount>('SELECT wallet_micros,earnings_micros,publisher_active FROM test_accounts WHERE user_id=?',userId)!;
  return{...test,publisher_active:live.publisher_active||test.publisher_active};
}

export function hasEpisodePurchase(userId:string,episodeId:string){
  if(one('SELECT 1 FROM purchases WHERE user_id=? AND episode_id=?',userId,episodeId))return true;
  return usingTestPaymentState()&&!!one('SELECT 1 FROM test_purchases WHERE user_id=? AND episode_id=?',userId,episodeId);
}
