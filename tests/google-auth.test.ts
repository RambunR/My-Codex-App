import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT,type JWTPayload} from 'jose';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-google-auth-'));
process.env.DATA_DIR=dir;process.env.PAYMENTS_MODE='demo';process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const originalFetch=globalThis.fetch;
const clientId='test-client.apps.googleusercontent.com';
const clientSecret='local-test-oauth-secret';
const password='ExistingAccountPassword123!';
const tokenEndpoint='https://oauth2.googleapis.com/token';
const certificatesEndpoint='https://www.googleapis.com/oauth2/v3/certs';
const keys=await generateKeyPair('RS256',{extractable:true});
const wrongKeys=await generateKeyPair('RS256',{extractable:true});
const jwk={...await exportJWK(keys.publicKey),kid:'google-test-key',alg:'RS256',use:'sig'};
const codes=new Map<string,{token?:string;challenge:string;failure?:boolean}>();
let server:Server,base:string,exchanges=0,certificates=0;
interface Attempt{url:URL;state:string;nonce:string;challenge:string;cookie:string;session:string}

function cookie(response:Response,name:string){return response.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0]||'';}
function combine(...cookies:string[]){return cookies.filter(Boolean).join('; ');}
async function request(route:string,body?:unknown,session='',headers:Record<string,string>={}){
  return originalFetch(base+route,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{...(session?{Cookie:session}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
async function json(route:string,body?:unknown,session='',expected=200,headers:Record<string,string>={}){
  const r=await request(route,body,session,headers);const data=await r.json();assert.equal(r.status,expected,`${route}: ${JSON.stringify(data)}`);return{response:r,data,cookie:cookie(r,'drama_session')};
}
function attempt(response:Response,url:string,session=''):Attempt{
  const parsed=new URL(url);const state=parsed.searchParams.get('state')||'',nonce=parsed.searchParams.get('nonce')||'',challenge=parsed.searchParams.get('code_challenge')||'';
  assert.equal(parsed.origin,'https://accounts.google.com');assert.ok(state&&nonce&&challenge);assert.equal(parsed.searchParams.get('client_id'),clientId);assert.equal(parsed.searchParams.get('code_challenge_method'),'S256');assert.equal(parsed.searchParams.get('redirect_uri'),base+'/api/auth/google/callback');assert.ok(!url.includes(clientSecret));
  const browser=cookie(response,'drama_google');assert.ok(browser,'OAuth requires an independent browser-binding cookie');
  return{url:parsed,state,nonce,challenge,cookie:browser,session};
}
async function start(next='/wallet',session='',language='en'){
  const r=await request('/api/auth/google/start?'+new URLSearchParams({next,language}),undefined,session);assert.equal(r.status,302);return attempt(r,r.headers.get('location')!,session);
}
async function startLink(session:string,next='/account'){
  const r=await json('/api/auth/google/link',{password,next,language:'en'},session);return attempt(r.response,r.data.url,session);
}
async function identityToken(a:Attempt,claims:JWTPayload={},wrongKey=false){
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({iss:'https://accounts.google.com',aud:clientId,sub:'google-subject-'+randomUUID(),email:randomUUID()+'@gmail.com',email_verified:true,name:'Google Viewer',nonce:a.nonce,iat:now,exp:now+300,...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(wrongKey?wrongKeys.privateKey:keys.privateKey);
}
async function callback(a:Attempt,options:{claims?:JWTPayload;token?:string;wrongKey?:boolean;cookies?:string;state?:string;error?:string;failure?:boolean}={}){
  const query=new URLSearchParams({state:options.state??a.state});
  if(options.error)query.set('error',options.error);
  else{const code='test-code-'+randomUUID();codes.set(code,{token:options.token??await identityToken(a,options.claims,options.wrongKey),challenge:a.challenge,failure:options.failure});query.set('code',code);}
  return request('/api/auth/google/callback?'+query,undefined,options.cookies??combine(a.cookie,a.session),{'sec-fetch-site':'cross-site'});
}
function location(response:Response){assert.ok([302,303].includes(response.status),`Expected an OAuth redirect, received ${response.status}`);return new URL(response.headers.get('location')!,base);}
function error(response:Response,code:string,pathname='/auth'){const url=location(response);assert.equal(url.origin,base);assert.equal(url.pathname,pathname);assert.equal(url.searchParams.get('error'),code);assert.equal(cookie(response,'drama_session'),'');return url;}
async function register(email=randomUUID()+'@example.test'){
  const r=await json('/api/auth/register',{name:'Existing Viewer',email,password},'',201);return{id:r.data.user.id,email,session:r.cookie};
}
function totalUsers(){return one<{n:number}>('SELECT COUNT(*) AS n FROM users')!.n;}

before(async()=>{
  config.googleClientId=clientId;config.googleClientSecret=clientSecret;
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url===certificatesEndpoint){certificates++;return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=3600'}});}
    if(url===tokenEndpoint){
      exchanges++;const exchange=new Request(input,init);assert.equal(exchange.method,'POST');const body=new URLSearchParams(await exchange.text());
      assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('client_id'),clientId);assert.equal(body.get('client_secret'),clientSecret);assert.equal(body.get('redirect_uri'),base+'/api/auth/google/callback');
      const code=body.get('code')||'';const value=codes.get(code);assert.ok(value,'Only issued test authorization codes may be exchanged');codes.delete(code);
      const verifier=body.get('code_verifier')||'';assert.ok(verifier.length>=43);assert.equal(createHash('sha256').update(verifier).digest('base64url'),value.challenge,'PKCE verifier must match the authorization challenge');
      if(value.failure)return Response.json({error:'invalid_grant'},{status:400});
      return Response.json({id_token:value.token,access_token:'unused-provider-access-token',token_type:'Bearer',expires_in:300});
    }
    return originalFetch(input,init);
  };
  const {createApp,errorHandler}=await import('../server/app');const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;config.appUrl=base;
});
after(async()=>{globalThis.fetch=originalFetch;if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('Google availability requires both credentials and configured start uses state, nonce, PKCE and a private cookie',async()=>{
  assert.equal((await json('/api/config')).data.auth.google,true);
  config.googleClientSecret='';
  try{assert.equal((await json('/api/config')).data.auth.google,false);await json('/api/auth/google/start',undefined,'',503);}finally{config.googleClientSecret=clientSecret;}
  const r=await request('/api/auth/google/start?next=%2Fwallet&language=zh-TW');const a=attempt(r,r.headers.get('location')!);
  assert.equal(a.url.searchParams.get('response_type'),'code');assert.deepEqual(new Set(a.url.searchParams.get('scope')!.split(' ')),new Set(['openid','email','profile']));assert.equal(a.url.searchParams.get('prompt'),'select_account');
  const header=r.headers.getSetCookie().find(x=>x.startsWith('drama_google='))!;assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=Lax/i);assert.ok(!r.headers.getSetCookie().some(x=>x.startsWith('drama_session=')));
});

test('production OAuth browser cookies require HTTPS and carry Secure, HttpOnly and SameSite flags',async()=>{
  const oldProduction=config.production,oldUrl=config.appUrl;config.production=true;config.appUrl='https://aidramio.example';
  try{
    const r=await request('/api/auth/google/start');assert.equal(r.status,302);const header=r.headers.getSetCookie().find(x=>x.startsWith('drama_google='))!;assert.match(header,/; Secure/i);assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=Lax/i);assert.equal(new URL(r.headers.get('location')!).searchParams.get('redirect_uri'),'https://aidramio.example/api/auth/google/callback');
    config.appUrl='http://aidramio.example';await json('/api/auth/google/start',undefined,'',503);
  }finally{config.production=oldProduction;config.appUrl=oldUrl;}
});

test('a verified signed Google identity registers an ordinary viewer and a persistent application session',async()=>{
  const a=await start('/wallet','','zh-TW');const email='new-google-viewer@gmail.com';const subject='new-google-viewer';
  const r=await callback(a,{claims:{email,sub:subject}});assert.equal(location(r).pathname,'/wallet');const session=cookie(r,'drama_session');assert.ok(session);
  const me=(await json('/api/auth/me',undefined,session)).data.user;assert.equal(me.email,email);assert.equal(me.role,'viewer');assert.equal(me.publisher_active,0);assert.equal(me.wallet_micros,0);assert.equal(me.earnings_micros,0);assert.equal(me.quota_bytes,5*1024**3);assert.equal(me.language,'zh-TW');assert.equal(me.password_hash,undefined);
  const identities=(await json('/api/account/identities',undefined,session)).data;assert.equal(identities.google.linked,true);assert.equal(identities.google.email,email);assert.equal(identities.password,false);assert.ok(certificates>0,'ID-token validation must retrieve a trusted Google signing key');
  await json('/api/auth/login',{email,password},'',401);
  assert.equal((await json('/api/auth/me',undefined,session)).data.user.id,me.id);
});

test('returning Google sign-in uses stable subject and preserves the original wallet when Google email changes',async()=>{
  const first=await start();const oneLogin=await callback(first,{claims:{sub:'stable-google-subject',email:'original-google-email@gmail.com'}});const oldSession=cookie(oneLogin,'drama_session');const id=(await json('/api/auth/me',undefined,oldSession)).data.user.id;
  run('UPDATE users SET wallet_micros=?,earnings_micros=? WHERE id=?',12_345_000,777_000,id);
  const other=await register('changed-google-email@example.test');
  const second=await start();const again=await callback(second,{claims:{iss:'accounts.google.com',sub:'stable-google-subject',email:other.email}});const me=(await json('/api/auth/me',undefined,cookie(again,'drama_session'))).data.user;
  assert.equal(me.id,id);assert.equal(me.wallet_micros,12_345_000);assert.equal(me.earnings_micros,777_000);assert.notEqual(me.id,other.id);
});

test('callback requires the exact state and browser cookie, consumes success once, and does not exchange invalid attempts',async()=>{
  const a=await start();const before=exchanges;
  error(await callback(a,{cookies:''}),'google_expired');error(await callback(a,{cookies:'drama_google=not-the-browser-token'}),'google_expired');error(await callback(a,{state:'0'.repeat(64)}),'google_expired');assert.equal(exchanges,before);
  const success=await callback(a);assert.ok(cookie(success,'drama_session'));assert.equal(exchanges,before+1);
  error(await callback(a),'google_expired');assert.equal(exchanges,before+1);
});

test('Google cancellation is checked against browser state and consumes the attempt without signing in',async()=>{
  const a=await start('/wallet');const before=exchanges;
  error(await callback(a,{error:'access_denied',cookies:''}),'google_expired');const cancelled=error(await callback(a,{error:'access_denied'}),'google_cancelled');assert.equal(cancelled.searchParams.get('next'),'/wallet');assert.equal(exchanges,before);
  error(await callback(a),'google_expired');assert.equal(exchanges,before);
});

test('expired OAuth attempts are rejected before exchanging the authorization code',async()=>{
  const a=await start();const before=exchanges;run('UPDATE oauth_attempts SET expires_at=? WHERE state_hash=?',Date.now()-1,createHash('sha256').update(a.state).digest('hex'));
  error(await callback(a),'google_expired');assert.equal(exchanges,before);
});

test('invalid token audience, issuer, nonce, email verification, signature and expiry cannot create accounts',async()=>{
  const count=totalUsers();
  const bad:Array<{name:string;claims?:JWTPayload;wrongKey?:boolean;unsigned?:boolean}>=[
    {name:'wrong audience',claims:{aud:'attacker-client.apps.googleusercontent.com'}},
    {name:'wrong issuer',claims:{iss:'https://attacker.invalid'}},
    {name:'wrong nonce',claims:{nonce:'nonce-from-another-browser'}},
    {name:'unverified email',claims:{email_verified:false}},
    {name:'non-boolean email verification',claims:{email_verified:'true'}},
    {name:'wrong authorized party',claims:{azp:'another-client.apps.googleusercontent.com'}},
    {name:'missing issued-at claim',claims:{iat:undefined}},
    {name:'expired token',claims:{exp:Math.floor(Date.now()/1000)-300}},
    {name:'untrusted signature',wrongKey:true},
    {name:'unsigned token',unsigned:true},
  ];
  for(const item of bad){const a=await start();const signed=item.unsigned?await identityToken(a):undefined;const token=signed?Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')+'.'+signed.split('.')[1]+'.':undefined;const r=await callback(a,{...item,token});error(r,'google_failed');assert.equal(totalUsers(),count,item.name);error(await callback(a),'google_expired');}
});

test('provider code-exchange failures never create a local session or account',async()=>{
  const count=totalUsers();const a=await start();error(await callback(a,{failure:true}),'google_failed');assert.equal(totalUsers(),count);error(await callback(a),'google_expired');
});

test('a Google email matching a password account never automatically claims its wallet or privileges',async()=>{
  const existing=await register('matching-email@example.test');run("UPDATE users SET role='admin',wallet_micros=23000000 WHERE id=?",existing.id);const count=totalUsers();
  const a=await start();error(await callback(a,{claims:{sub:'unlinked-matching-email',email:existing.email}}),'google_email_exists');assert.equal(totalUsers(),count);
  const me=(await json('/api/auth/me',undefined,existing.session)).data.user;assert.equal(me.id,existing.id);assert.equal(me.wallet_micros,23_000_000);assert.equal(me.role,'admin');assert.equal((await json('/api/account/identities',undefined,existing.session)).data.google.linked,false);
});

test('explicit Google linking requires a current password, authenticated origin, and preserves wallet and purchases',async()=>{
  const existing=await register('explicit-link@example.test');
  run('UPDATE users SET wallet_micros=?,earnings_micros=? WHERE id=?',8_125_000,123_000,existing.id);
  const creator=randomUUID(),series=randomUUID(),episode=randomUUID(),purchase=randomUUID();
  run('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)',creator,'creator-'+creator+'@example.test','Fixture Creator','disabled-fixture');
  run("INSERT INTO series (id,creator_id,title,description,language,genres,status) VALUES (?,?,?,?,?,?,'published')",series,creator,'Owned purchase','An existing purchased episode.','en','["drama"]');
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,series,'Existing episode',1,12,100,'fixture/unused.mp4');
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',purchase,existing.id,episode,300_000,210_000,90_000);
  await json('/api/auth/google/link',{password},'',401);await json('/api/auth/google/link',{password:'wrong-password'},existing.session,401);await json('/api/auth/google/link',{password},existing.session,403,{Origin:'https://attacker.invalid'});
  const a=await startLink(existing.session);const r=await callback(a,{claims:{sub:'explicit-linked-subject',email:'explicit-linked-google@gmail.com'}});const redirect=location(r);assert.equal(redirect.pathname,'/account');assert.equal(redirect.searchParams.get('google'),'linked');
  const linkedSession=cookie(r,'drama_session')||existing.session;const me=(await json('/api/auth/me',undefined,linkedSession)).data.user;assert.equal(me.id,existing.id);assert.equal(me.wallet_micros,8_125_000);assert.equal(me.earnings_micros,123_000);assert.equal(one('SELECT user_id FROM purchases WHERE id=?',purchase)!.user_id,existing.id);
  const ids=(await json('/api/account/identities',undefined,linkedSession)).data;assert.equal(ids.google.linked,true);assert.equal(ids.google.email,'explicit-linked-google@gmail.com');assert.equal(ids.password,true);
  const again=await start();const signed=await callback(again,{claims:{sub:'explicit-linked-subject',email:'explicit-linked-google@gmail.com'}});assert.equal((await json('/api/auth/me',undefined,cookie(signed,'drama_session'))).data.user.id,existing.id);
});

test('one Google identity cannot be linked to another account',async()=>{
  const another=await register('conflicting-link@example.test');const a=await startLink(another.session);error(await callback(a,{claims:{sub:'explicit-linked-subject',email:'explicit-linked-google@gmail.com'}}),'google_identity_conflict','/account');
  const me=(await json('/api/auth/me',undefined,another.session)).data.user;assert.equal(me.id,another.id);assert.equal(me.wallet_micros,0);assert.equal((await json('/api/account/identities',undefined,another.session)).data.google.linked,false);
});

test('logging out or rotating the original session invalidates an outstanding Google link',async()=>{
  const existing=await register('changed-session@example.test');const a=await startLink(existing.session);await json('/api/auth/logout',{},existing.session);
  error(await callback(a,{claims:{sub:'logged-out-link',email:'logged-out-link@gmail.com'}}),'google_account_changed','/account');
  const logged=await json('/api/auth/login',{email:existing.email,password});const second=await startLink(logged.cookie);const rotated=await json('/api/auth/login',{email:existing.email,password},logged.cookie);
  error(await callback(second,{cookies:combine(second.cookie,rotated.cookie),claims:{sub:'rotated-link',email:'rotated-link@gmail.com'}}),'google_account_changed','/account');assert.equal((await json('/api/account/identities',undefined,rotated.cookie)).data.google.linked,false);
});

test('unsafe return URLs cannot redirect a completed Google login off site or into API routes',async()=>{
  for(const next of ['https://attacker.invalid/','//attacker.invalid/','/\\attacker.invalid/','/api/auth/google/start','/safe/..//attacker.invalid','/%2e//attacker.invalid']){
    const a=await start(next);const r=await callback(a);const redirect=location(r);assert.equal(redirect.origin,base);assert.equal(redirect.pathname,'/');assert.equal(redirect.search,'');
  }
});

test('two concurrent callbacks consume the same OAuth attempt only once',async()=>{
  const a=await start();const jwt=await identityToken(a);const code='concurrent-'+randomUUID();codes.set(code,{token:jwt,challenge:a.challenge});const route='/api/auth/google/callback?'+new URLSearchParams({state:a.state,code});const count=exchanges;
  const results=await Promise.all([request(route,undefined,a.cookie),request(route,undefined,a.cookie)]);assert.equal(results.filter(r=>cookie(r,'drama_session')).length,1);assert.equal(results.filter(r=>location(r).searchParams.get('error')==='google_expired').length,1);assert.equal(exchanges,count+1);
});
