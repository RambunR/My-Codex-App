import {one,run} from './db.js';
import {assert} from './errors.js';
import {MAX_EPISODE_SECONDS,MAX_TRACKED_EPISODE_SECONDS} from '../shared/config.js';
import {assertEpisodeUploadDuration} from './episode-upload-policy.js';
// The original episodes table has a <=180 constraint on existing databases.
// Preserve its financial foreign keys and keep extended durations additively.
export function episodeDurationSql(alias='e'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias),400,'INVALID_SQL_ALIAS','Invalid episode query alias.');
  return `COALESCE((SELECT d.seconds FROM episode_durations_long d WHERE d.episode_id=${alias}.id),(SELECT d.seconds FROM episode_durations_extended d WHERE d.episode_id=${alias}.id),(SELECT d.seconds FROM episode_durations d WHERE d.episode_id=${alias}.id),${alias}.duration)`;
}
export function legacyEpisodeDuration(seconds:number){return Math.min(seconds,180);}
export function writeEpisodeDuration(episodeId:string,seconds:number){
  // Upload routes check permission at their transaction boundary. Repeat the
  // owner check here for long writes so another internal caller cannot bypass
  // the ordinary five-minute rule. Existing stored values remain readable.
  assert(Number.isFinite(seconds)&&seconds>0&&seconds<=MAX_TRACKED_EPISODE_SECONDS,422,'INVALID_VIDEO','Video duration is invalid or cannot be represented safely.');
  if(seconds>MAX_EPISODE_SECONDS){
    const owner=one<{creator_id:string}>('SELECT s.creator_id FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.id=?',episodeId);
    assert(owner,404,'NOT_FOUND','Episode not found.');assertEpisodeUploadDuration(owner.creator_id,seconds);
  }
  if(seconds>MAX_EPISODE_SECONDS)run('INSERT INTO episode_durations_long (episode_id,seconds) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET seconds=excluded.seconds',episodeId,seconds);
  else run('DELETE FROM episode_durations_long WHERE episode_id=?',episodeId);
  if(seconds>240)run('INSERT INTO episode_durations_extended (episode_id,seconds) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET seconds=excluded.seconds',episodeId,Math.min(seconds,MAX_EPISODE_SECONDS));
  else run('DELETE FROM episode_durations_extended WHERE episode_id=?',episodeId);
  if(seconds>180)run('INSERT INTO episode_durations (episode_id,seconds) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET seconds=excluded.seconds',episodeId,Math.min(seconds,240));
  else run('DELETE FROM episode_durations WHERE episode_id=?',episodeId);
}
