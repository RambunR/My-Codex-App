import crypto from 'node:crypto';
import type express from 'express';
import {z} from 'zod';
import {one,run,transaction} from './db.js';
import {hashPassword,rateLimit} from './auth.js';
import {assert} from './errors.js';
import {mailEnabled,sendAccountEmail} from './mail.js';
import {finishInBackground} from './background.js';
import {LANGUAGES} from '../shared/config.js';

type Kind='reset'|'verify';
interface EmailUser{id:string;email:string;password_hash:string}
interface EmailToken{token_hash:string;user_id:string;kind:Kind;email:string;password_hash_snapshot:string|null;expires_at:number}
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const hasPassword=(hash:string)=>/^[a-f\d]{32}:[a-f\d]{128}$/i.test(hash);
const emailRequest=z.object({email:z.email().max(254).transform(value=>value.toLowerCase()),language:z.enum(LANGUAGES.map(language=>language.code) as [string,...string[]]).optional()});
const tokenInput=z.string().regex(/^[a-f\d]{64}$/);
const cooldown=60_000,hour=60*60_000;

export const emailAuthEnabled=mailEnabled;

export function emailVerificationState(userId:string){
  const verification=one('SELECT 1 FROM account_email_verifications v JOIN users u ON u.id=v.user_id WHERE v.user_id=? AND v.verified_email=u.email COLLATE NOCASE',userId);
  // Google identities stored before verification emails were introduced already
  // came from verified signed profiles. A different linked email proves nothing
  // about the address on the application account.
  const google=verification?undefined:one("SELECT 1 FROM oauth_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=? AND i.provider='google' AND i.email=u.email COLLATE NOCASE",userId);
  return{email_verified:!!(verification||google)};
}

export function markEmailVerified(userId:string,email:string){
  const user=one<{email:string}>('SELECT email FROM users WHERE id=?',userId);
  if(!user||user.email.toLowerCase()!==email.toLowerCase())return false;
  run('INSERT INTO account_email_verifications (user_id,verified_email,verified_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET verified_email=excluded.verified_email,verified_at=excluded.verified_at',userId,user.email,new Date().toISOString());
  run("DELETE FROM account_email_tokens WHERE user_id=? AND kind='verify'",userId);
  return true;
}

function claimRequest(kind:Kind,email:string){
  const now=Date.now(),key=digest(`${kind}:${email.toLowerCase()}`);
  return transaction(()=>{
    // Expired proof material and rate windows do not need indefinite retention.
    run('DELETE FROM account_email_tokens WHERE expires_at<=?',now);
    run('DELETE FROM account_email_requests WHERE last_sent_at_ms<?',now-24*hour);
    const previous=one<{last_sent_at_ms:number;window_start_ms:number;attempts:number}>('SELECT * FROM account_email_requests WHERE subject_hash=?',key);
    if(previous&&previous.last_sent_at_ms>now-cooldown)return false;
    if(previous&&previous.window_start_ms>now-hour&&previous.attempts>=5)return false;
    const continuing=previous&&previous.window_start_ms>now-hour;
    run('INSERT INTO account_email_requests (subject_hash,last_sent_at_ms,window_start_ms,attempts) VALUES (?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET last_sent_at_ms=excluded.last_sent_at_ms,window_start_ms=excluded.window_start_ms,attempts=excluded.attempts',key,now,continuing?previous.window_start_ms:now,continuing?previous.attempts+1:1);
    return true;
  });
}

function requestEmail(kind:Kind,email:string){
  if(!claimRequest(kind,email))return;
  const user=one<EmailUser>('SELECT id,email,password_hash FROM users WHERE email=?',email);
  if(!user||(kind==='reset'&&!hasPassword(user.password_hash))||(kind==='verify'&&emailVerificationState(user.id).email_verified))return;
  const token=crypto.randomBytes(32).toString('hex'),hash=digest(token),now=Date.now();
  transaction(()=>{
    run('DELETE FROM account_email_tokens WHERE user_id=? AND kind=?',user.id,kind);
    run('INSERT INTO account_email_tokens (token_hash,user_id,kind,email,password_hash_snapshot,expires_at,created_at_ms) VALUES (?,?,?,?,?,?,?)',hash,user.id,kind,user.email,kind==='reset'?user.password_hash:null,now+(kind==='reset'?30*60_000:24*hour),now);
  });
  const delivery=sendAccountEmail(user.email,kind,token,crypto.randomUUID()).catch(()=>{
    try{run('DELETE FROM account_email_tokens WHERE token_hash=?',hash);}catch{/* Preserve a sanitized operational warning even if storage is unavailable. */}
    console.warn('AIDramio account email delivery failed; check provider configuration and service status.');
    // Public acknowledgements deliberately do not distinguish absent addresses,
    // provider-only accounts, verified accounts, cooldowns, or provider rejection.
  });
  // The provider round trip is deliberately outside the response path so account
  // existence is not exposed by a slow email service. Durable Objects keep it
  // alive with waitUntil; Node keeps the pending HTTPS request alive naturally.
  void finishInBackground(delivery);
}

export async function sendRegistrationVerification(userId:string){
  if(!mailEnabled())return;
  const user=one<{email:string}>('SELECT email FROM users WHERE id=?',userId);
  if(user)try{await requestEmail('verify',user.email);}catch{/* Registration remains available if email delivery fails. */}
}

function proof(token:string,kind:Kind){
  const record=one<EmailToken>('SELECT * FROM account_email_tokens WHERE token_hash=? AND kind=? AND expires_at>?',digest(token),kind,Date.now());
  assert(record,400,'EMAIL_TOKEN_INVALID','This email link has expired or has already been used. Request a new link.');
  const user=one<EmailUser>('SELECT id,email,password_hash FROM users WHERE id=?',record.user_id);
  assert(user&&user.email.toLowerCase()===record.email.toLowerCase(),400,'EMAIL_TOKEN_INVALID','This email link has expired or has already been used. Request a new link.');
  return{record,user};
}

export function registerEmailAuth(app:express.Express){
  const request=(kind:Kind)=>async(req:express.Request,res:express.Response)=>{
    const body=emailRequest.parse(req.body);
    assert(mailEnabled(),503,'MAIL_UNAVAILABLE','Account email delivery is not configured yet. Please try again later.');
    await requestEmail(kind,body.email);res.json({ok:true});
  };
  app.post('/api/auth/forgot-password',rateLimit('password-email',12,15*60_000),request('reset'));
  app.post('/api/auth/resend-verification',rateLimit('verification-email',12,15*60_000),request('verify'));
  app.post('/api/auth/verify-email',rateLimit('verify-email',30,15*60_000),(req,res)=>{
    const {token}=z.object({token:tokenInput}).parse(req.body);
    transaction(()=>{
      const {record,user}=proof(token,'verify');
      assert(markEmailVerified(user.id,record.email),400,'EMAIL_TOKEN_INVALID','This email link is no longer valid.');
    });res.json({ok:true});
  });
  app.post('/api/auth/reset-password',rateLimit('reset-password',30,15*60_000),async(req,res)=>{
    const body=z.object({token:tokenInput,password:z.string().min(10).max(128)}).parse(req.body);
    // Check proof before expensive hashing; repeat it inside the transaction after
    // hashing so concurrent uses or intervening password changes cannot win twice.
    const initial=proof(body.token,'reset');
    assert(hasPassword(initial.user.password_hash)&&initial.user.password_hash===initial.record.password_hash_snapshot,400,'EMAIL_TOKEN_INVALID','This email link is no longer valid.');
    const password=await hashPassword(body.password);
    transaction(()=>{
      const {record,user}=proof(body.token,'reset');
      assert(hasPassword(user.password_hash)&&user.password_hash===record.password_hash_snapshot,400,'EMAIL_TOKEN_INVALID','This email link is no longer valid.');
      run('UPDATE users SET password_hash=? WHERE id=?',password,user.id);
      markEmailVerified(user.id,record.email);
      run('DELETE FROM sessions WHERE user_id=?',user.id);
      run('DELETE FROM oauth_attempts WHERE user_id=?',user.id);
      // Sign in with Apple maintains its own browser-bound attempts table.
      if(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='apple_oauth_attempts'"))run('DELETE FROM apple_oauth_attempts WHERE user_id=?',user.id);
      run('DELETE FROM account_email_tokens WHERE user_id=?',user.id);
    });
    res.json({ok:true});
  });
}
