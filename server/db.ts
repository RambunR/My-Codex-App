import { DATABASE_SCHEMA } from '../shared/schema.js';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'platform.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(DATABASE_SCHEMA);
export function one<T = Record<string, any>>(sql: string, ...params: any[]): T | undefined { return db.prepare(sql).get(...params) as T | undefined; }
export function all<T = Record<string, any>>(sql: string, ...params: any[]): T[] { return db.prepare(sql).all(...params) as T[]; }
export function run(sql: string, ...params: any[]) { return db.prepare(sql).run(...params); }
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
