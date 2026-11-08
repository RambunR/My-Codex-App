import {useCallback,useEffect,useRef,useState} from 'react';
import {useBlocker,type BlockerFunction} from 'react-router-dom';
import {LoaderCircle,Upload} from 'lucide-react';
import {Modal} from './ui';
import {useI18n} from './i18n';
import './upload-leave-warning.css';
import {notifyPageReloadSafety,registerPageReloadBlocker} from './page-load-recovery';

interface UploadLeaveState{
  active:boolean;
  isActive:()=>boolean;
  stop:()=>Promise<void>;
  reading:boolean;
  completed:number;
  total:number;
  current?:{name:string;progress:number;processing:boolean};
}

/** Router blocking covers links, navigate() and Back/Forward. Full-document
 * exits use the browser's native warning; its wording belongs to the browser. */
export function useUploadLeaveGuard(state:UploadLeaveState){
  const{t,locale}=useI18n();const latest=useRef(state);latest.current=state;
  const installed=useRef(false),confirming=useRef(false),keep=useRef<HTMLButtonElement>(null);const[stopping,setStopping]=useState(false);
  const beforeUnload=useCallback((event:BeforeUnloadEvent)=>{
    if(!latest.current.isActive())return;event.preventDefault();event.returnValue='';
  },[]);
  const syncProtection=useCallback(()=>{
    const active=latest.current.isActive();
    if(active&&!installed.current){window.addEventListener('beforeunload',beforeUnload);installed.current=true;}
    else if(!active&&installed.current){window.removeEventListener('beforeunload',beforeUnload);installed.current=false;}
    notifyPageReloadSafety();
  },[beforeUnload]);
  const blocker=useBlocker(useCallback<BlockerFunction>(({currentLocation,nextLocation})=>currentLocation.pathname!==nextLocation.pathname&&latest.current.isActive(),[]));
  useEffect(()=>{syncProtection();},[state.active,syncProtection]);
  useEffect(()=>registerPageReloadBlocker(()=>latest.current.isActive()),[]);
  useEffect(()=>()=>{if(installed.current)window.removeEventListener('beforeunload',beforeUnload);installed.current=false;},[beforeUnload]);
  useEffect(()=>{
    if(blocker.state!=='blocked'&&confirming.current){confirming.current=false;setStopping(false);}
    if(blocker.state==='blocked'&&!confirming.current&&!latest.current.isActive())blocker.reset();
  },[blocker,state.active]);
  const stay=()=>{if(!confirming.current&&blocker.state==='blocked')blocker.reset();};
  const leave=async()=>{
    if(confirming.current||blocker.state!=='blocked')return;
    confirming.current=true;setStopping(true);const proceed=blocker.proceed;
    try{
      const cancellation=latest.current.stop();syncProtection();await cancellation;proceed();
    }catch{confirming.current=false;setStopping(false);blocker.reset();}
  };
  const number=(value:number)=>new Intl.NumberFormat(locale).format(value);
  const progress=state.total>0?Math.min(100,(state.completed+(state.current?.progress||0)/100)/state.total*100):0;
  const dialog=<Modal open={blocker.state==='blocked'} onClose={stay} title={t('uploadLeaveTitle')} initialFocusRef={keep}><div className="upload-leave-warning">
    <div className="upload-leave-brand"><img src="/icon-192.png?v=lingying-phoenix-05-v1" alt="" aria-hidden="true"/><span>LingYing</span></div>
    <span className="upload-leave-symbol" aria-hidden="true">{stopping?<LoaderCircle size={29} className="spin"/>:<Upload size={29}/>}</span>
    <p className="upload-leave-body">{t('uploadLeaveBody')}</p>
    <div className="upload-leave-progress" role="status" aria-live="polite">
      <strong>{stopping?t('uploadLeaveStopping'):state.reading?t('uploadLeaveReading'):t('uploadLeaveProgress').replace('{completed}',number(state.completed)).replace('{total}',number(state.total))}</strong>
      {!state.reading&&<div className="progress-line"><span style={{width:`${progress}%`}}/></div>}
      {state.current&&!state.reading&&<small>{t('uploadLeaveCurrent').replace('{name}',state.current.name)} · {t(state.current.processing?'processing':'uploading')}</small>}
    </div>
    <div className="upload-leave-actions"><button ref={keep} className="button primary upload-leave-keep" type="button" disabled={stopping} onClick={stay}>{t('uploadLeaveKeep')}</button><button className="button secondary upload-leave-stop" type="button" disabled={stopping} onClick={()=>void leave()}>{t('uploadLeaveStop')}</button></div>
  </div></Modal>;
  return{dialog,syncProtection};
}
