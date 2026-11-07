import {LANGUAGES,type Locale} from './config.js';

export const LEGACY_SPOKEN_LANGUAGE_CODES=['zh-TW','zh-CN'] as const;
export type LegacySpokenLanguageCode=typeof LEGACY_SPOKEN_LANGUAGE_CODES[number];
export type SpokenLanguageCode=Exclude<Locale,LegacySpokenLanguageCode>|'cmn'|'yue';
export type StoredSpokenLanguageCode=SpokenLanguageCode|LegacySpokenLanguageCode;
interface SpokenLanguage {readonly code:SpokenLanguageCode;readonly name:string;readonly region:string;readonly flag:string}

/** Audio varieties are separate from the interface and subtitle writing systems.
 * Legacy Chinese tags remain stored verbatim; neither tag establishes speech. */
export const SPOKEN_LANGUAGES:readonly SpokenLanguage[]=LANGUAGES.flatMap<SpokenLanguage>(language=>{
  if(language.code==='zh-TW')return[{code:'cmn',name:'Mandarin',region:'Chinese-speaking regions',flag:'🌐'}];
  if(language.code==='zh-CN')return[{code:'yue',name:'Cantonese',region:'Hong Kong · Macau · Guangdong',flag:'🌐'}];
  return[language];
});

/** Accept old clients and exact legacy bookmarks without converting their data. */
export const SPOKEN_LANGUAGE_CODES:readonly StoredSpokenLanguageCode[]=[...SPOKEN_LANGUAGES.map(language=>language.code),...LEGACY_SPOKEN_LANGUAGE_CODES];
export function isLegacyChineseLanguage(value:string):value is LegacySpokenLanguageCode{
  return LEGACY_SPOKEN_LANGUAGE_CODES.some(code=>code===value);
}
export function isSpokenLanguageCode(value:unknown):value is SpokenLanguageCode{
  return typeof value==='string'&&SPOKEN_LANGUAGES.some(language=>language.code===value);
}
export function isStoredSpokenLanguageCode(value:unknown):value is StoredSpokenLanguageCode{
  return isSpokenLanguageCode(value)||typeof value==='string'&&isLegacyChineseLanguage(value);
}
/** A new-editor default only: never apply this to existing series metadata. */
export function defaultSpokenLanguage(locale:string):SpokenLanguageCode{
  return isLegacyChineseLanguage(locale)?'cmn':isSpokenLanguageCode(locale)?locale:'en';
}
