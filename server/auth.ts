import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { one, run } from './db.js';
import { config } from './config.js';
import { assert } from './errors.js';
import type { User } from '../shared/config.js';
import {financeAccount,usingTestPaymentState,dramioPassState} from './payment-state.js';
import {emailVerificationState} from './email-auth.js';
import {assertPaymentAccountClear,paymentAccountReview} from './payment-risk.js';

const scrypt = promisify(crypto.scrypt);
export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const key = await scrypt(password, salt || 'invalid', 64) as Buffer;
  const expected = Buffer.from(hash || '', 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
declare global { namespace Express { interface Request { user?: User; } } }
const digest = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const publicFields = 'id,name,email,role,publisher_active,wallet_micros,earnings_micros,quota_bytes,used_bytes,language,stripe_account_id';
export function getUser(id: string) {
  const user=one<User>(`SELECT ${publicFields} FROM users WHERE id=?`,id);
  if(!user)return user;
  const account=usingTestPaymentState()?financeAccount(id)!:undefined;
  const current=account?{...user,...account,role:user.role==='admin'?'admin':account.publisher_active?'publisher':user.role,stripe_account_id:undefined} as User:user;
  return{...current,...emailVerificationState(id),payment_review:paymentAccountReview(id),dramio_pass:dramioPassState(id,!!user.publisher_active,!!current.publisher_active)};
}
export function readSession(req: Request, _res: Response, next: NextFunction) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('drama_session='))?.split('=')[1];
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const s = one<{ user_id: string }>('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?', digest(token), Date.now());
    if (s) req.user = getUser(s.user_id);
  }
  next();
}
export function createSession(res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  run('DELETE FROM sessions WHERE expires_at<?', Date.now());
  run('INSERT INTO sessions VALUES (?,?,?)', digest(token), userId, Date.now() + 30 * 24 * 60 * 60 * 1000);
  res.cookie('drama_session', token, { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
}
export function destroySession(req: Request, res: Response, clearCookie = true) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('drama_session='))?.split('=')[1];
  if (token) run('DELETE FROM sessions WHERE token_hash=?', digest(token));
  if(clearCookie) res.clearCookie('drama_session', { path: '/', secure: config.production, sameSite: 'lax' });
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) { assert(req.user, 401, 'AUTH_REQUIRED', 'Sign in to continue.'); next(); }
export function requirePublisher(req: Request, _res: Response, next: NextFunction) {
  assert(req.user, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
  if(!['GET','HEAD'].includes(req.method))assertPaymentAccountClear(req.user.id);
  assert(req.user.publisher_active, 403, 'ACTIVATION_REQUIRED', 'Get Dramio Pass for HK$88 once before uploading.'); next();
}
export function requireAdmin(req: Request, _res: Response, next: NextFunction) { assert(req.user?.role === 'admin', 403, 'FORBIDDEN', 'Administrator access required.'); next(); }
const limits = new Map<string, { count: number; reset: number }>();
export function rateLimit(scope: string, max: number, ms: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${scope}:${req.user?.id || req.ip}`; const now = Date.now();
    if (limits.size > 10000) for (const [k,v] of limits) if (v.reset < now) limits.delete(k);
    let state = limits.get(key); if (!state || state.reset < now) { state = { count: 0, reset: now + ms }; limits.set(key, state); }
    assert(++state.count <= max, 429, 'RATE_LIMIT', 'Too many requests. Please try again shortly.'); next();
  };
}
