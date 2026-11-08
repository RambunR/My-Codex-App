import {seriesTitleClass} from '../series-title';
import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {Link} from 'react-router-dom';
import {Play,Plus,ChevronDown} from 'lucide-react';
import {type Series} from '../../shared/config';
import {useI18n,type Key} from '../i18n';
import {spokenLanguageName} from '../spoken-language-locales';
import {CoverArtwork,CoverWatermark} from './CoverArtwork';

const DWELL_MS=8000,FADE_MS=280;
type Phase='idle'|'out'|'in';

/** One active slide keeps links, artwork and metadata together. Rotation stops
 * while a visitor is reading or interacting, and never runs in reduced motion. */
export function SuggestedHero({suggestions,fallback}:{suggestions:Series[];fallback?:Series}){
  const{t,locale}=useI18n();
  const[activeId,setActiveId]=useState<string|null>(null),[phase,setPhase]=useState<Phase>('idle');
  const[touchPaused,setTouchPaused]=useState(false),[hoverPaused,setHoverPaused]=useState(false),[focusPaused,setFocusPaused]=useState(false);
  const[hidden,setHidden]=useState(()=>document.hidden);
  const touchPointers=useRef(new Set<number>());
  const[reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hero=suggestions.find(series=>series.id===activeId)||suggestions[0]||fallback;
  const index=Math.max(0,suggestions.findIndex(series=>series.id===hero?.id));
  const slideKey=suggestions.map(series=>series.id).join('|');
  const slidesRef=useRef(suggestions),activeRef=useRef(hero?.id);slidesRef.current=suggestions;activeRef.current=hero?.id;
  const swapTimer=useRef<ReturnType<typeof setTimeout>|null>(null),firstFrame=useRef<number|null>(null),secondFrame=useRef<number|null>(null);
  const synopsisRef=useRef<HTMLDivElement>(null),heroCopyRef=useRef<HTMLDivElement>(null);
  const[heroScroll,setHeroScroll]=useState({synopsisMore:false,copyOverflow:false});
  const cancelTransition=useCallback(()=>{
    if(swapTimer.current!==null)clearTimeout(swapTimer.current);
    if(firstFrame.current!==null)cancelAnimationFrame(firstFrame.current);
    if(secondFrame.current!==null)cancelAnimationFrame(secondFrame.current);
    swapTimer.current=null;firstFrame.current=null;secondFrame.current=null;
  },[]);
  const settleTransition=useCallback(()=>{cancelTransition();setPhase('idle');},[cancelTransition]);
  const goTo=useCallback((nextIndex:number)=>{
    const slides=slidesRef.current;if(slides.length<2)return;
    const target=slides[(nextIndex%slides.length+slides.length)%slides.length];
    if(target.id===activeRef.current)return;
    cancelTransition();
    if(reducedMotion){setActiveId(target.id);setPhase('idle');return;}
    setPhase('out');
    swapTimer.current=setTimeout(()=>{
      swapTimer.current=null;
      if(!slidesRef.current.some(series=>series.id===target.id)){setPhase('idle');return;}
      setActiveId(target.id);setPhase('in');
      firstFrame.current=requestAnimationFrame(()=>{
        firstFrame.current=null;
        secondFrame.current=requestAnimationFrame(()=>{secondFrame.current=null;setPhase('idle');});
      });
    },FADE_MS);
  },[cancelTransition,reducedMotion]);
  useEffect(()=>cancelTransition,[cancelTransition]);
  useEffect(()=>{settleTransition();},[slideKey,settleTransition]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>{setReducedMotion(media.matches);settleTransition();};
    media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[settleTransition]);
  useEffect(()=>{
    const visibility=()=>{setHidden(document.hidden);if(document.hidden){touchPointers.current.clear();setTouchPaused(false);settleTransition();}};
    document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);
  },[settleTransition]);
  useEffect(()=>{
    const finishTouch=(event:PointerEvent)=>{if(touchPointers.current.delete(event.pointerId))setTouchPaused(touchPointers.current.size>0);};
    const loseFocus=()=>{touchPointers.current.clear();setTouchPaused(false);};
    window.addEventListener('pointerup',finishTouch);window.addEventListener('pointercancel',finishTouch);window.addEventListener('blur',loseFocus);
    return()=>{window.removeEventListener('pointerup',finishTouch);window.removeEventListener('pointercancel',finishTouch);window.removeEventListener('blur',loseFocus);};
  },[]);
  const rotating=suggestions.length>1&&!touchPaused&&!hoverPaused&&!focusPaused&&!hidden&&!reducedMotion;
  useEffect(()=>{
    if(!rotating||phase!=='idle')return;
    const timer=setTimeout(()=>goTo(index+1),DWELL_MS);return()=>clearTimeout(timer);
  },[rotating,phase,hero?.id,index,slideKey,goTo]);
  // Warm only the next artwork; the active image itself is remounted at a swap
  // so a slow connection cannot show the previous cover with the new title.
  useEffect(()=>{
    if(suggestions.length<2||!hero)return;
    const image=new Image();image.decoding='async';image.fetchPriority='low';image.src=suggestions[(index+1)%suggestions.length].cover;
  },[slideKey,hero?.id,index]);
  const measureHeroScroll=()=>{
    const synopsis=synopsisRef.current,copy=heroCopyRef.current;
    const next={synopsisMore:!!synopsis&&synopsis.scrollHeight>synopsis.clientHeight+synopsis.scrollTop+2,copyOverflow:!!copy&&copy.scrollHeight>copy.clientHeight+2};
    setHeroScroll(current=>current.synopsisMore===next.synopsisMore&&current.copyOverflow===next.copyOverflow?current:next);
  };
  const updatePointerPause=(event:ReactPointerEvent<HTMLElement>)=>{
    if(event.pointerType==='touch')return;
    const selector='a,button,.hero-synopsis';
    let paused=event.target instanceof Element&&!!event.target.closest(selector);
    // Fading layers are inert, so hit testing targets the section instead of
    // its links. Preserve the link under an approaching pointer before a swap.
    if(!paused&&phase!=='idle')paused=Array.from(event.currentTarget.querySelectorAll(selector)).some(element=>{
      const box=element.getBoundingClientRect();return event.clientX>=box.left&&event.clientX<box.right&&event.clientY>=box.top&&event.clientY<box.bottom;
    });
    setHoverPaused(paused);if(paused)settleTransition();
  };
  useEffect(()=>{
    const synopsis=synopsisRef.current,copy=heroCopyRef.current;if(!synopsis||!copy)return;
    synopsis.scrollTop=0;copy.scrollTop=0;measureHeroScroll();
    const observer=new ResizeObserver(measureHeroScroll);observer.observe(synopsis);observer.observe(copy);
    return()=>observer.disconnect();
  },[hero?.id,hero?.title,hero?.description,locale]);
  if(!hero)return null;
  const suggested=suggestions.some(series=>series.id===hero.id);
  return <section className={`hero hero-bounded hero-${hero.genres[0]} ${hero.demo===1?'':'hero-user-artwork'}`} aria-label={hero.title} data-suggested-carousel={suggestions.length>1?'true':'false'} data-carousel-phase={phase} data-autoplay={rotating?'running':'paused'}
    onPointerOver={updatePointerPause} onPointerMove={updatePointerPause}
    onPointerLeave={event=>{if(event.pointerType!=='touch')setHoverPaused(false);}}
    onPointerDownCapture={event=>{if(event.pointerType==='touch'&&suggestions.length>1){touchPointers.current.add(event.pointerId);setTouchPaused(true);settleTransition();}}}
    onFocusCapture={()=>{setFocusPaused(true);settleTransition();}}
    onBlurCapture={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setFocusPaused(false);}}>
    <div className="hero-art cover-artwork-frame" inert={phase!=='idle'} aria-hidden={phase!=='idle'?true:undefined}><CoverArtwork key={hero.id} src={hero.cover} alt="" fetchPriority="high" decoding="async"/><CoverWatermark/></div>
    <div ref={heroCopyRef} className={`hero-copy${heroScroll.copyOverflow?' is-scrollable':''}`} tabIndex={heroScroll.copyOverflow?0:undefined} role="group" aria-label={t('aboutSeries')} inert={phase!=='idle'} aria-hidden={phase!=='idle'?true:undefined}>
      <div className="hero-story-meta"><div className="spotlight"><span/>{t(suggested?'suggestedByLingYing':'newReleases')}</div><div className="hero-pills"><span>{t(`genre_${hero.genres[0]}` as Key)}</span><i/><span>{spokenLanguageName(hero.language,locale)}</span><i/><span>{hero.episode_count} {t('episodes')}</span></div></div>
      <h2 className={seriesTitleClass(hero.language)}><Link to={`/series/${hero.id}`}>{hero.title}</Link></h2>
      <div className="hero-synopsis-wrap"><div ref={synopsisRef} className="hero-synopsis" tabIndex={0} role="region" aria-label={t('description')} onScroll={measureHeroScroll}><p>{hero.description}</p></div>{heroScroll.synopsisMore&&<span className="hero-synopsis-more" aria-hidden="true"><ChevronDown size={15}/></span>}</div>
      <div className="hero-buttons"><Link className="button hero-play" to={hero.first_episode_id?`/watch/${hero.id}/${hero.first_episode_id}`:`/series/${hero.id}`}><Play size={17} fill="currentColor"/>{t('watchNow')}</Link><Link className="button hero-details" to={`/series/${hero.id}`}><Plus size={19}/>{t('aboutSeries')}</Link></div>{hero.free_episodes>0&&<span className="hero-free"><span className="free-dot"/>{t('freeAccess')}</span>}
    </div>
  </section>;
}
