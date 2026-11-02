import {z} from 'zod';
import {one,run} from './db.js';
import {LANGUAGES} from '../shared/config.js';

const language=z.enum(LANGUAGES.map(item=>item.code) as [string,...string[]]);
export const subtitleLanguagesSchema=z.array(language).max(LANGUAGES.length)
  .refine(values=>new Set(values).size===values.length,'Choose each subtitle language only once.').optional();
const canonical=(values:readonly string[])=>LANGUAGES.filter(item=>values.includes(item.code)).map(item=>item.code);

/** These are publisher-declared languages already present in the video.
 * Metadata never creates or translates caption tracks. */
export function seriesSubtitleLanguages(seriesId:string):string[]{
  const row=one<{languages:string}>('SELECT languages FROM series_subtitle_languages WHERE series_id=?',seriesId);
  return row?canonical(JSON.parse(row.languages)):[];
}

/** Caller owns the metadata transaction and authorization. Missing fields from
 * older editors leave existing declarations untouched; [] explicitly clears. */
export function writeSeriesSubtitleLanguages(seriesId:string,languages:readonly string[]|undefined){
  if(languages===undefined)return;
  const validated=subtitleLanguagesSchema.parse(languages)!;
  run("INSERT INTO series_subtitle_languages (series_id,languages) VALUES (?,?) ON CONFLICT(series_id) DO UPDATE SET languages=excluded.languages,updated_at=datetime('now')",seriesId,JSON.stringify(canonical(validated)));
}
