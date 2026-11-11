import {one} from './db.js';
import {config} from './config.js';
import {assert} from './errors.js';
import {MAX_EPISODE_BYTES,MAX_EPISODE_SECONDS,MAX_TRACKED_EPISODE_SECONDS} from '../shared/config.js';

/** Upload privileges follow the real series owner, never the administrator
 * performing an edit, a public publisher profile or client-supplied fields.
 * Keep this a pure read: getUser() can promote roles and open a transaction. */
export function episodeUploadLimits(ownerId:string){
  const owner=one<{role:string}>('SELECT role FROM users WHERE id=?',ownerId);
  const isOwner=!!config.platformOwnerUserId&&ownerId===config.platformOwnerUserId&&owner?.role==='admin';
  return{maxEpisodeSeconds:isOwner?null:MAX_EPISODE_SECONDS,maxEpisodeBytes:MAX_EPISODE_BYTES};
}

export function assertEpisodeUploadDuration(ownerId:string,seconds:number){
  assert(Number.isFinite(seconds)&&seconds>0&&seconds<=MAX_TRACKED_EPISODE_SECONDS,422,'INVALID_VIDEO','This file has no safely readable video duration.');
  const limits=episodeUploadLimits(ownerId);
  if(limits.maxEpisodeSeconds!==null)assert(seconds<=limits.maxEpisodeSeconds,422,'VIDEO_TOO_LONG',`Episodes must be ${limits.maxEpisodeSeconds/60} minutes or less.`);
  return limits;
}
