import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,Check,Play,Sparkles,Ticket} from 'lucide-react';
import {useI18n} from '../i18n';
import {useApp} from '../context';
import '../pass.css';

export function DramioPassIcon({className='',size=64}:{className?:string;size?:number}){
  const[missing,setMissing]=useState(false);
  return <span className={`dramio-pass-icon ${className}`} style={{width:size,height:size}} aria-hidden="true">
    {!missing?<img src="/dramio-pass.png" alt="" width={size} height={size} onError={()=>setMissing(true)}/>:<span className="dramio-pass-fallback"><Ticket size={size*.72} strokeWidth={1.4}/><Play className="dramio-pass-fallback-play" size={size*.24} fill="currentColor" strokeWidth={0}/><Sparkles className="dramio-pass-fallback-sparkle" size={size*.2}/></span>}
  </span>;
}

export function DramioPassCard(){
  const{user,config}=useApp();const{t,locale}=useI18n();
  if(!user)return null;
  const pass=user.dramio_pass;
  const active=pass?.active??!!user.publisher_active;
  const test=active&&(pass?.test??!!config.paymentsTestMode);
  let purchaseDate='';
  if(active&&pass?.purchased_at){
    const raw=pass.purchased_at.replace(' ','T'),date=new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?raw:raw+'Z');
    if(Number.isFinite(date.getTime()))purchaseDate=new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(date);
  }
  return <section className={`dramio-pass-card ${active?'dramio-pass-owned':'dramio-pass-unowned'}`} aria-labelledby="dramio-pass-title">
    <div className="dramio-pass-card-art"><DramioPassIcon size={104}/></div>
    <div className="dramio-pass-card-copy"><div className="dramio-pass-card-heading"><h2 id="dramio-pass-title">{t('dramioPass')}</h2><span className={`dramio-pass-status ${active?'active':''}`}>{active&&<Check size={12} aria-hidden="true"/>}{t(active?'passActive':'passInactive')}</span>{test&&<span className="dramio-pass-test">{t('passTest')}</span>}</div><p>{t(active?'passOwnedBody':'passInactiveBody')}</p><span className="dramio-pass-benefits">{t('passBenefits')}</span>{test&&<small className="dramio-pass-test-notice">{t('passTestBody')}</small>}{purchaseDate&&<small className="dramio-pass-purchased">{t('passPurchasedOn').replace('{date}',purchaseDate)}</small>}</div>
    <div className="dramio-pass-card-action"><div className="dramio-pass-price"><strong>HK$88</strong><span>{t('passOneTime')}</span></div><Link to="/studio" className={`button ${active?'secondary':'primary'}`}>{t(active?'openStudio':'getDramioPass')}<ArrowUpRight size={16} aria-hidden="true"/></Link></div>
  </section>;
}
