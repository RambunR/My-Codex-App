import crypto from 'node:crypto';
import Stripe from 'stripe';
import { config } from './config.js';
import {publicAppUrl,stripeSiteOrigin} from './origins.js';
import { one, run, transaction } from './db.js';
import { AppError,assert } from './errors.js';
import { ACTIVATION_HKD_CENTS,MIN_WALLET_FUNDING_CENTS,MAX_WALLET_FUNDING_CENTS } from '../shared/config.js';
import { paymentTable,purchaseTable,ledgerTable,financeAccount,accountTable,accountIdColumn,hasEpisodePurchase } from './payment-state.js';

export let stripe = config.stripeKey ? new Stripe(config.stripeKey, {httpClient:Stripe.createFetchHttpClient()}) : null;
export function configureStripe(){stripe=config.stripeKey?new Stripe(config.stripeKey,{httpClient:Stripe.createFetchHttpClient()}):null;}
export function stripeModeMatches(livemode:unknown){return typeof livemode==='boolean'&&livemode===/^(sk|rk)_live_/.test(config.stripeKey);}
export function stripeTestPayments(){return config.stripeTestMode||config.sandbox||config.payments==='stripe'&&/^(sk|rk)_test_/.test(config.stripeKey);}
export function stripeConfigured(){return Boolean(stripe&&/^(sk|rk)_(live|test)_/.test(config.stripeKey)&&config.stripeWebhook.startsWith('whsec_')&&(config.sandbox||config.stripeTestMode?/^(sk|rk)_test_/.test(config.stripeKey):!config.production||/^(sk|rk)_live_/.test(config.stripeKey)));}
export function paymentsReady(){return config.payments==='demo'&&!config.production||config.payments==='stripe'&&stripeConfigured();}
function canAdd(balance:number,amount:number){return Number.isSafeInteger(balance)&&balance>=0&&Number.isSafeInteger(amount)&&amount>=0&&balance<=Number.MAX_SAFE_INTEGER-amount;}
export function addLedger(userId: string, kind: string, amount: number, reference: string, description: string) {
  run(`INSERT INTO ${ledgerTable()} (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)`, crypto.randomUUID(), userId, kind, amount, reference, description);
}
export function settlePayment(paymentId: string, expected?: { amount: number; currency: string; session: string;livemode?:boolean }) {
  return transaction(() => {
    const payment = one(`SELECT * FROM ${paymentTable()} WHERE id=?`, paymentId);
    assert(payment, 404, 'NOT_FOUND', 'Payment not found.');
    if(payment.provider==='stripe')assert(expected&&stripeConfigured()&&stripeModeMatches(expected.livemode)&&(!config.production||config.sandbox||config.stripeTestMode||expected.livemode===true),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
    if(config.production)assert(payment.provider==='stripe',400,'PAYMENT_MODE_MISMATCH','Test payments cannot fund production accounts.');
    if (expected) assert(payment.provider_session === expected.session && payment.amount_cents === expected.amount && payment.currency === expected.currency, 400, 'PAYMENT_MISMATCH', 'Payment details do not match.');
    if (payment.status === 'paid') return false;
    assert(payment.status === 'pending', 409, 'PAYMENT_CLOSED', 'This payment is no longer pending.');
    if (payment.kind === 'funding') {
      assert(payment.currency==='usd'&&Number.isSafeInteger(payment.amount_cents)&&payment.amount_cents>=MIN_WALLET_FUNDING_CENTS&&payment.amount_cents<=MAX_WALLET_FUNDING_CENTS,400,'PAYMENT_MISMATCH','Wallet deposits must be valid USD amounts of at least $5.00.');
      const micros = payment.amount_cents * 10000;
      const user=financeAccount(payment.user_id);
      assert(user&&canAdd(user.wallet_micros,micros),409,'BALANCE_LIMIT','This credit would exceed the supported wallet balance. Contact support.');
      run(`UPDATE ${accountTable()} SET wallet_micros=wallet_micros+? WHERE ${accountIdColumn()}=?`, micros, payment.user_id);
      addLedger(payment.user_id, 'funding', micros, payment.id, 'Wallet top-up');
    } else {
      assert(payment.amount_cents===ACTIVATION_HKD_CENTS&&payment.currency==='hkd',400,'PAYMENT_MISMATCH','Dramio Pass must be HK$88.');
      assert(financeAccount(payment.user_id),404,'NOT_FOUND','Account not found.');
      if(config.stripeTestMode)run('UPDATE test_accounts SET publisher_active=1 WHERE user_id=?',payment.user_id);
      else run("UPDATE users SET publisher_active=1, role=CASE WHEN role='admin' THEN 'admin' ELSE 'publisher' END WHERE id=?", payment.user_id);
      addLedger(payment.user_id, 'activation', 0, payment.id, 'Dramio Pass · HK$88 once');
    }
    run(`UPDATE ${paymentTable()} SET status='paid' WHERE id=?`, payment.id);
    return true;
  });
}
export function unlockEpisode(userId: string, episodeId: string) {
  return transaction(() => {
    const episode = one(`SELECT e.*,s.creator_id,s.title AS series_title,s.free_episodes,s.price_cents,s.status FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.id=?`, episodeId);
    assert(episode && episode.status === 'published', 404, 'NOT_FOUND', 'Episode not found.');
    if (episode.number <= episode.free_episodes || episode.creator_id === userId) return { alreadyUnlocked: true };
    if (hasEpisodePurchase(userId,episodeId)) return { alreadyUnlocked: true };
    const user = financeAccount(userId);
    const price = episode.price_cents * 10000;
    assert(user && user.wallet_micros >= price, 402, 'INSUFFICIENT_FUNDS', 'Add funds to your wallet to unlock this episode.');
    const creator = episode.price_cents * 7000; const platform = episode.price_cents * 3000; const id = crypto.randomUUID();
    const publisher=financeAccount(episode.creator_id);
    assert(publisher&&canAdd(publisher.earnings_micros,creator),409,'BALANCE_LIMIT','The publisher cannot receive this purchase right now. Your wallet was not charged.');
    run(`UPDATE ${accountTable()} SET wallet_micros=wallet_micros-? WHERE ${accountIdColumn()}=?`, price, userId);
    run(`UPDATE ${accountTable()} SET earnings_micros=earnings_micros+? WHERE ${accountIdColumn()}=?`, creator, episode.creator_id);
    run(`INSERT INTO ${purchaseTable()} (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)`, id, userId, episodeId, price, creator, platform);
    addLedger(userId, 'unlock', -price, id, `${episode.series_title} · Episode ${episode.number}`);
    addLedger(episode.creator_id, 'earning', creator, id, `${episode.series_title} · Episode ${episode.number}`);
    return { alreadyUnlocked: false, paid_micros: price, creator_micros: creator, platform_micros: platform };
  });
}
export function returnWithdrawalFunds(userId:string,amount:number){
  assert(!stripeTestPayments(),503,'TEST_PAYOUTS_DISABLED','Payouts are unavailable during Stripe test payments.');
  const user=one('SELECT earnings_micros FROM users WHERE id=?',userId);
  assert(user&&canAdd(user.earnings_micros,amount),409,'BALANCE_LIMIT','This refund would exceed the supported earnings balance.');
  run('UPDATE users SET earnings_micros=earnings_micros+? WHERE id=?',amount,userId);
}
export function requestWithdrawal(userId: string, amountCents: number, note = '') {
  assert(!stripeTestPayments(),503,'TEST_PAYOUTS_DISABLED','Payouts are unavailable during Stripe test payments.');
  assert(Number.isSafeInteger(amountCents) && amountCents > 0, 400, 'INVALID_AMOUNT', 'Enter a valid withdrawal amount.');
  assert(amountCents * config.usdToHkd / 100 >= 20, 400, 'MIN_WITHDRAWAL', 'The minimum payout is HK$20 equivalent.');
  return transaction(() => {
    const user = one('SELECT earnings_micros FROM users WHERE id=?', userId); const amount = amountCents * 10000;
    assert(user && user.earnings_micros >= amount, 400, 'INSUFFICIENT_EARNINGS', 'Your available earnings are too low.');
    const id = crypto.randomUUID();
    run('UPDATE users SET earnings_micros=earnings_micros-? WHERE id=?', amount, userId);
    run('INSERT INTO withdrawals (id,user_id,amount_micros,note) VALUES (?,?,?,?)', id, userId, amount, note);
    addLedger(userId, 'withdrawal', -amount, id, 'Payout requested · funds reserved');
    return id;
  });
}
export async function createCheckout(userId: string, kind: 'funding' | 'activation', cents: number) {
  assert(paymentsReady(),503,'PAYMENTS_UNAVAILABLE','Payments are not configured yet. Please try again later.');
  if(kind==='funding'){
    assert(Number.isSafeInteger(cents)&&cents>=MIN_WALLET_FUNDING_CENTS&&cents<=MAX_WALLET_FUNDING_CENTS,400,'INVALID_AMOUNT','Enter a USD amount of at least $5.00 within the supported payment range.');
    const user=financeAccount(userId);
    assert(user&&canAdd(user.wallet_micros,cents*10000),400,'WALLET_LIMIT_REACHED','This deposit would exceed the supported wallet balance.');
  }
  if (kind === 'activation') {
    const user = financeAccount(userId);
    assert(!user?.publisher_active, 409, 'ALREADY_ACTIVE', 'Your Dramio Pass is already active.');
    if(config.payments==='stripe'&&config.stripeActivationPriceId){
      let price:Stripe.Price;
      try{price=await stripe!.prices.retrieve(config.stripeActivationPriceId);}catch{throw new AppError(503,'PAYMENT_CONFIG_ERROR','The Dramio Pass price is unavailable. Please contact support.');}
      assert(price.active&&price.type==='one_time'&&price.currency==='hkd'&&price.unit_amount===ACTIVATION_HKD_CENTS&&stripeModeMatches(price.livemode),503,'PAYMENT_CONFIG_ERROR','The Dramio Pass price must be HK$88 once in the correct payment mode.');
    }
  }
  const currency=kind==='activation'?'hkd':'usd',amount=kind==='activation'?ACTIVATION_HKD_CENTS:cents;
  for(let attempt=0;attempt<3;attempt++){
    const payment=transaction(()=>{
      if(kind==='activation'){
        if(financeAccount(userId)?.publisher_active)return null;
        const pending=one(`SELECT * FROM ${paymentTable()} WHERE user_id=? AND kind='activation' AND status='pending' AND provider=? ORDER BY created_at DESC LIMIT 1`,userId,config.payments);
        if(pending)return pending;
      }
      const id=crypto.randomUUID();run(`INSERT INTO ${paymentTable()} (id,user_id,kind,amount_cents,currency,provider) VALUES (?,?,?,?,?,?)`,id,userId,kind,amount,currency,config.payments);
      return{id,provider_session:null};
    });
    if(!payment)return{alreadyPaid:true};
    const id=payment.id as string;
    if(config.payments==='demo')return{demo:true,paymentId:id,amount_cents:amount,currency};
    if(payment.provider_session){
      const existing=await stripe!.checkout.sessions.retrieve(payment.provider_session);
      if(financeAccount(userId)?.publisher_active)return{alreadyPaid:true};
      assert(stripeModeMatches(existing.livemode),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
      if(existing.payment_status==='paid'){
        settlePayment(id,{amount:existing.amount_total!,currency:existing.currency!,session:existing.id,livemode:existing.livemode});return{alreadyPaid:true};
      }
      if(existing.status==='open')return{url:existing.url,paymentId:id};
      assert(existing.status!=='complete',409,'PAYMENT_PROCESSING','Your payment is still processing. Please wait before trying again.');
      run(`UPDATE ${paymentTable()} SET status='expired' WHERE id=? AND status='pending'`,id);continue;
    }
    try{
      const session=await stripe!.checkout.sessions.create({mode:'payment',payment_method_types:['card'],client_reference_id:id,metadata:{app:'aidramio',site:stripeSiteOrigin(),financialMode:config.stripeTestMode?'test':'default',paymentId:id,userId},
        line_items:kind==='activation'&&config.stripeActivationPriceId?[{price:config.stripeActivationPriceId,quantity:1}]:[{price_data:{currency,unit_amount:amount,...(kind==='funding'&&config.stripeWalletProductId?{product:config.stripeWalletProductId}:{product_data:{name:kind==='activation'?'Dramio Pass':'LingYing wallet credit'}})},quantity:1}],
        success_url:`${publicAppUrl()}/${kind==='activation'?'studio':'wallet'}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:`${publicAppUrl()}/${kind==='activation'?'studio':'wallet'}?checkout=cancelled`,
      },{idempotencyKey:`checkout:${id}`});
      assert(stripeModeMatches(session.livemode),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
      run(`UPDATE ${paymentTable()} SET provider_session=? WHERE id=? AND status='pending'`,session.id,id);
      if(kind==='activation'&&financeAccount(userId)?.publisher_active)return{alreadyPaid:true};
      return{url:session.url,paymentId:id};
    }catch(error){
      // A timeout can occur after Stripe created Checkout. Retain this pending
      // payment and stable idempotency key so activation retries cannot charge twice.
      if(error instanceof AppError)throw error;
      throw new AppError(502,'CHECKOUT_UNAVAILABLE','Secure checkout is temporarily unavailable. Please try again shortly.');
    }
  }
  throw new AppError(409,'PAYMENT_RETRY','The checkout changed while opening. Please try again.');
}
