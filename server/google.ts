import crypto from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {z} from 'zod';
import {config} from './config.js';
import {publicRedirect} from './origins.js';
import {one,run,transaction} from './db.js';
import {assert} from './errors.js';
import {createSession,destroySession,rateLimit,requireAuth,verifyPassword} from './auth.js';
import {markEmailVerified} from './email-auth.js';
import {LANGUAGES} from '../shared/config.js';

const COOKIE='drama_google';
const TTL=10*60_000;
const AUTHORIZATION='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000,cacheMaxAge:10*60_000});
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const passwordEnabled=(hash:string)=>/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(hash);
type Failure='google_cancelled'|'google_failed'|'google_expired'|'google_email_exists'|'google_identity_conflict'|'google_account_changed';
class FlowError extends Error{constructor(public code:Failure){super(code);}}
interface Attempt{
  state_hash:string;browser_hash:string;nonce:string;code_verifier:string;
  next_path:string;language:string;intent:'signin'|'link';user_id:string|null;session_hash:string|null;expires_at:number;
}
export function googleEnabled(){return Boolean(config.googleClientId&&config.googleClientSecret);}
function requireGoogle(){assert(googleEnabled(),503,'GOOGLE_UNAVAILABLE','Google sign-in is not configured yet.');}
function cookie(req:Request,name:string){return(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';}
function cookieOptions(){return{httpOnly:true,secure:config.production,sameSite:'lax' as const,path:'/api/auth/google'};}
function sessionHash(req:Request):string|null{
  const token=cookie(req,'drama_session');if(!req.user||!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=digest(token);return one('SELECT user_id FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',hash,req.user.id,Date.now())?hash:null;
}
export function safeGoogleNext(value:unknown,fallback='/'){
  if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return fallback;
  try{const url=new URL(value,config.appUrl);if(url.origin!==new URL(config.appUrl).origin||url.pathname.startsWith('//')||url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname==='/auth')return fallback;return url.pathname+url.search+url.hash;}catch{return fallback;}
}
function redirectUri(){
  const origin=new URL(config.appUrl);
  assert(!config.production||origin.protocol==='https:',503,'GOOGLE_UNAVAILABLE','Google sign-in requires an HTTPS application URL.');
  return origin.origin+'/api/auth/google/callback';
}
function start(req:Request,res:Response,intent:'signin'|'link',next:unknown,locale:unknown){
  requireGoogle();
  const state=crypto.randomBytes(32).toString('hex');
  const browser=crypto.randomBytes(32).toString('hex');
  const nonce=crypto.randomBytes(32).toString('base64url');
  const verifier=crypto.randomBytes(32).toString('base64url');
  const fingerprint=sessionHash(req);
  if(intent==='link')assert(fingerprint&&req.user,401,'AUTH_REQUIRED','Sign in again before connecting Google.');
  const language=typeof locale==='string'&&LANGUAGES.some(l=>l.code===locale)?locale:'en';
  const destination=intent==='link'?'/account':safeGoogleNext(next);
  const uri=redirectUri();
  run('DELETE FROM oauth_attempts WHERE expires_at<?',Date.now());
  run('INSERT INTO oauth_attempts (state_hash,browser_hash,nonce,code_verifier,next_path,language,intent,user_id,session_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',digest(state),digest(browser),nonce,verifier,destination,language,intent,req.user?.id||null,fingerprint,Date.now()+TTL);
  res.cookie(COOKIE,browser,{...cookieOptions(),maxAge:TTL});
  res.setHeader('Referrer-Policy','no-referrer');
  const url=new URL(AUTHORIZATION);
  url.search=new URLSearchParams({client_id:config.googleClientId,redirect_uri:uri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();
  return url.toString();
}
function consume(req:Request):Attempt{
  const state=req.query.state;const browser=cookie(req,COOKIE);
  if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||!/^[a-f0-9]{64}$/.test(browser))throw new FlowError('google_expired');
  return transaction(()=>{
    const attempt=one<Attempt>('SELECT * FROM oauth_attempts WHERE state_hash=?',digest(state));
    if(!attempt||attempt.expires_at<=Date.now()||attempt.browser_hash!==digest(browser))throw new FlowError('google_expired');
    // No await between lookup and removal: even concurrent callbacks consume once.
    run('DELETE FROM oauth_attempts WHERE state_hash=?',attempt.state_hash);
    return attempt;
  });
}
function checkSession(req:Request,attempt:Attempt){
  if(sessionHash(req)!==attempt.session_hash||(req.user?.id||null)!==attempt.user_id)throw new FlowError('google_account_changed');
  if(attempt.intent==='link'&&!req.user)throw new FlowError('google_account_changed');
}
async function googleProfile(code:string,attempt:Attempt){
  const response=await fetch(TOKEN,{method:'POST',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({code,client_id:config.googleClientId,client_secret:config.googleClientSecret,redirect_uri:redirectUri(),grant_type:'authorization_code',code_verifier:attempt.code_verifier})});
  if(!response.ok)throw new FlowError('google_failed');
  const tokens=await response.json() as {id_token?:unknown};
  if(typeof tokens.id_token!=='string'||tokens.id_token.length>16_384)throw new FlowError('google_failed');
  const {payload}=await jwtVerify(tokens.id_token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:config.googleClientId,algorithms:['RS256'],clockTolerance:5,maxTokenAge:'1h',requiredClaims:['sub','email','email_verified','nonce','iat','exp']});
  if(payload.nonce!==attempt.nonce||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||!z.email().max(254).safeParse(payload.email).success)throw new FlowError('google_failed');
  if(payload.azp!==undefined&&payload.azp!==config.googleClientId)throw new FlowError('google_failed');
  if(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==config.googleClientId)throw new FlowError('google_failed');
  const email=(payload.email as string).toLowerCase();
  const suppliedName=typeof payload.name==='string'?payload.name.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,60):'';
  return{subject:payload.sub,email,name:suppliedName.length>=2?suppliedName:(email.split('@')[0]+' viewer').slice(0,60)};
}
function connect(attempt:Attempt,profile:{subject:string;email:string;name:string}){
  return transaction(()=>{
    const identity=one('SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?','google',profile.subject);
    if(attempt.intent==='link'){
      if(identity&&identity.user_id!==attempt.user_id)throw new FlowError('google_identity_conflict');
      const current=one('SELECT subject FROM oauth_identities WHERE provider=? AND user_id=?','google',attempt.user_id);
      if(current&&current.subject!==profile.subject)throw new FlowError('google_identity_conflict');
      if(!identity)run('INSERT INTO oauth_identities (provider,subject,user_id,email) VALUES (?,?,?,?)','google',profile.subject,attempt.user_id,profile.email);
      else run('UPDATE oauth_identities SET email=? WHERE provider=? AND subject=?',profile.email,'google',profile.subject);
      return attempt.user_id!;
    }
    if(identity){
      run('UPDATE oauth_identities SET email=? WHERE provider=? AND subject=?',profile.email,'google',profile.subject);
      return identity.user_id as string;
    }
    // Email alone never authorizes access to an existing wallet or purchases.
    if(one('SELECT id FROM users WHERE email=?',profile.email))throw new FlowError('google_email_exists');
    const uid=crypto.randomUUID();
    run('INSERT INTO users (id,email,name,password_hash,language) VALUES (?,?,?,?,?)',uid,profile.email,profile.name,'!google-only:'+crypto.randomBytes(32).toString('hex'),attempt.language);
    run('INSERT INTO oauth_identities (provider,subject,user_id,email) VALUES (?,?,?,?)','google',profile.subject,uid,profile.email);
    return uid;
  });
}
export function registerGoogleAuth(app:Express){
  app.get('/api/account/identities',requireAuth,(req,res)=>{
    const identity=one('SELECT email FROM oauth_identities WHERE provider=? AND user_id=?','google',req.user!.id);
    const apple=one('SELECT email FROM apple_identities WHERE user_id=?',req.user!.id);
    const user=one('SELECT password_hash FROM users WHERE id=?',req.user!.id)!;
    res.json({google:identity?{linked:true,email:identity.email}:{linked:false},apple:apple?{linked:true,email:apple.email}:{linked:false},password:passwordEnabled(user.password_hash)});
  });
  app.get('/api/auth/google/start',rateLimit('google-start',30,15*60_000),(req,res)=>{res.redirect(302,start(req,res,'signin',req.query.next,req.query.language));});
  app.post('/api/auth/google/link',requireAuth,rateLimit('google-link',10,15*60_000),async(req,res)=>{
    requireGoogle();const body=z.object({password:z.string().min(1).max(128),next:z.string().optional(),language:z.string().optional()}).parse(req.body);
    const user=one('SELECT password_hash FROM users WHERE id=?',req.user!.id)!;
    assert(passwordEnabled(user.password_hash)&&await verifyPassword(body.password,user.password_hash),401,'INVALID_PASSWORD','Your current password is incorrect.');
    assert(!one('SELECT subject FROM oauth_identities WHERE provider=? AND user_id=?','google',req.user!.id),409,'GOOGLE_ALREADY_LINKED','This account already has a Google sign-in method.');
    res.json({url:start(req,res,'link','/account',body.language)});
  });
  app.get('/api/auth/google/callback',rateLimit('google-callback',90,15*60_000),async(req,res)=>{
    let attempt:Attempt|undefined;
    res.setHeader('Referrer-Policy','no-referrer');
    try{
      attempt=consume(req);res.clearCookie(COOKIE,cookieOptions());checkSession(req,attempt);requireGoogle();
      if(req.query.error)throw new FlowError(req.query.error==='access_denied'?'google_cancelled':'google_failed');
      if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>4096)throw new FlowError('google_failed');
      const profile=await googleProfile(req.query.code,attempt);
      checkSession(req,attempt);
      const uid=connect(attempt,profile);
      markEmailVerified(uid,profile.email);
      destroySession(req,res,false);createSession(res,uid);
      res.redirect(303,publicRedirect(attempt.intent==='link'?'/account?google=linked':attempt.next_path));
    }catch(error){
      const reason=error instanceof FlowError?error.code:'google_failed';
      const query=new URLSearchParams({error:reason});
      if(attempt?.intent==='link')res.redirect(303,publicRedirect('/account?'+query.toString()));
      else{query.set('next',attempt?.next_path||'/');res.redirect(303,publicRedirect('/auth?'+query.toString()));}
    }
  });
}
