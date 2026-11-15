import type {SeriesUnlockQuote} from '../shared/series-unlock.js';
import {hasLuckyDrawAccess} from './lucky-draw-access.js';
import {episodePriceCents} from './episode-pricing.js';
import type {CheckoutChoice} from '../shared/wechat-pay.js';
import {wechatPayEnabled,requestedWechatQuote,bindWechatQuote,storeCheckoutMethod,checkoutMethod,verifyWechatSession} from './wechat-pay.js';
import {episodeFreeSql} from './episode-access.js';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { config } from './config.js';
import {publicAppUrl,stripeSiteOrigin} from './origins.js';
import { one, all, run, transaction } from './db.js';
import { AppError,assert } from './errors.js';
import { ACTIVATION_HKD_CENTS,MIN_WALLET_FUNDING_CENTS,MAX_WALLET_FUNDING_CENTS,LANGUAGES } from '../shared/config.js';
import {checkoutCopy} from '../shared/checkout-copy.js';
import {PASS_PROMOTION_CODE,PASS_PROMOTION_HKD_CENTS} from '../shared/pass-promotion.js';
import {quotePromotion,storePromotionQuote,promotionSnapshot,validPromotionPayment} from './promotions.js';
import { paymentTable,purchaseTable,ledgerTable,financeAccount,accountTable,accountIdColumn,hasEpisodePurchase,usingTestPaymentState } from './payment-state.js';
import {verifiedStripeEventContext} from './stripe-event-context.js';
import {assertPaymentAccountClear,assertPaymentPayoutsClear,recordPaymentLink} from './payment-risk.js';
import {ensureStripeWebhookReady,stripeWebhookReadiness,resetStripeReadiness} from './stripe-readiness.js';
import {assertSeriesAvailable} from './moderation.js';
import {fundingRewardQuote} from '../shared/funding-rewards.js';
import {storeFundingQuote,fundingCreditForPayment} from './funding-rewards.js';
import {WITHDRAWAL_POLICY} from '../shared/withdrawals.js';
import {type CreatorPassConsent} from '../shared/creator-pass-consent.js';
import {requireCreatorPassConsent,recordCreatorPassConsent} from './creator-pass-consent.js';

export let stripe = config.stripeKey ? new Stripe(config.stripeKey, {httpClient:Stripe.createFetchHttpClient()}) : null;
const stripeLocales:Record<string,Stripe.Checkout.SessionCreateParams.Locale>={en:'en','zh-TW':'zh-TW','zh-CN':'zh',ja:'ja',ko:'ko',id:'id','pt-BR':'pt-BR',es:'es-419',vi:'vi',th:'th',fil:'fil',tr:'tr',ru:'ru',fr:'fr',de:'de',ms:'ms'};
export function configureStripe(){stripe=config.stripeKey?new Stripe(config.stripeKey,{httpClient:Stripe.createFetchHttpClient()}):null;resetStripeReadiness();}
export function stripeModeMatches(livemode:unknown){return typeof livemode==='boolean'&&livemode===(verifiedStripeEventContext()?.livemode??/^(sk|rk)_live_/.test(config.stripeKey));}
export function stripeTestPayments(){return config.stripeTestMode||config.sandbox||config.payments==='stripe'&&/^(sk|rk)_test_/.test(config.stripeKey);}
export function stripeConfigured(){return verifiedStripeEventContext()?.configured??Boolean(stripe&&/^(sk|rk)_(live|test)_/.test(config.stripeKey)&&config.stripeWebhook.startsWith('whsec_')&&(config.sandbox||config.stripeTestMode?/^(sk|rk)_test_/.test(config.stripeKey):!config.production||/^(sk|rk)_live_/.test(config.stripeKey)));}
export function paymentsReady(){return config.payments==='demo'&&!config.production||config.payments==='stripe'&&stripeConfigured()&&(!config.stripeAutoConfigureWebhook||stripeWebhookReadiness().status==='ready');}
export function assertPayoutsEnabled(){
  assert(!stripeTestPayments(),503,'TEST_PAYOUTS_DISABLED','Payouts are unavailable during Stripe test payments.');
  assert(config.payoutsEnabled,503,'PAYOUTS_PAUSED','Creator payouts are temporarily unavailable.');
  assertPaymentPayoutsClear();
}
function canAdd(balance:number,amount:number){return Number.isSafeInteger(balance)&&balance>=0&&Number.isSafeInteger(amount)&&amount>=0&&balance<=Number.MAX_SAFE_INTEGER-amount;}
function validActivationPayment(payment:Record<string,any>){
  const quote=promotionSnapshot(payment.id);
  return payment.currency==='hkd'&&(payment.amount_cents===ACTIVATION_HKD_CENTS&&!quote||validPromotionPayment(payment));
}
export function addLedger(userId: string, kind: string, amount: number, reference: string, description: string) {
  run(`INSERT INTO ${ledgerTable()} (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)`, crypto.randomUUID(), userId, kind, amount, reference, description);
}
export function settlePayment(paymentId: string, expected?: { amount: number; currency: string; session: string;livemode?:boolean;sessionObject?:Stripe.Checkout.Session }) {
  return transaction(() => {
    const payment = one(`SELECT * FROM ${paymentTable()} WHERE id=?`, paymentId);
    assert(payment, 404, 'NOT_FOUND', 'Payment not found.');
    if(payment.provider==='stripe')assert(expected&&stripeConfigured()&&stripeModeMatches(expected.livemode)&&(!config.production||config.sandbox||usingTestPaymentState()||expected.livemode===true),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
    if(config.production)assert(payment.provider==='stripe',400,'PAYMENT_MODE_MISMATCH','Test payments cannot fund production accounts.');
    if (expected) assert(payment.provider_session === expected.session && payment.amount_cents === expected.amount && payment.currency === expected.currency, 400, 'PAYMENT_MISMATCH', 'Payment details do not match.');
    verifyWechatSession(payment,expected?.sessionObject);
    if(expected?.sessionObject)recordPaymentLink(payment.id,expected.sessionObject);
    if (payment.status === 'paid') return false;
    assert(payment.status === 'pending', 409, 'PAYMENT_CLOSED', 'This payment is no longer pending.');
    if (payment.kind === 'funding') {
      const funding=fundingCreditForPayment(payment);
      assert(funding.amountCents>=MIN_WALLET_FUNDING_CENTS&&funding.amountCents<=MAX_WALLET_FUNDING_CENTS,400,'PAYMENT_MISMATCH','Wallet deposits must be valid USD credit amounts of at least $5.00.');
      const paidMicros=funding.amountCents*10000,bonusMicros=funding.bonusCents*10000,micros=funding.totalCreditCents*10000;
      const user=financeAccount(payment.user_id);
      assert(user&&canAdd(user.wallet_micros,micros),409,'BALANCE_LIMIT','This credit would exceed the supported wallet balance. Contact support.');
      run(`UPDATE ${accountTable()} SET wallet_micros=wallet_micros+? WHERE ${accountIdColumn()}=?`, micros, payment.user_id);
      addLedger(payment.user_id, 'funding', paidMicros, payment.id, 'Wallet top-up');
      if(bonusMicros)addLedger(payment.user_id,'funding_bonus',bonusMicros,payment.id,'Wallet funding gift · paid episode credit');
    } else {
      // Persisted server quotes stay payable after an offer is disabled. Client
      // amounts and provider metadata alone never establish a valid discount.
      assert(validActivationPayment(payment),400,'PAYMENT_MISMATCH','The Dramio Pass amount does not match its recorded quote.');
      assert(financeAccount(payment.user_id),404,'NOT_FOUND','Account not found.');
      if(usingTestPaymentState())run('UPDATE test_accounts SET publisher_active=1 WHERE user_id=?',payment.user_id);
      else run("UPDATE users SET publisher_active=1, role=CASE WHEN role='admin' THEN 'admin' ELSE 'publisher' END WHERE id=?", payment.user_id);
      addLedger(payment.user_id, 'activation', 0, payment.id, `Dramio Pass · HK$${payment.amount_cents/100} once${promotionSnapshot(payment.id)?` · ${promotionSnapshot(payment.id)!.code}`:''}`);
    }
    run(`UPDATE ${paymentTable()} SET status='paid' WHERE id=?`, payment.id);
    return true;
  });
}
interface ChargeEpisode {id:string;number:number;series_title:string}
/** Balance preflight must not lazily create test accounts on a rejected quote. */
function unlockBalances(userId:string){
  return usingTestPaymentState()
    ?one<{wallet_micros:number;earnings_micros:number}>(`SELECT COALESCE(t.wallet_micros,0) AS wallet_micros,COALESCE(t.earnings_micros,0) AS earnings_micros FROM users u LEFT JOIN test_accounts t ON t.user_id=u.id WHERE u.id=?`,userId)
    :one<{wallet_micros:number;earnings_micros:number}>('SELECT wallet_micros,earnings_micros FROM users WHERE id=?',userId);
}
/** Caller owns the single transaction. Both purchase paths share the exact
 * receipt and ledger writer; aggregate guards run before the first write. */
function chargeEpisodes(userId:string,creatorId:string,episodes:readonly ChargeEpisode[],cents:number){
  const unit=cents*10000,creatorUnit=cents*7000,platformUnit=cents*3000;
  const total=unit*episodes.length,creatorTotal=creatorUnit*episodes.length,platformTotal=platformUnit*episodes.length;
  assert(canAdd(0,total)&&canAdd(0,creatorTotal)&&canAdd(0,platformTotal),409,'BALANCE_LIMIT','This purchase exceeds the supported balance range.');
  const user=unlockBalances(userId),publisher=unlockBalances(creatorId);
  assert(user&&canAdd(user.wallet_micros,0)&&user.wallet_micros>=total,402,'INSUFFICIENT_FUNDS',`Add funds to your wallet to unlock ${episodes.length===1?'this episode':'these episodes'}.`);
  assert(publisher&&canAdd(publisher.earnings_micros,creatorTotal),409,'BALANCE_LIMIT','The publisher cannot receive this purchase right now. Your wallet was not charged.');
  // Lazy initialization is allowed only after every aggregate check succeeds.
  financeAccount(userId);financeAccount(creatorId);
  run(`UPDATE ${accountTable()} SET wallet_micros=wallet_micros-? WHERE ${accountIdColumn()}=?`,total,userId);
  run(`UPDATE ${accountTable()} SET earnings_micros=earnings_micros+? WHERE ${accountIdColumn()}=?`,creatorTotal,creatorId);
  for(const episode of episodes){
    const purchaseId=crypto.randomUUID();
    run(`INSERT INTO ${purchaseTable()} (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)`,purchaseId,userId,episode.id,unit,creatorUnit,platformUnit);
    addLedger(userId,'unlock',-unit,purchaseId,`${episode.series_title} · Episode ${episode.number}`);
    addLedger(creatorId,'earning',creatorUnit,purchaseId,`${episode.series_title} · Episode ${episode.number}`);
  }
  return{paid_micros:total,creator_micros:creatorTotal,platform_micros:platformTotal};
}
export function unlockEpisode(userId:string,episodeId:string,expectedCents?:number){
  return transaction(()=>{
    assertPaymentAccountClear(userId);
    const episode=one(`SELECT e.*,${episodeFreeSql()} AS free,s.creator_id,s.title AS series_title,s.free_episodes,s.price_cents,s.status FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.id=?`,episodeId);
    assert(episode&&episode.status==='published',404,'NOT_FOUND','Episode not found.');assertSeriesAvailable(episode.series_id);
    if(episode.free||episode.creator_id===userId||hasEpisodePurchase(userId,episodeId)||hasLuckyDrawAccess(userId,episode.series_id))return{alreadyUnlocked:true};
    const cents=episodePriceCents(episode.price_cents);
    assert(expectedCents===undefined||expectedCents===cents,409,'EPISODE_PRICE_CHANGED','The episode price changed. Review the current price before unlocking.');
    return{alreadyUnlocked:false,...chargeEpisodes(userId,episode.creator_id,[{id:episode.id,number:episode.number,series_title:episode.series_title}],cents)};
  });
}
/** Read-only snapshot; callers own a transaction so eligibility and revision
 * use the same database view. Lucky Draw grants retain their separate rules. */
function seriesUnlockSnapshot(userId:string,seriesId:string){
  assertPaymentAccountClear(userId);
  const series=assertSeriesAvailable(seriesId),cents=episodePriceCents(series.price_cents),lucky=hasLuckyDrawAccess(userId,seriesId);
  const episodes=all<{id:string;number:number;free:number}>(`SELECT e.id,e.number,${episodeFreeSql()} AS free FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.series_id=? ORDER BY e.number,e.id`,seriesId)
    .map(episode=>({...episode,owned:hasEpisodePurchase(userId,episode.id)}));
  const remaining=series.creator_id===userId||lucky?[]:episodes.filter(episode=>!episode.free&&!episode.owned);
  const total=remaining.length*cents*10000;
  assert(canAdd(0,total),409,'BALANCE_LIMIT','This purchase exceeds the supported balance range.');
  const revision=crypto.createHash('sha256').update(JSON.stringify({version:1,userId,mode:usingTestPaymentState()?'test':'default',seriesId,creatorId:series.creator_id,storedPrice:series.price_cents,cents,lucky,episodes:episodes.map(episode=>[episode.id,episode.number,!!episode.free,episode.owned])})).digest('hex');
  const quote:SeriesUnlockQuote={series_id:seriesId,episode_ids:remaining.map(episode=>episode.id),episode_count:remaining.length,total_micros:total,unit_price_micros:cents*10000,revision};
  return{quote,series,remaining,cents};
}
export function quoteSeriesUnlock(userId:string,seriesId:string):SeriesUnlockQuote{
  return transaction(()=>seriesUnlockSnapshot(userId,seriesId).quote);
}
export function unlockAllEpisodes(userId:string,seriesId:string,revision:string){
  assert(typeof revision==='string'&&/^[a-f0-9]{64}$/.test(revision),400,'VALIDATION','Supply a valid unlock quote revision.');
  return transaction(()=>{
    const snapshot=seriesUnlockSnapshot(userId,seriesId);
    if(!snapshot.remaining.length)return{unlocked_count:0,paid_micros:0,alreadyUnlocked:true};
    assert(snapshot.quote.revision===revision,409,'UNLOCK_QUOTE_CHANGED','The episodes or price changed. Review a fresh quote before unlocking.');
    const charged=chargeEpisodes(userId,snapshot.series.creator_id,snapshot.remaining.map(episode=>({id:episode.id,number:episode.number,series_title:snapshot.series.title})),snapshot.cents);
    return{unlocked_count:snapshot.remaining.length,paid_micros:charged.paid_micros,alreadyUnlocked:false};
  });
}
export function returnWithdrawalFunds(userId:string,amount:number){
  assertPayoutsEnabled();
  const user=one('SELECT earnings_micros FROM users WHERE id=?',userId);
  assert(user&&canAdd(user.earnings_micros,amount),409,'BALANCE_LIMIT','This refund would exceed the supported earnings balance.');
  run('UPDATE users SET earnings_micros=earnings_micros+? WHERE id=?',amount,userId);
}
export function requestWithdrawal(userId: string, amountCents: number, note = '') {
  assertPayoutsEnabled();
  assertPaymentAccountClear(userId);
  assert(Number.isSafeInteger(amountCents) && amountCents > 0, 400, 'INVALID_AMOUNT', 'Enter a valid withdrawal amount.');
  assert(amountCents >= WITHDRAWAL_POLICY.minimumCents, 400, 'MIN_WITHDRAWAL', 'The minimum withdrawal is US$10.00.');
  return transaction(() => {
    const user = one('SELECT earnings_micros FROM users WHERE id=?', userId); const amount = amountCents * 10000;
    assert(user && user.earnings_micros >= amount, 400, 'INSUFFICIENT_EARNINGS', 'Your available earnings are too low.');
    const id = crypto.randomUUID();
    run('UPDATE users SET earnings_micros=earnings_micros-? WHERE id=?', amount, userId);
    run('INSERT INTO withdrawals (id,user_id,amount_micros,note) VALUES (?,?,?,?)', id, userId, amount, note);
    const fee=WITHDRAWAL_POLICY.feeCents*10000;
    run('INSERT INTO withdrawal_terms (withdrawal_id,policy_version,gross_micros,fee_micros,payout_micros,processing_min_days,processing_max_days) VALUES (?,?,?,?,?,?,?)',id,WITHDRAWAL_POLICY.version,amount,fee,amount-fee,WITHDRAWAL_POLICY.processingMinDays,WITHDRAWAL_POLICY.processingMaxDays);
    addLedger(userId, 'withdrawal', -amount, id, 'Payout requested · funds reserved');
    return id;
  });
}
export async function createCheckout(userId: string, kind: 'funding' | 'activation', cents: number, languageCode?:string,promoCode?:string,promoRevision?:number,creatorConsent?:CreatorPassConsent,choice:CheckoutChoice={method:'card'}) {
  const consent=kind==='activation'?requireCreatorPassConsent(creatorConsent):undefined;
  const method=choice.method;
  assert(method==='card'||method==='wechat_pay',400,'INVALID_PAYMENT_METHOD','Choose a supported payment method.');
  if(method==='wechat_pay')assert(wechatPayEnabled(),503,'WECHAT_UNAVAILABLE','WeChat Pay is not available.');
  assert(!choice.fundingQuoteId||kind==='funding'&&method==='wechat_pay',400,'WECHAT_QUOTE_MISMATCH','This quote applies only to WeChat Pay wallet top-ups.');
  const wechatQuote=kind==='funding'&&method==='wechat_pay'?requestedWechatQuote(choice.fundingQuoteId,userId,cents):null;
  assert(promoCode===undefined||kind==='activation',400,'PROMOTION_NOT_APPLICABLE','Promotion codes apply only to Dramio Pass, not wallet deposits.');
  const promotion=promoCode===undefined?null:quotePromotion(userId,promoCode);
  const assertRevision=()=>{if(promotion)assert(promoRevision===promotion.revision||promoRevision===undefined&&promotion.code===PASS_PROMOTION_CODE&&promotion.amountHkdCents===PASS_PROMOTION_HKD_CENTS,409,'PROMOTION_CHANGED','This promotion changed. Apply the code again to confirm the current price.');};
  assertRevision();
  if(config.payments==='stripe'&&stripeConfigured())await ensureStripeWebhookReady(stripe);
  assert(paymentsReady(),503,'PAYMENTS_UNAVAILABLE','Payments are not configured yet. Please try again later.');
  assertPaymentAccountClear(userId);
  if(kind==='funding'){
    assert(Number.isSafeInteger(cents)&&cents>=MIN_WALLET_FUNDING_CENTS&&cents<=MAX_WALLET_FUNDING_CENTS,400,'INVALID_AMOUNT','Enter a USD amount of at least $5.00 within the supported payment range.');
    const user=financeAccount(userId);
    assert(user&&canAdd(user.wallet_micros,fundingRewardQuote(cents).totalCreditCents*10000),400,'WALLET_LIMIT_REACHED','This deposit and its gift would exceed the supported wallet balance.');
  }
  if (kind === 'activation') {
    const user = financeAccount(userId);
    assert(!user?.publisher_active, 409, 'ALREADY_ACTIVE', 'Your Dramio Pass is already active.');
    if(config.payments==='stripe'&&config.stripeActivationPriceId&&!promotion){
      let price:Stripe.Price;
      try{price=await stripe!.prices.retrieve(config.stripeActivationPriceId);}catch{throw new AppError(503,'PAYMENT_CONFIG_ERROR','The Dramio Pass price is unavailable. Please contact support.');}
      assert(price.active&&price.type==='one_time'&&price.currency==='hkd'&&price.unit_amount===ACTIVATION_HKD_CENTS&&stripeModeMatches(price.livemode),503,'PAYMENT_CONFIG_ERROR','The Dramio Pass price must be HK$88 once in the correct payment mode.');
    }
  }
  const currency=kind==='activation'||method==='wechat_pay'?'hkd':'usd',amount=kind==='activation'?(promotion?promotion.amountHkdCents:ACTIVATION_HKD_CENTS):wechatQuote?wechatQuote.hkd_cents:cents;
  const requestedLanguage=languageCode||one('SELECT language FROM users WHERE id=?',userId)?.language||'en';
  const checkoutLanguage=LANGUAGES.some(language=>language.code===requestedLanguage)?requestedLanguage:'en';
  // Custom messages cover every app language. Stripe's own controls use its
  // supported locale, with English for languages its hosted UI does not offer.
  const locale=stripeLocales[checkoutLanguage]||'en';
  for(let attempt=0;attempt<3;attempt++){
    const payment=transaction<Record<string,any>|null>(()=>{
      if(kind==='activation'){
        if(financeAccount(userId)?.publisher_active)return null;
        const pending=one(`SELECT * FROM ${paymentTable()} WHERE user_id=? AND kind='activation' AND status='pending' AND provider=? ORDER BY created_at DESC LIMIT 1`,userId,config.payments);
        if(pending)return{...pending,created:false};
      }
      if(wechatQuote?.payment_id){const pending=one(`SELECT * FROM ${paymentTable()} WHERE id=? AND user_id=? AND kind='funding' AND status='pending' AND provider='stripe'`,wechatQuote.payment_id,userId);assert(pending,409,'WECHAT_QUOTE_USED','This quote has already been used. Refresh the HKD payment amount.');return{...pending,created:false};}
      if(promotion){const fresh=quotePromotion(userId,promotion.code);assert(fresh.revision===promotion.revision&&fresh.amountHkdCents===promotion.amountHkdCents,409,'PROMOTION_CHANGED','This promotion changed. Apply the code again to confirm the current price.');}
      const id=crypto.randomUUID();run(`INSERT INTO ${paymentTable()} (id,user_id,kind,amount_cents,currency,provider) VALUES (?,?,?,?,?,?)`,id,userId,kind,amount,currency,config.payments);
      if(promotion)storePromotionQuote(id,promotion);
      if(kind==='funding')storeFundingQuote(id,userId,cents);
      storeCheckoutMethod(id,method);
      if(wechatQuote)bindWechatQuote(wechatQuote.id,id);
      if(consent)recordCreatorPassConsent(id,userId,consent,checkoutLanguage);
      return{id,provider_session:null,amount_cents:amount,currency,created:true};
    });
    if(!payment)return{alreadyPaid:true};
    const id=payment.id as string;
    const funding=kind==='funding'?fundingCreditForPayment({...payment,id,user_id:userId,kind:'funding'}):undefined;
    const messages=checkoutCopy(checkoutLanguage,funding?.amountCents||0,funding?.bonusCents||0,wechatQuote?{amountCents:amount,currency:'hkd'}:undefined);
    const sameMethod=checkoutMethod(id)===method;
    const sameQuote=kind!=='activation'||payment.amount_cents===amount&&payment.currency===currency&&(promotion?validPromotionPayment({...payment,id})&&promotionSnapshot(id)?.code===promotion.code:!promotionSnapshot(id));
    const assertSameQuote=()=>{if(!sameMethod)throw new AppError(409,'ACTIVATION_CHECKOUT_CONFLICT','Close your existing unpaid Dramio Pass checkout before changing payment method.',{paymentId:id,reason:'payment_method'});if(!sameQuote)throw new AppError(409,'ACTIVATION_CHECKOUT_CONFLICT','Close your existing unpaid Dramio Pass checkout before changing its promotion.',{paymentId:id});};
    const recordResumeConsent=()=>{if(consent&&!payment.created)transaction(()=>recordCreatorPassConsent(id,userId,consent,checkoutLanguage));};
    if(config.payments==='demo'){assertSameQuote();recordResumeConsent();return{demo:true,paymentId:id,amount_cents:amount,currency,...(funding?{funding}:{})};}
    if(payment.provider_session){
      const existing=await stripe!.checkout.sessions.retrieve(payment.provider_session);
      if(financeAccount(userId)?.publisher_active)return{alreadyPaid:true};
      assert(stripeModeMatches(existing.livemode),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
      if(existing.payment_status==='paid'){
        settlePayment(id,{amount:existing.amount_total!,currency:existing.currency!,session:existing.id,livemode:existing.livemode,sessionObject:existing});return{alreadyPaid:true};
      }
      if(existing.status==='open'){
        assertSameQuote();
        if(consent)assert(existing.payment_status==='unpaid',409,'PAYMENT_PROCESSING','Your payment is still processing. Please wait before trying again.');
        recordResumeConsent();return{url:existing.url,paymentId:id,...(funding?{funding}:{})};
      }
      assert(existing.status!=='complete',409,'PAYMENT_PROCESSING','Your payment is still processing. Please wait before trying again.');
      run(`UPDATE ${paymentTable()} SET status='expired' WHERE id=? AND status='pending'`,id);if(wechatQuote)throw new AppError(409,'WECHAT_QUOTE_USED','This checkout expired. Refresh the HKD payment amount.');continue;
    }
    assertSameQuote();
    try{
      const metadata={...(method==='wechat_pay'?{checkoutMethod:method,...(wechatQuote?{fundingQuoteId:wechatQuote.id}:{})}:{}),app:'aidramio',site:stripeSiteOrigin(),financialMode:config.stripeTestMode?'test':'default',paymentId:id,userId,...(promotion?{promotionCode:promotion.code,regularAmountHkdCents:String(ACTIVATION_HKD_CENTS)}:{})};
      const session=await stripe!.checkout.sessions.create({mode:'payment',payment_method_types:[method],...(method==='wechat_pay'?{payment_method_options:{wechat_pay:{client:'web' as const}}}:{}),client_reference_id:id,metadata,payment_intent_data:{metadata},locale,customer_email:one('SELECT email FROM users WHERE id=?',userId)!.email,
        branding_settings:{display_name:'LingYing · HK NovaXR Production'},
        custom_text:{after_submit:{message:messages.afterSubmit},...(kind==='funding'?{submit:{message:messages.submit}}:{})},
        line_items:kind==='activation'&&config.stripeActivationPriceId&&!promotion?[{price:config.stripeActivationPriceId,quantity:1}]:[{price_data:{currency,unit_amount:amount,...(kind==='funding'&&config.stripeWalletProductId&&!funding?.bonusCents?{product:config.stripeWalletProductId}:{product_data:{name:kind==='activation'?'Dramio Pass':'LingYing wallet credit',...(kind==='funding'?{description:messages.description}:promotion?{description:`Promotion ${promotion.code} · HK$${(amount/100).toFixed(2)} once (regular HK$88).`}:{})}})},quantity:1}],
        success_url:`${publicAppUrl()}/${kind==='activation'?'studio':'wallet'}?checkout=success&session_id={CHECKOUT_SESSION_ID}${promotion?`&promo=${encodeURIComponent(promotion.code)}`:''}`,
        cancel_url:`${publicAppUrl()}/${kind==='activation'?'studio':'wallet'}?checkout=cancelled${promotion?`&promo=${encodeURIComponent(promotion.code)}`:''}`,
      },{idempotencyKey:`checkout:${id}`});
      assert(stripeModeMatches(session.livemode),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
      run(`UPDATE ${paymentTable()} SET provider_session=? WHERE id=? AND status='pending'`,session.id,id);
      recordPaymentLink(id,session);
      if(consent&&!payment.created&&session.payment_status==='paid'){
        settlePayment(id,{amount:session.amount_total!,currency:session.currency!,session:session.id,livemode:session.livemode,sessionObject:session});return{alreadyPaid:true};
      }
      if(kind==='activation'&&financeAccount(userId)?.publisher_active)return{alreadyPaid:true};
      // A legacy pending payment may already have a provider Session after a
      // timeout. Only append a new acknowledgement once its unpaid state is
      // verified; paid history never manufactures a consent record.
      if(session.status==='open'&&session.payment_status==='unpaid')recordResumeConsent();
      return{url:session.url,paymentId:id,...(funding?{funding}:{})};
    }catch(error){
      // A timeout can occur after Stripe created Checkout. Retain this pending
      // payment and stable idempotency key so activation retries cannot charge twice.
      if(error instanceof AppError)throw error;
      throw new AppError(502,'CHECKOUT_UNAVAILABLE','Secure checkout is temporarily unavailable. Please try again shortly.');
    }
  }
  throw new AppError(409,'PAYMENT_RETRY','The checkout changed while opening. Please try again.');
}

/** Close an owner's unpaid hosted Checkout without creating a charge or credit. */
export async function cancelCheckout(userId:string,paymentId:string){
  assert(stripe&&stripeConfigured(),503,'PAYMENTS_UNAVAILABLE','Payments unavailable.');
  const payment=one(`SELECT * FROM ${paymentTable()} WHERE id=? AND user_id=? AND provider='stripe'`,paymentId,userId);
  assert(payment,404,'NOT_FOUND','Payment not found.');
  if(payment.status==='paid')return{cancelled:false,alreadyPaid:true};
  if(payment.status!=='pending')return{cancelled:true};
  assert(payment.provider_session,409,'PAYMENT_PROCESSING','Your checkout is still being created. Try again shortly.');
  const inspect=(session:Stripe.Checkout.Session)=>{
    assert(stripeModeMatches(session.livemode),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
    assert(session.id===payment.provider_session&&session.amount_total===payment.amount_cents&&session.currency===payment.currency,400,'PAYMENT_MISMATCH','Payment details do not match.');
    assert((!session.metadata?.site||session.metadata.site===stripeSiteOrigin())&&(!session.metadata?.paymentId||session.metadata.paymentId===payment.id)&&(!session.metadata?.userId||session.metadata.userId===userId)&&(!session.client_reference_id||session.client_reference_id===payment.id),400,'PAYMENT_MISMATCH','Payment details do not match.');
    if(session.payment_status==='paid'){
      settlePayment(payment.id,{amount:session.amount_total!,currency:session.currency!,session:session.id,livemode:session.livemode,sessionObject:session});
      return{cancelled:false,alreadyPaid:true};
    }
    if(session.status==='expired'){
      run(`UPDATE ${paymentTable()} SET status='expired' WHERE id=? AND user_id=? AND status='pending'`,payment.id,userId);
      return{cancelled:true};
    }
    assert(session.status==='open',409,'PAYMENT_PROCESSING','Your payment is still processing. Please wait.');
    return null;
  };
  const session=await stripe!.checkout.sessions.retrieve(payment.provider_session);
  const closed=inspect(session);if(closed)return closed;
  try{
    const expired=await stripe!.checkout.sessions.expire(session.id);
    const result=inspect(expired);assert(result,502,'CHECKOUT_UNAVAILABLE','The checkout could not be closed. Try again shortly.');return result;
  }catch(error){
    // A payment can complete between retrieve and expire. Verify its current
    // provider state rather than marking a paid or processing session expired.
    if(error instanceof AppError)throw error;
    const current=await stripe!.checkout.sessions.retrieve(session.id);
    const result=inspect(current);if(result)return result;throw error;
  }
}
