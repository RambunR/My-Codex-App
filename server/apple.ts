import crypto from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {createRemoteJWKSet,importPKCS8,jwtVerify,SignJWT} from 'jose';
import {z} from 'zod';
import {config} from './config.js';
import {one,run,transaction} from './db.js';
import {assert} from './errors.js';
import {createSession,destroySession,rateLimit,requireAuth,verifyPassword} from './auth.js';
import {markEmailVerified} from './email-auth.js';
import {LANGUAGES} from '../shared/config.js';

const COOKIE='drama_apple';
const TTL=10*60_000;
const ISSUER='https://appleid.apple.com';
const keys=createRemoteJWKSet(new URL(ISSUER+'/auth/keys'),{timeoutDuration:5000,cacheMaxAge:10*60_000});
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const passwordEnabled=(hash:string)=>/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(hash);
type Failure='apple_cancelled'|'apple_failed'|'apple_expired'|'apple_email_exists'|'apple_identity_conflict'|'apple_account_changed';
type FailureStage='browser_binding'|'provider_callback'|'authorization_code'|'private_key'|'token_exchange'|'id_token_parse'|'id_token_verify'|'identity_store'|'session_create';
interface Diagnostic{stage:FailureStage;upstreamStatus?:number;upstreamError?:string;}
const providerErrors=new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','server_error','temporarily_unavailable']);
const joseErrors=new Set(['ERR_JOSE_ALG_NOT_ALLOWED','ERR_JOSE_NOT_SUPPORTED','ERR_JWK_INVALID','ERR_JWKS_INVALID','ERR_JWKS_NO_MATCHING_KEY','ERR_JWKS_MULTIPLE_MATCHING_KEYS','ERR_JWKS_TIMEOUT','ERR_JWS_INVALID','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWT_INVALID','ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED']);
const privateKeyErrors=new Set(['TypeError','DataError','NotSupportedError','OperationError','InvalidCharacterError']);
function providerError(value:unknown){return typeof value==='string'&&providerErrors.has(value)?value:undefined;}
function privateKeyFormat(){
  const value=config.applePrivateKey.trim();
  try{if(typeof JSON.parse(value)==='string')return 'json_string';}catch{/* PEM is not JSON. */}
  const pem=value.replace(/\\n/g,'\n');
  return pem.startsWith('-----BEGIN PRIVATE KEY-----')&&pem.endsWith('-----END PRIVATE KEY-----')?'pkcs8_pem':'other';
}
function reportFailure(diagnostic:Diagnostic,failure:Failure,error:unknown){
  if(failure!=='apple_failed')return;
  const detail=error&&typeof error==='object'?error as {code?:unknown;name?:unknown}:undefined;
  const code=typeof detail?.code==='string'&&joseErrors.has(detail.code)?detail.code:undefined;
  const name=diagnostic.stage==='private_key'&&typeof detail?.name==='string'&&privateKeyErrors.has(detail.name)?detail.name:undefined;
  const status=diagnostic.upstreamStatus,upstream=providerError(diagnostic.upstreamError);
  // Only fixed stages and allowlisted error identifiers reach logs. Never include
  // exception messages, callback bodies, tokens, identity claims or credentials.
  try{console.error(JSON.stringify({event:'apple_auth_failure',stage:diagnostic.stage,failure,
    ...(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?{upstream_status:status}:{}),
    ...(upstream?{upstream_error:upstream}:{}),
    ...(code?{error_code:code}:{}),...(name?{error_name:name}:{}),
    ...(diagnostic.stage==='private_key'?{key_format:privateKeyFormat()}:{})}));}catch{/* Diagnostics must not interrupt the normal error redirect. */}
}
class FlowError extends Error{constructor(public code:Failure){super(code);}}
interface Attempt{
  state_hash:string;browser_hash:string;nonce:string;next_path:string;language:string;
  intent:'signin'|'link';user_id:string|null;session_hash:string|null;expires_at:number;
}

export function appleEnabled(){return Boolean(config.appleClientId&&config.appleTeamId&&config.appleKeyId&&config.applePrivateKey);}
function requireApple(){assert(appleEnabled(),503,'APPLE_UNAVAILABLE','Apple sign-in is not configured yet.');}
function cookie(req:Request,name:string){return(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1)||'';}
// Apple posts from its own origin; SameSite=Lax would omit this browser binding.
function cookieOptions(){return{httpOnly:true,secure:true,sameSite:'none' as const,path:'/api/auth/apple'};}
function sessionHash(req:Request):string|null{
  const token=cookie(req,'drama_session');if(!req.user||!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=digest(token);return one('SELECT user_id FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',hash,req.user.id,Date.now())?hash:null;
}
function safeNext(value:unknown){
  if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return '/';
  try{const url=new URL(value,config.appUrl);if(url.origin!==new URL(config.appUrl).origin||url.pathname.startsWith('//')||url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname==='/auth')return '/';return url.pathname+url.search+url.hash;}catch{return '/';}
}
function redirectUri(){
  const origin=new URL(config.appUrl);
  assert(origin.protocol==='https:',503,'APPLE_UNAVAILABLE','Apple sign-in requires an HTTPS application URL.');
  return origin.origin+'/api/auth/apple/callback';
}
function start(req:Request,res:Response,intent:'signin'|'link',next:unknown,locale:unknown){
  requireApple();const uri=redirectUri();
  const state=crypto.randomBytes(32).toString('hex');const browser=crypto.randomBytes(32).toString('hex');const nonce=crypto.randomBytes(32).toString('base64url');
  const fingerprint=sessionHash(req);
  if(intent==='link')assert(fingerprint&&req.user,401,'AUTH_REQUIRED','Sign in again before connecting Apple.');
  const language=typeof locale==='string'&&LANGUAGES.some(l=>l.code===locale)?locale:'en';
  const destination=intent==='link'?'/account':safeNext(next);
  run('DELETE FROM apple_oauth_attempts WHERE expires_at<?',Date.now());
  run('INSERT INTO apple_oauth_attempts (state_hash,browser_hash,nonce,next_path,language,intent,user_id,session_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',digest(state),digest(browser),nonce,destination,language,intent,req.user?.id||null,fingerprint,Date.now()+TTL);
  res.cookie(COOKIE,browser,{...cookieOptions(),maxAge:TTL});res.setHeader('Referrer-Policy','no-referrer');
  const url=new URL(ISSUER+'/auth/authorize');
  url.search=new URLSearchParams({client_id:config.appleClientId,redirect_uri:uri,response_type:'code',response_mode:'form_post',scope:'name email',state,nonce}).toString();
  return url.toString();
}
function consume(req:Request):Attempt{
  const state=req.body?.state;const browser=cookie(req,COOKIE);
  if(!req.is('application/x-www-form-urlencoded')||typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||!/^[a-f0-9]{64}$/.test(browser))throw new FlowError('apple_expired');
  return transaction(()=>{
    const attempt=one<Attempt>('SELECT * FROM apple_oauth_attempts WHERE state_hash=?',digest(state));
    if(!attempt||attempt.expires_at<=Date.now()||attempt.browser_hash!==digest(browser))throw new FlowError('apple_expired');
    run('DELETE FROM apple_oauth_attempts WHERE state_hash=?',attempt.state_hash);return attempt;
  });
}
function checkSession(req:Request,attempt:Attempt){
  // The normal application cookie is Lax and is absent on Apple's form_post.
  // The independent None/Secure cookie binds the callback to this browser, while
  // the original session must still exist (logout/reset/rotation invalidates it).
  if(attempt.session_hash){
    if(!attempt.user_id||!one('SELECT user_id FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',attempt.session_hash,attempt.user_id,Date.now()))throw new FlowError('apple_account_changed');
    const supplied=cookie(req,'drama_session');
    if(supplied&&(digest(supplied)!==attempt.session_hash||req.user?.id!==attempt.user_id))throw new FlowError('apple_account_changed');
  }else if(attempt.user_id||req.user)throw new FlowError('apple_account_changed');
  if(attempt.intent==='link'&&!attempt.session_hash)throw new FlowError('apple_account_changed');
}
async function clientSecret(){
  const key=await importPKCS8(config.applePrivateKey.replace(/\\n/g,'\n'),'ES256');
  return new SignJWT({}).setProtectedHeader({alg:'ES256',kid:config.appleKeyId}).setIssuer(config.appleTeamId).setSubject(config.appleClientId).setAudience(ISSUER).setIssuedAt().setExpirationTime('5m').sign(key);
}
function displayName(value:unknown,email:string){
  let name='';
  if(typeof value==='string'&&value.length<=8192){
    try{const data=JSON.parse(value);if(data&&typeof data.name==='object'&&data.name){name=[data.name.firstName,data.name.lastName].filter((part:unknown)=>typeof part==='string').join(' ');}}catch{/* Name is optional and never establishes identity. */}
  }
  name=name.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,60);
  return name.length>=2?name:(email.split('@')[0]+' viewer').slice(0,60);
}
async function profile(code:string,attempt:Attempt,name:unknown,diagnostic:Diagnostic){
  diagnostic.stage='private_key';const secret=await clientSecret();
  diagnostic.stage='token_exchange';
  const response=await fetch(ISSUER+'/auth/token',{method:'POST',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({client_id:config.appleClientId,client_secret:secret,code,grant_type:'authorization_code',redirect_uri:redirectUri()})});
  diagnostic.upstreamStatus=response.status;
  if(!response.ok){
    try{const data=await response.json() as {error?:unknown}|null;diagnostic.upstreamError=providerError(data?.error);}catch{/* The HTTP status still identifies an upstream rejection. */}
    throw new FlowError('apple_failed');
  }
  diagnostic.stage='id_token_parse';
  const tokens=await response.json() as {id_token?:unknown};
  if(typeof tokens.id_token!=='string'||tokens.id_token.length>16_384)throw new FlowError('apple_failed');
  diagnostic.stage='id_token_verify';
  const {payload}=await jwtVerify(tokens.id_token,keys,{issuer:ISSUER,audience:config.appleClientId,algorithms:['RS256'],clockTolerance:5,maxTokenAge:'1h',requiredClaims:['sub','email','email_verified','nonce','iat','exp']});
  if(payload.aud!==config.appleClientId||payload.nonce!==attempt.nonce||![true,'true'].includes(payload.email_verified as boolean|string)||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||!z.email().max(254).safeParse(payload.email).success)throw new FlowError('apple_failed');
  const email=(payload.email as string).toLowerCase();
  return{subject:payload.sub,email,name:displayName(name,email)};
}
function connect(attempt:Attempt,identity:{subject:string;email:string;name:string}){
  return transaction(()=>{
    const linked=one('SELECT user_id FROM apple_identities WHERE subject=?',identity.subject);
    if(attempt.intent==='link'){
      if(linked&&linked.user_id!==attempt.user_id)throw new FlowError('apple_identity_conflict');
      const current=one('SELECT subject FROM apple_identities WHERE user_id=?',attempt.user_id);
      if(current&&current.subject!==identity.subject)throw new FlowError('apple_identity_conflict');
      if(!linked)run('INSERT INTO apple_identities (subject,user_id,email) VALUES (?,?,?)',identity.subject,attempt.user_id,identity.email);
      else run('UPDATE apple_identities SET email=? WHERE subject=?',identity.email,identity.subject);
      markEmailVerified(attempt.user_id!,identity.email);return attempt.user_id!;
    }
    if(linked){
      run('UPDATE apple_identities SET email=? WHERE subject=?',identity.email,identity.subject);
      markEmailVerified(linked.user_id,identity.email);return linked.user_id as string;
    }
    if(one('SELECT id FROM users WHERE email=?',identity.email))throw new FlowError('apple_email_exists');
    const uid=crypto.randomUUID();
    run('INSERT INTO users (id,email,name,password_hash,language) VALUES (?,?,?,?,?)',uid,identity.email,identity.name,'!apple-only:'+crypto.randomBytes(32).toString('hex'),attempt.language);
    run('INSERT INTO apple_identities (subject,user_id,email) VALUES (?,?,?)',identity.subject,uid,identity.email);
    markEmailVerified(uid,identity.email);return uid;
  });
}
export function registerAppleAuth(app:Express){
  app.get('/api/auth/apple/start',rateLimit('apple-start',30,15*60_000),(req,res)=>{res.redirect(302,start(req,res,'signin',req.query.next,req.query.language));});
  app.post('/api/auth/apple/link',requireAuth,rateLimit('apple-link',10,15*60_000),async(req,res)=>{
    requireApple();const body=z.object({password:z.string().min(1).max(128),language:z.string().optional()}).parse(req.body);
    const user=one('SELECT password_hash FROM users WHERE id=?',req.user!.id)!;
    assert(passwordEnabled(user.password_hash)&&await verifyPassword(body.password,user.password_hash),401,'INVALID_PASSWORD','Your current password is incorrect.');
    assert(!one('SELECT subject FROM apple_identities WHERE user_id=?',req.user!.id),409,'APPLE_ALREADY_LINKED','This account already has an Apple sign-in method.');
    res.json({url:start(req,res,'link','/account',body.language)});
  });
  app.post('/api/auth/apple/callback',rateLimit('apple-callback',90,15*60_000),async(req,res)=>{
    let attempt:Attempt|undefined;const diagnostic:Diagnostic={stage:'browser_binding'};res.setHeader('Referrer-Policy','no-referrer');
    try{
      attempt=consume(req);res.clearCookie(COOKIE,cookieOptions());checkSession(req,attempt);requireApple();
      diagnostic.stage='provider_callback';
      if(req.body.error){diagnostic.upstreamError=providerError(req.body.error);throw new FlowError(req.body.error==='user_cancelled_authorize'||req.body.error==='access_denied'?'apple_cancelled':'apple_failed');}
      diagnostic.stage='authorization_code';
      if(typeof req.body.code!=='string'||!req.body.code||req.body.code.length>4096)throw new FlowError('apple_failed');
      const identity=await profile(req.body.code,attempt,req.body.user,diagnostic);checkSession(req,attempt);
      diagnostic.stage='identity_store';
      const uid=connect(attempt,identity);
      diagnostic.stage='session_create';
      destroySession(req,res,false);if(attempt.session_hash)run('DELETE FROM sessions WHERE token_hash=?',attempt.session_hash);
      createSession(res,uid);res.redirect(303,attempt.intent==='link'?'/account?apple=linked':attempt.next_path);
    }catch(error){
      const failure=error instanceof FlowError?error.code:'apple_failed';reportFailure(diagnostic,failure,error);
      const query=new URLSearchParams({error:failure});
      if(attempt?.intent==='link')res.redirect(303,'/account?'+query);
      else{query.set('next',attempt?.next_path||'/');res.redirect(303,'/auth?'+query);}
    }
  });
}
