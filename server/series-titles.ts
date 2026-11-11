import {all} from './db.js';
import {assert} from './errors.js';
import {normalizeSeriesTitle} from '../shared/series-titles.js';

interface ExistingSeriesTitle {id:string;title:string}

/** The write routes call this inside their database transaction. Read current
 * source titles rather than backfilling a unique index that would break legacy
 * duplicates or silently rename real uploads. Preflight checks are advisory. */
export function seriesTitleAvailable(title:string,current?:ExistingSeriesTitle):boolean {
  const normalized=normalizeSeriesTitle(title);
  // Existing uploads can keep their title while editing other metadata, even
  // when older uploads already share that normalized spelling.
  if(current&&normalized===normalizeSeriesTitle(current.title))return true;
  const titles=all<ExistingSeriesTitle>(`SELECT s.id,s.title FROM series s
    WHERE (? IS NULL OR s.id<>?)
      AND NOT EXISTS (SELECT 1 FROM series_deletions d WHERE d.series_id=s.id)
      AND NOT EXISTS (SELECT 1 FROM retired_catalog_series r WHERE r.series_id=s.id)`,current?.id??null,current?.id??null);
  return !titles.some(series=>normalizeSeriesTitle(series.title)===normalized);
}

export function assertSeriesTitleAvailable(title:string,current?:ExistingSeriesTitle):void {
  assert(seriesTitleAvailable(title,current),409,'SERIES_TITLE_EXISTS','A series with this title already exists. Choose a different title.');
}
