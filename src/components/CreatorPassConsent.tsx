import {useId,type RefObject} from 'react';
import {Link} from 'react-router-dom';
import {useI18n} from '../i18n';
import {creatorPassConsentEnglish,creatorPassConsentMessages} from '../creator-pass-consent-locales';
import '../creator-pass-consent.css';

export function CreatorPassConsent({checked,onChange,disabled=false,invalid=false,changed=false,inputRef,reloadRef}:{checked:boolean;onChange:(checked:boolean)=>void;disabled?:boolean;invalid?:boolean;changed?:boolean;inputRef?:RefObject<HTMLInputElement|null>;reloadRef?:RefObject<HTMLButtonElement|null>}){
  const{t,locale}=useI18n();const id=useId();
  const copy=creatorPassConsentMessages[locale]||creatorPassConsentEnglish;
  const policyLink=(token:string,index:number)=>token==='{terms}'?<Link key={index} to="/terms#creator-pass" target="_blank" rel="noopener noreferrer">{t('terms')}</Link>:token==='{privacy}'?<Link key={index} to="/privacy" target="_blank" rel="noopener noreferrer">{t('privacy')}</Link>:token;
  return <div className="creator-pass-consent">
    <div className="creator-pass-consent-row">
      <input ref={inputRef} id={id} name="creator_pass_consent" type="checkbox" checked={checked} onChange={event=>onChange(event.target.checked)} disabled={disabled||changed} required aria-invalid={invalid||changed||undefined} aria-describedby={invalid||changed?`${id}-error`:undefined}/>
      <label htmlFor={id}>{copy.creatorPassConsentLabel.split(/(\{terms\}|\{privacy\})/g).map(policyLink)}<span className="creator-pass-consent-risk">{copy.creatorPassConsentRisk}</span></label>
    </div>
    {(invalid||changed)&&<p id={`${id}-error`} className="creator-pass-consent-error" role="alert">{changed?copy.creatorPassConsentChanged:copy.creatorPassConsentRequired}</p>}
    {changed&&<button ref={reloadRef} type="button" className="button secondary creator-pass-consent-reload" onClick={()=>window.location.reload()}>{copy.creatorPassConsentReload}</button>}
  </div>;
}
