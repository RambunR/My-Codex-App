import {LEGACY_SPOKEN_LANGUAGE_CODES} from '../shared/spoken-languages';

const chineseSeriesLanguages=new Set<string>(['cmn','yue',...LEGACY_SPOKEN_LANGUAGE_CODES]);

/** Add a Han fallback for Chinese-series titles without changing text or locale. */
export function seriesTitleClass(language:string|undefined,display=false){
  return language&&chineseSeriesLanguages.has(language)?`series-title-cjk${display?' series-title-cjk-display':''}`:undefined;
}
