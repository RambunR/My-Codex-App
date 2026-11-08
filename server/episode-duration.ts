import {run} from './db.js';
import {assert} from './errors.js';
import {MAX_EPISODE_SECONDS} from '../shared/config.js';
// The original episodes table has a <=180 constraint on existing databases.
// Preserve its financial foreign keys and keep extended durations additively.
export function episodeDurationSql(alias='e'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias),400,'INVALID_SQL_ALIAS','Invalid episode query alias.');
  return `COALESCE((SELECT d.seconds FROM episode_durations_extended d WHERE d.episode_id=${alias}.id),(SELECT d.seconds FROM episode_durations d WHERE d.episode_id=${alias}.id),${alias}.duration)`;
}
export function legacyEpisodeDuration(seconds:number){return Math.min(seconds,180);}
export function writeEpisodeDuration(episodeId:string,seconds:number){
  assert(Number.isFinite(seconds)&&seconds>0&&seconds<=MAX_EPISODE_SECONDS,422,'VIDEO_TOO_LONG',`Episodes must be ${MAX_EPISODE_SECONDS/60} minutes or less.`);
  if(seconds>240)run('INSERT INTO episode_durations_extended (episode_id,seconds) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET seconds=excluded.seconds',episodeId,seconds);
  else run('DELETE FROM episode_durations_extended WHERE episode_id=?',episodeId);
  if(seconds>180)run('INSERT INTO episode_durations (episode_id,seconds) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET seconds=excluded.seconds',episodeId,Math.min(seconds,240));
  else run('DELETE FROM episode_durations WHERE episode_id=?',episodeId);
}
