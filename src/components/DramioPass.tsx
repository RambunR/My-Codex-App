import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,Check,Clapperboard,Play,ShieldCheck,Sparkles,Ticket,Upload} from 'lucide-react';
import {useI18n,type Key} from '../i18n';
import {useApp} from '../context';
import {usePassPrice} from '../usePassPrice';
import '../pass.css';
import '../account-access.css';
import '../pass-promotion.css';

export function DramioPassIcon({className='',size=64}:{className?:string;size?:number}){
  const[missing,setMissing]=useState(false);
  return <span className={`dramio-pass-icon ${className}`} style={{width:size,height:size}} aria-hidden="true">
    {!missing?<img src="/dramio-pass.png" alt="" width={size} height={size} onError={()=>setMissing(true)}/>:<span className="dramio-pass-fallback"><Ticket size={size*.72} strokeWidth={1.4}/><Play className="dramio-pass-fallback-play" size={size*.24} fill="currentColor" strokeWidth={0}/><Sparkles className="dramio-pass-fallback-sparkle" size={size*.2}/></span>}
  </span>;
}

export function DramioPassCard(){
  const{user,config}=useApp();const{t,locale}=useI18n();
  const passPrice=usePassPrice();
  if(!user)return null;
  const pass=user.dramio_pass;
  const active=pass?.active??!!user.publisher_active;
  const price=passPrice((config.limits.activationHkd||88)*100);
  const billing=t('passPromoBilling').replace('{hkd}',`HK$${(config.limits.activationHkd||88).toFixed(2)}`);
  const administrator=user.role==='admin';
  const adminAccess=administrator?<AdminUploadAccess canUpload={!user.payment_review&&config.uploadsEnabled!==false} held={!!user.payment_review}/>:null;
  if(administrator&&!active)return adminAccess;
  const test=active&&(pass?.test??!!config.paymentsTestMode);
  let purchaseDate='';
  if(active&&pass?.purchased_at){
    const raw=pass.purchased_at.replace(' ','T'),date=new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?raw:raw+'Z');
    if(Number.isFinite(date.getTime()))purchaseDate=new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(date);
  }
  return <>{adminAccess}<section className={`dramio-pass-card ${active?'dramio-pass-owned':'dramio-pass-unowned'}`} aria-labelledby="dramio-pass-title">
    <div className="dramio-pass-card-art"><DramioPassIcon size={104}/></div>
    <div className="dramio-pass-card-copy"><div className="dramio-pass-card-heading"><h2 id="dramio-pass-title">{t('dramioPass')}</h2><span className={`dramio-pass-status ${active?'active':''}`}>{active&&<Check size={12} aria-hidden="true"/>}{t(active?'passActive':'passInactive')}</span>{test&&<span className="dramio-pass-test">{t('passTest')}</span>}</div><p>{t(active?'passOwnedBody':'passInactiveBody')}</p><span className="dramio-pass-benefits">{t('passBenefits')} <span className="creator-share-fee-note">{t('creatorShareFeeNote')}</span></span><small className="provider-fee-estimate-note">{t('providerFeeEstimateNote')}</small>{test&&<small className="dramio-pass-test-notice">{t('passTestBody')}</small>}{purchaseDate&&<small className="dramio-pass-purchased">{t('passPurchasedOn').replace('{date}',purchaseDate)}</small>}</div>
    <div className="dramio-pass-card-action"><div className="dramio-pass-price">{active?<strong>{t('passActivated')}</strong>:<strong dir="ltr" data-currency={price.currency}>{price.text}</strong>}<span>{t('passOneTime')}</span>{!active&&<small className="dramio-pass-billing-note">{billing}</small>}</div><Link to="/studio" className={`button ${active?'secondary':'primary'}`}>{t(active?'openStudio':'getDramioPass')}<ArrowUpRight size={16} aria-hidden="true"/></Link></div>
  </section></>;
}

function AdminUploadAccess({canUpload,held}:{canUpload:boolean;held:boolean}){
  const{t}=useI18n();
  const label=(key:string)=>t(key as Key);
  return <section className="admin-account-access" data-role="admin" data-upload-status={canUpload?'enabled':held?'held':'disabled'} aria-labelledby="admin-account-access-title">
    <span className="admin-account-access-icon" aria-hidden="true"><ShieldCheck size={43} strokeWidth={1.4}/><Sparkles size={17}/></span>
    <div className="admin-account-access-copy">
      <div className="admin-account-access-heading"><h2 id="admin-account-access-title">{label('adminAccessTitle')}</h2><span className={`admin-account-upload-status ${canUpload?'is-enabled':'is-paused'}`} role="status">{canUpload?<Check size={13} aria-hidden="true"/>:<ShieldCheck size={13} aria-hidden="true"/>}{label(canUpload?'adminUploadEnabled':'adminUploadHeld')}</span></div>
      <p>{label('adminUploadIncluded')} {t('adminUnlimitedStorageBody')}</p>
      <div className="admin-account-actions"><Link className="button secondary" to="/admin?tab=content"><ShieldCheck size={16} aria-hidden="true"/>{label('adminOpenContent')}<ArrowUpRight size={15} aria-hidden="true"/></Link><Link className="button secondary" to="/studio"><Clapperboard size={16} aria-hidden="true"/>{label('adminOpenStudio')}<ArrowUpRight size={15} aria-hidden="true"/></Link>{canUpload?<Link className="button primary" to="/studio/new"><Upload size={16} aria-hidden="true"/>{label('adminUploadDrama')}<ArrowUpRight size={15} aria-hidden="true"/></Link>:<button className="button primary" type="button" disabled><Upload size={16} aria-hidden="true"/>{label('adminUploadDrama')}</button>}</div>
    </div>
  </section>;
}
