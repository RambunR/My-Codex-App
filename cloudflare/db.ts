import type {DurableObjectStorage} from '@cloudflare/workers-types';
import {DATABASE_SCHEMA} from '../shared/schema';
import {getRuntime} from './runtime';
export function initializeDatabase(storage:DurableObjectStorage){storage.sql.exec(DATABASE_SCHEMA);}
export function one<T=Record<string,any>>(sql:string,...params:any[]):T|undefined{return getRuntime().storage.sql.exec(sql,...params).toArray()[0] as T|undefined;}
export function all<T=Record<string,any>>(sql:string,...params:any[]):T[]{return getRuntime().storage.sql.exec(sql,...params).toArray() as T[];}
export function run(sql:string,...params:any[]){const cursor=getRuntime().storage.sql.exec(sql,...params);return{changes:cursor.rowsWritten};}
export function transaction<T>(fn:()=>T):T{return getRuntime().storage.transactionSync(fn);}
export const db={exec:(sql:string)=>getRuntime().storage.sql.exec(sql)};
