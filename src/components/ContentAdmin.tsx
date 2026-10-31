import {useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {Search,Upload,FilePenLine,ShieldAlert,RotateCcw,History,ChevronLeft,ChevronRight} from 'lucide-react';
import {apiCrossOrigin,post,useApi} from '../api';
import {useApp} from '../context';
import {useI18n,languageName,type Key} from '../i18n';
import {Button,Empty,ErrorState,Loading,Modal} from '../ui';
import '../content-admin.css';

interface ContentSeries {
  id:string;title:string;cover:string;language:string;
  creator_id:string;creator_name:string;status:'draft'|'published'|'archived';
  episode_count:number;taken_down:boolean;moderation_reason?:string;
}
interface ContentList {series:ContentSeries[];page:number;limit:number;total:number}
interface ModerationEvent {id:string;action:'takedown'|'restore'|'metadata';reason:string;actor_name?:string;actor_id:string;created_at:string}
type ContentFilter='all'|'published'|'draft'|'archived'|'taken_down';
type Action='takedown'|'restore'|'history';

export function ContentAdmin(){
  const {t,locale}=useI18n();const {user,toast}=useApp();
  const [search,setSearch]=useState('');const [query,setQuery]=useState('');
  const [state,setState]=useState<ContentFilter>('all');const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<{series:ContentSeries;action:Action}|null>(null);
  const [reason,setReason]=useState('');const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);const [failure,setFailure]=useState('');
  const params=new URLSearchParams({q:query,status:state,page:String(page),limit:'20'});
  const list=useApi<ContentList>(user?.role==='admin'?`/api/admin/series?${params}`:undefined);
  const pages=Math.max(1,Math.ceil((list.data?.total??0)/(list.data?.limit||20)));
  const history=useApi<{events:ModerationEvent[]}>(selected?`/api/admin/series/${encodeURIComponent(selected.series.id)}/moderation`:undefined);
  const choose=(series:ContentSeries,action:Action)=>{setSelected({series,action});setReason('');setConfirmed(false);setFailure('');};
  const close=()=>{if(!busy)setSelected(null);};
  const filter=(event:FormEvent)=>{event.preventDefault();setQuery(search.trim());setPage(1);};
  const valid=reason.trim().length>=10&&confirmed;
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!selected||selected.action==='history'||busy)return;
    if(!valid){setFailure(t('contentReasonRequired'));return;}
    setBusy(true);setFailure('');
    try{await post(`/api/admin/series/${encodeURIComponent(selected.series.id)}/moderation`,{action:selected.action,reason:reason.trim()});toast(t('contentSaved'));setSelected(null);list.refresh();}
    catch(error){setFailure((error as Error).message);}finally{setBusy(false);}
  };
  const timestamp=(value:string)=>{
    const raw=value.replace(' ','T');const parsed=new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?raw:raw+'Z');
    return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString(locale);
  };
  if(user?.role!=='admin')return null;
  return <section className="panel content-admin-panel">
    <div className="content-admin-heading"><div><h2>{t('contentAdmin')}</h2><p className="muted">{t('contentAdminBody')}</p></div>
      {user.payment_review?<button className="button primary" disabled><Upload size={17}/>{t('contentUpload')}</button>:<Link className="button primary" to="/studio/new?from=admin"><Upload size={17}/>{t('contentUpload')}</Link>}
    </div>
    <p className="field-hint">{t('contentAdminUploadHint')}</p>
    <form className="content-admin-filters" onSubmit={filter} role="search" aria-label={t('contentSearch')}>
      <label className="field content-admin-search"><span>{t('contentSearch')}</span><div className="search-field"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} maxLength={120} aria-label={t('contentSearch')}/></div></label>
      <label className="field" htmlFor="content-admin-status">{t('contentFilter')}<select id="content-admin-status" aria-label={t('contentFilter')} value={state} onChange={event=>{setState(event.target.value as ContentFilter);setPage(1);}}><option value="all">{t('contentAll')}</option><option value="published">{t('published')}</option><option value="draft">{t('draft')}</option><option value="archived">{t('archived')}</option><option value="taken_down">{t('contentTakenDown')}</option></select></label>
      <button className="button secondary" type="submit"><Search size={16}/>{t('contentSearchAction')}</button>
    </form>
    {list.loading&&!list.data?<Loading/>:list.error?<ErrorState error={list.error} retry={list.refresh}/>:<>
      {list.data?.series.length?<div className="content-admin-list">{list.data.series.map(series=><article className="content-admin-row" key={series.id}>
        <img src={series.cover||'/images/placeholder.svg'} crossOrigin={apiCrossOrigin(series.cover)} alt="" loading="lazy"/>
        <div className="content-admin-series"><h3>{series.title}</h3><p>{t('contentCreator')}: {series.creator_name}</p><small>{languageName(series.language)} · {series.episode_count} {t('episodes')}</small><div className="content-admin-statuses"><span className={`status ${series.status}`}>{t(series.status as Key)}</span>{series.taken_down&&<span className="status content-admin-offline">{t('contentTakenDown')}</span>}</div>{series.taken_down&&series.moderation_reason&&<p className="content-admin-reason">{series.moderation_reason}</p>}</div>
        <div className="content-admin-actions"><Link className="button secondary small" to={`/studio/series/${encodeURIComponent(series.id)}?from=admin`}><FilePenLine size={15}/>{t('contentEdit')}</Link><button className="button secondary small" onClick={()=>choose(series,'history')}><History size={15}/>{t('contentHistory')}</button><button className={`button small ${series.taken_down?'secondary':'content-admin-danger'}`} onClick={()=>choose(series,series.taken_down?'restore':'takedown')}>{series.taken_down?<RotateCcw size={15}/>:<ShieldAlert size={15}/>} {t(series.taken_down?'contentRestore':'contentTakeDown')}</button></div>
      </article>)}</div>:<Empty title={t('contentNoSeries')}/>}
      {list.data&&pages>1&&<nav className="content-admin-pagination" aria-label={t('contentPage')}><button className="button secondary small" disabled={page<=1||list.loading} onClick={()=>setPage(value=>Math.max(1,value-1))}><ChevronLeft size={16}/>{t('contentPrevious')}</button><span>{t('contentPage')} {list.data.page} / {pages}</span><button className="button secondary small" disabled={page>=pages||list.loading} onClick={()=>setPage(value=>value+1)}>{t('contentNext')}<ChevronRight size={16}/></button></nav>}
    </>}
    <Modal open={!!selected} onClose={close} title={t(selected?.action==='restore'?'contentRestore':selected?.action==='history'?'contentHistory':'contentTakeDown')}>
      {selected&&<><h3 className="content-admin-modal-title">{selected.series.title}</h3>
        {selected.action!=='history'&&<><p>{t(selected.action==='takedown'?'contentTakeDownBody':'contentRestoreBody')}</p><form className="content-admin-moderation-form" onSubmit={submit}>
          <label className="field">{t('contentReason')}<textarea rows={4} aria-label={t('contentReason')} value={reason} onChange={event=>{setReason(event.target.value);setConfirmed(false);setFailure('');}} minLength={10} maxLength={2000} required disabled={busy}/><small>{t('contentReasonHint')}</small></label>
          <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} required disabled={busy}/><span>{t('contentConfirm')}</span></label>
          {failure&&<p className="form-error" role="alert">{failure}</p>}
          <Button className={`button wide ${selected.action==='takedown'?'content-admin-danger':'primary'}`} type="submit" busy={busy} disabled={!valid}>{t(selected.action==='takedown'?'contentTakeDown':'contentRestore')}</Button>
        </form></>}
        <section className="content-admin-history"><h4>{t('contentHistory')}</h4>{history.loading&&!history.data?<Loading/>:history.error?<ErrorState error={history.error} retry={history.refresh}/>:history.data?.events.length?<ol>{history.data.events.map(event=><li key={event.id}><div><strong>{t(event.action==='restore'?'contentRestore':event.action==='metadata'?'contentEdit':'contentTakeDown')}</strong><time>{timestamp(event.created_at)}</time></div><p>{event.reason}</p><small>{event.actor_name||event.actor_id}</small></li>)}</ol>:<p className="muted">{t('contentNoHistory')}</p>}</section>
      </>}
    </Modal>
  </section>;
}
