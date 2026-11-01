import type {ReactNode} from 'react';
import {Check} from 'lucide-react';
import {STANDARD_GENRES,STORY_THEMES,SERIES_FORMATS,CREATION_TYPES,MAX_STORY_THEMES} from '../../shared/taxonomy';
import {SERIES_LIMITS,type SeriesField} from '../../shared/series-validation';
import {useI18n,type Key} from '../i18n';
import '../taxonomy-editor.css';

export interface SeriesClassificationValues {
  genres:string[];themes:string[];format:string|null;creation_type:string;
}
interface FieldAccessibility {
  id:string;name:string;'aria-invalid':boolean;'aria-describedby':string;'aria-errormessage'?:string;
}
interface Props {
  value:SeriesClassificationValues;
  onChange:(update:Partial<SeriesClassificationValues>)=>void;
  accessibility:(field:SeriesField)=>FieldAccessibility;
  fieldError:(field:SeriesField)=>ReactNode;
}

export function SeriesClassificationFields({value,onChange,accessibility,fieldError}:Props){
  const{t}=useI18n();const label=(key:string)=>t(key as Key);
  // An older Animation genre remains editable until the creator chooses to remove it.
  const genres=[...STANDARD_GENRES,...value.genres.filter(genre=>genre==='animation')];
  return <div className="taxonomy-fields">
    <div className="field">
      <span id="series-genres-label">{t('genres')} <small>({value.genres.length}/{SERIES_LIMITS.genresMax})</small></span>
      <div {...accessibility('genres')} className="genre-options taxonomy-options" role="group" aria-labelledby="series-genres-label">
        {genres.map(genre=>{const selected=value.genres.includes(genre);return <button type="button" key={genre} className={selected?'active':''} aria-pressed={selected} disabled={!selected&&value.genres.length>=SERIES_LIMITS.genresMax} onClick={()=>onChange({genres:selected?value.genres.filter(item=>item!==genre):[...value.genres,genre]})}>{selected&&<Check size={12}/>} {label(`genre_${genre}`)}</button>;})}
      </div>
      <small id="series-genres-hint">{t('seriesGenreHint')}</small>{fieldError('genres')}
    </div>
    <div className="field">
      <span id="series-themes-label">{label('taxonomyStoryThemes')} <small>({value.themes.length}/{MAX_STORY_THEMES})</small></span>
      <div {...accessibility('themes')} className="genre-options taxonomy-options" role="group" aria-labelledby="series-themes-label">
        {STORY_THEMES.map(theme=>{const selected=value.themes.includes(theme);return <button type="button" key={theme} className={selected?'active':''} aria-pressed={selected} disabled={!selected&&value.themes.length>=MAX_STORY_THEMES} onClick={()=>onChange({themes:selected?value.themes.filter(item=>item!==theme):[...value.themes,theme]})}>{selected&&<Check size={12}/>} {label(`theme_${theme}`)}</button>;})}
      </div>
      <small id="series-themes-hint">{label('taxonomyThemesHint')}</small>{fieldError('themes')}
    </div>
    <label className="field">{label('taxonomyFormat')}
      <select {...accessibility('format')} aria-label={label('taxonomyFormat')} value={value.format||''} onChange={event=>onChange({format:event.target.value||null})}>
        <option value="">{label('taxonomyChooseFormat')}</option>
        {SERIES_FORMATS.map(format=><option key={format} value={format}>{label(`format_${format}`)}</option>)}
      </select>
      <small id="series-format-hint">{label('taxonomyFormatHint')}</small>{fieldError('format')}
    </label>
    <label className="field">{t('creationType')}
      <select {...accessibility('creation_type')} aria-label={t('creationType')} value={value.creation_type} onChange={event=>onChange({creation_type:event.target.value})}>
        {CREATION_TYPES.map(type=><option key={type} value={type}>{t(type)}</option>)}
      </select>
      <small id="series-creation-hint">{t('aiWelcomeBody')}</small>{fieldError('creation_type')}
    </label>
  </div>;
}
