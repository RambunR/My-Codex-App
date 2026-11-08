import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Link} from 'react-router-dom';
import {RefreshCw,House,WifiOff,Upload} from 'lucide-react';
import {useI18n} from '../i18n';
import {getPageRecoveryNotice,isPageReloadBlocked,refreshPage,subscribePageRecovery} from '../page-load-recovery';
import {pageRecoveryMessages} from '../page-recovery-locales';
import '../page-recovery.css';

function useRecoveryState(){
  const notice=useSyncExternalStore(subscribePageRecovery,getPageRecoveryNotice,()=>false);
  const blocked=useSyncExternalStore(subscribePageRecovery,isPageReloadBlocked,()=>false);
  const[online,setOnline]=useState(()=>navigator.onLine);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  return{notice,blocked,online};
}
export function PageRecovery({standalone=false}:{standalone?:boolean}){
  const{locale}=useI18n();const copy=pageRecoveryMessages[locale]||pageRecoveryMessages.en;
  const{blocked,online}=useRecoveryState();
  const heading=useRef<HTMLHeadingElement>(null);useEffect(()=>{heading.current?.focus();},[]);
  return <div className={`page page-recovery${standalone?' page-recovery-standalone':''}`}><section className="page-recovery-card" role="alert">
    <div className="page-recovery-brand"><img src="/icon-192.png" alt=""/><span>LingYing</span></div>
    <span className="page-recovery-symbol" aria-hidden="true">{blocked?<Upload size={28}/>:!online?<WifiOff size={28}/>:<RefreshCw size={28}/>}</span>
    <h1 ref={heading} tabIndex={-1}>{copy.title}</h1><p>{blocked?copy.upload:!online?copy.offline:copy.body}</p>
    <div className="page-recovery-actions"><button type="button" className="button primary" disabled={blocked||!online} onClick={()=>refreshPage()}><RefreshCw size={17}/>{copy.refresh}</button><Link className="button secondary" to="/" aria-disabled={blocked||undefined} onClick={event=>{if(isPageReloadBlocked())event.preventDefault();}}><House size={17}/>{copy.home}</Link></div>
  </section></div>;
}
export function PageRecoveryNotice(){
  const{locale}=useI18n();const copy=pageRecoveryMessages[locale]||pageRecoveryMessages.en;
  const{notice,blocked,online}=useRecoveryState();if(!notice)return null;
  return <aside className="page-recovery-notice" role="status"><Upload size={20} aria-hidden="true"/><p>{blocked?copy.upload:!online?copy.offline:copy.body}</p><button type="button" className="button secondary" disabled={blocked||!online} onClick={()=>refreshPage()}>{copy.refresh}</button></aside>;
}
