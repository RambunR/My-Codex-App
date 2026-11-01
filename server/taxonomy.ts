import {z} from 'zod';
import {one,run} from './db.js';
import {STORY_THEMES,SERIES_FORMATS,MAX_STORY_THEMES,type StoryTheme,type SeriesFormat} from '../shared/taxonomy.js';

export const themesSchema=z.array(z.enum(STORY_THEMES)).max(MAX_STORY_THEMES).refine(values=>new Set(values).size===values.length,'Choose each story theme only once.');
export const formatSchema=z.enum(SERIES_FORMATS).nullable();
export interface SeriesClassification {themes:StoryTheme[];format:SeriesFormat|null}
interface ClassificationRow {themes:string;format:SeriesFormat|null}

export function seriesClassification(seriesId:string,genres:readonly string[]):SeriesClassification{
  const saved=one<ClassificationRow>('SELECT themes,format FROM series_classifications WHERE series_id=?',seriesId);
  if(saved)return{themes:JSON.parse(saved.themes),format:saved.format};
  // Existing metadata can prove animation; it cannot prove that another series is live action.
  return{themes:[],format:genres.includes('animation')?'animation':null};
}

/** Call inside the series write transaction; omitted fields preserve existing metadata. */
export function writeSeriesClassification(seriesId:string,genres:readonly string[],input:{themes?:StoryTheme[];format?:SeriesFormat|null}){
  if(input.themes===undefined&&input.format===undefined)return;
  const before=seriesClassification(seriesId,genres);
  run(`INSERT INTO series_classifications (series_id,themes,format) VALUES (?,?,?)
    ON CONFLICT(series_id) DO UPDATE SET themes=excluded.themes,format=excluded.format,updated_at=datetime('now')`,
  seriesId,JSON.stringify(input.themes??before.themes),input.format===undefined?before.format:input.format);
}

// A fixed expression shared by new format filters and old animation-genre bookmarks.
export const SERIES_FORMAT_SQL=`CASE WHEN EXISTS(SELECT 1 FROM series_classifications cf WHERE cf.series_id=s.id)
  THEN (SELECT cf.format FROM series_classifications cf WHERE cf.series_id=s.id)
  WHEN EXISTS(SELECT 1 FROM json_each(s.genres) old_genre WHERE old_genre.value='animation') THEN 'animation' ELSE NULL END`;
