import crypto from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {z} from 'zod';
import {config} from './config.js';
import {one,run,transaction} from './db.js';
import {assert} from './errors.js';
import {createSession,destroySession,getUser,rateLimit,requireAuth,verifyPassword} from './auth.js';
import {markEmailVerified} from './email-auth.js';
import {mailEnabled,sendWechatRegistrationCode} from './mail.js';
import {safeGoogleNext} from './google.js';
import {publicRedirect} from './origins.js';
import {LANGUAGES} from '../shared/config.js';

const COOKIE='drama_wechat',REGISTRATION_COOKIE='drama_wechat_registration',TTL=10*60_000;
const AUTHORIZATION='https://open.weixin.qq.com/connect/qrconnect';
const TOKEN='https://api.weixin.qq.com/sns/oauth2/access_token',PROFILE='https://api.weixin.qq.com/sns/userinfo';
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const providerId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,128}$/.test(value);
type Failure='wechat_cancelled'|'wechat_failed'|'wechat_expired'|'wechat_identity_conflict'|'wechat_account_changed';
class FlowError extends Error{constructor(public code:Failure){super(code);}}
interface Attempt{state_hash:string;browser_hash:string;app_id:string;next_path:string;language:string;intent:'signin'|'link';user_id:string|null;session_hash:string|null;expires_at:number}
interface Profile{openId:string;unionId:string|null;nickname:string}
interface Registration{token_hash:string;app_id:string;open_id:string;union_id:string|null;nickname:string;next_path:string;language:string;expires_at:number}
export const wechatAuthEnabled=()=>/^wx[a-f0-9]{16}$/i.test(config.wechatAppId)&&/^[A-Za-z0-9_-]{32,128}$/.test(config.wechatAppSecret);
const requireWechat=()=>assert(wechatAuthEnabled(),503,'WECHAT_AUTH_UNAVAILABLE','WeChat sign-in is not configured yet.');
const cookie=(req:Request,name:string)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
const cookieOptions=()=>({httpOnly:true,secure:config.production,sameSite:'lax' as const,path:'/api/auth/wechat'});
function sessionHash(req:Request){const token=cookie(req,'drama_session');return req.user&&opaque(token)&&one('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',digest(token),req.user.id,Date.now())?digest(token):null;}
function redirectUri(){const origin=new URL(config.appUrl);assert(!config.production||origin.protocol==='https:',503,'WECHAT_AUTH_UNAVAILABLE','WeChat sign-in requires HTTPS.');return origin.origin+'/api/auth/wechat/callback';}
function headers(res:Response){res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');}
function start(req:Request,res:Response,intent:'signin'|'link',next:unknown,locale:unknown){
  requireWechat();const state=crypto.randomBytes(32).toString('hex'),browser=crypto.randomBytes(32).toString('hex'),fingerprint=sessionHash(req);
  if(intent==='link')assert(fingerprint&&req.user,401,'AUTH_REQUIRED','Sign in again before connecting WeChat.');
  const language=typeof locale==='string'&&LANGUAGES.some(l=>l.code===locale)?locale:'en',destination=intent==='link'?'/account':safeGoogleNext(next),uri=redirectUri();
  transaction(()=>{run('DELETE FROM wechat_oauth_attempts WHERE expires_at<=?',Date.now());run('DELETE FROM wechat_registrations WHERE expires_at<=?',Date.now());run('DELETE FROM wechat_registration_codes WHERE expires_at<=? OR NOT EXISTS(SELECT 1 FROM wechat_registrations r WHERE r.token_hash=wechat_registration_codes.token_hash)',Date.now());run('DELETE FROM wechat_email_limits WHERE sent_at<?',Date.now()-24*60*60_000);run('INSERT INTO wechat_oauth_attempts (state_hash,browser_hash,app_id,next_path,language,intent,user_id,session_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',digest(state),digest(browser),config.wechatAppId,destination,language,intent,req.user?.id||null,fingerprint,Date.now()+TTL);});
  res.cookie(COOKIE,browser,{...cookieOptions(),maxAge:TTL});res.clearCookie(REGISTRATION_COOKIE,cookieOptions());headers(res);
  const url=new URL(AUTHORIZATION);url.search=new URLSearchParams({appid:config.wechatAppId,redirect_uri:uri,response_type:'code',scope:'snsapi_login',state}).toString();url.hash='wechat_redirect';return url.href;
}
function consume(req:Request):Attempt{
  const state=req.query.state,browser=cookie(req,COOKIE);if(!opaque(state)||!opaque(browser))throw new FlowError('wechat_expired');
  return transaction(()=>{const attempt=one<Attempt>('SELECT * FROM wechat_oauth_attempts WHERE state_hash=?',digest(state));if(!attempt||attempt.expires_at<=Date.now()||attempt.browser_hash!==digest(browser))throw new FlowError('wechat_expired');run('DELETE FROM wechat_oauth_attempts WHERE state_hash=?',attempt.state_hash);return attempt;});
}
function checkSession(req:Request,attempt:Attempt){if(sessionHash(req)!==attempt.session_hash||(req.user?.id||null)!==attempt.user_id||attempt.intent==='link'&&!req.user)throw new FlowError('wechat_account_changed');if(attempt.app_id!==config.wechatAppId)throw new FlowError('wechat_expired');}
async function providerJson(url:URL,maxBytes:number){
  // WeChat's documented token endpoint requires a server-side GET containing
  // AppSecret. Never return/log the URL, token response or raw provider errors.
  try{const response=await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10_000)});if(!response.ok||Number(response.headers.get('content-length'))>maxBytes)throw new FlowError('wechat_failed');const reader=response.body?.getReader();if(!reader)throw new FlowError('wechat_failed');const chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes)throw new FlowError('wechat_failed');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data)||data.errcode)throw new FlowError('wechat_failed');return data as Record<string,unknown>;}catch{throw new FlowError('wechat_failed');}
}
async function wechatProfile(code:string,attempt:Attempt):Promise<Profile>{
  const url=new URL(TOKEN);url.search=new URLSearchParams({appid:attempt.app_id,secret:config.wechatAppSecret,code,grant_type:'authorization_code'}).toString();const tokens=await providerJson(url,16_384);
  if(!providerId(tokens.openid)||typeof tokens.access_token!=='string'||tokens.access_token.length<10||tokens.access_token.length>4096||typeof tokens.scope!=='string'||!tokens.scope.split(',').includes('snsapi_login')||typeof tokens.expires_in!=='number'||tokens.expires_in<=0)throw new FlowError('wechat_failed');
  const profileUrl=new URL(PROFILE);profileUrl.search=new URLSearchParams({access_token:tokens.access_token,openid:tokens.openid,lang:attempt.language==='zh-TW'?'zh_TW':attempt.language==='zh-CN'?'zh_CN':'en'}).toString();const profile=await providerJson(profileUrl,65_536);
  if(profile.openid!==tokens.openid)throw new FlowError('wechat_failed');
  for(const id of [tokens.unionid,profile.unionid])if(id!==undefined&&id!==null&&!providerId(id))throw new FlowError('wechat_failed');
  if(tokens.unionid&&profile.unionid&&tokens.unionid!==profile.unionid)throw new FlowError('wechat_failed');
  const suppliedName=typeof profile.nickname==='string'?Array.from(profile.nickname.replace(/[\u0000-\u001f\u007f]/g,'').trim()).slice(0,60).join(''):'';
  return{openId:tokens.openid,unionId:(profile.unionid||tokens.unionid||null) as string|null,nickname:suppliedName.length>=2?suppliedName:'WeChat viewer'};
}
function identityFor(appId:string,profile:Profile){
  const identity=one('SELECT * FROM wechat_identities WHERE app_id=? AND open_id=?',appId,profile.openId);
  if(identity?.union_id&&profile.unionId&&identity.union_id!==profile.unionId)throw new FlowError('wechat_identity_conflict');
  if(profile.unionId){const other=one('SELECT open_id FROM wechat_identities WHERE app_id=? AND union_id=?',appId,profile.unionId);if(other&&other.open_id!==profile.openId)throw new FlowError('wechat_identity_conflict');}
  return identity;
}
function connect(attempt:Attempt,profile:Profile){return transaction(()=>{
  const identity=identityFor(attempt.app_id,profile);
  if(attempt.intent==='link'){
    const current=one('SELECT app_id,open_id FROM wechat_identities WHERE user_id=?',attempt.user_id);
    if(identity&&identity.user_id!==attempt.user_id||current&&(current.app_id!==attempt.app_id||current.open_id!==profile.openId))throw new FlowError('wechat_identity_conflict');
    if(!identity)run('INSERT INTO wechat_identities (app_id,open_id,user_id,union_id,nickname) VALUES (?,?,?,?,?)',attempt.app_id,profile.openId,attempt.user_id,profile.unionId,profile.nickname);
    else run('UPDATE wechat_identities SET union_id=COALESCE(union_id,?),nickname=? WHERE app_id=? AND open_id=?',profile.unionId,profile.nickname,attempt.app_id,profile.openId);
    return attempt.user_id!;
  }
  if(!identity)return null;
  run('UPDATE wechat_identities SET union_id=COALESCE(union_id,?),nickname=? WHERE app_id=? AND open_id=?',profile.unionId,profile.nickname,attempt.app_id,profile.openId);return identity.user_id as string;
});}
function registration(req:Request):Registration{
  const token=cookie(req,REGISTRATION_COOKIE);assert(opaque(token)&&!req.user,400,'WECHAT_REGISTRATION_EXPIRED','Restart WeChat sign-in to complete registration.');
  const record=one<Registration>('SELECT * FROM wechat_registrations WHERE token_hash=?',digest(token));assert(record&&record.expires_at>Date.now()&&record.app_id===config.wechatAppId,400,'WECHAT_REGISTRATION_EXPIRED','Restart WeChat sign-in to complete registration.');return record;
}
export function registerWechatAuth(app:Express){
  app.get('/api/auth/wechat/start',rateLimit('wechat-start',30,15*60_000),(req,res)=>res.redirect(302,start(req,res,'signin',req.query.next,req.query.language)));
  app.post('/api/auth/wechat/link',requireAuth,rateLimit('wechat-link',10,15*60_000),async(req,res)=>{
    requireWechat();const body=z.object({password:z.string().min(1).max(128),language:z.string().optional()}).parse(req.body),user=one('SELECT password_hash FROM users WHERE id=?',req.user!.id)!;
    assert(/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(user.password_hash)&&await verifyPassword(body.password,user.password_hash),401,'INVALID_PASSWORD','Your current password is incorrect.');
    assert(req.user!.email_verified,403,'WECHAT_LINK_EMAIL_REQUIRED','Verify your LingYing email before connecting WeChat.');
    assert(!one('SELECT 1 FROM wechat_identities WHERE user_id=?',req.user!.id),409,'WECHAT_ALREADY_LINKED','This account already has WeChat connected.');res.json({url:start(req,res,'link','/account',body.language)});
  });
  app.get('/api/auth/wechat/callback',rateLimit('wechat-callback',90,15*60_000),async(req,res)=>{
    let attempt:Attempt|undefined;headers(res);
    try{
      attempt=consume(req);res.clearCookie(COOKIE,cookieOptions());checkSession(req,attempt);requireWechat();
      if(req.query.error)throw new FlowError(req.query.error==='access_denied'?'wechat_cancelled':'wechat_failed');
      if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>4096)throw new FlowError('wechat_cancelled');
      const profile=await wechatProfile(req.query.code,attempt);checkSession(req,attempt);const uid=connect(attempt,profile);
      if(uid){res.clearCookie(REGISTRATION_COOKIE,cookieOptions());destroySession(req,res,false);createSession(res,uid);res.redirect(303,publicRedirect(attempt.intent==='link'?'/account?wechat=linked':attempt.next_path));return;}
      if(req.user)throw new FlowError('wechat_account_changed');
      const token=crypto.randomBytes(32).toString('hex');run('INSERT INTO wechat_registrations (token_hash,app_id,open_id,union_id,nickname,next_path,language,expires_at) VALUES (?,?,?,?,?,?,?,?)',digest(token),attempt.app_id,profile.openId,profile.unionId,profile.nickname,attempt.next_path,attempt.language,Date.now()+TTL);
      res.cookie(REGISTRATION_COOKIE,token,{...cookieOptions(),maxAge:TTL});res.redirect(303,publicRedirect('/auth?'+new URLSearchParams({mode:'wechat-register',next:attempt.next_path}).toString()));
    }catch(error){const reason=error instanceof FlowError?error.code:'wechat_failed',query=new URLSearchParams({error:reason});if(attempt?.intent==='link')res.redirect(303,publicRedirect('/account?'+query));else{query.set('next',attempt?.next_path||'/');res.redirect(303,publicRedirect('/auth?'+query));}}
  });
  app.get('/api/auth/wechat/registration',rateLimit('wechat-registration-read',60,15*60_000),(req,res)=>{headers(res);requireWechat();const record=registration(req);res.json({registration:{name:record.nickname,language:record.language,next:record.next_path,expiresAt:record.expires_at,emailVerificationAvailable:mailEnabled()}});});
  app.post('/api/auth/wechat/registration/email',rateLimit('wechat-email-code',12,15*60_000),async(req,res)=>{
    headers(res);requireWechat();assert(mailEnabled(),503,'MAIL_UNAVAILABLE','Email verification is not available.');
    const{email}=z.object({email:z.email().max(254).transform(value=>value.toLowerCase())}).strict().parse(req.body),code=String(crypto.randomInt(0,1_000_000)).padStart(6,'0');
    const claim=transaction(()=>{const record=registration(req),now=Date.now(),key=digest(email),previous=one('SELECT * FROM wechat_email_limits WHERE email_hash=?',key),current=one('SELECT * FROM wechat_registration_codes WHERE token_hash=?',record.token_hash);
      assert(!one('SELECT id FROM users WHERE email=?',email),409,'WECHAT_EMAIL_EXISTS','Sign in to your existing account and connect WeChat in Account settings.');
      assert((!current||current.sent_at<=now-60_000)&&(!previous||previous.sent_at<=now-60_000)&&( !previous||previous.window_start<=now-60*60_000||previous.sends<5),429,'RATE_LIMIT','Wait before requesting another verification email.');
      const sameWindow=previous&&previous.window_start>now-60*60_000,proof=digest(record.token_hash+':'+email+':'+code),expires=Math.min(record.expires_at,now+TTL);
      run('INSERT INTO wechat_email_limits (email_hash,window_start,sent_at,sends) VALUES (?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET window_start=excluded.window_start,sent_at=excluded.sent_at,sends=excluded.sends',key,sameWindow?previous.window_start:now,now,sameWindow?previous.sends+1:1);
      run('INSERT INTO wechat_registration_codes (token_hash,email,code_hash,expires_at,sent_at,attempts) VALUES (?,?,?,?,?,0) ON CONFLICT(token_hash) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0',record.token_hash,email,proof,expires,now);return{tokenHash:record.token_hash,proof};});
    try{await sendWechatRegistrationCode(email,code,crypto.randomUUID());}catch{run('DELETE FROM wechat_registration_codes WHERE token_hash=? AND code_hash=?',claim.tokenHash,claim.proof);assert(false,503,'MAIL_UNAVAILABLE','Email verification is not available.');}
    res.json({ok:true});
  });
  app.post('/api/auth/wechat/register',rateLimit('register',12,15*60_000),async(req,res)=>{
    headers(res);requireWechat();const body=z.object({name:z.string().trim().min(2).max(60),email:z.email().max(254).transform(v=>v.toLowerCase()),terms:z.literal(true),code:z.string().regex(/^\d{6}$/)}).strict().parse(req.body);
    const result=transaction(()=>{const record=registration(req),profile={openId:record.open_id,unionId:record.union_id,nickname:record.nickname};const emailProof=one('SELECT * FROM wechat_registration_codes WHERE token_hash=?',record.token_hash);if(!emailProof||emailProof.email!==body.email||emailProof.expires_at<=Date.now()||emailProof.attempts>=5)return null;const provided=digest(record.token_hash+':'+body.email+':'+body.code);if(!crypto.timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(emailProof.code_hash,'hex'))){run('UPDATE wechat_registration_codes SET attempts=attempts+1 WHERE token_hash=?',record.token_hash);return null;}assert(!one('SELECT id FROM users WHERE email=?',body.email),409,'WECHAT_EMAIL_EXISTS','Sign in to your existing account and connect WeChat in Account settings.');assert(!identityFor(record.app_id,profile),409,'WECHAT_ALREADY_REGISTERED','This WeChat account is already registered. Restart WeChat sign-in.');
      const id=crypto.randomUUID();run('INSERT INTO users (id,email,name,password_hash,language) VALUES (?,?,?,?,?)',id,body.email,body.name,'!wechat-only:'+crypto.randomBytes(32).toString('hex'),record.language);run('INSERT INTO wechat_identities (app_id,open_id,user_id,union_id,nickname) VALUES (?,?,?,?,?)',record.app_id,record.open_id,id,record.union_id,record.nickname);markEmailVerified(id,body.email);run('DELETE FROM wechat_registration_codes WHERE token_hash=?',record.token_hash);run('DELETE FROM wechat_registrations WHERE token_hash=?',record.token_hash);return{id,next:record.next_path};});
    assert(result,400,'WECHAT_EMAIL_CODE_INVALID','The email verification code is incorrect or expired.');res.clearCookie(REGISTRATION_COOKIE,cookieOptions());destroySession(req,res,false);createSession(res,result.id);res.status(201).json({user:getUser(result.id),next:result.next});
  });
}
