import {z} from 'zod';
import {one,run} from './db.js';
import {assert} from './errors.js';

export const lastEpisodeFreeSchema=z.boolean().optional();
export function seriesLastEpisodeFree(seriesId:string){
  return one<{last_episode_free:number}>('SELECT last_episode_free FROM series_episode_access_settings WHERE series_id=?',seriesId)?.last_episode_free===1;
}
/** Caller owns authorization and the metadata transaction. Older editors that
 * omit the field preserve its value; new series default to disabled. */
export function writeSeriesLastEpisodeFree(seriesId:string,value:boolean|undefined){
  if(value===undefined)return;
  const enabled=lastEpisodeFreeSchema.parse(value)!;
  run("INSERT INTO series_episode_access_settings (series_id,last_episode_free) VALUES (?,?) ON CONFLICT(series_id) DO UPDATE SET last_episode_free=excluded.last_episode_free,updated_at=datetime('now')",seriesId,enabled?1:0);
}
function alias(value:string){assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value),400,'INVALID_SQL_ALIAS','Invalid episode access query alias.');return value;}
/** SQL form of shared isEpisodeFree. Every playback/payment/catalogue query
 * uses this predicate so no charge can disagree with declared free access. */
export function episodeFreeSql(episodeAlias='e',seriesAlias='s'){
  const e=alias(episodeAlias),s=alias(seriesAlias);
  return `(${e}.number<=${s}.free_episodes OR (EXISTS(SELECT 1 FROM series_episode_access_settings access_setting WHERE access_setting.series_id=${s}.id AND access_setting.last_episode_free=1) AND ${e}.number=(SELECT MAX(access_last.number) FROM episodes access_last WHERE access_last.series_id=${s}.id)))`;
}

export function seriesFreeEpisodeCount(seriesId:string){
  return Number(one<{count:number}>(`SELECT COUNT(*) AS count FROM episodes e JOIN series s ON s.id=e.series_id WHERE s.id=? AND ${episodeFreeSql()}`,seriesId)!.count);
}
