import {useEffect,useRef,useState} from 'react';
import {LuckyGift,type GiftPhase} from '../components/LuckyGift';
import {LuckyDrawResult} from '../components/LuckyDrawResult';
import {drawDate} from '../lucky-draw-utils';
export {drawDate} from '../lucky-draw-utils';
import {Link} from 'react-router-dom';
import {Gift,Sparkles,Ticket,ArrowRight,Check,Clock3,LockKeyhole} from 'lucide-react';
import {api,ApiError,useApi} from '../api';
import {useApp} from '../context';
import {useI18n} from '../i18n';
import {Button,ErrorState,Loading,SeriesCard} from '../ui';
import {CoverThumbnail} from '../components/CoverArtwork';
import {seriesTitleClass} from '../series-title';
import type {DrawPool,DrawPrize,DrawResponse,DrawState} from '../../shared/lucky-draw';
import '../lucky-draw.css';

const storageKey=(userId:string)=>'lingying-lucky-draw-pending:'+userId;
function savedRequest(userId?:string){if(!userId)return '';try{const value=sessionStorage.getItem(storageKey(userId))||'';return /^[a-f0-9-]{36}$/i.test(value)?value:'';}catch{return '';}}
export function PrizeCard({prize,feature=false,onDetails}:{prize:DrawPrize;feature?:boolean;onDetails?:(prize:DrawPrize)=>void}){const{t,locale}=useI18n();return <article className={`lucky-prize-card${feature?' lucky-prize-feature':''}`} data-draw-id={prize.id}>{prize.series&&<Link to={`/series/${prize.series.id}`} tabIndex={-1} aria-hidden="true"><CoverThumbnail src={prize.series.cover} alt=""/></Link>}<div>{feature&&<span className="lucky-win-label"><Check size={15}/>{t('luckyWon')}</span>}<h3 className={seriesTitleClass(prize.series?.language)}>{prize.series?.title||prize.title}</h3><p className="lucky-draw-date"><Clock3 size={13}/><span>{t('luckyDrawnAt')} <time dateTime={prize.drawn_at}>{drawDate(prize.drawn_at,locale)}</time></span></p>{onDetails&&<button className="button ghost small lucky-prize-details" onClick={()=>onDetails(prize)}>{t('luckyViewDetails')}</button>}{prize.series?<Link className="button secondary small" to={prize.series.first_episode_id?`/watch/${prize.series.id}/${prize.series.first_episode_id}`:`/series/${prize.series.id}`}>{t('watchNow')}<ArrowRight size={15}/></Link>:<p className="muted"><LockKeyhole size={14}/> {t('luckyUnavailable')}</p>}</div></article>;}
export function LuckyDrawPage(){const{ready,user}=useApp();if(!ready)return <Loading/>;return <LuckyDrawContent key={user?.id||'guest'}/>;}
function LuckyDrawContent(){
 const{user,refreshUser}=useApp();const{t,locale}=useI18n();const[page,setPage]=useState(1);const pool=useApi<DrawPool>('/api/lucky-draw/pool');const state=useApi<DrawState>(user?`/api/lucky-draw?page=${page}`:undefined);
 const[pending,setPending]=useState(()=>savedRequest(user?.id));const pendingRef=useRef(pending),writing=useRef(false),mounted=useRef(true);
 const[recovering,setRecovering]=useState(!!pending),[phase,setPhase]=useState<GiftPhase>('idle'),[prize,setPrize]=useState<DrawPrize|null>(null),[failure,setFailure]=useState('');
 const[detailPrize,setDetailPrize]=useState<DrawPrize|null>(null);const resultRef=useRef<HTMLDivElement>(null);
 const closeDetails=()=>{setDetailPrize(null);requestAnimationFrame(()=>{if(document.activeElement===document.body)resultRef.current?.focus();});};
 const clearPending=()=>{pendingRef.current='';setPending('');try{if(user)sessionStorage.removeItem(storageKey(user.id));}catch{}};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!user||!pendingRef.current)return;let active=true;api<DrawResponse>('/api/lucky-draw/draws/'+pendingRef.current).then(reply=>{if(!active)return;setPrize(reply.draw);setPhase('revealed');setDetailPrize(reply.draw);clearPending();state.refresh();pool.refresh();}).catch(error=>{if(active&&!(error instanceof ApiError&&error.status===404))setFailure(t('luckyUnknown'));}).finally(()=>{if(active)setRecovering(false);});return()=>{active=false;};},[user?.id]);
 const eligible=pool.data?.series.filter(series=>series.eligible).length||0,busy=phase==='drawing'||phase==='revealing'||recovering;
 const draw=async()=>{
  if(!user||writing.current||busy||detailPrize)return;writing.current=true;setFailure('');setPrize(null);setPhase('drawing');
  const key=pendingRef.current||crypto.randomUUID();pendingRef.current=key;setPending(key);try{sessionStorage.setItem(storageKey(user.id),key);}catch{}
  try{
   const delay=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:650;
   const [reply]=await Promise.all([api<DrawResponse>('/api/lucky-draw/draw',{method:'POST',body:JSON.stringify({request_id:key}),signal:AbortSignal.timeout(20000)}),new Promise(resolve=>window.setTimeout(resolve,delay))]);
   if(!mounted.current)return;clearPending();setPage(1);state.refresh();pool.refresh();
   if(delay&&reply.draw.series?.cover){const cover=new Image();cover.src=reply.draw.series.cover;await Promise.race([cover.decode().catch(()=>{}),new Promise(resolve=>window.setTimeout(resolve,1500))]);}
   if(!mounted.current)return;setPrize(reply.draw);setPhase(delay?'revealing':'revealed');
   if(delay)await new Promise(resolve=>window.setTimeout(resolve,1450));
   if(!mounted.current)return;setPhase('revealed');setDetailPrize(reply.draw);
  }catch(error){if(!mounted.current)return;setPhase('idle');if(error instanceof ApiError&&['DRAW_NO_CHANCES','DRAW_POOL_EMPTY'].includes(error.code)){clearPending();setFailure(t(error.code==='DRAW_NO_CHANCES'?'luckyNoChances':'luckyNoNew'));}else{setFailure(t('luckyUnknown'));if(error instanceof ApiError&&error.status===401)void refreshUser();}state.refresh();pool.refresh();}
  finally{writing.current=false;}
 };
 const blocked=!!user&&!pending&&(!state.data||state.data.remaining<1||eligible<1),loading=pool.loading&&!pool.data||!!user&&state.loading&&!state.data;
 return <div className="page lucky-draw-page">
  <section className="lucky-hero" aria-labelledby="lucky-title"><div className="lucky-hero-copy"><span className="eyebrow"><Sparkles size={14}/> LingYing</span><h1 id="lucky-title">{t('luckyTitle')}<span className="lucky-title-spark" aria-hidden="true">✦</span></h1><p className="lucky-intro">{t('luckyIntro')}</p>{user&&<div className="lucky-counter"><Ticket size={22}/><div><span>{t('luckyChances')}</span><strong>{state.data?state.data.remaining.toLocaleString(locale):'—'}</strong></div></div>}
   <div className="lucky-primary-action">{user?<Button className="button primary lucky-draw-button" onClick={draw} busy={busy} disabled={blocked||loading||!!detailPrize} aria-describedby="lucky-rules">{busy?t(recovering?'luckyRecovering':'luckyDrawing'):t(pending?'luckyRetry':'luckyDraw')}{!busy&&<Gift size={19}/>}</Button>:<><Link className="button primary lucky-draw-button" to="/auth?mode=register&next=%2Flucky-draw">{t('luckyRegister')}<ArrowRight size={18}/></Link><Link className="lucky-sign-in" to="/auth?next=%2Flucky-draw">{t('signIn')}</Link></>}</div>
   {user&&!loading&&!busy&&!pending&&<p className="lucky-availability">{state.data?.remaining===0?t('luckyNoChances'):!pool.data?.series.length?t('luckyEmptyPool'):!eligible?t('luckyNoNew'):null}</p>}
   {failure&&<p className="form-error" role="alert">{failure}</p>}<p id="lucky-rules" className="lucky-rules">{t('luckyRules')}</p>
  </div><LuckyGift phase={phase} prize={prize}/></section>
  {loading&&<Loading/>}{pool.error&&<ErrorState error={pool.error} retry={pool.refresh}/>} {user&&state.error&&<ErrorState error={state.error} retry={state.refresh}/>}
  <div className="lucky-result" ref={resultRef} tabIndex={-1} aria-live="polite" aria-atomic="true">{phase==='revealed'&&prize&&<PrizeCard prize={prize} feature onDetails={setDetailPrize}/>}</div>
  <section className="lucky-wins" aria-labelledby="lucky-wins-title"><div className="lucky-section-heading"><h2 id="lucky-wins-title"><Check size={19}/>{t('luckyWins')}</h2>{user&&state.data&&<span>{t('luckyUsed')} <b>{state.data.used.toLocaleString(locale)}</b></span>}</div>{!user?<p className="muted">{t('luckyNoWins')} <Link to="/auth?mode=register&next=%2Flucky-draw">{t('luckyRegister')}</Link></p>:state.data?.unlocked.length?<><div className="lucky-prize-grid">{state.data.unlocked.map(item=><PrizeCard key={item.id} prize={item} onDetails={setDetailPrize}/>)}</div>{state.data.unlockedTotal>state.data.pageSize&&<nav className="lucky-pagination" aria-label={t('luckyHistory')}><button className="button secondary small" disabled={page===1||state.loading} onClick={()=>setPage(value=>value-1)}>{t('previous')}</button><span>{page} / {Math.ceil(state.data.unlockedTotal/state.data.pageSize)}</span><button className="button secondary small" disabled={page*state.data.pageSize>=state.data.unlockedTotal||state.loading} onClick={()=>setPage(value=>value+1)}>{t('next')}</button></nav>}</>:<p className="lucky-empty-wins"><Gift size={21}/>{t('luckyNoWins')}</p>}</section>
  <section className="lucky-pool" aria-labelledby="lucky-pool-title"><div className="lucky-section-heading"><h2 id="lucky-pool-title"><Gift size={19}/>{t('luckyPool')}</h2>{pool.data&&<span>{pool.data.series.length.toLocaleString(locale)}</span>}</div>{pool.data?.series.length?<div className="lucky-pool-grid">{pool.data.series.map(series=><div className="lucky-pool-item" key={series.id}><SeriesCard series={series}/>{user&&<span className={`lucky-pool-eligibility ${series.eligible?'is-eligible':''}`}>{series.eligible?<Ticket size={13}/>:<Check size={13}/>} {t(series.eligible?'luckyEligible':'luckyAlreadyUnlocked')}</span>}</div>)}</div>:!pool.loading&&!pool.error&&<p className="muted">{t('luckyEmptyPool')}</p>}</section>
 <LuckyDrawResult prize={detailPrize} onClose={closeDetails}/>
 </div>;
}
