import {LANGUAGES} from '../../shared/config';
import {languageName,useI18n} from '../i18n';
import '../subtitle-metadata.css';

/** A publisher's language declaration is metadata, not a browser text track. */
export function SubtitleMetadata({languages,standalone=false}:{languages:unknown;standalone?:boolean}){
  const{t}=useI18n();
  const declared=new Set(Array.isArray(languages)?languages.filter((value):value is string=>typeof value==='string'):[]);
  const supported=LANGUAGES.filter(language=>declared.has(language.code));
  if(!supported.length)return null;
  const details=<div className="subtitle-metadata"><dt>{t('subtitleLanguages')}</dt><dd><ul className="subtitle-metadata-list" aria-label={t('subtitleLanguages')}>{supported.map(language=><li key={language.code}><bdi lang={language.code}>{languageName(language.code)}</bdi></li>)}</ul><p className="subtitle-metadata-hint">{t('subtitleDeclaredHint')}</p></dd></div>;
  return standalone?<dl className="watch-subtitle-metadata">{details}</dl>:details;
}
