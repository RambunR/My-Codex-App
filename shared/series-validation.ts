import {GENRES,MIN_PRICE_CENTS,MAX_PRICE_CENTS} from './config.js';
import {isStoredSpokenLanguageCode} from './spoken-languages.js';
import {STORY_THEMES,SERIES_FORMATS,CREATION_TYPES,MAX_STORY_THEMES} from './taxonomy.js';

export const SERIES_LIMITS={titleMin:2,titleMax:120,synopsisMin:10,synopsisMax:4000,genresMin:1,genresMax:3,priceMin:MIN_PRICE_CENTS,priceMax:MAX_PRICE_CENTS,freeMin:0,freeMax:1000} as const;
export interface SeriesDetailsInput {
  title:string;description:string;language:string;genres:string[];creation_type:string;
  price_cents:number|null;free_episodes:number|null;
  themes?:string[];format?:string|null;
}
export type SeriesField=keyof SeriesDetailsInput;
export type SeriesValidationMessage='seriesTitleInvalid'|'seriesSynopsisInvalid'|'seriesGenresInvalid'|'seriesPriceInvalid'|'seriesFreeInvalid'|'seriesLanguageInvalid'|'seriesCreationInvalid'|'taxonomyThemesInvalid'|'taxonomyFormatInvalid';
export function seriesDetailsErrors(input:SeriesDetailsInput):Partial<Record<SeriesField,SeriesValidationMessage>>{
  const errors:Partial<Record<SeriesField,SeriesValidationMessage>>={};
  if(input.title.trim().length<SERIES_LIMITS.titleMin||input.title.trim().length>SERIES_LIMITS.titleMax)errors.title='seriesTitleInvalid';
  if(input.description.trim().length<SERIES_LIMITS.synopsisMin||input.description.trim().length>SERIES_LIMITS.synopsisMax)errors.description='seriesSynopsisInvalid';
  if(!isStoredSpokenLanguageCode(input.language))errors.language='seriesLanguageInvalid';
  if(input.genres.length<SERIES_LIMITS.genresMin||input.genres.length>SERIES_LIMITS.genresMax||new Set(input.genres).size!==input.genres.length||input.genres.some(genre=>!GENRES.includes(genre as typeof GENRES[number])))errors.genres='seriesGenresInvalid';
  if(!CREATION_TYPES.includes(input.creation_type as typeof CREATION_TYPES[number]))errors.creation_type='seriesCreationInvalid';
  if(input.themes!==undefined&&(input.themes.length>MAX_STORY_THEMES||new Set(input.themes).size!==input.themes.length||input.themes.some(theme=>!STORY_THEMES.includes(theme as typeof STORY_THEMES[number]))))errors.themes='taxonomyThemesInvalid';
  if(input.format!==undefined&&input.format!==null&&!SERIES_FORMATS.includes(input.format as typeof SERIES_FORMATS[number]))errors.format='taxonomyFormatInvalid';
  if(input.price_cents===null||!Number.isSafeInteger(input.price_cents)||input.price_cents<SERIES_LIMITS.priceMin||input.price_cents>SERIES_LIMITS.priceMax)errors.price_cents='seriesPriceInvalid';
  if(input.free_episodes===null||!Number.isSafeInteger(input.free_episodes)||input.free_episodes<SERIES_LIMITS.freeMin||input.free_episodes>SERIES_LIMITS.freeMax)errors.free_episodes='seriesFreeInvalid';
  return errors;
}
