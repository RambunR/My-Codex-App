import type {User} from './config.js';

/** A quote covers only the listed currently locked paid episodes. */
export interface SeriesUnlockQuote {
  series_id:string;
  episode_ids:string[];
  episode_count:number;
  total_micros:number;
  unit_price_micros:number;
  revision:string;
}
export interface SeriesUnlockRequest {revision:string}
export interface SeriesUnlockResult {
  unlocked_count:number;
  paid_micros:number;
  alreadyUnlocked:boolean;
  user:User;
}
