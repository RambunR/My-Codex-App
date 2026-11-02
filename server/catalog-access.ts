import {one} from './db.js';
import {assert} from './errors.js';
import type {SeriesAccessType} from '../shared/catalog-access.js';

/** Follow the exact public playback free rule. COUNT alone is insufficient for
 * retained series with gaps in their episode numbers. Empty series have no
 * declared access type; personal unlocks never alter this classification. */
export function seriesAccessTypeSql(alias='s'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias),400,'INVALID_SQL_ALIAS','Invalid series query alias.');
  const free=`EXISTS(SELECT 1 FROM episodes access_free WHERE access_free.series_id=${alias}.id AND access_free.number<=${alias}.free_episodes)`;
  const paid=`EXISTS(SELECT 1 FROM episodes access_paid WHERE access_paid.series_id=${alias}.id AND access_paid.number>${alias}.free_episodes)`;
  return `CASE WHEN ${free} THEN CASE WHEN ${paid} THEN 'free-then-paid' ELSE 'all-free' END WHEN ${paid} THEN 'all-paid' ELSE NULL END`;
}
export function readSeriesAccessType(seriesId:string):SeriesAccessType|null{
  return one<{access_type:SeriesAccessType|null}>(`SELECT ${seriesAccessTypeSql()} AS access_type FROM series s WHERE s.id=?`,seriesId)?.access_type??null;
}
