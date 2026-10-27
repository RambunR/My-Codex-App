import {useEffect,useRef,useState,type FormEvent} from 'react';
import {BarChart3,Clock3,Eye,Heart,RefreshCw,Users,X} from 'lucide-react';
import {useApi} from '../api';
import {useI18n,type Key} from '../i18n';
import {ErrorState,Loading} from '../ui';
import type {SeriesAnalytics as SeriesAnalyticsData} from '../../shared/analytics';
import '../analytics.css';

type Period='7d'|'30d'|'90d'|'all'|'custom';
const periodLabels:Record<Period,Key>={'7d':'analytics7d','30d':'analytics30d','90d':'analytics90d',all:'analyticsAll',custom:'analyticsCustom'};
function duration(seconds:number){
  const n=Math.max(0,Math.round(seconds||0)),hours=Math.floor(n/3600),minutes=Math.floor(n%3600/60),rest=String(n%60).padStart(2,'0');
  return hours?`${hours}:${String(minutes).padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;
}
function utcDate(value:string,locale:string){return new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));}

export function SeriesAnalytics({seriesId,onClose}:{seriesId:string;onClose?:()=>void}){
  const{t,locale}=useI18n();const panel=useRef<HTMLElement>(null);
  useEffect(()=>{panel.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[seriesId]);
  const[period,setPeriod]=useState<Period>('30d');const[query,setQuery]=useState('period=30d');const[dateError,setDateError]=useState(false);
  const today=new Date().toISOString().slice(0,10);
  const[from,setFrom]=useState(()=>new Date(Date.now()-29*86400000).toISOString().slice(0,10));const[to,setTo]=useState(today);
  const{data,loading,error,refresh}=useApi<SeriesAnalyticsData>(`/api/studio/series/${encodeURIComponent(seriesId)}/analytics?${query}`);
  const selectPeriod=(value:Period)=>{setPeriod(value);setDateError(false);if(value!=='custom')setQuery(new URLSearchParams({period:value}).toString());};
  const apply=(event:FormEvent)=>{
    event.preventDefault();const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(start)||!Number.isFinite(end)||start>end||end-start>=366*86400000){setDateError(true);return;}
    setDateError(false);setQuery(new URLSearchParams({start:from,end:to}).toString());
  };
  const count=(n:number)=>new Intl.NumberFormat(locale).format(n||0);
  const daily=data?.daily||[];const maxViews=Math.max(1,...daily.map(day=>day.views));
  const points=daily.map((day,index)=>`${daily.length===1?500:index/(daily.length-1)*1000},${118-day.views/maxViews*104}`).join(' ');
  return <section ref={panel} className="series-analytics panel" aria-label={t('analytics')}>
    <div className="analytics-heading"><div><span className="eyebrow">{t('studio')}</span><h2><BarChart3 size={20}/>{t('analytics')}</h2>{data?.series&&<p>{data.series.title}</p>}</div><div className="analytics-heading-actions"><button className="icon-button" disabled={loading} onClick={refresh} aria-label={t('analyticsRefresh')}><RefreshCw size={18}/></button>{onClose&&<button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={19}/></button>}</div></div>
    <form className="analytics-filters" onSubmit={apply}><label className="field">{t('analyticsRange')}<select aria-label={t('analyticsRange')} value={period} onChange={event=>selectPeriod(event.target.value as Period)}>{(Object.keys(periodLabels) as Period[]).map(value=><option value={value} key={value}>{t(periodLabels[value])}</option>)}</select></label>{period==='custom'&&<><label className="field">{t('analyticsFrom')}<input aria-label={t('analyticsFrom')} type="date" value={from} max={to||undefined} onChange={event=>setFrom(event.target.value)} required/></label><label className="field">{t('analyticsTo')}<input aria-label={t('analyticsTo')} type="date" value={to} min={from||undefined} onChange={event=>setTo(event.target.value)} required/></label><button className="button secondary analytics-apply" type="submit">{t('analyticsApply')}</button></>}<span className="analytics-utc">{t('analyticsUtc')}</span></form>
    {dateError&&<p className="form-error" role="alert">{t('analyticsInvalidDates')}</p>}
    {loading?<Loading/>:error?<ErrorState error={error} retry={refresh}/>:data&&<>
      <p className="analytics-selected-range"><time dateTime={data.range.start}>{utcDate(data.range.start,locale)}</time><span aria-hidden="true">–</span><time dateTime={data.range.end}>{utcDate(data.range.end,locale)}</time></p>
      <div className="analytics-summary"><div><span><Eye size={16}/>{t('views')}</span><strong>{count(data.totals.views)}</strong><small>{t('analyticsWatchTime')} · <bdi>{duration(data.totals.watchSeconds)}</bdi></small></div><div><span><Clock3 size={16}/>{t('analyticsAverage')}</span><strong><bdi>{duration(data.totals.avgWatchSeconds)}</bdi></strong><small>{t('views')} · {count(data.totals.views)}</small></div><div><span><Users size={16}/>{t('analyticsPaidViewers')}</span><strong>{count(data.totals.paidViewers)}</strong><small>{count(data.totals.paidUnlocks)} {t('analyticsPaidUnlocks')}</small></div><div><span><Heart size={16}/>{t('analyticsTotalLikes')}</span><strong>{count(data.totals.likes)}</strong><small>{t('analyticsLikeNote')}</small></div></div>
      <div className="analytics-chart-section"><div className="analytics-section-heading"><h3>{t('analyticsViewsTrend')}</h3><span>{t('views')} · {count(data.totals.views)}</span></div>{data.totals.views===0?<div className="analytics-no-activity"><BarChart3 size={28}/><p>{t('analyticsNoActivity')}</p></div>:<div className="analytics-chart"><div className="analytics-chart-max">{count(maxViews)}</div><svg viewBox="0 0 1000 130" role="img" aria-label={t('analyticsViewsTrend')} preserveAspectRatio="none"><title>{t('analyticsViewsTrend')}</title><line x1="0" y1="118" x2="1000" y2="118" className="analytics-chart-baseline"/>{daily.length>1&&<polygon points={`0,118 ${points} 1000,118`} className="analytics-chart-fill"/>}<polyline points={points} className="analytics-chart-line" vectorEffect="non-scaling-stroke"/>{daily.length===1&&<circle cx="500" cy={118-daily[0].views/maxViews*104} r="4" className="analytics-chart-dot"/>}</svg><div className="analytics-chart-dates"><time dateTime={daily[0]?.date}>{daily[0]&&utcDate(daily[0].date,locale)}</time><time dateTime={daily.at(-1)?.date}>{daily.at(-1)&&utcDate(daily.at(-1)!.date,locale)}</time></div><details className="analytics-daily-details"><summary>{t('analyticsViewsTrend')}</summary><div className="analytics-table-scroll"><table><thead><tr><th>{t('analyticsRange')}</th><th>{t('views')}</th><th>{t('analyticsAverage')}</th><th>{t('analyticsPaidViewers')}</th></tr></thead><tbody>{daily.map(day=><tr key={day.date}><td><time dateTime={day.date}>{utcDate(day.date,locale)}</time></td><td>{count(day.views)}</td><td><bdi>{duration(day.avgWatchSeconds)}</bdi></td><td>{count(day.paidViewers)}</td></tr>)}</tbody></table></div></details></div>}</div>
      <div className="analytics-episodes"><h3>{t('analyticsEpisodeStats')}</h3>{data.episodes.length?<div className="analytics-table-scroll"><table><thead><tr><th scope="col">{t('episode')}</th><th scope="col">{t('views')}</th><th scope="col">{t('analyticsAverage')}</th><th scope="col">{t('analyticsPaidViewers')}</th><th scope="col">{t('analyticsPaidUnlocks')}</th></tr></thead><tbody>{data.episodes.map(episode=><tr key={episode.id}><th scope="row"><span className="analytics-episode-number">{String(episode.number).padStart(2,'0')}</span><span>{episode.title}</span></th><td data-label={t('views')}>{count(episode.views)}</td><td data-label={t('analyticsAverage')}><bdi>{duration(episode.avgWatchSeconds)}</bdi></td><td data-label={t('analyticsPaidViewers')}>{count(episode.paidViewers)}</td><td data-label={t('analyticsPaidUnlocks')}>{count(episode.paidUnlocks)}</td></tr>)}</tbody></table></div>:<p className="muted analytics-no-episodes">{t('noEpisodes')}</p>}</div>
      <p className="analytics-note">{t('analyticsRecordingNote')}</p>{data.testPayments&&<p className="analytics-note analytics-test-note"><Users size={14}/>{t('analyticsTestNote')}</p>}
    </>}
  </section>;
}
