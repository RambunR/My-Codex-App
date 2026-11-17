import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {Bell,CheckCheck,CloudDownload,Download,ExternalLink,Folder,Play,RefreshCw,ShieldCheck,Square,X} from 'lucide-react';
import {api,ApiError,post} from '../api';
import {useApp} from '../context';
import {useI18n,type Key} from '../i18n';
import {Button,Empty,ErrorState,Loading} from '../ui';
import type {DriveImportJob,DriveImportStatus,DriveJobStatus} from '../../shared/drive-import-types';
import '../drive-import.css';

const endpoint='/api/admin/drive-imports';
const verificationLifetime=24*60*60*1000;
const statuses:Record<DriveJobStatus,Key>={waiting:'driveImportStatusWaiting',downloading:'driveImportStatusDownloading',validating:'driveImportStatusValidating',complete:'driveImportStatusComplete',error:'driveImportStatusError',cancelled:'driveImportStatusCancelled',review:'driveImportStatusReview'};
const verificationMessages:Record<string,Key>={DRIVE_IMPORT_API_DISABLED:'driveImportApiDisabled',DRIVE_IMPORT_AUTH_FAILED:'driveImportAuthFailed',DRIVE_IMPORT_ACCESS_DENIED:'driveImportAccessDenied',DRIVE_IMPORT_RATE_LIMITED:'driveImportRateLimited',DRIVE_IMPORT_UNAVAILABLE:'driveImportUnavailable',DRIVE_IMPORT_INVALID_FOLDER:'driveImportInvalidFolder',DRIVE_IMPORT_INVALID_RESPONSE:'driveImportInvalidResponse',DRIVE_IMPORT_CONNECTION_FAILED:'driveImportConnectionFailed',DRIVE_IMPORT_CREDENTIALS_REQUIRED:'driveImportCredentialsMissing',DRIVE_IMPORT_RUNTIME_UNAVAILABLE:'driveImportRuntimeMissing'};

// This owner-only shortcut uses the public account identifier, never provider
// error text or a private credential value, to select the Cloud Console project.
function driveApiConsoleUrl(email:string|null){
  const project=typeof email==='string'?email.match(/^[a-z0-9][a-z0-9-]{0,62}@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/)?.[1]:undefined;
  const url=new URL('https://console.cloud.google.com/apis/library/drive.googleapis.com');
  if(project)url.searchParams.set('project',project);return url.href;
}

// Only an ID is sent to the server. A pasted URL never becomes a fetch target.
export function driveFolderId(value:string):string|null{
  const input=value.trim();
  if(/^[A-Za-z0-9_-]{10,200}$/.test(input))return input;
  try{
    const url=new URL(input);
    if(url.protocol!=='https:'||url.hostname!=='drive.google.com'||url.username||url.password||url.port)return null;
    const match=url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})\/?$/);
    return match?.[1]||null;
  }catch{return null;}
}

export function DriveImports(){
  const{user,toast,refreshUser}=useApp(),{t,locale}=useI18n();
  const owner=user?.role==='admin'&&user.max_episode_seconds===null;
  const[data,setData]=useState<DriveImportStatus>(),[loading,setLoading]=useState(true),[readError,setReadError]=useState<Error>(),[failure,setFailure]=useState(''),[denied,setDenied]=useState(false);
  const[folder,setFolder]=useState(''),[busy,setBusy]=useState(''),[verificationFailure,setVerificationFailure]=useState<Key|null>(null);
  const mounted=useRef(false),mutation=useRef(false),edited=useRef(false),requestId=useRef(0),request=useRef<AbortController|null>(null),accessDenied=useRef(false);

  const deny=()=>{accessDenied.current=true;setDenied(true);setData(undefined);setReadError(undefined);setFailure('');setVerificationFailure(null);};
  const load=useCallback(async()=>{
    if(!owner||!mounted.current||accessDenied.current)return;
    const id=++requestId.current;request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);
    try{
      const result=await api<DriveImportStatus>(endpoint,{signal:controller.signal});
      if(mounted.current&&id===requestId.current){setData(result);setReadError(undefined);if(!edited.current)setFolder(result.settings.folderId);}
    }catch(error){
      if(mounted.current&&id===requestId.current&&!controller.signal.aborted){
        if(error instanceof ApiError&&error.status===403)deny();
        else setReadError(error instanceof Error?error:new Error(t('failed')));
      }
    }finally{if(mounted.current&&id===requestId.current)setLoading(false);}
  },[owner,t]);

  useEffect(()=>{
    mounted.current=true;void load();
    const timer=window.setInterval(()=>{if(!mutation.current&&!document.hidden)void load();},30000);
    return()=>{mounted.current=false;window.clearInterval(timer);++requestId.current;request.current?.abort();};
  },[load]);

  const perform=async(key:string,operation:()=>Promise<unknown>,message?:Key,onSuccess?:()=>void)=>{
    if(mutation.current||!owner||accessDenied.current)return;
    mutation.current=true;++requestId.current;request.current?.abort();setBusy(key);setFailure('');
    if(key==='connection')setVerificationFailure(null);
    try{
      await operation();if(!mounted.current)return;onSuccess?.();await load();
      if(mounted.current&&!accessDenied.current&&message)toast(t(message));
    }catch(error){
      if(mounted.current){if(error instanceof ApiError&&error.status===403)deny();else if(key==='connection')setVerificationFailure(error instanceof ApiError&&Object.hasOwn(verificationMessages,error.code)?verificationMessages[error.code]:'driveImportConnectionFailed');else setFailure(error instanceof Error?error.message:t('failed'));}
    }finally{mutation.current=false;if(mounted.current){setBusy('');setLoading(false);}}
  };

  if(!owner||denied)return <Empty title="403" body={t('driveImportDenied')}/>;
  if(loading&&!data)return <Loading/>;
  if(!data)return readError?<ErrorState error={readError} retry={()=>void load()}/>:null;

  const parsedFolder=driveFolderId(folder),dirty=parsedFolder!==data.settings.folderId;
  const savedFolder=driveFolderId(data.settings.folderId),folderUrl=savedFolder?`https://drive.google.com/drive/folders/${encodeURIComponent(savedFolder)}`:null;
  const ready=data.connection.configured&&data.connection.runtimeAvailable;
  const verifiedAt=data.settings.verifiedAt;
  const freshVerification=verifiedAt!==null&&verifiedAt<=Date.now()&&Date.now()-verifiedAt<=verificationLifetime;
  const verified=!verificationFailure&&verifiedAt!==null&&verifiedAt<=Date.now()&&(data.settings.enabled||freshVerification);
  const canEnable=ready&&freshVerification&&!dirty&&!verificationFailure;
  const date=(value:string|number)=>{const parsed=new Date(typeof value==='string'&&!/[TZ+]/.test(value)?value.replace(' ','T')+'Z':value);return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(parsed):String(value);};
  const save=(event:FormEvent)=>{
    event.preventDefault();if(!parsedFolder||!dirty||busy)return;
    void perform('folder',()=>api(endpoint,{method:'PATCH',body:JSON.stringify({folderId:parsedFolder})}),'driveImportSaved',()=>{edited.current=false;setFolder(parsedFolder);setVerificationFailure(null);});
  };
  const progress=(job:DriveImportJob)=>{
    const total=Math.max(0,job.totalFiles),done=Math.min(total,Math.max(0,job.finishedFiles));
    const label=t('driveImportProgress').replace('{done}',String(done)).replace('{total}',String(total));
    return <div className="drive-import-progress"><progress max={Math.max(1,total)} value={done} aria-label={label}/><span>{label}</span></div>;
  };
  const draftLink=(seriesId:string)=><Link className="button secondary small" to={`/studio/series/${encodeURIComponent(seriesId)}`}><ExternalLink size={14} aria-hidden="true"/>{t('driveImportOpenDraft')}</Link>;

  return <section className="drive-import-panel panel" aria-labelledby="drive-import-heading" aria-busy={!!busy}>
    <div className="drive-import-heading"><div><h2 id="drive-import-heading"><CloudDownload size={22} aria-hidden="true"/>{t('driveImportTitle')}</h2><p>{t('driveImportIntro')}</p></div><span className={`drive-import-state ${data.settings.enabled?'is-on':''}`}><span aria-hidden="true"/>{t(data.settings.enabled?'driveImportEnabled':'driveImportDisabled')}</span></div>
    {failure&&<p className="form-error drive-import-error" role="alert">{failure}</p>}
    {verificationFailure&&<div className="drive-import-error drive-import-verification-error" role="alert"><p>{t(verificationFailure)}</p><div className="drive-import-diagnostic-links"><a className="drive-import-setup-link drive-import-open-api" href={driveApiConsoleUrl(data.connection.serviceAccountEmail)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/>{t('driveImportOpenApiConsole')}</a>{folderUrl&&<a className="drive-import-setup-link drive-import-open-sharing" href={folderUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/>{t('driveImportOpenSharing')}</a>}</div></div>}
    {readError&&<div className="drive-import-error" role="alert"><p>{readError.message}</p><Button className="button secondary small" disabled={!!busy||loading} onClick={()=>void load()}><RefreshCw size={14} aria-hidden="true"/>{t('retry')}</Button></div>}
    <div className="drive-import-setup">
      <form onSubmit={save} className="drive-import-folder-form">
        <label className="field" htmlFor="drive-import-folder"><span><Folder size={17} aria-hidden="true"/>{t('driveImportFolder')}</span><input id="drive-import-folder" aria-label={t('driveImportFolder')} aria-invalid={!parsedFolder||undefined} type="text" dir="ltr" autoComplete="off" spellCheck={false} value={folder} maxLength={500} disabled={!!busy} aria-describedby="drive-import-folder-hint" onChange={event=>{edited.current=true;setFolder(event.target.value);}}/><small id="drive-import-folder-hint">{t('driveImportFolderHint')}</small></label>
        <Button type="submit" className="button secondary" busy={busy==='folder'} disabled={!!busy||!parsedFolder||!dirty}>{t('driveImportSaveFolder')}</Button>
      </form>
      {folderUrl&&<a className="drive-import-folder-link" href={folderUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/><span dir="ltr">drive.google.com/drive/folders/{savedFolder}</span></a>}
      {!data.connection.configured?<p className="drive-import-warning" role="status">{t('driveImportCredentialsMissing')}</p>:<div className="drive-import-account"><strong>{t('driveImportServiceAccount')}</strong>{data.connection.serviceAccountEmail&&<code dir="ltr">{data.connection.serviceAccountEmail}</code>}<p>{t('driveImportConnectHelp')}</p></div>}
      {!data.connection.runtimeAvailable&&<p className="drive-import-warning" role="status">{t('driveImportRuntimeMissing')}</p>}
      <div className="drive-import-connection-state"><ShieldCheck size={17} aria-hidden="true"/><span>{t(verified?'driveImportVerified':'driveImportVerifyFirst')}{verified&&verifiedAt!==null&&<time dateTime={new Date(verifiedAt).toISOString()}>{date(verifiedAt)}</time>}</span></div>
      <div className="drive-import-controls">
        <Button type="button" className="button secondary" busy={busy==='connection'} disabled={!!busy||!ready||dirty} onClick={()=>void perform('connection',()=>post(`${endpoint}/connection`),'driveImportConnected')}><ShieldCheck size={16} aria-hidden="true"/>{t('driveImportVerify')}</Button>
        <Button type="button" className={`button ${data.settings.enabled?'secondary':'primary'}`} busy={busy==='enabled'} disabled={!!busy||(!data.settings.enabled&&!canEnable)} onClick={()=>void perform('enabled',()=>api(endpoint,{method:'PATCH',body:JSON.stringify({enabled:!data.settings.enabled})}),data.settings.enabled?'driveImportDisabled':'driveImportEnabled')}>{data.settings.enabled?<Square size={15} aria-hidden="true"/>:<Play size={15} aria-hidden="true"/>}{t(data.settings.enabled?'driveImportDisable':'driveImportEnable')}</Button>
        <Button type="button" className="button secondary" busy={busy==='scan'} disabled={!!busy||!ready||!data.settings.enabled||dirty} onClick={()=>void perform('scan',()=>post(`${endpoint}/scan`),'driveImportQueued')}><RefreshCw size={16} aria-hidden="true"/>{t('driveImportCheckNow')}</Button>
      </div>
    </div>
    <div className="drive-import-policy"><p>{t('driveImportManifest')}</p><p>{t('driveImportDrafts')}</p><div className="drive-import-guide-links"><a className="drive-import-setup-link" href="https://github.com/RambunR/My-Codex-App/blob/main/docs/GOOGLE_DRIVE_IMPORT.md" target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/>{t('driveImportSetupGuide')}</a><a className="drive-import-setup-link" href="/downloads/verify-clipweave-export.mjs" download><Download size={14} aria-hidden="true"/>{t('driveImportDownloadTool')}</a></div></div>
    <section className="drive-import-activity" aria-labelledby="drive-import-jobs-heading"><h3 id="drive-import-jobs-heading">{t('driveImportJobs')}</h3>{!data.jobs.length?<p className="muted">{t('driveImportNoJobs')}</p>:<ul className="drive-import-list">{data.jobs.map(job=><li className="drive-import-job" key={job.id}>
      <div className="drive-import-item-heading"><strong>{job.folderName}</strong><span className={`drive-import-job-status drive-status-${job.status}`}>{t(statuses[job.status])}</span></div>
      {progress(job)}{job.message&&<p className="drive-import-message">{job.message}</p>}<time className="drive-import-time" dateTime={job.updatedAt}>{date(job.updatedAt)}</time>
      <div className="drive-import-item-actions">{job.seriesId&&draftLink(job.seriesId)}{['waiting','downloading','validating'].includes(job.status)&&<Button type="button" className="button ghost small" busy={busy===`cancel-${job.id}`} disabled={!!busy} onClick={()=>void perform(`cancel-${job.id}`,()=>post(`${endpoint}/jobs/${encodeURIComponent(job.id)}/cancel`))}><X size={14} aria-hidden="true"/>{t('driveImportCancel')}</Button>}{['error','cancelled'].includes(job.status)&&!job.seriesId&&<Button type="button" className="button secondary small" busy={busy===`retry-${job.id}`} disabled={!!busy} onClick={()=>void perform(`retry-${job.id}`,()=>post(`${endpoint}/jobs/${encodeURIComponent(job.id)}/retry`))}><RefreshCw size={14} aria-hidden="true"/>{t('driveImportRetry')}</Button>}</div>
    </li>)}</ul>}</section>
    <section className="drive-import-notifications" aria-labelledby="drive-import-notifications-heading"><div className="drive-import-section-heading"><h3 id="drive-import-notifications-heading"><Bell size={18} aria-hidden="true"/>{t('driveImportNotifications')}{data.unread>0&&<span className="drive-import-unread">{data.unread}</span>}</h3><Button type="button" className="button secondary small" busy={busy==='read'} disabled={!!busy||!data.unread} onClick={()=>void perform('read',async()=>{await post(`${endpoint}/notifications/read`);await refreshUser();})}><CheckCheck size={15} aria-hidden="true"/>{t('driveImportReadAll')}</Button></div>{!data.notifications.length?<p className="muted">{t('driveImportNoNotifications')}</p>:<ul className="drive-import-list">{data.notifications.map(notification=><li key={notification.id} className={`drive-import-notification ${!notification.readAt?'is-unread':''}`}><strong>{notification.title}</strong><p className="drive-import-message">{notification.message}</p><time className="drive-import-time" dateTime={notification.createdAt}>{date(notification.createdAt)}</time>{notification.seriesId&&<div className="drive-import-item-actions">{draftLink(notification.seriesId)}</div>}</li>)}</ul>}</section>
  </section>;
}
