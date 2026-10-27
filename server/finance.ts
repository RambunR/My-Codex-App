import crypto from 'node:crypto';
import Stripe from 'stripe';
import { config } from './config.js';
import { one, run, transaction } from './db.js';
import { assert } from './errors.js';
import { ACTIVATION_HKD_CENTS } from '../shared/config.js';

export let stripe = config.stripeKey ? new Stripe(config.stripeKey, {httpClient:Stripe.createFetchHttpClient()}) : null;
export function configureStripe(){stripe=config.stripeKey?new Stripe(config.stripeKey,{httpClient:Stripe.createFetchHttpClient()}):null;}
export function addLedger(userId: string, kind: string, amount: number, reference: string, description: string) {
  run('INSERT INTO ledger (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)', crypto.randomUUID(), userId, kind, amount, reference, description);
}
export function settlePayment(paymentId: string, expected?: { amount: number; currency: string; session: string }) {
  return transaction(() => {
    const payment = one('SELECT * FROM payments WHERE id=?', paymentId);
    assert(payment, 404, 'NOT_FOUND', 'Payment not found.');
    if (expected) assert(payment.provider_session === expected.session && payment.amount_cents === expected.amount && payment.currency === expected.currency, 400, 'PAYMENT_MISMATCH', 'Payment details do not match.');
    if (payment.status === 'paid') return false;
    assert(payment.status === 'pending', 409, 'PAYMENT_CLOSED', 'This payment is no longer pending.');
    if (payment.kind === 'funding') {
      const micros = payment.amount_cents * 10000;
      run('UPDATE users SET wallet_micros=wallet_micros+? WHERE id=?', micros, payment.user_id);
      addLedger(payment.user_id, 'funding', micros, payment.id, 'Wallet top-up');
    } else {
      run("UPDATE users SET publisher_active=1, role=CASE WHEN role='admin' THEN 'admin' ELSE 'publisher' END WHERE id=?", payment.user_id);
      addLedger(payment.user_id, 'activation', 0, payment.id, 'One-time publisher activation · HK$88');
    }
    run("UPDATE payments SET status='paid' WHERE id=?", payment.id);
    return true;
  });
}
export function unlockEpisode(userId: string, episodeId: string) {
  return transaction(() => {
    const episode = one(`SELECT e.*,s.creator_id,s.title AS series_title,s.free_episodes,s.price_cents,s.status FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.id=?`, episodeId);
    assert(episode && episode.status === 'published', 404, 'NOT_FOUND', 'Episode not found.');
    if (episode.number <= episode.free_episodes || episode.creator_id === userId) return { alreadyUnlocked: true };
    if (one('SELECT id FROM purchases WHERE user_id=? AND episode_id=?', userId, episodeId)) return { alreadyUnlocked: true };
    const user = one('SELECT wallet_micros FROM users WHERE id=?', userId);
    const price = episode.price_cents * 10000;
    assert(user && user.wallet_micros >= price, 402, 'INSUFFICIENT_FUNDS', 'Add funds to your wallet to unlock this episode.');
    const creator = episode.price_cents * 7000; const platform = episode.price_cents * 3000; const id = crypto.randomUUID();
    run('UPDATE users SET wallet_micros=wallet_micros-? WHERE id=?', price, userId);
    run('UPDATE users SET earnings_micros=earnings_micros+? WHERE id=?', creator, episode.creator_id);
    run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)', id, userId, episodeId, price, creator, platform);
    addLedger(userId, 'unlock', -price, id, `${episode.series_title} · Episode ${episode.number}`);
    addLedger(episode.creator_id, 'earning', creator, id, `${episode.series_title} · Episode ${episode.number}`);
    return { alreadyUnlocked: false, paid_micros: price, creator_micros: creator, platform_micros: platform };
  });
}
export function requestWithdrawal(userId: string, amountCents: number, note = '') {
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
  assert(config.payments === 'demo' || (config.payments === 'stripe' && stripe && config.stripeWebhook), 503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured yet. Please try again later.');
  let reuseId: string | undefined;
  if (kind === 'activation') {
    const user = one('SELECT publisher_active FROM users WHERE id=?', userId);
    assert(!user?.publisher_active, 409, 'ALREADY_ACTIVE', 'Your publisher account is already active.');
    const pending = one("SELECT id,provider_session FROM payments WHERE user_id=? AND kind='activation' AND status='pending' ORDER BY created_at DESC LIMIT 1", userId);
    if (pending) {
      if (config.payments === 'demo') return { demo: true, paymentId: pending.id, amount_cents: ACTIVATION_HKD_CENTS, currency: 'hkd' };
      if (pending.provider_session) {
        const existing = await stripe!.checkout.sessions.retrieve(pending.provider_session);
        if (existing.status === 'open') return { url: existing.url, paymentId: pending.id };
        if (existing.payment_status === 'paid') { settlePayment(pending.id, { amount: existing.amount_total!, currency: existing.currency!, session: existing.id }); return { alreadyPaid: true }; }
      }
      if(pending.provider_session) run("UPDATE payments SET status='expired' WHERE id=?", pending.id);
      else reuseId=pending.id;
    }
  }
  const id = reuseId || crypto.randomUUID(); const currency = kind === 'activation' ? 'hkd' : 'usd'; const amount = kind === 'activation' ? ACTIVATION_HKD_CENTS : cents;
  if(!reuseId) run('INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider) VALUES (?,?,?,?,?,?)', id, userId, kind, amount, currency, config.payments);
  if (config.payments === 'demo') return { demo: true, paymentId: id, amount_cents: amount, currency };
  try {
    const session = await stripe!.checkout.sessions.create({ mode: 'payment', client_reference_id: id, metadata: { paymentId: id, userId },
      line_items: [{ price_data: { currency, unit_amount: amount, product_data: { name: kind === 'activation' ? 'Publisher activation · one-time' : 'Drama wallet credit' } }, quantity: 1 }],
      success_url: `${config.appUrl}/wallet?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/${kind === 'activation' ? 'studio' : 'wallet'}?checkout=cancelled`,
    }, { idempotencyKey: `checkout:${id}` });
    run('UPDATE payments SET provider_session=? WHERE id=?', session.id, id);
    return { url: session.url, paymentId: id };
  } catch (error) { run("UPDATE payments SET status='failed' WHERE id=?", id); throw error; }
}
