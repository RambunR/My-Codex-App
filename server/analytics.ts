import crypto from 'node:crypto';
import {one,all,run,transaction} from './db.js';
import {assert} from './errors.js';
import {config} from './config.js';
import {purchaseTable,usingTestPaymentState} from './payment-state.js';
import {publicSeriesAllowedSql} from './moderation.js';
import {MAX_EPISODE_SECONDS,MAX_TRACKED_EPISODE_SECONDS} from '../shared/config.js';
import {episodeDurationSql} from './episode-duration.js';
import {playbackTimeSql,playbackSessionFieldsSql,LEGACY_PLAYBACK_MAX_MS} from './playback-times.js';
import type {AnalyticsMetrics,AnalyticsRange,AnalyticsRangeInput,PlaybackReceipt,SeriesAnalytics} from '../shared/analytics.js';

const DAY=86_400_000,SESSION_WINDOW=30*60_000,MAX_HEARTBEAT_MS=15_000;
interface PlaybackSession {id:string;episode_id:string;viewer_key:string;started_at_ms:number;last_seen_ms:number;watched_ms:number;reported_ms:number;counted_view:number;qualified_at_ms:number|null}
const receipt=(session:PlaybackSession):PlaybackReceipt=>({sessionId:session.id,watchedMs:session.watched_ms,reportedMs:session.reported_ms,viewCounted:session.counted_view===1});
const validViewer=(viewerKey:string)=>assert(/^[a-f0-9]{64}$/.test(viewerKey),400,'INVALID_VIEWER','Playback requires a valid viewer identity.');
// HTTP routes enforce publication and entitlement before recording. Retain
// internal draft-fixture support while stopping hidden/deleted/moderated data.
function assertSeriesRecordable(seriesId:string){
  const series=one(`SELECT s.status FROM series s WHERE s.id=? AND ${publicSeriesAllowedSql('s')}`,seriesId);
  assert(series&&(series.status==='published'||series.status==='draft'),404,'NOT_FOUND','Series not found.');
}

// The public player calls this on actual playback, not metadata loading. Count
// the view immediately while keeping watch time at zero until it is measured.
// A durable window deduplicates retries, resumes and reloads for 30 minutes.
export function startPlayback(episodeId:string,viewerKey:string,now=Date.now()):PlaybackReceipt {
  validViewer(viewerKey);
  return transaction(()=>{
    const episode=one<{series_id:string}>('SELECT series_id FROM episodes WHERE id=?',episodeId);
    assert(episode,404,'NOT_FOUND','Episode not found.');assertSeriesRecordable(episode.series_id);
    const existing=one<PlaybackSession>(`SELECT ${playbackSessionFieldsSql()} FROM playback_sessions p WHERE p.episode_id=? AND p.viewer_key=? AND p.started_at_ms>? ORDER BY p.started_at_ms DESC LIMIT 1`,episodeId,viewerKey,now-SESSION_WINDOW);
    if(existing){
      if(!existing.counted_view)run('UPDATE series SET views=views+1 WHERE id=?',episode.series_id);
      run('UPDATE playback_sessions SET last_seen_ms=?,counted_view=1,qualified_at_ms=COALESCE(qualified_at_ms,?) WHERE id=?',now,now,existing.id);
      return receipt({...existing,counted_view:1});
    }
    const id=crypto.randomUUID();
    run('INSERT INTO playback_sessions (id,episode_id,viewer_key,started_at_ms,last_seen_ms,counted_view,qualified_at_ms) VALUES (?,?,?,?,?,1,?)',id,episodeId,viewerKey,now,now,now);
    run('UPDATE series SET views=views+1 WHERE id=?',episode.series_id);
    return{sessionId:id,watchedMs:0,reportedMs:0,viewCounted:true};
  });
}

// The browser reports cumulative active playback, never the seek position. The
// server additionally bounds credit by elapsed wall time and one heartbeat span.
// Track the highest reported total separately from credited time: replaying a
// previously clipped report must never credit the discarded time on a retry.
export function recordPlayback(sessionId:string,viewerKey:string,cumulativeWatchedMs:number,now=Date.now()):PlaybackReceipt {
  validViewer(viewerKey);
  assert(Number.isSafeInteger(cumulativeWatchedMs)&&cumulativeWatchedMs>=0&&cumulativeWatchedMs<=MAX_TRACKED_EPISODE_SECONDS*1000,400,'INVALID_WATCH_TIME','Enter valid cumulative playback time.');
  return transaction(()=>{
    const session=one<PlaybackSession&{duration:number;series_id:string}>(`SELECT ${playbackSessionFieldsSql()},${episodeDurationSql()} AS duration,e.series_id FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE p.id=? AND p.viewer_key=?`,sessionId,viewerKey);
    assert(session,404,'NOT_FOUND','Playback session not found.');
    assertSeriesRecordable(session.series_id);
    // Preserve the existing short-episode report ceiling and replay high-water
    // mark, while long episodes may report their actual persisted duration.
    assert(cumulativeWatchedMs<=Math.max(MAX_EPISODE_SECONDS,session.duration)*1000,400,'INVALID_WATCH_TIME','Enter valid cumulative playback time.');
    const durationMs=Math.ceil(session.duration*1000);
    const lifetime=session.duration>MAX_EPISODE_SECONDS?Math.min(Number.MAX_SAFE_INTEGER,durationMs+SESSION_WINDOW):SESSION_WINDOW;
    assert(now-session.started_at_ms<=lifetime,409,'PLAYBACK_EXPIRED','Restart playback to continue recording viewing activity.');
    const requested=Math.max(0,cumulativeWatchedMs-Math.max(session.reported_ms,session.watched_ms));
    const increase=Math.min(requested,Math.max(0,now-session.last_seen_ms),MAX_HEARTBEAT_MS);
    const watchedMs=Math.min(Math.floor(session.duration*1000),session.watched_ms+increase);
    // A zero/short heartbeat must never undo a view counted at playback start.
    // Active sessions created before this release can qualify on their first
    // positive measured heartbeat; historical inactive sessions are not backfilled.
    const qualifies=session.counted_view===1||watchedMs>0;
    if(qualifies&&!session.counted_view)run('UPDATE series SET views=views+1 WHERE id=?',session.series_id);
    const reportedMs=Math.max(session.reported_ms,cumulativeWatchedMs);
    run('UPDATE playback_sessions SET watched_ms=?,reported_ms=?,last_seen_ms=?,counted_view=?,qualified_at_ms=? WHERE id=?',Math.min(LEGACY_PLAYBACK_MAX_MS,watchedMs),Math.min(LEGACY_PLAYBACK_MAX_MS,reportedMs),now,qualifies?1:0,session.qualified_at_ms??(qualifies?now:null),session.id);
    if(watchedMs>LEGACY_PLAYBACK_MAX_MS||reportedMs>LEGACY_PLAYBACK_MAX_MS)run('INSERT INTO playback_session_times (session_id,watched_ms,reported_ms) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET watched_ms=excluded.watched_ms,reported_ms=excluded.reported_ms',session.id,Math.min(240000,watchedMs),Math.min(240000,reportedMs));
    if(watchedMs>240000||reportedMs>240000)run('INSERT INTO playback_session_times_extended (session_id,watched_ms,reported_ms) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET watched_ms=excluded.watched_ms,reported_ms=excluded.reported_ms',session.id,Math.min(MAX_EPISODE_SECONDS*1000,watchedMs),Math.min(MAX_EPISODE_SECONDS*1000,reportedMs));
    if(watchedMs>MAX_EPISODE_SECONDS*1000||reportedMs>MAX_EPISODE_SECONDS*1000)run('INSERT INTO playback_session_times_long (session_id,watched_ms,reported_ms) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET watched_ms=excluded.watched_ms,reported_ms=excluded.reported_ms',session.id,watchedMs,reportedMs);
    return{sessionId:session.id,watchedMs,reportedMs,viewCounted:qualifies};
  });
}

function parseDate(value:string){
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value),400,'INVALID_PERIOD','Choose valid YYYY-MM-DD dates.');
  const ms=Date.parse(value+'T00:00:00.000Z');
  assert(Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value,400,'INVALID_PERIOD','Choose valid calendar dates.');
  return ms;
}
const dateLabel=(ms:number)=>new Date(ms).toISOString().slice(0,10);
export function resolveAnalyticsRange(input:AnalyticsRangeInput={},now=Date.now(),earliestMs=now):AnalyticsRange {
  const today=Math.floor(now/DAY)*DAY;
  if(input.start!==undefined||input.end!==undefined){
    assert(input.start&&input.end,400,'INVALID_PERIOD','Choose both a start and end date.');
    const startMs=parseDate(input.start),endMs=parseDate(input.end)+DAY;
    assert(endMs>startMs&&endMs-startMs<=366*DAY,400,'INVALID_PERIOD','Choose an ordered date range of up to 366 days.');
    return{period:'custom',start:input.start,end:input.end,startMs,endMs};
  }
  const period=input.period||'30d';
  assert(['7d','30d','90d','all'].includes(period),400,'INVALID_PERIOD','Choose 7d, 30d, 90d, all, or a custom date range.');
  const startMs=period==='all'?Math.min(today,Math.floor(earliestMs/DAY)*DAY):today-(Number.parseInt(period,10)-1)*DAY;
  return{period:period as AnalyticsRange['period'],start:dateLabel(startMs),end:dateLabel(today),startMs,endMs:today+DAY};
}
const emptyMetrics=():AnalyticsMetrics=>({views:0,watchSeconds:0,avgWatchSeconds:0,paidViewers:0,paidUnlocks:0});
function viewMetrics(row:Record<string,any>|undefined):Pick<AnalyticsMetrics,'views'|'watchSeconds'|'avgWatchSeconds'> {
  const views=Number(row?.views||0),watchSeconds=Number(row?.watched_ms||0)/1000;
  return{views,watchSeconds,avgWatchSeconds:views?watchSeconds/views:0};
}

export function readSeriesAnalytics(creatorId:string,seriesId:string,input:AnalyticsRangeInput={},now=Date.now()):SeriesAnalytics {
  const series=one<{id:string;title:string;creator_id:string}>('SELECT id,title,creator_id FROM series WHERE id=?',seriesId);
  assert(series&&!one('SELECT 1 FROM series_deletions WHERE series_id=?',seriesId)&&!one('SELECT 1 FROM retired_catalog_series WHERE series_id=?',seriesId),404,'NOT_FOUND','Series not found.');
  assert(series.creator_id===creatorId,403,'FORBIDDEN','These statistics belong to another publisher.');
  const table=purchaseTable();
  const first=one<{at_ms:number|null}>(`SELECT MIN(at_ms) AS at_ms FROM (
    SELECT p.started_at_ms AS at_ms FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?
    UNION ALL SELECT CAST(strftime('%s',p.created_at)*1000 AS INTEGER) AS at_ms FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0
  )`,seriesId,seriesId);
  const range=resolveAnalyticsRange(input,now,first?.at_ms??now),params=[seriesId,range.startMs,range.endMs];
  const views=one(`SELECT COUNT(*) AS views,COALESCE(SUM(${playbackTimeSql()}),0) AS watched_ms FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.counted_view=1 AND p.qualified_at_ms>=? AND p.qualified_at_ms<?`,...params);
  const paid=one(`SELECT COUNT(*) AS paidUnlocks,COUNT(DISTINCT p.user_id) AS paidViewers FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0 AND CAST(strftime('%s',p.created_at)*1000 AS INTEGER)>=? AND CAST(strftime('%s',p.created_at)*1000 AS INTEGER)<?`,...params);
  const likes=one<{n:number}>('SELECT COUNT(*) AS n FROM series_likes WHERE series_id=?',seriesId)!.n;
  const episodeViews=all(`SELECT p.episode_id,COUNT(*) AS views,SUM(${playbackTimeSql()}) AS watched_ms FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.counted_view=1 AND p.qualified_at_ms>=? AND p.qualified_at_ms<? GROUP BY p.episode_id`,...params);
  const episodePaid=all(`SELECT p.episode_id,COUNT(*) AS paidUnlocks,COUNT(DISTINCT p.user_id) AS paidViewers FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0 AND CAST(strftime('%s',p.created_at)*1000 AS INTEGER)>=? AND CAST(strftime('%s',p.created_at)*1000 AS INTEGER)<? GROUP BY p.episode_id`,...params);
  const byEpisodeViews=new Map(episodeViews.map(row=>[row.episode_id,row])),byEpisodePaid=new Map(episodePaid.map(row=>[row.episode_id,row]));
  const episodes=all<{id:string;title:string;number:number;duration:number}>(`SELECT e.id,e.title,e.number,${episodeDurationSql()} AS duration FROM episodes e WHERE e.series_id=? ORDER BY e.number`,seriesId).map(episode=>({
    ...episode,...emptyMetrics(),...viewMetrics(byEpisodeViews.get(episode.id)),paidViewers:Number(byEpisodePaid.get(episode.id)?.paidViewers||0),paidUnlocks:Number(byEpisodePaid.get(episode.id)?.paidUnlocks||0),
  }));
  const dailyViews=all(`SELECT date(p.qualified_at_ms/1000,'unixepoch') AS date,COUNT(*) AS views,SUM(${playbackTimeSql()}) AS watched_ms FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.counted_view=1 AND p.qualified_at_ms>=? AND p.qualified_at_ms<? GROUP BY date`,...params);
  const dailyPaid=all(`SELECT date(p.created_at) AS date,COUNT(*) AS paidUnlocks,COUNT(DISTINCT p.user_id) AS paidViewers FROM ${table} p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? AND p.price_micros>0 AND CAST(strftime('%s',p.created_at)*1000 AS INTEGER)>=? AND CAST(strftime('%s',p.created_at)*1000 AS INTEGER)<? GROUP BY date`,...params);
  const byDayViews=new Map(dailyViews.map(row=>[row.date,row])),byDayPaid=new Map(dailyPaid.map(row=>[row.date,row]));
  const daily:SeriesAnalytics['daily']=[];
  for(let at=range.startMs;at<range.endMs;at+=DAY){const date=dateLabel(at);daily.push({date,...emptyMetrics(),...viewMetrics(byDayViews.get(date)),paidViewers:Number(byDayPaid.get(date)?.paidViewers||0),paidUnlocks:Number(byDayPaid.get(date)?.paidUnlocks||0)});}
  const tracking=one<{at_ms:number|null}>('SELECT MIN(p.started_at_ms) AS at_ms FROM playback_sessions p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?',seriesId);
  return{series:{id:series.id,title:series.title},range,totals:{...emptyMetrics(),...viewMetrics(views),paidViewers:Number(paid?.paidViewers||0),paidUnlocks:Number(paid?.paidUnlocks||0),likes},daily,episodes,testPayments:usingTestPaymentState()||config.sandbox||config.payments==='demo',trackingStartedAt:tracking?.at_ms===null||tracking?.at_ms===undefined?null:new Date(tracking.at_ms).toISOString()};
}
