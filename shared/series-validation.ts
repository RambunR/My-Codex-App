import {GENRES,LANGUAGES,MIN_PRICE_CENTS} from './config.js';

export const SERIES_LIMITS={titleMin:2,titleMax:120,synopsisMin:10,synopsisMax:4000,genresMin:1,genresMax:3,priceMin:MIN_PRICE_CENTS,priceMax:10000,freeMin:0,freeMax:1000} as const;
export interface SeriesDetailsInput {
  title:string;description:string;language:string;genres:string[];creation_type:string;
  price_cents:number|null;free_episodes:number|null;
}
export type SeriesField=keyof SeriesDetailsInput;
export type SeriesValidationMessage='seriesTitleInvalid'|'seriesSynopsisInvalid'|'seriesGenresInvalid'|'seriesPriceInvalid'|'seriesFreeInvalid'|'seriesLanguageInvalid'|'seriesCreationInvalid';
export function seriesDetailsErrors(input:SeriesDetailsInput):Partial<Record<SeriesField,SeriesValidationMessage>>{
  const errors:Partial<Record<SeriesField,SeriesValidationMessage>>={};
  if(input.title.trim().length<SERIES_LIMITS.titleMin||input.title.trim().length>SERIES_LIMITS.titleMax)errors.title='seriesTitleInvalid';
  if(input.description.trim().length<SERIES_LIMITS.synopsisMin||input.description.trim().length>SERIES_LIMITS.synopsisMax)errors.description='seriesSynopsisInvalid';
  if(!LANGUAGES.some(item=>item.code===input.language))errors.language='seriesLanguageInvalid';
  if(input.genres.length<SERIES_LIMITS.genresMin||input.genres.length>SERIES_LIMITS.genresMax||input.genres.some(genre=>!GENRES.includes(genre as typeof GENRES[number])))errors.genres='seriesGenresInvalid';
  if(!['human','ai-assisted','ai-generated'].includes(input.creation_type))errors.creation_type='seriesCreationInvalid';
  if(input.price_cents===null||!Number.isSafeInteger(input.price_cents)||input.price_cents<SERIES_LIMITS.priceMin||input.price_cents>SERIES_LIMITS.priceMax)errors.price_cents='seriesPriceInvalid';
  if(input.free_episodes===null||!Number.isSafeInteger(input.free_episodes)||input.free_episodes<SERIES_LIMITS.freeMin||input.free_episodes>SERIES_LIMITS.freeMax)errors.free_episodes='seriesFreeInvalid';
  return errors;
}
