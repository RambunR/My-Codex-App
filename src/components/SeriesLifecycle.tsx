import {seriesTitleClass} from '../series-title';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Eye,EyeOff,Trash2,AlertTriangle,RefreshCw} from 'lucide-react';
import {api,post,ApiError} from '../api';
import {useApp} from '../context';
import {useI18n} from '../i18n';
import {Button,Loading,Modal} from '../ui';
import {bytes} from '../../shared/config';
import '../series-lifecycle.css';

interface LifecycleSeries {id:string;title:string;status:string;taken_down?:boolean;language?:string}
interface DeletionPreview {
  series:LifecycleSeries;
  summary:{episode_count:number;views:number;likes:number;paid_unlocks:number;paid_viewers:number;real_paid_unlocks:number;test_paid_unlocks:number;real_paid_viewers:number;test_paid_viewers:number;affected_paid_viewers:number;total_watch_seconds:number;avg_watch_seconds:number;media_bytes:number;financial_mode:'test'|'live'};
  confirmation_token:string;
  expires_at:string|number;
}
interface DeletionResult {ok:boolean;deleted:boolean;cleanup_pending:boolean;released_bytes:number}
type Action='hide'|'show'|'delete';
const expiredCodes=new Set(['DELETION_CONFIRMATION_INVALID','DELETION_CONFIRMATION_STALE']);
function duration(seconds:number){const value=Math.max(0,Math.round(seconds||0)),h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=String(value%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;}

export function SeriesLifecycle({series,disabled=false,onCompleted,onOpenChange}:{series:LifecycleSeries;disabled?:boolean;onCompleted:(action:Action)=>void|Promise<void>;onOpenChange?:(open:boolean)=>void}){
  const{t,locale}=useI18n();const{user,toast,refreshUser}=useApp();
  const[action,setAction]=useState<Action|null>(null);const[preview,setPreview]=useState<DeletionPreview|null>(null);const[loading,setLoading]=useState(false);const[mutating,setMutating]=useState(false);const[failure,setFailure]=useState('');const[expired,setExpired]=useState(false);const[titleInput,setTitleInput]=useState('');const[acknowledged,setAcknowledged]=useState(false);
  const generation=useRef(0),request=useRef<AbortController|null>(null),mutationBusy=useRef(false),openChange=useRef(onOpenChange);openChange.current=onOpenChange;
  useEffect(()=>()=>{generation.current++;request.current?.abort();openChange.current?.(false);},[series.id]);
  const blocked=disabled||!!user?.payment_review||!!series.taken_down&&user?.role!=='admin';
  const count=(value:number)=>new Intl.NumberFormat(locale).format(Math.max(0,Math.floor(value||0)));
  const close=()=>{if(mutationBusy.current)return;generation.current++;request.current?.abort();request.current=null;setAction(null);setPreview(null);setLoading(false);setFailure('');setExpired(false);setTitleInput('');setAcknowledged(false);openChange.current?.(false);};
  const loadPreview=async()=>{
    if(mutationBusy.current||blocked)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;const current=++generation.current;
    setAction('delete');openChange.current?.(true);setPreview(null);setTitleInput('');setAcknowledged(false);setFailure('');setExpired(false);setLoading(true);
    try{
      const result=await api<DeletionPreview>(`/api/studio/series/${encodeURIComponent(series.id)}/lifecycle`,{signal:controller.signal});
      const metrics=['episode_count','views','likes','real_paid_unlocks','test_paid_unlocks','real_paid_viewers','test_paid_viewers','affected_paid_viewers','total_watch_seconds','avg_watch_seconds','media_bytes'] as const;
      if(result?.series?.id!==series.id||typeof result.series.title!=='string'||!result.series.title||typeof result.confirmation_token!=='string'||!result.confirmation_token||!metrics.every(key=>Number.isFinite(result.summary?.[key])&&result.summary[key]>=0))throw new Error(t('seriesDeleteExpired'));
      if(current===generation.current)setPreview(result);
    }
    catch(error){if(current===generation.current&&!controller.signal.aborted)setFailure(error instanceof Error?error.message:t('failed'));}
    finally{if(current===generation.current){setLoading(false);request.current=null;}}
  };
  const open=(next:Action)=>{if(blocked||mutationBusy.current)return;if(next==='delete'){void loadPreview();return;}generation.current++;request.current?.abort();setAction(next);setFailure('');setPreview(null);openChange.current?.(true);};
  const confirm=async(event?:FormEvent)=>{
    event?.preventDefault();if(!action||blocked||mutationBusy.current||loading)return;
    if(action==='delete'&&(!preview||expired||titleInput!==preview.series.title||!acknowledged))return;
    mutationBusy.current=true;setMutating(true);setFailure('');const current=generation.current;const chosen=action;
    try{
      let pending=false;
      if(chosen==='delete'){
        const result=await api<DeletionResult>(`/api/studio/series/${encodeURIComponent(series.id)}`,{method:'DELETE',body:JSON.stringify({confirmation_token:preview!.confirmation_token,confirm_title:titleInput,acknowledge:true})});pending=result.cleanup_pending;
      }else await post(`/api/studio/series/${encodeURIComponent(series.id)}/status`,{status:chosen==='hide'?'archived':'published'});
      if(current!==generation.current)return;
      setAction(null);openChange.current?.(false);toast(t(chosen==='delete'?'seriesDeletedSuccess':chosen==='hide'?'seriesHiddenSuccess':'publishedSuccess'));if(pending)toast(t('seriesCleanupPending'));
      // The refreshed account owns quota accounting; hiding/deleting never
      // fabricates local storage credit or changes a financial balance.
      await onCompleted(chosen);
      // A failed account refresh must not turn an already committed deletion
      // into a misleading failure or leave the deleted series open in Studio.
      if(chosen==='delete')await refreshUser().catch(()=>{});
    }catch(error){
      if(current!==generation.current)return;
      if(error instanceof ApiError&&expiredCodes.has(error.code)){setExpired(true);setAcknowledged(false);setFailure(t('seriesDeleteExpired'));}
      else setFailure(error instanceof Error?error.message:t('failed'));
    }finally{mutationBusy.current=false;if(current===generation.current)setMutating(false);}
  };
  const canDelete=!!preview&&!expired&&titleInput===preview.series.title&&acknowledged&&!loading&&!mutating&&!blocked;
  return <div className="series-lifecycle-actions" data-series-id={series.id}>
    {series.status==='published'&&!series.taken_down&&<button type="button" className="button secondary small" disabled={blocked||mutating} onClick={()=>open('hide')} aria-label={`${t('seriesHide')}: ${series.title}`}><EyeOff size={15}/>{t('seriesHide')}</button>}
    {series.status==='archived'&&!series.taken_down&&<button type="button" className="button secondary small" disabled={blocked||mutating} onClick={()=>open('show')} aria-label={`${t('seriesShow')}: ${series.title}`}><Eye size={15}/>{t('seriesShow')}</button>}
    <button type="button" className="button ghost small danger-text" disabled={blocked||mutating} onClick={()=>open('delete')} aria-label={`${t('seriesDelete')}: ${series.title}`}><Trash2 size={15}/>{t('seriesDelete')}</button>
    <Modal open={!!action} onClose={close} title={t(action==='delete'?'seriesDeleteTitle':action==='hide'?'seriesHideTitle':'seriesShowTitle')}>
      <div className={`series-lifecycle-dialog ${action==='delete'?'is-deleting':''}`}>
        {action==='delete'?<>
          <p className="series-delete-warning"><AlertTriangle size={21} aria-hidden="true"/><strong>{t('seriesDeleteWarning')}</strong></p>
          {loading?<Loading/>:preview&&<>
            <h3 className={`series-delete-name ${seriesTitleClass(series.language)||''}`}>{preview.series.title}</h3>
            <section className="series-delete-statistics" aria-label={t('seriesDeleteSnapshot')}><h3>{t('seriesDeleteSnapshot')}</h3><dl>
              <div className="series-delete-affected" data-metric="affected_paid_viewers"><dt>{t('seriesDeleteAffectedPaidViewers')}</dt><dd>{count(preview.summary.affected_paid_viewers)}</dd></div>{([['episode_count','seriesDeleteEpisodes'],['views','seriesDeleteViews'],['likes','seriesDeleteLikes'],['real_paid_viewers','seriesDeleteRealPaidViewers'],['test_paid_viewers','seriesDeleteTestPaidViewers'],['real_paid_unlocks','seriesDeleteRealUnlocks'],['test_paid_unlocks','seriesDeleteTestUnlocks']] as const).map(([key,label])=><div key={key} data-metric={key}><dt>{t(label)}</dt><dd>{count(preview.summary[key])}</dd></div>)}
              <div data-metric="total_watch_seconds"><dt>{t('seriesDeleteWatchTime')}</dt><dd><bdi>{duration(preview.summary.total_watch_seconds)}</bdi></dd></div><div data-metric="avg_watch_seconds"><dt>{t('seriesDeleteAverage')}</dt><dd><bdi>{duration(preview.summary.avg_watch_seconds)}</bdi></dd></div><div data-metric="media_bytes"><dt>{t('seriesDeleteStorage')}</dt><dd>{bytes(preview.summary.media_bytes)}</dd></div>
            </dl></section>
            <p className="series-delete-financial field-hint">{t('seriesDeleteFinancial')}</p>
            <form className="series-delete-form" onSubmit={confirm}>
              <label className="field" htmlFor={`delete-title-${series.id}`}>{t('seriesDeleteType')}<input id={`delete-title-${series.id}`} className={`series-delete-title-input ${seriesTitleClass(series.language)||''}`} aria-label={t('seriesDeleteType')} value={titleInput} onChange={event=>setTitleInput(event.target.value)} autoComplete="off" spellCheck={false} maxLength={120} disabled={mutating||expired} required aria-describedby={`delete-confirm-name-${series.id}`}/><small id={`delete-confirm-name-${series.id}`} className={`series-delete-required-name ${seriesTitleClass(series.language)||''}`}>{preview.series.title}</small></label>
              <label className="checkbox-label series-delete-ack"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={mutating||expired} required/><span>{t('seriesDeleteAcknowledge')}</span></label>
              <Button type="submit" className="button series-delete-submit wide" busy={mutating} disabled={!canDelete}><Trash2 size={16}/>{t('seriesDeleteConfirm')}</Button>
            </form>
          </>}
          {failure&&<p className="form-error" role="alert">{failure}</p>}
          {!loading&&(expired||!preview)&&<button type="button" className="button secondary wide series-delete-reload" onClick={()=>void loadPreview()} disabled={mutating}><RefreshCw size={16}/>{t('seriesDeleteReload')}</button>}
        </>:<><h3 className={`series-delete-name ${seriesTitleClass(series.language)||''}`}>{series.title}</h3><p className="muted">{t(action==='hide'?'seriesHideBody':'seriesShowBody')}</p>{failure&&<p className="form-error" role="alert">{failure}</p>}<Button type="button" className="button primary wide" busy={mutating} disabled={blocked} onClick={()=>void confirm()}>{action==='hide'?<EyeOff size={16}/>:<Eye size={16}/>} {t(action==='hide'?'seriesHideConfirm':'seriesShowConfirm')}</Button></>}
        <button type="button" className="button ghost wide" onClick={close} disabled={mutating}>{t('cancel')}</button>
      </div>
    </Modal>
  </div>;
}
