import {seriesTitleClass} from '../series-title';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type MouseEvent} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {LockKeyhole,Play,ChevronRight,ChevronLeft,Globe2,Clapperboard,Wallet as WalletIcon,Check,ArrowRight,Sparkles,RotateCcw} from 'lucide-react';
import {api,apiUrl,apiCrossOrigin,ApiError} from '../api';
import {useApp} from '../context';
import {useI18n,type Key} from '../i18n';
import {spokenLanguageName} from '../spoken-language-locales';
import {BackLink,Modal,Loading,ErrorState,Button,Avatar} from '../ui';
import {CoverArtwork,CoverThumbnail} from '../components/CoverArtwork';
import {type Series,type Episode,usd,MAX_EPISODE_SECONDS} from '../../shared/config';
import {usePlaybackAnalytics} from '../usePlaybackAnalytics';
import {exitNativeVideoFullscreen,type VideoFullscreenMode} from '../useVideoFullscreen';
import {SubtitleMetadata} from '../components/SubtitleMetadata';
import {BrandedVideo} from '../components/BrandedVideo';
import {SeriesUnlockDialog} from '../components/SeriesUnlockDialog';
import '../watch-mobile.css';

type WatchData={series:Series;episodes:Episode[]};
function useWatchData(id:string|undefined,viewer:string,ready:boolean,invalidMessage:string){
  const key=JSON.stringify([id,viewer]);const[revision,setRevision]=useState(0);
  const[state,setState]=useState<{key:string;data?:WatchData;error?:Error;loading:boolean}>({key:'',loading:true});
  const message=useRef(invalidMessage);message.current=invalidMessage;
  useEffect(()=>{
    if(!id||!ready)return;const controller=new AbortController();
    setState(previous=>({key,data:previous.key===key?previous.data:undefined,loading:true}));
    void api<WatchData>(`/api/series/${encodeURIComponent(id)}`,{signal:controller.signal}).then(data=>{
      if(controller.signal.aborted)return;
      if(data?.series?.id!==id||!Array.isArray(data.episodes))throw new Error(message.current);
      setState({key,data,loading:false});
    }).catch(error=>{if(!controller.signal.aborted)setState(previous=>({key,data:previous.key===key?previous.data:undefined,error:error instanceof Error?error:new Error(message.current),loading:false}));});
    return()=>controller.abort();
  },[id,key,ready,revision]);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  return state.key===key?{...state,refresh}:{key,loading:true,data:undefined,error:undefined,refresh};
}
interface ProgressSnapshot{key:string;episodeId:string;userId:string;duration:number;seconds:number;saved:number}

export function Watch(){
  const{id,episodeId}=useParams();const{t,locale}=useI18n();const{user,ready,refreshUser,toast}=useApp();const navigate=useNavigate();
  const{data,loading,error,refresh}=useWatchData(id,user?.id||'',ready,t('noEpisodes'));
  const selectionKey=`${id||''}/${episodeId||''}`,dialogKey=`${selectionKey}/${user?.id||''}`;
  const ep=data?.episodes.find(episode=>episode.id===episodeId),current=data?.episodes.findIndex(episode=>episode.id===episodeId)??-1;
  const locked=!ep||!ep.free&&!ep.unlocked,canPlay=!!ep&&!locked,next=data?.episodes[current+1],previous=data?.episodes[current-1];
  const[hasVideo,setHasVideo]=useState(false),[playRevision,setPlayRevision]=useState(0),[videoErrorFor,setVideoErrorFor]=useState<string|null>(null),[blockedFor,setBlockedFor]=useState<string|null>(null),[completedFor,setCompletedFor]=useState<string|null>(null),[autoLockedFor,setAutoLockedFor]=useState<string|null>(null);
  const[confirmFor,setConfirmFor]=useState<string|null>(null),[bundleFor,setBundleFor]=useState<string|null>(null),[busyFor,setBusyFor]=useState<string|null>(null),[fullscreenMode,setFullscreenMode]=useState<VideoFullscreenMode>('none');
  const videoRef=useRef<HTMLVideoElement>(null),playerRef=useRef<HTMLDivElement>(null),boundMedia=useRef('');
  const epoch=`${selectionKey}:${playRevision}`,source=canPlay&&ep?apiUrl(`/api/episodes/${ep.id}/stream`):undefined;
  const active=useRef({selectionKey,dialogKey,epoch,userId:user?.id,canPlay});active.current={selectionKey,dialogKey,epoch,userId:user?.id,canPlay};
  const playIntent=useRef<{key:string;kind:'next'|'continue'}|null>(null),playAttempt=useRef(0),progress=useRef<ProgressSnapshot|null>(null),unlockController=useRef<AbortController|null>(null),unlockOperation=useRef(0),priorMedia=useRef<{source:string|undefined;revision:number}>({source:undefined,revision:0});
  const videoError=videoErrorFor===epoch,blocked=blockedFor===epoch,completed=completedFor===epoch,busy=busyFor===dialogKey;
  usePlaybackAnalytics(videoRef,ep?.id,canPlay,user?.id,playRevision,ep?.duration);

  const flushProgress=useCallback((force=false)=>{
    const snapshot=progress.current;if(!snapshot||active.current.userId!==snapshot.userId||snapshot.seconds<=0||snapshot.seconds<=snapshot.saved||!force&&snapshot.seconds-snapshot.saved<5)return;
    snapshot.saved=snapshot.seconds;void api(`/api/episodes/${snapshot.episodeId}/progress`,{method:'POST',body:JSON.stringify({seconds:Math.min(snapshot.duration,snapshot.seconds)}),keepalive:force}).catch(()=>{});
  },[]);
  useEffect(()=>{
    setConfirmFor(null);setBundleFor(null);setBusyFor(null);setBlockedFor(null);setVideoErrorFor(null);setCompletedFor(null);if(playIntent.current?.key!==selectionKey)playIntent.current=null;
    return()=>{flushProgress(true);playAttempt.current++;unlockOperation.current++;unlockController.current?.abort();unlockController.current=null;};
  },[selectionKey,user?.id,flushProgress]);
  useEffect(()=>{if(canPlay)setHasVideo(true);},[canPlay]);
  useLayoutEffect(()=>{
    const video=videoRef.current;boundMedia.current='';
    if(!canPlay){if(video){video.pause();video.removeAttribute('src');video.load();}}
    else if(video&&priorMedia.current.source===source&&priorMedia.current.revision!==playRevision)video.load();
    priorMedia.current={source,revision:playRevision};
  },[selectionKey,source,canPlay,playRevision]);
  useEffect(()=>{if(!canPlay&&fullscreenMode==='native')void exitNativeVideoFullscreen(videoRef.current);},[canPlay,fullscreenMode]);
  const matchesMedia=()=>{
    const video=videoRef.current;if(!video||!canPlay||active.current.epoch!==epoch||!source)return false;
    return video.currentSrc===new URL(source,window.location.href).href;
  };
  const bindMedia=()=>{
    if(!matchesMedia()||!ep)return;boundMedia.current=epoch;
    if(!progress.current||progress.current.key!==epoch)progress.current=user?{key:epoch,episodeId:ep.id,userId:user.id,duration:Number.isFinite(ep.duration)&&ep.duration>0?ep.duration:MAX_EPISODE_SECONDS,seconds:0,saved:0}:null;
  };
  const saveProgress=()=>{
    if(!matchesMedia()||boundMedia.current!==epoch)return;const snapshot=progress.current;
    if(snapshot?.key===epoch){snapshot.seconds=videoRef.current?.currentTime||0;flushProgress();}
  };
  const attemptPlay=()=>{
    const video=videoRef.current;if(!video||!canPlay)return;const target=epoch,attempt=++playAttempt.current;setBlockedFor(null);
    try{void Promise.resolve(video.play()).catch(error=>{if(attempt===playAttempt.current&&active.current.epoch===target&&error?.name!=='AbortError')setBlockedFor(target);});}catch{if(active.current.epoch===target)setBlockedFor(target);}
  };
  useEffect(()=>{if(canPlay&&playIntent.current?.key===selectionKey)attemptPlay();},[selectionKey,source,canPlay,playRevision]);
  const selectEpisode=(target:Episode,automatic=false)=>{
    if(!id||target.id===episodeId)return;saveProgress();flushProgress(true);const key=`${id}/${target.id}`;
    playIntent.current={key,kind:automatic?'next':'continue'};setAutoLockedFor(automatic&&!target.free&&!target.unlocked?key:null);navigate(`/watch/${id}/${target.id}`);
  };
  const episodeLink=(event:MouseEvent<HTMLAnchorElement>,target:Episode)=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();selectEpisode(target);}};
  const ended=()=>{
    if(!matchesMedia()||boundMedia.current!==epoch)return;saveProgress();flushProgress(true);
    if(next)selectEpisode(next,true);else{playIntent.current=null;setCompletedFor(epoch);}
  };
  const retryPlayback=()=>{setVideoErrorFor(null);setBlockedFor(null);playIntent.current={key:selectionKey,kind:'continue'};setPlayRevision(value=>value+1);};
  const replay=()=>{const video=videoRef.current;if(!video||!canPlay)return;setCompletedFor(null);if(progress.current?.key===epoch){progress.current.saved=0;progress.current.seconds=0;}video.currentTime=0;playIntent.current={key:selectionKey,kind:'continue'};attemptPlay();};
  const prepareDialog=async(bundle=false)=>{
    const target=dialogKey;if(fullscreenMode==='native')await exitNativeVideoFullscreen(videoRef.current);if(active.current.dialogKey!==target)return;
    if(!user){navigate(`/auth?next=${encodeURIComponent(`/watch/${id}/${episodeId}`)}`);return;}
    if(bundle)setBundleFor(target);else setConfirmFor(target);
  };
  const unlock=async()=>{
    if(!data||!ep||!user||!locked||confirmFor!==dialogKey||unlockController.current)return;
    const target=dialogKey,targetEpoch=epoch,operation=++unlockOperation.current,controller=new AbortController();unlockController.current=controller;setBusyFor(target);
    try{
      await api(`/api/episodes/${ep.id}/unlock`,{method:'POST',body:JSON.stringify({expected_price_cents:data.series.price_cents}),signal:controller.signal});
      if(controller.signal.aborted||operation!==unlockOperation.current||active.current.dialogKey!==target)return;
      setConfirmFor(null);playIntent.current={key:selectionKey,kind:'continue'};toast(t('purchaseSuccess'));refresh();void refreshUser().catch(()=>{});
    }catch(caught){if(!controller.signal.aborted&&operation===unlockOperation.current&&active.current.dialogKey===target){
      if(caught instanceof ApiError&&caught.code==='EPISODE_PRICE_CHANGED'){setConfirmFor(null);playIntent.current=null;toast(t('seriesUnlockChanged'),true);refresh();}
      else{setVideoErrorFor(current=>current===targetEpoch?null:current);toast((caught as Error).message,true);}
    }}
    finally{if(operation===unlockOperation.current){unlockController.current=null;setBusyFor(null);}}
  };

  if(!ready||loading&&!data)return <Loading/>;
  if(error&&!data)return <ErrorState error={error} retry={refresh}/>;
  if(!data||!ep)return <ErrorState error={new Error(t('noEpisodes'))}/>;
  const series=data.series,price=series.price_cents*10000,insufficient=(user?.wallet_micros||0)<price,returnTo=`/watch/${id}/${episodeId}`;
  const portalTarget=fullscreenMode==='container'?playerRef.current||undefined:undefined;
  const episodeControls=(fullscreen=false)=><nav className={`player-controls${fullscreen?' fullscreen-player-controls':''}`} aria-label={t('episodes')} style={!fullscreen&&fullscreenMode==='container'?{display:'none'}:undefined}><button className="button secondary" disabled={!previous} onClick={()=>previous&&selectEpisode(previous)}><ChevronLeft size={16} aria-hidden="true"/><span>{t('previous')}</span></button><span>{t('episode')} {ep.number}<strong>{ep.title}</strong></span><button className="button secondary" disabled={!next} onClick={()=>next&&selectEpisode(next)}><span>{t('next')}</span><ChevronRight size={16} aria-hidden="true"/></button></nav>;
  const overlay=locked?<><CoverArtwork className="watch-gate-poster" src={series.cover} alt=""/><div className="player-lock watch-locked-gate"><div className="lock-symbol"><LockKeyhole size={28}/></div><span className="eyebrow">{t('episode')} {ep.number}</span><h2>{t('locked')}</h2><p>{t(autoLockedFor===selectionKey?'watchNextLocked':'unlockBody')}</p>{error&&<p role="alert">{error.message}<button className="button secondary" onClick={refresh}>{t('retry')}</button></p>}<button className="button primary" onClick={()=>void prepareDialog()}><LockKeyhole size={15}/>{t(autoLockedFor===selectionKey?'watchUnlockNext':'unlock')} · {usd(price)}</button><button className="button secondary" onClick={()=>void prepareDialog(true)}>{t('seriesUnlockAll')}</button><span>{t('creatorShare')}</span></div></>:videoError?<div className="player-lock watch-playback-error"><Clapperboard size={30}/><p>{t('retry')}</p><button className="button primary" onClick={retryPlayback}>{t('retry')}</button></div>:completed?<div className="player-lock watch-end-card"><h2>{t('watchSeriesComplete')}</h2><button className="button primary" onClick={replay}><RotateCcw size={17}/>{t('watchReplay')}</button><Link className="button secondary" to={`/series/${id}`}>{t('watchBackToSeries')}</Link></div>:blocked?<div className="player-lock watch-playback-blocked" role="status"><p>{t('watchPlaybackBlocked')}</p><button className="button primary" onClick={attemptPlay}><Play size={18}/>{t(playIntent.current?.kind==='next'?'watchPlayNext':'watchContinue')}</button></div>:null;
  return <div className="page watch-page"><div className="watch-heading"><BackLink to={`/series/${id}`} label={series.title} className={seriesTitleClass(series.language)}/><span>{t('episode')} {ep.number} / {data.episodes.length}</span></div>{error&&!locked&&<div className="watch-load-error" role="alert">{error.message}<button className="button secondary" onClick={refresh}>{t('retry')}</button></div>}<div className="watch-grid"><div className="player-column"><div className={`video-player ${locked||videoError||completed||blocked?'player-message':''}`}><BrandedVideo containerRef={playerRef} wrapperClassName="watch-player-shell" ref={videoRef} renderVideo={canPlay||hasVideo} src={source} crossOrigin={source?apiCrossOrigin(source):undefined} poster={series.cover} controls={canPlay} playsInline preload={canPlay?'metadata':'none'} aria-hidden={!canPlay?true:undefined} tabIndex={!canPlay?-1:undefined} style={!canPlay?{visibility:'hidden'}:undefined} onLoadedMetadata={bindMedia} onPlaying={()=>{bindMedia();if(matchesMedia()){setBlockedFor(null);setVideoErrorFor(null);}}} onTimeUpdate={saveProgress} onError={()=>{if(matchesMedia())setVideoErrorFor(epoch);}} onEnded={ended} aria-label={`${series.title} — ${t('episode')} ${ep.number}`} overlay={overlay} fullscreenControls={episodeControls(true)} onFullscreenChange={setFullscreenMode}/>{series.demo===1&&<span className="sample-video-label">{t('sampleVideo')}</span>}</div>{episodeControls()}</div>
    <aside className="watch-sidebar"><Link to={`/series/${id}`} className="watch-series-intro"><span className="eyebrow">{t(`genre_${series.genres[0]}` as Key)}</span><h1 className={seriesTitleClass(series.language)}>{series.title}</h1><div className="detail-meta"><span><Globe2 size={13}/>{spokenLanguageName(series.language,locale)}</span><span>{series.episode_count} {t('episodes')}</span></div><p>{series.description}</p></Link><SubtitleMetadata languages={series.subtitle_languages} standalone/><div className="watch-episode-title"><h3>{t('episodes')}</h3><span>{data.episodes.filter(episode=>episode.free).length} {t('freeEpisodes')}</span></div><nav className="watch-episode-grid" aria-label={`${series.title} — ${t('episodes')}`}>{data.episodes.map(episode=><Link className={`${episode.id===ep.id?'current':''} ${episode.free||episode.unlocked?'open':''}`} key={episode.id} aria-current={episode.id===ep.id?'page':undefined} to={`/watch/${id}/${episode.id}`} onClick={event=>episodeLink(event,episode)} aria-label={`${t('episode')} ${episode.number}${episode.free?' '+t('free'):!episode.unlocked?' '+t('locked'):''}`}><span>{String(episode.number).padStart(2,'0')}</span>{episode.id===ep.id?<span className="playing-bars" aria-hidden="true"><i/><i/><i/></span>:episode.free?<small>{t('free')}</small>:episode.unlocked?<Check size={11}/>:<LockKeyhole size={11}/>}</Link>)}</nav>{series.publisher_id?<Link className="watch-creator creator-profile-link" to={`/publishers/${encodeURIComponent(series.publisher_id)}`} aria-label={`${t('publisherViewProfile')}: ${series.creator_name}`}><Avatar name={series.creator_name} size="small"/><div><small>{t('by')}</small><strong>{series.creator_name}</strong></div><Sparkles size={17} aria-hidden="true"/></Link>:<div className="watch-creator"><Avatar name={series.creator_name} size="small"/><div><small>{t('by')}</small><strong>{series.creator_name}</strong></div><Sparkles size={17}/></div>}{user&&<Link className="watch-wallet" to={`/wallet?return=${encodeURIComponent(returnTo)}`}><WalletIcon size={18}/><span>{t('balance')}<strong>{usd(user.wallet_micros)}</strong></span><ArrowRight size={16}/></Link>}</aside></div>
    <Modal open={confirmFor===dialogKey} onClose={()=>!busy&&setConfirmFor(null)} title={`${t('unlock')} ${ep.number}`} portalTarget={portalTarget}><div className="unlock-preview"><CoverThumbnail src={series.cover} alt={series.title}/><div><h3 className={seriesTitleClass(series.language)}>{series.title}</h3><p>{t('episode')} {ep.number} · {ep.title}</p></div></div><p className="muted">{t('unlockBody')}</p><div className="checkout-total"><span>{t('price')}</span><strong>{usd(price)}</strong></div><div className="balance-row"><span>{t('balance')}</span><span>{usd(user?.wallet_micros||0)}</span></div><div className="revenue-note"><Sparkles size={16}/>{t('creatorShare')}</div>{insufficient?<Link to={`/wallet?return=${encodeURIComponent(returnTo)}`} className="button primary wide" onClick={()=>setConfirmFor(null)}>{t('insufficientFunds')}<ArrowRight size={17}/></Link>:<Button className="button primary wide" busy={busy} onClick={unlock}>{t('confirm')} · {usd(price)}</Button>}</Modal>
    <SeriesUnlockDialog open={bundleFor===dialogKey} onClose={()=>setBundleFor(null)} series={series} returnTo={returnTo} portalTarget={portalTarget} onUnlocked={()=>{if(active.current.dialogKey!==dialogKey)return;setBundleFor(null);playIntent.current={key:selectionKey,kind:'continue'};refresh();}}/>
  </div>;
}
