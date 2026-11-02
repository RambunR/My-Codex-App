import {useEffect,useRef,useState,type FormEvent,type DragEvent,type PointerEvent} from 'react';
import {ArrowDown,ArrowUp,GripVertical,Check,RefreshCw,Pencil,Trash2,Play,AlertTriangle} from 'lucide-react';
import {api,post,ApiError} from '../api';
import {useApp} from '../context';
import {useI18n} from '../i18n';
import {Button,Loading,Modal} from '../ui';
import {bytes,usd,type Episode} from '../../shared/config';
import {batchEpisodeTitle,MAX_EPISODE_BATCH_BASE_NAME} from '../../shared/episode-batch';
import '../episode-manager.css';

interface ManagedSeries {id:string;title:string;status:string;free_episodes:number;price_cents:number}
export interface EpisodeMutationResult {ok:boolean;episodes:Episode[];episodes_revision:string;cleanup_pending?:boolean;owner_storage?:{used_bytes:number;quota_bytes:number}}
interface DeletePreview {
  series:{id:string;title:string};
  summary:{episode_count:number;views:number;total_watch_seconds:number;media_bytes:number;real_paid_unlocks:number;test_paid_unlocks:number;paid_episode_count:number};
  confirmation_token:string;expires_at:string;episodes_revision:string;can_delete?:boolean;
}
type Dialog='rename'|'delete'|'order'|null;
const staleCodes=new Set(['EPISODE_BATCH_STALE','EPISODE_BATCH_CONFIRM_INVALID']);
const sameOrder=(a:string[],b:string[])=>a.length===b.length&&a.every((id,index)=>id===b[index]);
const elapsed=(seconds:number)=>{const rounded=Math.max(0,Math.round(seconds));return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}`;};

export function EpisodeManager({series,episodes,revision,disabled=false,canPreview,onPreview,onEdit,onRemove,onChanged,onRefresh,onLockChange}:{
  series:ManagedSeries;episodes:Episode[];revision?:string;disabled?:boolean;canPreview:boolean;
  onPreview:(episode:Episode)=>void;onEdit:(episode:Episode)=>void;onRemove:(episode:Episode)=>void;
  onChanged:(result:EpisodeMutationResult)=>void|Promise<void>;onRefresh:()=>void;onLockChange:(locked:boolean)=>void;
}){
  const{t,locale}=useI18n();const{toast}=useApp();
  const[selected,setSelected]=useState<string[]>([]),[order,setOrder]=useState<string[]|null>(null),[dialog,setDialog]=useState<Dialog>(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[failure,setFailure]=useState(''),[stale,setStale]=useState(false),[preview,setPreview]=useState<DeletePreview|null>(null),[typedTitle,setTypedTitle]=useState(''),[acknowledged,setAcknowledged]=useState(false),[dragging,setDragging]=useState<string|null>(null);
  const generation=useRef(0),mounted=useRef(true),mutation=useRef(false),previewRequest=useRef<AbortController|null>(null),dragId=useRef<string|null>(null),touchPointer=useRef<number|null>(null),lockChange=useRef(onLockChange),previousRevision=useRef(revision);lockChange.current=onLockChange;
  const ids=episodes.map(episode=>episode.id),dirty=!!order&&!sameOrder(order,ids),orderedIds=order&&order.length===ids.length&&order.every(id=>ids.includes(id))?order:ids;
  const byId=new Map(episodes.map(episode=>[episode.id,episode])),shown=orderedIds.map(id=>byId.get(id)!).filter(Boolean),selectedEpisodes=episodes.filter(episode=>selected.includes(episode.id));
  const available=typeof revision==='string'&&/^[a-f0-9]{64}$/.test(revision);
  const blocked=disabled||busy||loading||!available;
  const affected=dirty?shown.filter((episode,index)=>(episode.number<=series.free_episodes)!==(index+1<=series.free_episodes)).length:0;
  const number=(value:number)=>new Intl.NumberFormat(locale).format(value);
  const validName=name.trim().length>0&&name.trim().length<=MAX_EPISODE_BATCH_BASE_NAME;
  const showError=(error:unknown)=>{
    if(error instanceof ApiError&&staleCodes.has(error.code)){setStale(true);setPreview(null);setAcknowledged(false);setFailure(t('episodeBatchStale'));}
    else setFailure(error instanceof Error?error.message:t('failed'));
  };
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;previewRequest.current?.abort();lockChange.current(false);};},[]);
  useEffect(()=>{lockChange.current(!!dialog||dirty||busy);},[dialog,dirty,busy]);
  useEffect(()=>{
    setSelected(previous=>previous.filter(id=>ids.includes(id)));
    if(previousRevision.current&&revision!==previousRevision.current){
      setOrder(null);setDragging(null);dragId.current=null;
      if(dialog){generation.current++;previewRequest.current?.abort();setPreview(null);setStale(true);setAcknowledged(false);setLoading(false);setFailure(t('episodeBatchStale'));}
    }
    previousRevision.current=revision;
  },[revision]);
  useEffect(()=>{
    if(!preview)return;const milliseconds=Date.parse(preview.expires_at)-Date.now();
    const timer=window.setTimeout(()=>{setStale(true);setPreview(null);setAcknowledged(false);setFailure(t('seriesDeleteExpired'));},Math.max(0,Math.min(milliseconds,2_147_483_647)));
    return()=>window.clearTimeout(timer);
  },[preview?.confirmation_token]);
  const close=()=>{if(mutation.current)return;generation.current++;previewRequest.current?.abort();previewRequest.current=null;setDialog(null);setPreview(null);setFailure('');setStale(false);setTypedTitle('');setAcknowledged(false);setLoading(false);};
  const open=(next:Dialog)=>{if(blocked||mutation.current)return;setFailure('');setStale(false);setPreview(null);setTypedTitle('');setAcknowledged(false);setDialog(next);};
  const loadDelete=async()=>{
    if(blocked||mutation.current||!selectedEpisodes.length||dirty)return;
    const current=++generation.current,controller=new AbortController();previewRequest.current?.abort();previewRequest.current=controller;open('delete');setLoading(true);
    try{
      const result=await api<DeletePreview>(`/api/studio/series/${encodeURIComponent(series.id)}/episodes/batch-delete-preview`,{method:'POST',body:JSON.stringify({revision,episode_ids:selectedEpisodes.map(episode=>episode.id)}),signal:controller.signal});
      const metrics=['episode_count','views','total_watch_seconds','media_bytes','real_paid_unlocks','test_paid_unlocks','paid_episode_count'] as const;
      if(result?.series?.id!==series.id||typeof result.series.title!=='string'||result.episodes_revision!==revision||typeof result.confirmation_token!=='string'||!result.confirmation_token||!Number.isFinite(Date.parse(result.expires_at))||result.summary?.episode_count!==selectedEpisodes.length||!metrics.every(key=>Number.isFinite(result.summary?.[key])&&result.summary[key]>=0))throw new Error(t('episodeBatchStale'));
      if(current===generation.current&&mounted.current)setPreview(result);
    }catch(error){if(current===generation.current&&mounted.current&&!controller.signal.aborted)showError(error);}
    finally{if(current===generation.current&&mounted.current){setLoading(false);previewRequest.current=null;}}
  };
  const mutate=async(body:Record<string,unknown>,success:string)=>{
    if(blocked||mutation.current||stale)return;
    mutation.current=true;setBusy(true);setFailure('');const current=generation.current;
    try{
      const result=await post<EpisodeMutationResult>(`/api/studio/series/${encodeURIComponent(series.id)}/episodes/batch`,{revision,...body});
      if(!mounted.current||current!==generation.current)return;
      setDialog(null);setPreview(null);setOrder(null);setSelected([]);setAcknowledged(false);setTypedTitle('');
      await onChanged(result);toast(success);if(result.cleanup_pending)toast(t('seriesCleanupPending'));
    }catch(error){if(mounted.current&&current===generation.current)showError(error);}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  };
  const rename=(event:FormEvent)=>{event.preventDefault();if(!name.trim()||name.trim().length>MAX_EPISODE_BATCH_BASE_NAME||!selectedEpisodes.length)return;void mutate({action:'rename',episode_ids:selectedEpisodes.map(episode=>episode.id),base_name:name.trim()},t('savedSuccess'));};
  const paidProtected=!!preview&&(preview.can_delete===false||preview.summary.paid_episode_count>0||preview.summary.real_paid_unlocks>0||preview.summary.test_paid_unlocks>0);
  const remove=(event:FormEvent)=>{event.preventDefault();if(!preview||paidProtected||typedTitle!==preview.series.title||!acknowledged||stale)return;void mutate({action:'delete',episode_ids:selectedEpisodes.map(episode=>episode.id),confirmation_token:preview.confirmation_token,confirm_title:typedTitle,acknowledge:true},t('savedSuccess'));};
  const reorder=()=>{if(!dirty||affected&&!acknowledged)return;void mutate({action:'reorder',episode_ids:orderedIds,acknowledge_access_change:affected?acknowledged:false},t('episodeOrderChanged'));};
  const move=(episodeId:string,index:number)=>{
    if(blocked||dialog)return;
    setSelected([]);setOrder(previous=>{const next=[...(previous||ids)],from=next.indexOf(episodeId);if(from<0)return previous;next.splice(from,1);next.splice(Math.max(0,Math.min(index,next.length)),0,episodeId);return next;});
  };
  const drop=(event:DragEvent,episodeId:string)=>{if(!dragId.current)return;event.preventDefault();event.stopPropagation();const from=dragId.current;dragId.current=null;setDragging(null);if(from!==episodeId)move(from,orderedIds.indexOf(episodeId));};
  const pointerStart=(event:PointerEvent<HTMLButtonElement>,episodeId:string)=>{if(blocked||dialog||event.pointerType==='mouse')return;event.preventDefault();touchPointer.current=event.pointerId;dragId.current=episodeId;setDragging(episodeId);try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}};
  const pointerMove=(event:PointerEvent<HTMLButtonElement>)=>{
    if(touchPointer.current!==event.pointerId||!dragId.current)return;event.preventDefault();
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('.episode-editor-row[data-episode-id]')?.dataset.episodeId;
    if(target&&orderedIds.includes(target)&&target!==dragId.current)move(dragId.current,orderedIds.indexOf(target));
    if(event.clientY<80)window.scrollBy(0,-16);else if(event.clientY>window.innerHeight-80)window.scrollBy(0,16);
  };
  const pointerEnd=()=>{touchPointer.current=null;dragId.current=null;setDragging(null);};
  const refreshList=()=>{close();setOrder(null);setSelected([]);onRefresh();};
  return <div className="episode-manager">
    <div className="episode-bulk-toolbar">
      <label className="episode-select-all checkbox-label"><input type="checkbox" aria-label={t('episodeSelectAll')} checked={!!episodes.length&&selectedEpisodes.length===episodes.length} disabled={blocked||!!dialog||dirty||!episodes.length} onChange={event=>setSelected(event.target.checked?ids:[])}/><span>{t('episodeSelectAll')}</span></label>
      <span className="episode-selected-count" aria-live="polite">{t('episodeSelectedCount').replace('{count}',number(selectedEpisodes.length))}</span>
      {selectedEpisodes.length>0&&<button className="button ghost small" type="button" disabled={blocked||!!dialog||dirty} onClick={()=>setSelected([])}>{t('episodeClearSelection')}</button>}
      <div className="episode-bulk-actions"><button type="button" className="button secondary small" disabled={blocked||!!dialog||dirty||!selectedEpisodes.length} onClick={()=>{setName('');open('rename');}}><Pencil size={14}/>{t('episodeBatchRename')}</button><button type="button" className="button ghost small danger-text" disabled={blocked||!!dialog||dirty||!selectedEpisodes.length} onClick={()=>void loadDelete()}><Trash2 size={14}/>{t('episodeBatchDelete')}</button></div>
    </div>
    <p className="episode-reorder-hint field-hint">{t('episodeReorderHint')}</p>
    {!available&&<p className="form-error" role="alert">{t('episodeBatchStale')} <button className="episode-inline-refresh" type="button" onClick={onRefresh}><RefreshCw size={13}/>{t('episodeBatchRefresh')}</button></p>}
    {dirty&&<div className="episode-order-actions" role="status"><p>{t('episodeOrderTitleHint')}</p><div><button className="button secondary small" type="button" disabled={blocked||!!dialog} onClick={()=>open('order')}><Check size={15}/>{t('episodeSaveOrder')}</button><button className="button ghost small" type="button" disabled={blocked||!!dialog} onClick={()=>{setOrder(null);setFailure('');}}>{t('episodeCancelOrder')}</button></div></div>}
    {!dialog&&failure&&<p className="form-error" role="alert">{failure}</p>}
    <div className="episode-editor-list">{shown.map((episode,index)=>{
      const displayedNumber=dirty?index+1:episode.number,change=(episode.number<=series.free_episodes)!==(displayedNumber<=series.free_episodes),rowBlocked=blocked||!!dialog,actionBlocked=disabled||busy||loading||!!dialog||dirty;
      return <div className={`episode-editor-row ${dragging===episode.id?'episode-dragging':''} ${change?'episode-access-changing':''}`} key={episode.id} data-episode-id={episode.id} onDragOver={event=>{if(dragId.current){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={event=>drop(event,episode.id)}>
        <label className="episode-select"><input type="checkbox" aria-label={t('episodeSelect').replace('{number}',String(episode.number))} checked={selected.includes(episode.id)} disabled={actionBlocked} onChange={event=>setSelected(previous=>event.target.checked?[...previous,episode.id]:previous.filter(id=>id!==episode.id))}/></label>
        <button type="button" className="icon-button episode-drag-handle" aria-label={t('episodeDrag').replace('{number}',String(episode.number))} title={t('episodeDrag').replace('{number}',String(episode.number))} draggable={!rowBlocked} disabled={rowBlocked} onDragStart={event=>{dragId.current=episode.id;setDragging(episode.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',episode.id);}} onDragEnd={pointerEnd} onPointerDown={event=>pointerStart(event,episode.id)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onKeyDown={event=>{if(event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();move(episode.id,index+(event.key==='ArrowUp'?-1:1));}}}><GripVertical size={16}/></button>
        <span className="episode-number">{String(displayedNumber).padStart(2,'0')}</span><div className="episode-editor-copy"><strong>{episode.title}</strong><small>{Math.round(episode.duration)}s · {bytes(episode.bytes)} · {displayedNumber<=series.free_episodes?t('free'):usd(series.price_cents*10000)}</small></div>
        <div className="episode-row-actions"><button type="button" className="icon-button episode-move-up" disabled={rowBlocked||index===0} aria-label={t('episodeMoveUp').replace('{number}',String(episode.number))} onClick={()=>move(episode.id,index-1)}><ArrowUp size={15}/></button><button type="button" className="icon-button episode-move-down" disabled={rowBlocked||index===shown.length-1} aria-label={t('episodeMoveDown').replace('{number}',String(episode.number))} onClick={()=>move(episode.id,index+1)}><ArrowDown size={15}/></button>{canPreview&&<button type="button" className="icon-button" disabled={actionBlocked} aria-label={`${t('contentPreview')}: ${episode.title}`} onClick={()=>onPreview(episode)}><Play size={16}/></button>}<button type="button" className="icon-button" disabled={actionBlocked} aria-label={`${t('edit')} ${episode.title}`} onClick={()=>onEdit(episode)}><Pencil size={16}/></button><button type="button" className="icon-button danger-text" disabled={actionBlocked} aria-label={`${t('remove')} ${episode.title}`} onClick={()=>onRemove(episode)}><Trash2 size={16}/></button></div>
      </div>;
    })}</div>
    <Modal open={dialog==='rename'} onClose={close} title={t('episodeBatchRenameTitle')}><form className="episode-batch-rename" onSubmit={rename}><p className="field-hint">{t('episodeBatchRenameHint')}</p><label className="field">{t('episodeBatchBaseName')}<input value={name} onChange={event=>setName(event.target.value)} maxLength={MAX_EPISODE_BATCH_BASE_NAME} required disabled={busy||stale} autoComplete="off"/></label><div className="episode-batch-preview" aria-live="polite">{selectedEpisodes.map(episode=><p key={episode.id}><span>{String(episode.number).padStart(3,'0')}</span><strong>{validName?batchEpisodeTitle(name,episode.number):episode.title}</strong></p>)}</div>{failure&&<p className="form-error" role="alert">{failure}</p>}<Button type="submit" className="button primary wide" busy={busy} disabled={blocked||stale||!validName}><Pencil size={15}/>{t('episodeBatchRenameApply').replace('{count}',number(selectedEpisodes.length))}</Button><button className="button ghost wide" type="button" disabled={busy} onClick={close}>{t('cancel')}</button>{stale&&<button type="button" className="button secondary wide" disabled={busy} onClick={refreshList}><RefreshCw size={15}/>{t('episodeBatchRefresh')}</button>}</form></Modal>
    <Modal open={dialog==='delete'} onClose={close} title={t('episodeBatchDeleteTitle')}><div className="episode-batch-delete"><p className="episode-batch-warning"><AlertTriangle size={20}/><strong>{t('episodeBatchDeleteWarning')}</strong></p>{loading?<Loading/>:preview&&<><h3 className="episode-batch-series-title">{preview.series.title}</h3><section className="episode-batch-statistics" aria-label={t('episodeBatchDeleteStats')}><h3>{t('episodeBatchDeleteStats')}</h3><dl>{([['episode_count','seriesDeleteEpisodes'],['views','seriesDeleteViews'],['real_paid_unlocks','seriesDeleteRealUnlocks'],['test_paid_unlocks','seriesDeleteTestUnlocks'],['paid_episode_count','episodeBatchPaidEpisodes']] as const).map(([key,label])=><div key={key} data-metric={key}><dt>{t(label)}</dt><dd>{number(preview.summary[key])}</dd></div>)}<div data-metric="total_watch_seconds"><dt>{t('seriesDeleteWatchTime')}</dt><dd>{elapsed(preview.summary.total_watch_seconds)}</dd></div><div data-metric="media_bytes"><dt>{t('seriesDeleteStorage')}</dt><dd>{bytes(preview.summary.media_bytes)}</dd></div></dl></section>{paidProtected?<p className="form-error episode-batch-paid-guard" role="alert">{t('episodeBatchPurchasedGuard')}</p>:<form onSubmit={remove}><label className="field">{t('episodeBatchDeleteType')}<input value={typedTitle} onChange={event=>setTypedTitle(event.target.value)} aria-label={t('episodeBatchDeleteType')} aria-describedby={`episode-delete-series-${series.id}`} disabled={busy||stale} required maxLength={120} autoComplete="off" spellCheck={false}/><small id={`episode-delete-series-${series.id}`}>{preview.series.title}</small></label><label className="checkbox-label episode-batch-ack"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy||stale} required/><span>{t('episodeBatchDeleteAcknowledge')}</span></label><Button type="submit" className="button episode-batch-delete-submit wide" busy={busy} disabled={blocked||stale||typedTitle!==preview.series.title||!acknowledged}><Trash2 size={15}/>{t('episodeBatchDeleteApply').replace('{count}',number(preview.summary.episode_count))}</Button></form>}</>}{failure&&<p className="form-error" role="alert">{failure}</p>}{stale&&<button type="button" className="button secondary wide" disabled={busy} onClick={refreshList}><RefreshCw size={15}/>{t('episodeBatchRefresh')}</button>}<button className="button ghost wide" type="button" disabled={busy} onClick={close}>{t('cancel')}</button></div></Modal>
    <Modal open={dialog==='order'} onClose={close} title={t('episodeOrderTitle')}><div className="episode-order-confirm"><p className="field-hint">{t('episodeOrderTitleHint')}</p>{affected>0&&<><p className="episode-batch-warning"><AlertTriangle size={20}/><strong>{t('episodeOrderAccessWarning')}</strong></p><p>{t('episodeOrderAccessCount').replace('{count}',number(affected))}</p><label className="checkbox-label episode-batch-ack"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy||stale}/><span>{t('episodeOrderAcknowledge')}</span></label></>}{failure&&<p className="form-error" role="alert">{failure}</p>}<Button className="button primary wide" busy={busy} disabled={blocked||stale||affected>0&&!acknowledged} onClick={reorder}><Check size={15}/>{t('episodeSaveOrder')}</Button><button type="button" className="button ghost wide" disabled={busy} onClick={close}>{t('cancel')}</button>{stale&&<button type="button" className="button secondary wide" disabled={busy} onClick={refreshList}><RefreshCw size={15}/>{t('episodeBatchRefresh')}</button>}</div></Modal>
  </div>;
}
