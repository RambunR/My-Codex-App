import type {Series} from './config';
export const LUCKY_DRAW_INITIAL_CHANCES=1;
export const LUCKY_DRAW_MAX_BALANCE=1_000_000;
export const LUCKY_DRAW_MAX_GRANT=1000;
export const LUCKY_DRAW_MAX_POOL=200;
export interface DrawSeries extends Series {uploaded_at?:string|null}
export interface DrawPrize {id:string;request_id:string;title:string;drawn_at:string;series:DrawSeries|null}
export interface DrawState {remaining:number;used:number;added:number;initialChances:number;unlocked:DrawPrize[];unlockedTotal:number;page:number;pageSize:number}
export interface DrawResponse {draw:DrawPrize;remaining:number;used:number;added:number}
export interface DrawPool {series:Array<Series&{eligible:boolean}>;initialChances:number}
