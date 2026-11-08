import {MAX_PRICE_CENTS} from '../shared/config.js';
import {run,transaction} from './db.js';

export const EPISODE_PRICE_CAP_POLICY='episode-price-usd1-v1';
export function episodePriceCents(storedPrice:number){return Math.min(storedPrice,MAX_PRICE_CENTS);}

/** Only current asking prices change. Receipts, earnings and entitlements are
 * immutable; the original asking price remains in the SYSTEM audit. Rollback
 * must never silently restore a higher price from that audit. */
export function applyEpisodePriceCap(){
  return transaction(()=>{
    run(`INSERT INTO episode_price_cap_events (series_id,policy_key,before_price_cents,after_price_cents)
      SELECT id,?,price_cents,? FROM series WHERE price_cents>?`,EPISODE_PRICE_CAP_POLICY,MAX_PRICE_CENTS,MAX_PRICE_CENTS);
    return run('UPDATE series SET price_cents=? WHERE price_cents>?',MAX_PRICE_CENTS,MAX_PRICE_CENTS).changes;
  });
}
