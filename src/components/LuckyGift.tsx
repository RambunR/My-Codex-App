import type {CSSProperties} from 'react';
import type {DrawPrize} from '../../shared/lucky-draw';
import {CoverThumbnail} from './CoverArtwork';
import '../lucky-gift-reveal.css';

export type GiftPhase='idle'|'drawing'|'revealing'|'revealed';
const artwork='/images/lucky-gift-luxe-v2.webp';

/** Both masked pieces use the same illustration, so the closed seam is exact.
 * The actual saved prize sits behind the front of the box during its rise. */
export function LuckyGift({phase,prize}:{phase:GiftPhase;prize:DrawPrize|null}){
  return <div className={`lucky-gift-scene lucky-${phase}`} aria-hidden="true">
    <div className="lucky-gift-aura"/><div className="lucky-gift-halo"/>
    <span className="lucky-gift-spark lucky-gift-spark-one">✦</span><span className="lucky-gift-spark lucky-gift-spark-two">✧</span>
    <div className="lucky-gift">
      <div className="lucky-box-radiance"/>
      <svg className="lucky-box-interior" viewBox="0 0 400 400" focusable="false"><path d="M27 221H349L374 186H49Z" fill="#492547" stroke="#ddbda1" strokeWidth="3"/><path d="M39 216H344L365 191H56Z" fill="#221126"/></svg>
      {prize?.series&&<div className="lucky-flying-cover" data-prize-series={prize.series.id}><CoverThumbnail src={prize.series.cover} alt="" onError={event=>{if(!event.currentTarget.dataset.fallback){event.currentTarget.dataset.fallback='true';event.currentTarget.src='/images/placeholder.svg';}}}/></div>}
      <img className="lucky-gift-art lucky-gift-base" src={artwork} alt="" width="896" height="896" draggable={false} fetchPriority="high"/>
      <img className="lucky-gift-art lucky-gift-lid" src={artwork} alt="" width="896" height="896" draggable={false}/>
    </div>
    <div className="lucky-reveal-particles">{Array.from({length:14},(_,index)=><i key={index} style={{'--i':index,'--angle':`${index*360/14}deg`} as CSSProperties}/>)}</div>
    <div className="lucky-gift-floor"/>
  </div>;
}
