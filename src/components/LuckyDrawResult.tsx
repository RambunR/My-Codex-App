import {useRef} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight,Check,BookmarkCheck,LockKeyhole} from 'lucide-react';
import type {DrawPrize} from '../../shared/lucky-draw';
import {useI18n,type Key} from '../i18n';
import {spokenLanguageName} from '../spoken-language-locales';
import {Modal} from '../ui';
import {CoverArtwork,CoverWatermark,coverFrameStyle} from './CoverArtwork';
import {seriesTitleClass} from '../series-title';
import {drawDate,seriesDate} from '../lucky-draw-utils';
import '../lucky-gift-reveal.css';

export function LuckyDrawResult({prize,onClose}:{prize:DrawPrize|null;onClose:()=>void}){
  const{t,locale}=useI18n();const watch=useRef<HTMLAnchorElement>(null),series=prize?.series;
  const uploaded=seriesDate(series?.uploaded_at,locale),published=seriesDate(series?.published_at,locale);
  return <Modal open={!!prize} onClose={onClose} title={t('luckyWon')} wide initialFocusRef={series?watch:undefined}>
    {prize&&<div className="lucky-result-panel" data-series-id={series?.id}>
      <div className="lucky-result-content">
        {series&&<div className="lucky-result-poster cover-artwork-frame" style={coverFrameStyle(series.cover_aspect_ratio)}><CoverArtwork src={series.cover} alt={series.title} onError={event=>{if(!event.currentTarget.dataset.fallback){event.currentTarget.dataset.fallback='true';event.currentTarget.src='/images/placeholder.svg';}}}/><CoverWatermark/></div>}
        <div className="lucky-result-details"><span className="lucky-result-badge"><Check size={13}/>{t('luckyUnlocked')}</span><h3 className={seriesTitleClass(series?.language)}>{series?.title||prize.title}</h3>
          {series?<><dl className="lucky-result-metadata">
            {!!series.genres.length&&<div className="lucky-result-genres"><dt>{t('genre')}</dt><dd>{series.genres.map(genre=><span key={genre}>{t((genre==='animation'?'animation':`genre_${genre}`) as Key)}</span>)}</dd></div>}
            <div><dt>{t('episodes')}</dt><dd>{series.episode_count.toLocaleString(locale)}</dd></div>
            <div><dt>{t('spokenLanguage')}</dt><dd>{spokenLanguageName(series.language,locale)}</dd></div>
            {uploaded&&<div><dt>{t('luckyUploadDate')}</dt><dd><time dateTime={series.uploaded_at!} title={series.uploaded_at!}>{uploaded}</time></dd></div>}
            {published&&<div><dt>{t('luckyPublishedOn')}</dt><dd><time dateTime={series.published_at} title={series.published_at}>{published}</time></dd></div>}
            <div className="lucky-result-creator"><dt>{t('by')}</dt><dd>{series.creator_name}</dd></div>
          </dl>{series.description&&<p className="lucky-result-synopsis">{series.description}</p>}</>:<p className="muted lucky-result-unavailable"><LockKeyhole size={16}/>{t('luckyUnavailable')}</p>}
          <p className="lucky-result-time">{t('luckyDrawnAt')} <time dateTime={prize.drawn_at}>{drawDate(prize.drawn_at,locale)}</time></p>
        </div>
      </div>
      <p className="lucky-result-saved"><BookmarkCheck size={17}/>{t('luckySavedHint')}</p>
      <div className="lucky-result-actions">{series&&<Link ref={watch} className="button primary lucky-view-now" to={series.first_episode_id?`/watch/${series.id}/${series.first_episode_id}`:`/series/${series.id}`} onClick={onClose}>{t('luckyViewNow')}<ArrowRight size={17}/></Link>}<button className="button secondary lucky-watch-later" onClick={onClose}>{t('luckyWatchLater')}</button></div>
    </div>}
  </Modal>;
}
