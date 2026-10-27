export type AnalyticsPeriod='7d'|'30d'|'90d'|'all'|'custom';
export interface AnalyticsRangeInput {period?:string;start?:string;end?:string}
export interface AnalyticsRange {period:AnalyticsPeriod;start:string;end:string;startMs:number;endMs:number}
export interface PlaybackReceipt {sessionId:string;watchedMs:number;reportedMs?:number;viewCounted:boolean}
export interface AnalyticsMetrics {
  views:number;watchSeconds:number;avgWatchSeconds:number;paidViewers:number;paidUnlocks:number;
}
export interface SeriesAnalytics {
  series:{id:string;title:string};
  range:AnalyticsRange;
  totals:AnalyticsMetrics&{likes:number};
  daily:Array<AnalyticsMetrics&{date:string}>;
  episodes:Array<AnalyticsMetrics&{id:string;title:string;number:number;duration:number}>;
  testPayments:boolean;
  trackingStartedAt:string|null;
}
