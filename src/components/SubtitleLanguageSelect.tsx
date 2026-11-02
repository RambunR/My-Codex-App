import {useId,useRef,useState} from 'react';
import {ChevronDown,Languages,X} from 'lucide-react';
import {LANGUAGES} from '../../shared/config';
import {useI18n} from '../i18n';
import '../subtitle-language-select.css';

export function SubtitleLanguageSelect({value,onChange,disabled=false}:{value:string[];onChange:(languages:string[])=>void;disabled?:boolean}){
  const{t,locale}=useI18n(),id=useId(),toggle=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false);
  const selected=LANGUAGES.filter(language=>value.includes(language.code));
  const summary=selected.length?t('subtitleLanguagesSelected').replace('{count}',new Intl.NumberFormat(locale).format(selected.length)):t('subtitleLanguagesNone');
  const change=(code:string,checked:boolean)=>{if(disabled)return;const next=new Set(value);if(checked)next.add(code);else next.delete(code);onChange(LANGUAGES.filter(language=>next.has(language.code)).map(language=>language.code));};
  return <fieldset className="subtitle-language-select" disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend id={`${id}-label`}>{t('subtitleLanguages')}</legend><p className="field-hint subtitle-language-hint" id={`${id}-hint`}>{t('subtitleLanguagesHint')}</p>
    <button ref={toggle} className="subtitle-language-toggle" type="button" aria-label={t('subtitleLanguagesChoose')} aria-expanded={open} aria-controls={`${id}-choices`} aria-describedby={`${id}-summary`} onClick={()=>setOpen(value=>!value)}><Languages size={17} aria-hidden="true"/><span id={`${id}-summary`} aria-live="polite">{summary}</span><ChevronDown className={open?'is-open':''} size={18} aria-hidden="true"/></button>
    {selected.length>0&&<div className="subtitle-language-selection"><ul className="subtitle-language-chips" aria-label={t('subtitleLanguages')}>{selected.map(language=><li key={language.code} lang={language.code}>{language.name}</li>)}</ul><button className="subtitle-language-clear" type="button" onClick={()=>!disabled&&onChange([])}><X size={14} aria-hidden="true"/>{t('subtitleLanguagesClear')}</button></div>}
    {open&&<div className="subtitle-language-choices" id={`${id}-choices`} role="group" aria-labelledby={`${id}-label`} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);toggle.current?.focus();}}}>{LANGUAGES.map(language=><label className="subtitle-language-option" key={language.code}><input type="checkbox" value={language.code} checked={value.includes(language.code)} onChange={event=>change(language.code,event.target.checked)} aria-label={language.name}/><span><strong lang={language.code}>{language.name}</strong><small>{language.region}</small></span></label>)}</div>}
  </fieldset>;
}
