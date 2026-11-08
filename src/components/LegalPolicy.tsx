import {useEffect} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {Mail} from 'lucide-react';
import {useI18n} from '../i18n';
import {PageTitle} from '../ui';
import {COMPANY_NAME,CONTACT_EMAIL,CONTACT_HREF} from '../company';
import {LEGAL_POLICY_VERSION,LEGAL_POLICY_EFFECTIVE_DATE,legalPolicyContent,type LegalLocale,type LegalPolicyType} from '../legal-policy-content';
import '../legal-policy.css';

export function LegalPolicy({type}:{type:LegalPolicyType}){
  const{locale,setLocale}=useI18n();
  const{hash}=useLocation();
  const language:LegalLocale=locale==='zh-TW'||locale==='zh-CN'?locale:'en';
  const copy=legalPolicyContent[language],documentCopy=copy[type];
  useEffect(()=>{
    let id:string;try{id=decodeURIComponent(hash.slice(1));}catch{return;}
    const frame=requestAnimationFrame(()=>{if(id)document.getElementById(id)?.scrollIntoView({block:'start'});else window.scrollTo(0,0);});
    return()=>cancelAnimationFrame(frame);
  },[type,language,hash]);
  return <div className="page info-page legal-policy-page" lang={language} dir="ltr" data-policy-version={LEGAL_POLICY_VERSION}>
    <PageTitle eyebrow="LingYing" title={documentCopy.title} description={documentCopy.intro}/>
    <div className="legal-policy-meta"><p className="legal-effective-date">{copy.effective}: <time dateTime={LEGAL_POLICY_EFFECTIVE_DATE}>{copy.date}</time><span>{copy.version}: {LEGAL_POLICY_VERSION}</span></p>
      <nav className="legal-language-options" aria-label={copy.languages}>{([['en','English'],['zh-TW','繁體中文'],['zh-CN','简体中文']] as const).map(([code,label])=><button key={code} type="button" lang={code} aria-pressed={language===code} onClick={()=>setLocale(code)}>{label}</button>)}</nav>
    </div>
    {locale!==language&&<p className="legal-language-notice" role="note">{copy.fallback}</p>}
    <section className="panel company-contact legal-company-contact" aria-labelledby="legal-company-heading"><h2 id="legal-company-heading">{COMPANY_NAME}</h2><address><a href={CONTACT_HREF}><Mail size={18} aria-hidden="true"/>{CONTACT_EMAIL}</a></address></section>
    <section className="panel legal-summary" aria-labelledby="legal-summary-heading"><h2 id="legal-summary-heading">{copy.summary}</h2><ul>{documentCopy.summary.map(point=><li key={point}>{point}</li>)}</ul></section>
    <nav className="panel legal-toc" aria-labelledby="legal-toc-heading"><h2 id="legal-toc-heading">{copy.contents}</h2><ol>{documentCopy.sections.map(section=><li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
    <div className="info-sections legal-policy-sections">{documentCopy.sections.map(section=><section className="panel legal-section" key={section.id} id={section.id} tabIndex={-1} aria-labelledby={`${section.id}-heading`}><h2 id={`${section.id}-heading`}>{section.title}</h2>{section.paragraphs.map(paragraph=><p key={paragraph}>{paragraph}</p>)}{section.items&&<ul>{section.items.map(item=><li key={item}>{item}</li>)}</ul>}{section.contact&&<a className="legal-contact-link" href={CONTACT_HREF}>{copy.contact}: {CONTACT_EMAIL}</a>}</section>)}</div>
    <nav className="legal-related-policies" aria-label={copy.related}><Link to={type==='terms'?'/privacy':'/terms'}>{copy[type==='terms'?'privacy':'terms'].title}</Link><a href={CONTACT_HREF}>{copy.contact}</a></nav>
  </div>;
}
