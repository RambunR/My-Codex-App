import {Link,useParams,useSearchParams} from 'react-router-dom';
import {BadgeCheck,CalendarDays,ChevronLeft,ChevronRight,Clapperboard,Clock3,Eye,Heart,Info} from 'lucide-react';
import {useApi} from '../api';
import {useI18n} from '../i18n';
import {Avatar,BackLink,Empty,engagementCount,ErrorState,Loading,SectionHeading,SeriesCard} from '../ui';
import type {PublisherPage} from '../../shared/config';
import '../publisher-profile.css';

function profileDate(value:string,locale:string){
  const date=new Date(`${value.slice(0,10)}T00:00:00Z`);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:'long',timeZone:'UTC'}).format(date):value;
}

// Unit formatting follows the selected locale, including numbers and RTL text.
// Display no more than two units, without inventing unrecorded historical time.
function watchDuration(value:number,locale:string){
  const seconds=Math.max(0,Math.floor(Number.isFinite(value)?value:0));
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
  const unit=(amount:number,name:'hour'|'minute'|'second')=>new Intl.NumberFormat(locale,{style:'unit',unit:name,unitDisplay:'short',maximumFractionDigits:0}).format(amount);
  if(hours)return [unit(hours,'hour'),minutes?unit(minutes,'minute'):undefined].filter(Boolean).join(' ');
  if(minutes)return [unit(minutes,'minute'),seconds%60?unit(seconds%60,'second'):undefined].filter(Boolean).join(' ');
  return unit(seconds,'second');
}

export function Publisher(){
  const{id}=useParams();
  const[params,setParams]=useSearchParams();
  const{t,locale}=useI18n();
  const pageInput=Number(params.get('page')||1);
  const requestedPage=Number.isSafeInteger(pageInput)&&pageInput>0?pageInput:1;
  const{data,loading,error,refresh}=useApi<PublisherPage>(id?`/api/publishers/${encodeURIComponent(id)}?page=${requestedPage}&page_size=24`:undefined);
  if(loading||(!error&&data?.publisher.id!==id))return <Loading/>;
  if(error)return <div className="page publisher-page"><BackLink to="/browse" label={t('explore')}/><ErrorState error={error} retry={refresh}/></div>;
  if(!data)return <Empty title={t('noResults')}/>;
  const{publisher,stats,pagination}=data;
  const count=(value:number)=>engagementCount(value,locale,false);
  const changePage=(value:number)=>{
    const next=new URLSearchParams(params);if(value<=1)next.delete('page');else next.set('page',String(value));setParams(next);
    window.scrollTo({top:0,behavior:'instant'});
  };
  return <div className="page catalog-page publisher-page">
    <BackLink to="/browse" label={t('explore')}/>
    <header className="publisher-public-heading">
      <Avatar name={publisher.display_name}/>
      <div className="publisher-public-identity">
        <div className="publisher-public-labels"><span className="eyebrow">{t('publisherPublicProfile')}</span>{publisher.is_official&&<span className="publisher-official-badge"><BadgeCheck size={14} aria-hidden="true"/>{t('publisherOfficial')}</span>}</div>
        <h1>{publisher.display_name}</h1>
        <p className="publisher-public-date"><CalendarDays size={16} aria-hidden="true"/><span>{t('publisherRegistered')}</span><time dateTime={publisher.registered_at}>{profileDate(publisher.registered_at,locale)}</time></p>
      </div>
    </header>
    <dl className="publisher-public-stats" aria-label={t('publisherPublicProfile')}>
      <div><dt><Clapperboard size={18} aria-hidden="true"/>{t('publisherReleasedSeries')}</dt><dd>{count(stats.series_count)}</dd><small>{count(stats.episode_count)} {t('episodes')}</small></div>
      <div><dt><Eye size={18} aria-hidden="true"/>{t('publisherTotalViews')}</dt><dd>{count(stats.views)}</dd></div>
      <div><dt><Heart size={18} aria-hidden="true"/>{t('publisherReceivedLikes')}</dt><dd>{count(stats.likes)}</dd></div>
      <div><dt><Clock3 size={18} aria-hidden="true"/>{t('publisherWatchTime')}</dt><dd className="publisher-public-duration"><bdi>{watchDuration(stats.total_watch_seconds,locale)}</bdi></dd><small>{t('analyticsAverage')} · <bdi>{watchDuration(stats.avg_watch_seconds,locale)}</bdi></small></div>
    </dl>
    <p className="publisher-public-stats-note"><Info size={14} aria-hidden="true"/>{t('publisherStatsNote')}</p>
    <section className="publisher-public-series" aria-labelledby="publisher-series-heading">
      <div id="publisher-series-heading"><SectionHeading title={t('publisherReleasedSeries')}><span>{count(pagination.total)}</span></SectionHeading></div>
      {data.series.length?<div className="poster-grid browse-grid">{data.series.map(series=><SeriesCard key={series.id} series={series}/>)}</div>:<Empty title={t('publisherNoSeries')} body={t('publisherNoSeriesBody')} action={<Link className="button secondary" to="/browse">{t('explore')}</Link>}/>}
      {pagination.total_pages>1&&<nav className="publisher-public-pagination" aria-label={t('publisherReleasedSeries')}>
        <button type="button" className="button secondary" disabled={pagination.page<=1} onClick={()=>changePage(pagination.page-1)}><ChevronLeft size={17} aria-hidden="true"/>{t('previous')}</button>
        <span role="status">{t('publisherPage').replace('{page}',count(pagination.page)).replace('{pages}',count(pagination.total_pages))}</span>
        <button type="button" className="button secondary" disabled={pagination.page>=pagination.total_pages} onClick={()=>changePage(pagination.page+1)}>{t('next')}<ChevronRight size={17} aria-hidden="true"/></button>
      </nav>}
    </section>
  </div>;
}
