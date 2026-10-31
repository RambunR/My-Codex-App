import { useEffect,useRef,useState,type ReactNode,type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link,useNavigate,useLocation } from 'react-router-dom';
import { X,Play,Plus,Check,Globe2,Film,Sparkles,ArrowUpRight,Clapperboard,LoaderCircle,ArrowLeft,Search,Eye,Heart } from 'lucide-react';
import { useI18n,languageName } from './i18n';
import { useApp } from './context';
import { post } from './api';
import { LANGUAGES,type Series } from '../shared/config';
import { brandName } from './brand';
import './social.css';

export function Brand({small=false}:{small?:boolean}){const{locale,t}=useI18n();const name=brandName(locale);const split=locale.startsWith('zh')?1:4;return <Link to="/" className={`brand ${small?'brand-small':''}`} aria-label={`${name} · ${t('discover')}`}><img className="brand-image" src="/brand-mark.png?v=lingying-phoenix-05-v1" alt="" width="36" height="36"/><span lang={locale.startsWith('zh')?locale:'en'} dir="ltr"><b>{name.slice(0,split)}</b>{name.slice(split)}<span className="brand-dot">.</span></span></Link>;}
export function Modal({open,onClose,title,children,wide=false}:{open:boolean;onClose:()=>void;title:string;children:ReactNode;wide?:boolean}){
  const{t}=useI18n();
  const ref=useRef<HTMLDivElement>(null);const onCloseRef=useRef(onClose);onCloseRef.current=onClose;
  useEffect(()=>{if(!open)return;const before=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    requestAnimationFrame(()=>ref.current?.querySelector<HTMLElement>('button,input,select,a')?.focus());
    const handle=(e:KeyboardEvent)=>{if(e.key==='Escape')onCloseRef.current();if(e.key==='Tab'){const els=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href],textarea');if(!els?.length)return;const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    document.addEventListener('keydown',handle);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',handle);before?.focus?.();};
  },[open]);
  if(!open)return null;return createPortal(<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={`modal ${wide?'modal-wide':''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={20}/></button></div>{children}</div></div>,document.body);
}
export function LanguagePicker({open,onClose}:{open:boolean;onClose:()=>void}){
  const {locale,setLocale,t}=useI18n();const[query,setQuery]=useState('');
  return <Modal open={open} onClose={onClose} title={t('language')} wide><div className="language-intro"><Globe2/><p>{t('worldBody')}</p></div><div className="search-field"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('language')} aria-label={t('language')}/></div><div className="language-grid">{LANGUAGES.filter(l=>`${l.name} ${l.region}`.toLowerCase().includes(query.toLowerCase())).map(l=><button key={l.code} className={`language-option ${l.code===locale?'selected':''}`} onClick={()=>{setLocale(l.code);onClose();}}><span className="language-flag">{l.flag}</span><span><strong>{l.name}</strong><small>{l.region}</small></span>{l.code===locale&&<Check size={17}/>}</button>)}</div></Modal>;
}
export function Button({busy,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{busy?:boolean}){return <button {...props} disabled={busy||props.disabled}>{busy?<LoaderCircle className="spin" size={17}/>:null}{children}</button>;}
export function PageTitle({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}){return <div className="page-heading"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div>;}
export function Empty({title,body,action,icon='film'}:{title:string;body?:string;action?:ReactNode;icon?:string}){return <div className="empty-state"><span>{icon==='search'?<Search size={27}/>:<Clapperboard size={28}/>}</span><h3>{title}</h3>{body&&<p>{body}</p>}{action}</div>;}
export function Loading(){return <div className="loading-state" role="status"><LoaderCircle className="spin" size={26}/><span>{useI18n().t('loading')}</span></div>;}
export function ErrorState({error,retry}:{error:Error;retry?:()=>void}){const{t}=useI18n();return <Empty title={error.message} action={retry&&<button className="button secondary" onClick={retry}>{t('retry')}</button>}/>;}
export function AuthGate({children}:{children:ReactNode}){const{user,ready}=useApp();const{t}=useI18n();const location=useLocation();if(!ready)return <Loading/>;if(user)return children;return <Empty title={t('guestTitle')} body={t('guestBody')} action={<Link className="button primary" to={`/auth?next=${encodeURIComponent(location.pathname+location.search)}`}>{t('signIn')}<ArrowUpRight size={16}/></Link>}/>;}
export function engagementCount(value:number|undefined,locale:string,compact=true){const count=Math.max(0,Math.floor(typeof value==='number'&&Number.isFinite(value)?value:0));return new Intl.NumberFormat(locale,{notation:compact&&count>=1000?'compact':'standard',maximumFractionDigits:1}).format(count);}
export function SeriesEngagement({series,compact=false}:{series:Pick<Series,'views'|'likes'>;compact?:boolean}){
  const{locale,t}=useI18n();
  return <div className={`series-engagement ${compact?'series-engagement-compact':''}`}><span title={`${engagementCount(series.views,locale,false)} ${t('views')}`}><Eye size={compact?12:16} aria-hidden="true"/><span>{engagementCount(series.views,locale)} <span className="engagement-label">{t('views')}</span></span></span><span title={`${engagementCount(series.likes,locale,false)} ${t('likes')}`}><Heart size={compact?12:16} aria-hidden="true"/><span>{engagementCount(series.likes,locale)} <span className="engagement-label">{t('likes')}</span></span></span></div>;
}
export function SeriesCard({series,rank,compact=false}:{series:Series;rank?:number;compact?:boolean}){
  const {t}=useI18n();const{user,toast}=useApp();const navigate=useNavigate();const[saved,setSaved]=useState(series.saved||false);const[busy,setBusy]=useState(false);
  const save=async(e:React.MouseEvent)=>{e.preventDefault();e.stopPropagation();if(!user){navigate('/auth?next=/library');return;}setBusy(true);try{const d=await post(`/api/series/${series.id}/save`);setSaved(d.saved);toast(t(d.saved?'saved':'save'));}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}};
  return <article className={`series-card ${compact?'series-compact':''}`}><Link to={`/series/${series.id}`} className="poster-link"><div className={`poster poster-${series.genres[0]}`}><img src={series.cover} alt={series.title} loading="lazy"/><div className="poster-shade"/>{rank&&<span className="rank-number">{String(rank).padStart(2,'0')}</span>}<span className={`poster-badge ${series.creation_type==='human'?'badge-original':''}`}>{series.creation_type==='human'?<Film size={10}/>:<Sparkles size={10}/>} {series.creation_type==='human'?t('originals'):t('aiStories')}</span><div className="poster-film-title"><span>LingYing Selects</span><strong>{series.title}</strong><i>{languageName(series.language)}</i></div><div className="poster-play"><Play size={22} fill="currentColor"/></div><span className="poster-episodes">{series.episode_count} {t('episodes')}</span></div></Link><button className={`poster-save ${saved?'is-saved':''}`} disabled={busy} aria-label={`${t(saved?'saved':'save')}: ${series.title}`} onClick={save}>{saved?<Check size={15}/>:<Plus size={17}/>}</button><div className="series-card-info"><Link to={`/series/${series.id}`}><h3>{series.title}</h3></Link><p><span>{t(series.genres[0] as any)}</span><i/> <span>{languageName(series.language)}</span></p><SeriesEngagement series={series} compact/></div></article>;
}
export function SectionHeading({title,link,description,children}:{title:string;link?:string;description?:string;children?:ReactNode}){const{t}=useI18n();return <div className="section-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{children}{link&&<Link to={link}>{t('viewAll')}<ArrowUpRight size={15}/></Link>}</div>;}
export function Avatar({name,size='normal'}:{name:string;size?:string}){return <span className={`avatar avatar-${size}`}>{name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase()}</span>;}
export function BackLink({to,label}:{to?:string;label?:string}){const navigate=useNavigate();const{t}=useI18n();return <button className="back-link" onClick={()=>to?navigate(to):navigate(-1)}><ArrowLeft size={16}/>{label||t('back')}</button>;}
