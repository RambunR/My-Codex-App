import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {Users,Plus,Pencil,CalendarDays,ExternalLink,ShieldCheck,RefreshCw} from 'lucide-react';
import {api,post,useApi} from '../api';
import {useApp} from '../context';
import {useI18n} from '../i18n';
import {Avatar,Button,Empty,ErrorState,Loading,Modal} from '../ui';
import '../publisher-management.css';

export interface ManagedPublisherProfile {
  id:string;display_name:string;registered_at:string;managed:boolean;is_official:boolean;
  created_at?:string;updated_at?:string;series_count?:number;
}
interface PublisherList {publishers:ManagedPublisherProfile[];default_publisher_id:string|null}
const today=()=>new Date().toISOString().slice(0,10);
function validDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>today())return false;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function PublisherManagement(){
  const{user,toast}=useApp(),{t,locale}=useI18n();
  const list=useApi<PublisherList>(user?.role==='admin'?'/api/admin/publishers':undefined);
  const[editor,setEditor]=useState<ManagedPublisherProfile|'new'|null>(null),[name,setName]=useState(''),[registeredAt,setRegisteredAt]=useState(today),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  const mutation=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const validName=name.trim().length>=2&&name.trim().length<=80,valid=validName&&validDate(registeredAt);
  const choose=(profile:ManagedPublisherProfile|'new')=>{if(mutation.current)return;setEditor(profile);setName(profile==='new'?'':profile.display_name);setRegisteredAt(profile==='new'?today():profile.registered_at);setFailure('');};
  const close=()=>{if(mutation.current)return;setEditor(null);setFailure('');};
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!editor||mutation.current)return;if(!valid){setFailure(t('publisherProfileValidation'));return;}
    mutation.current=true;setBusy(true);setFailure('');
    try{
      const body={display_name:name.trim(),registered_at:registeredAt};
      if(editor==='new')await post('/api/admin/publishers',body);else await api(`/api/admin/publishers/${encodeURIComponent(editor.id)}`,{method:'PATCH',body:JSON.stringify(body)});
      if(!mounted.current)return;setEditor(null);list.refresh();toast(t('publisherProfileSaved'));
    }catch(error){if(mounted.current)setFailure(error instanceof Error?error.message:t('failed'));}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  };
  const date=(value:string)=>validDate(value)?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):value;
  if(user?.role!=='admin')return <Empty title="403"/>;
  if(list.loading&&!list.data)return <Loading/>;
  if(list.error)return <ErrorState error={list.error} retry={list.refresh}/>;
  return <section className="panel publisher-management" aria-labelledby="publisher-management-heading">
    <div className="publisher-management-heading"><div><h2 id="publisher-management-heading"><Users size={20}/>{t('publisherManagementTitle')}</h2><p>{t('publisherManagementBody')}</p></div><button type="button" className="button primary" disabled={busy} onClick={()=>choose('new')}><Plus size={16}/>{t('publisherCreate')}</button></div>
    <p className="field-hint publisher-attribution-hint">{t('publisherAttributionHint')}</p>
    {list.data?.publishers.length?<div className="publisher-management-list">{list.data.publishers.map(profile=><article className="publisher-management-card" key={profile.id} data-publisher-id={profile.id}>
      <div className="publisher-management-name"><Avatar name={profile.display_name}/><div><h3>{profile.display_name}</h3>{profile.is_official&&<span className="publisher-official-badge"><ShieldCheck size={13}/>{t('publisherOfficial')}</span>}</div></div>
      <p className="publisher-management-date"><CalendarDays size={14}/><span>{t('publisherPublicDateValue').replace('{date}',date(profile.registered_at))}</span></p>
      <p className="publisher-management-count">{t('publisherSeriesCount').replace('{count}',new Intl.NumberFormat(locale).format(Math.max(0,profile.series_count||0)))}</p>
      <div className="publisher-management-actions">{profile.managed&&<button className="button secondary small" type="button" disabled={busy} aria-label={`${t('publisherEdit')}: ${profile.display_name}`} onClick={()=>choose(profile)}><Pencil size={14}/>{t('edit')}</button>}<Link className="button ghost small" to={`/publishers/${encodeURIComponent(profile.id)}`}><ExternalLink size={14}/>{t('publisherViewProfile')}</Link></div>
    </article>)}</div>:<Empty title={t('publisherNoProfiles')}/>}
    <Modal open={!!editor} onClose={close} title={t(editor==='new'?'publisherCreate':'publisherEdit')}><form className="publisher-profile-form" noValidate onSubmit={save}>
      <p className="field-hint">{t('publisherAttributionHint')}</p>
      <label className="field" htmlFor="publisher-profile-name">{t('publisherDisplayName')}<input id="publisher-profile-name" aria-label={t('publisherDisplayName')} value={name} onChange={event=>setName(event.target.value)} minLength={2} maxLength={80} required disabled={busy} autoComplete="off" aria-describedby="publisher-profile-validation"/></label>
      <label className="field" htmlFor="publisher-profile-date">{t('publisherPublicDate')}<input id="publisher-profile-date" aria-label={t('publisherPublicDate')} type="date" value={registeredAt} onChange={event=>setRegisteredAt(event.target.value)} min="1900-01-01" max={today()} required disabled={busy} aria-describedby="publisher-profile-date-hint"/><small id="publisher-profile-date-hint">{t('publisherDateHint')}</small></label>
      <p id="publisher-profile-validation" className="field-hint">{t('publisherProfileValidation')}</p>{failure&&<p className="form-error" role="alert">{failure}</p>}
      <Button type="submit" className="button primary wide" disabled={!valid} busy={busy}>{t('saveProfile')}</Button><button type="button" className="button ghost wide" onClick={close} disabled={busy}>{t('cancel')}</button>
    </form></Modal>
  </section>;
}

export function PublisherProfileSelect({value,onChange,disabled=false}:{value:string|null|undefined;onChange:(id:string|null)=>void;disabled?:boolean}){
  const{user}=useApp(),{t}=useI18n();
  const list=useApi<PublisherList>(user?.role==='admin'?'/api/admin/publishers':undefined);
  if(user?.role!=='admin')return null;
  const profiles=list.data?.publishers.filter(profile=>profile.managed)||[],effective=value===undefined?list.data?.default_publisher_id||'':value||'';
  return <div className="publisher-profile-select">
    <label className="field" htmlFor="series-publisher-profile">{t('publisherSelect')}<select id="series-publisher-profile" aria-label={t('publisherSelect')} value={effective} onChange={event=>onChange(event.target.value||null)} disabled={disabled||list.loading||!!list.error} aria-describedby="series-publisher-profile-hint"><option value="">{t('publisherSelectDefault')}</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.display_name}{profile.is_official?` · ${t('publisherOfficial')}`:''}</option>)}</select><small id="series-publisher-profile-hint">{t('publisherSelectHint')} {t('publisherAttributionHint')}</small></label>
    {list.error&&<div className="publisher-select-error" role="alert"><p>{t('publisherProfilesUnavailable')}</p><button type="button" className="button ghost small" disabled={disabled||list.loading} onClick={list.refresh}><RefreshCw size={13}/>{t('retry')}</button></div>}
  </div>;
}
