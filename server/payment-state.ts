import {config} from './config.js';
import {one,all,run} from './db.js';
import {validPromotionPayment} from './promotions.js';
import {ACTIVATION_HKD_CENTS} from '../shared/config.js';
import {verifiedStripeEventContext} from './stripe-event-context.js';

export interface FinanceAccount {
  wallet_micros:number;
  earnings_micros:number;
  publisher_active:number;
}

// Test Checkout uses the same identities and content, while its financial state
// is kept out of the balances, entitlements and activation used for live money.
export function usingTestPaymentState(){return verifiedStripeEventContext()?.testState??config.stripeTestMode===true;}
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

// Keep existing activation records authoritative. The pass is its public name,
// not a second purchase or a migration of test ownership into real ownership.
export function dramioPassState(userId:string,realActive:boolean,active:boolean){
  if(!active)return{active:false,test:false,purchased_at:null};
  const testOnly=usingTestPaymentState()&&!realActive;
  const table=testOnly?'test_payments':'payments';
  const candidates=all<{id:string;provider:string;created_at:string;amount_cents:number;currency:string}>(`SELECT p.id,p.provider,p.created_at,p.amount_cents,p.currency FROM ${table} p WHERE p.user_id=? AND p.kind='activation' AND p.status='paid' AND p.currency='hkd' ORDER BY p.created_at DESC,p.rowid DESC`,userId);
  const receipt=candidates.find(payment=>payment.amount_cents===ACTIVATION_HKD_CENTS||validPromotionPayment(payment,testOnly?'test':'default'));
  let purchased_at:string|null=null;
  if(receipt){
    const raw=receipt.created_at.replace(' ','T');
    const time=Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?raw:raw+'Z');
    if(Number.isFinite(time))purchased_at=new Date(time).toISOString();
  }
  const test=testOnly||config.sandbox||receipt?.provider==='demo'||!receipt&&!config.production&&config.payments==='demo';
  return{active:true,test,purchased_at};
}
