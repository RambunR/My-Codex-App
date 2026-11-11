import {one} from './db.js';

/** Free series awards are independent of Stripe financial partitions. Public
 * callers must still enforce publication, moderation and deletion guards. */
export function hasLuckyDrawAccess(userId:string,seriesId:string){
  return !!one('SELECT 1 FROM lucky_draw_results WHERE user_id=? AND series_id=?',userId,seriesId);
}
