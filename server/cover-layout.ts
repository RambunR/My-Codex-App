import {z} from 'zod';
import {one,run} from './db.js';
import {assert} from './errors.js';
import {UPLOAD_COVER_ASPECT_RATIOS,type CoverAspectRatio,type UploadCoverAspectRatio} from '../shared/cover-layout.js';

export const coverAspectRatioSchema=z.enum(UPLOAD_COVER_ASPECT_RATIOS).optional();
export function seriesCoverAspectRatio(seriesId:string):CoverAspectRatio{
  return one<{aspect_ratio:UploadCoverAspectRatio}>('SELECT aspect_ratio FROM series_cover_layouts WHERE series_id=?',seriesId)?.aspect_ratio??'2:3';
}
/** Called inside the series metadata transaction. Existing records are not
 * backfilled and their cover bytes are never altered by a layout change. */
export function writeSeriesCoverLayout(seriesId:string,ratio:UploadCoverAspectRatio|undefined,{creating=false}={}){
  const chosen=ratio??(creating?'9:16':undefined);if(chosen===undefined)return;
  assert((UPLOAD_COVER_ASPECT_RATIOS as readonly string[]).includes(chosen),400,'INVALID_COVER_ASPECT_RATIO','Choose a supported cover format.');
  run("INSERT INTO series_cover_layouts (series_id,aspect_ratio) VALUES (?,?) ON CONFLICT(series_id) DO UPDATE SET aspect_ratio=excluded.aspect_ratio,updated_at=datetime('now')",seriesId,chosen);
}
export function coverAspectRatioSql(alias='s'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias),400,'INVALID_SQL_ALIAS','Invalid cover query alias.');
  return `COALESCE((SELECT l.aspect_ratio FROM series_cover_layouts l WHERE l.series_id=${alias}.id),'2:3')`;
}
