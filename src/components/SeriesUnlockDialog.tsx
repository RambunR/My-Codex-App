import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Check,LockKeyhole,Wallet,ArrowRight,RefreshCw,Sparkles} from 'lucide-react';
import {ApiError,post,useApi} from '../api';
import {useApp} from '../context';
import {useI18n} from '../i18n';
import {Button,Loading,Modal} from '../ui';
import {CoverThumbnail} from './CoverArtwork';
import {seriesTitleClass} from '../series-title';
import {usd,type Series,type User} from '../../shared/config';
import type {SeriesUnlockQuote,SeriesUnlockResult} from '../../shared/series-unlock';
import '../series-unlock.css';

interface Props{
  open:boolean;
  onClose:()=>void;
  series:Series;
  onUnlocked:()=>void;
  returnTo:string;
  portalTarget?:Element;
}

/** Each opening/account/series gets a fresh server quote. A purchase always
 * needs an explicit confirmation of that exact quote; retries never auto-pay. */
export function SeriesUnlockDialog(props:Props){
  const{user}=useApp();
  return props.open&&user?<UnlockSession key={`${props.series.id}:${user.id}`} {...props} user={user}/>:null;
}

function UnlockSession({onClose,series,onUnlocked,returnTo,portalTarget,user}:Props&{user:User}){
  const{t}=useI18n();const{setUser,refreshUser,toast}=useApp();
  const{data:quote,error,loading,refresh,setData:setQuote}=useApi<SeriesUnlockQuote>(`/api/series/${encodeURIComponent(series.id)}/unlock-quote`);
  const[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),[failure,setFailure]=useState(''),[needsTopup,setNeedsTopup]=useState(false);
  const active=useRef(true),inFlight=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const close=()=>{if(!inFlight.current)onClose();};
  const retry=()=>{if(inFlight.current)return;setFailure('');setQuote(undefined);refresh();};
  const purchase=async()=>{
    if(!quote||inFlight.current||loading||quote.series_id!==series.id)return;
    inFlight.current=true;setBusy(true);setFailure('');
    try{
      const result=await post<SeriesUnlockResult&{user:User}>(`/api/series/${encodeURIComponent(series.id)}/unlock-all`,{revision:quote.revision});
      if(!active.current)return;
      setUser(result.user);toast(t('seriesUnlockSuccess'));onClose();onUnlocked();
    }catch(error){
      if(!active.current)return;
      if(error instanceof ApiError&&error.code==='UNLOCK_QUOTE_CHANGED'){
        setChanged(true);setQuote(undefined);refresh();void refreshUser().catch(()=>{});
      }else if(error instanceof ApiError&&error.status===402){
        setNeedsTopup(true);setFailure(t('insufficientFunds'));void refreshUser().catch(()=>{});
      }else setFailure((error as Error).message);
    }finally{inFlight.current=false;if(active.current)setBusy(false);}
  };
  const currentQuote=quote?.series_id===series.id?quote:undefined;
  const insufficient=needsTopup||!!currentQuote&&user.wallet_micros<currentQuote.total_micros;
  const walletUrl=`/wallet?return=${encodeURIComponent(returnTo)}`;
  return <Modal open onClose={close} title={t('seriesUnlockTitle')} portalTarget={portalTarget}>
    <div className="series-unlock-dialog" aria-busy={loading||busy}>
      <div className="unlock-preview"><CoverThumbnail src={series.cover} alt=""/><div><h3 className={seriesTitleClass(series.language)}>{series.title}</h3></div></div>
      {changed&&<p className="series-unlock-quote-change" role="alert">{t('seriesUnlockChanged')}</p>}
      {loading?<div aria-label={t('seriesUnlockLoading')}><Loading/></div>:error?<div className="series-unlock-error" role="alert"><p>{error.message}</p><button className="button secondary" onClick={retry}><RefreshCw size={16}/>{t('seriesUnlockRetry')}</button></div>:currentQuote?<>
        {currentQuote.episode_count>0?<><p className="series-unlock-description">{t('seriesUnlockBody').replace('{count}',String(currentQuote.episode_count))}</p><p className="series-unlock-exclusions">{t('seriesUnlockOwned')}</p></>:<p className="series-unlock-complete" role="status"><Check size={19}/>{t('seriesUnlockAlready')}</p>}
        <div className="checkout-total series-unlock-total"><span>{t('seriesUnlockTotal')}</span><strong>{usd(currentQuote.total_micros)}</strong></div>
        <div className="balance-row series-unlock-wallet"><span><Wallet size={16}/>{t('balance')}</span><span>{usd(user.wallet_micros)}</span></div>
        {currentQuote.episode_count>0&&<p className="series-unlock-scope">{t('seriesUnlockScope')}</p>}
        {currentQuote.episode_count>0&&<div className="revenue-note"><Sparkles size={16}/>{t('creatorShare')}</div>}
        {failure&&<p className="form-error" role="alert">{failure}</p>}
        {currentQuote.episode_count===0?<button className="button secondary wide" onClick={close}>{t('close')}</button>:insufficient?<Link to={walletUrl} className="button primary wide series-unlock-topup" onClick={close}><Wallet size={17}/>{t('insufficientFunds')}<ArrowRight size={17}/></Link>:<Button className="button primary wide series-unlock-confirm" busy={busy} onClick={()=>void purchase()}><LockKeyhole size={17}/>{t('seriesUnlockConfirm')} · {usd(currentQuote.total_micros)}</Button>}
      </>:<Loading/>}
    </div>
  </Modal>;
}
