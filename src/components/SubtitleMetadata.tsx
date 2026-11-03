import {LANGUAGES} from '../../shared/config';
import {Captions} from 'lucide-react';
import {languageName,useI18n} from '../i18n';
import '../subtitle-metadata.css';

function supportedSubtitleLanguages(languages:unknown){
  const declared=new Set(Array.isArray(languages)?languages.filter((value):value is string=>typeof value==='string'):[]);
  return LANGUAGES.filter(language=>declared.has(language.code));
}

/** Compact declaration beside the spoken language in the series summary. */
export function InlineSubtitleMetadata({languages}:{languages:unknown}){
  const{t}=useI18n();const supported=supportedSubtitleLanguages(languages);
  return <span className="subtitle-metadata-inline" role="group" aria-label={t('subtitleLanguages')}><Captions size={15} aria-hidden="true"/><span className="subtitle-metadata-inline-copy"><span>{t('subtitleLanguages')}: </span>{supported.length?supported.map((language,index)=><span key={language.code}><bdi lang={language.code}>{languageName(language.code)}</bdi>{index<supported.length-1?', ':''}</span>):t('subtitleLanguagesUnspecified')}</span></span>;
}

/** A publisher's language declaration is metadata, not a browser text track. */
export function SubtitleMetadata({languages,standalone=false}:{languages:unknown;standalone?:boolean}){
  const{t}=useI18n();
  const supported=supportedSubtitleLanguages(languages);
  if(!supported.length)return null;
  const details=<div className="subtitle-metadata"><dt>{t('subtitleLanguages')}</dt><dd><ul className="subtitle-metadata-list" aria-label={t('subtitleLanguages')}>{supported.map(language=><li key={language.code}><bdi lang={language.code}>{languageName(language.code)}</bdi></li>)}</ul><p className="subtitle-metadata-hint">{t('subtitleDeclaredHint')}</p></dd></div>;
  return standalone?<dl className="watch-subtitle-metadata">{details}</dl>:details;
}
