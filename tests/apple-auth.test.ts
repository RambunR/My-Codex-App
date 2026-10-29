import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {generateKeyPair,exportJWK,exportPKCS8,SignJWT,jwtVerify,type JWTPayload} from 'jose';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-apple-auth-'));
process.env.DATA_DIR=dir;process.env.PAYMENTS_MODE='demo';process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const originalFetch=globalThis.fetch;
const issuer='https://appleid.apple.com',clientId='com.aidramio.web.test',teamId='TESTTEAM01',keyId='TESTKEY001';
const appOrigin='https://aidramio-apple.example';
const password='ExistingAccountPassword123!';
const providerKeys=await generateKeyPair('RS256',{extractable:true});
const wrongKeys=await generateKeyPair('RS256',{extractable:true});
const clientKeys=await generateKeyPair('ES256',{extractable:true});
const jwk={...await exportJWK(providerKeys.publicKey),kid:'apple-provider-test-key',alg:'RS256',use:'sig'};
const codes=new Map<string,{token?:string;failure?:boolean;providerError?:string;errorDescription?:string;response?:unknown}>();
let server:Server,base:string,exchanges=0;
interface Attempt{url:URL;state:string;nonce:string;cookie:string;session:string}
function cookie(response:Response,name:string){return response.headers.getSetCookie().find(value=>value.startsWith(name+'='))?.split(';')[0]||'';}
function combine(...cookies:string[]){return cookies.filter(Boolean).join('; ');}
async function request(route:string,body?:unknown,session='',headers:Record<string,string>={}){
  return originalFetch(base+route,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{...(session?{Cookie:session}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
async function json(route:string,body?:unknown,session='',status=200,headers:Record<string,string>={}){
  const response=await request(route,body,session,headers);const data=await response.json();assert.equal(response.status,status,`${route}: ${JSON.stringify(data)}`);return{response,data,cookie:cookie(response,'drama_session')};
}
function parseAttempt(response:Response,url:string,session=''):Attempt{
  const parsed=new URL(url);assert.equal(parsed.origin,issuer);assert.equal(parsed.pathname,'/auth/authorize');
  assert.equal(parsed.searchParams.get('client_id'),clientId);assert.equal(parsed.searchParams.get('response_type'),'code');assert.equal(parsed.searchParams.get('response_mode'),'form_post');
  assert.equal(parsed.searchParams.get('redirect_uri'),appOrigin+'/api/auth/apple/callback');
  const state=parsed.searchParams.get('state')||'',nonce=parsed.searchParams.get('nonce')||'';assert.ok(state&&nonce);
  const binding=cookie(response,'drama_apple');assert.ok(binding);return{url:parsed,state,nonce,cookie:binding,session};
}
async function start(next='/wallet',session='',language='en'){
  const response=await request('/api/auth/apple/start?'+new URLSearchParams({next,language}),undefined,session);assert.equal(response.status,302);return parseAttempt(response,response.headers.get('location')!,session);
}
async function startLink(session:string){const result=await json('/api/auth/apple/link',{password,language:'en'},session);return parseAttempt(result.response,result.data.url,session);}
async function identityToken(attempt:Attempt,claims:JWTPayload={},wrongKey=false){
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({iss:issuer,aud:clientId,sub:'apple-subject-'+randomUUID(),email:randomUUID()+'@privaterelay.appleid.com',email_verified:'true',nonce:attempt.nonce,iat:now,exp:now+300,...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(wrongKey?wrongKeys.privateKey:providerKeys.privateKey);
}
async function callback(attempt:Attempt,options:{claims?:JWTPayload;token?:string;wrongKey?:boolean;cookies?:string;state?:string;error?:string;failure?:boolean;user?:string;code?:string;providerError?:string;errorDescription?:string;tokenResponse?:unknown}={}){
  const body=new URLSearchParams({state:options.state??attempt.state});
  if(options.error)body.set('error',options.error);
  else{const code=options.code??'apple-code-'+randomUUID();codes.set(code,{token:options.token??await identityToken(attempt,options.claims,options.wrongKey),failure:options.failure,providerError:options.providerError,errorDescription:options.errorDescription,response:options.tokenResponse});body.set('code',code);}
  if(options.errorDescription)body.set('error_description',options.errorDescription);
  if(options.user)body.set('user',options.user);
  return originalFetch(base+'/api/auth/apple/callback',{redirect:'manual',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:issuer,'sec-fetch-site':'cross-site',Cookie:options.cookies??attempt.cookie},body});
}
function location(response:Response){assert.ok([302,303].includes(response.status),`Expected redirect, got ${response.status}`);return new URL(response.headers.get('location')!,base);}
function failure(response:Response,code:string,pathname='/auth'){const url=location(response);assert.equal(url.origin,base);assert.equal(url.pathname,pathname);assert.equal(url.searchParams.get('error'),code);assert.equal(cookie(response,'drama_session'),'');return url;}
async function register(email=randomUUID()+'@example.test'){const result=await json('/api/auth/register',{name:'Existing Viewer',email,password},'',201);return{id:result.data.user.id,email,session:result.cookie};}
function totalUsers(){return one<{n:number}>('SELECT COUNT(*) AS n FROM users')!.n;}

before(async()=>{
  config.appleClientId=clientId;config.appleTeamId=teamId;config.appleKeyId=keyId;config.applePrivateKey=await exportPKCS8(clientKeys.privateKey);config.appUrl=appOrigin;
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url===issuer+'/auth/keys')return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=3600'}});
    if(url===issuer+'/auth/token'){
      exchanges++;const exchange=new Request(input,init);assert.equal(exchange.method,'POST');const body=new URLSearchParams(await exchange.text());
      assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('client_id'),clientId);assert.equal(body.get('redirect_uri'),appOrigin+'/api/auth/apple/callback');
      const secret=await jwtVerify(body.get('client_secret')!,clientKeys.publicKey,{algorithms:['ES256'],issuer:teamId,subject:clientId,audience:issuer,requiredClaims:['iat','exp']});
      assert.equal(secret.protectedHeader.kid,keyId);assert.ok(secret.payload.exp!-secret.payload.iat!<=300);
      const code=body.get('code')||'',issued=codes.get(code);assert.ok(issued,'Only issued one-use codes can be exchanged');codes.delete(code);
      if(issued.failure||issued.providerError)return Response.json({error:issued.providerError||'invalid_grant',error_description:issued.errorDescription},{status:400});
      if(issued.response!==undefined)return Response.json(issued.response);
      return Response.json({id_token:issued.token,access_token:'unused-test-access-token',refresh_token:'unused-test-refresh-token'});
    }
    return originalFetch(input,init);
  };
  const {createApp,errorHandler}=await import('../server/app');const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
after(async()=>{globalThis.fetch=originalFetch;if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('Apple availability requires all server credentials and form_post uses a private Secure None cookie',async()=>{
  assert.equal((await json('/api/config')).data.auth.apple,true);
  const stored=config.applePrivateKey;config.applePrivateKey='';
  try{assert.equal((await json('/api/config')).data.auth.apple,false);await json('/api/auth/apple/start',undefined,'',503);}finally{config.applePrivateKey=stored;}
  const response=await request('/api/auth/apple/start?next=%2Fwallet&language=zh-TW');const attempt=parseAttempt(response,response.headers.get('location')!);
  const header=response.headers.getSetCookie().find(value=>value.startsWith('drama_apple='))!;
  assert.match(header,/HttpOnly/i);assert.match(header,/; Secure/i);assert.match(header,/SameSite=None/i);assert.match(header,/Path=\/api\/auth\/apple/i);
  assert.equal(one('SELECT state_hash FROM apple_oauth_attempts WHERE state_hash=?',attempt.state),undefined,'Raw state is not stored');
  const stateHash=createHash('sha256').update(attempt.state).digest('hex');assert.ok(one('SELECT state_hash FROM apple_oauth_attempts WHERE state_hash=?',stateHash));
  const old=config.appUrl;config.appUrl='http://aidramio.example';try{await json('/api/auth/apple/start',undefined,'',503);}finally{config.appUrl=old;}
});

test('verified Apple registration creates a viewer, uses signed email over form data, and marks that email verified',async()=>{
  const attempt=await start('/wallet','','zh-TW'),email='first-apple-viewer@privaterelay.appleid.com',subject='first-apple-viewer';
  const response=await callback(attempt,{claims:{email,sub:subject},user:JSON.stringify({email:'attacker@example.test',name:{firstName:'Apple',lastName:'Viewer'}})});
  assert.equal(location(response).pathname,'/wallet');const session=cookie(response,'drama_session');assert.ok(session);
  const user=(await json('/api/auth/me',undefined,session)).data.user;
  assert.equal(user.email,email);assert.equal(user.name,'Apple Viewer');assert.equal(user.language,'zh-TW');assert.equal(user.role,'viewer');assert.equal(user.publisher_active,0);assert.equal(user.wallet_micros,0);assert.equal(user.earnings_micros,0);assert.equal(user.email_verified,true);assert.equal(user.password_hash,undefined);
  assert.equal(one('SELECT user_id FROM apple_identities WHERE subject=?',subject)!.user_id,user.id);
  await json('/api/auth/login',{email,password},'',401);
});

test('Apple callbacks require browser-bound state, consume cancellation once and reject expired attempts before exchange',async()=>{
  const attempt=await start(),before=exchanges;
  failure(await callback(attempt,{cookies:''}),'apple_expired');failure(await callback(attempt,{state:'0'.repeat(64)}),'apple_expired');assert.equal(exchanges,before);
  failure(await callback(attempt,{error:'user_cancelled_authorize'}),'apple_cancelled');
  failure(await callback(attempt),'apple_expired');assert.equal(exchanges,before);
  const expired=await start();run('UPDATE apple_oauth_attempts SET expires_at=? WHERE state_hash=?',Date.now()-1,createHash('sha256').update(expired.state).digest('hex'));
  failure(await callback(expired),'apple_expired');assert.equal(exchanges,before);
});

test('returning Apple sign-in uses stable subject and preserves the existing wallet when provider email changes',async()=>{
  const initial=await start();const response=await callback(initial,{claims:{sub:'stable-apple-viewer',email:'old-apple@example.test',email_verified:true}});
  const id=(await json('/api/auth/me',undefined,cookie(response,'drama_session'))).data.user.id;
  run('UPDATE users SET wallet_micros=?,earnings_micros=?,publisher_active=1 WHERE id=?',12_345_000,777_000,id);
  const other=await register('changed-apple@example.test');const attempt=await start();const again=await callback(attempt,{claims:{sub:'stable-apple-viewer',email:other.email}});
  const user=(await json('/api/auth/me',undefined,cookie(again,'drama_session'))).data.user;
  assert.equal(user.id,id);assert.notEqual(user.id,other.id);assert.equal(user.wallet_micros,12_345_000);assert.equal(user.earnings_micros,777_000);assert.equal(user.publisher_active,1);
  assert.equal((await json('/api/auth/me',undefined,other.session)).data.user.email_verified,false,'A changed Apple email cannot verify another account');
});

test('wrong Apple issuer, audience, nonce, verification, expiry, signature and unsigned tokens never create accounts',async()=>{
  const before=totalUsers();const now=Math.floor(Date.now()/1000);
  for(const claims of [{iss:'https://attacker.example'},{aud:'another-service'},{nonce:'wrong-nonce'},{email_verified:'false'},{exp:now-60},{iat:now+60}]){
    const attempt=await start();failure(await callback(attempt,{claims}),'apple_failed');
  }
  const wrong=await start();failure(await callback(wrong,{wrongKey:true}),'apple_failed');
  const unsigned=await start();const token=Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({iss:issuer,aud:clientId,sub:'forged',email:'forged@example.test',email_verified:true,nonce:unsigned.nonce,iat:now,exp:now+300})).toString('base64url')+'.';
  failure(await callback(unsigned,{token}),'apple_failed');assert.equal(totalUsers(),before);
});

test('Apple provider errors and email collisions cannot claim an existing password account',async()=>{
  const existing=await register('password-apple-collision@example.test');run('UPDATE users SET wallet_micros=? WHERE id=?',99_000_000,existing.id);
  const before=totalUsers();const failed=await start();failure(await callback(failed,{failure:true}),'apple_failed');
  const collision=await start();failure(await callback(collision,{claims:{email:existing.email}}),'apple_email_exists');
  assert.equal(totalUsers(),before);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',existing.id)!.wallet_micros,99_000_000);assert.equal(one('SELECT subject FROM apple_identities WHERE user_id=?',existing.id),undefined);
});

test('password-confirmed Apple linking survives the cross-site form without the Lax app cookie and preserves the account',async()=>{
  const existing=await register('explicit-apple-link@example.test');run('UPDATE users SET wallet_micros=? WHERE id=?',7_000_000,existing.id);
  await json('/api/auth/apple/link',{password:'wrong-password'},existing.session,401);
  await json('/api/auth/apple/link',{password},existing.session,403,{Origin:'https://attacker.example','sec-fetch-site':'cross-site'});
  const attempt=await startLink(existing.session);const response=await callback(attempt,{claims:{sub:'explicit-apple-link',email:existing.email}});
  assert.equal(location(response).pathname,'/account');assert.equal(location(response).searchParams.get('apple'),'linked');
  const session=cookie(response,'drama_session');const user=(await json('/api/auth/me',undefined,session)).data.user;
  assert.equal(user.id,existing.id);assert.equal(user.wallet_micros,7_000_000);assert.equal(user.email_verified,true);
  assert.equal((await json('/api/auth/me',undefined,existing.session)).data.user,null,'The original app session rotates even when its Lax cookie was absent');
  const conflict=await register('apple-conflict@example.test');const another=await startLink(conflict.session);
  failure(await callback(another,{claims:{sub:'explicit-apple-link',email:existing.email}}),'apple_identity_conflict','/account');
  assert.equal(one('SELECT user_id FROM apple_identities WHERE subject=?','explicit-apple-link')!.user_id,existing.id);
});

test('logging out or rotating the original session invalidates pending Apple linking without relying on callback cookies',async()=>{
  const existing=await register('apple-session-change@example.test');const loggedOut=await startLink(existing.session);await json('/api/auth/logout',{},existing.session);
  failure(await callback(loggedOut),'apple_account_changed','/account');
  const login=await json('/api/auth/login',{email:existing.email,password});const rotated=await startLink(login.cookie);
  await json('/api/auth/login',{email:existing.email,password},login.cookie);failure(await callback(rotated),'apple_account_changed','/account');
});

test('unsafe return paths stay on site and concurrent Apple callbacks exchange a code only once',async()=>{
  for(const next of ['https://attacker.example/','//attacker.example/','/safe/..//attacker.example','/%2e//attacker.example']){
    const attempt=await start(next);const failed=failure(await callback(attempt,{error:'access_denied'}),'apple_cancelled');assert.equal(failed.searchParams.get('next'),'/');
  }
  const attempt=await start(),code='concurrent-apple-'+randomUUID(),before=exchanges;codes.set(code,{token:await identityToken(attempt)});
  const body=new URLSearchParams({state:attempt.state,code});
  const send=()=>originalFetch(base+'/api/auth/apple/callback',{redirect:'manual',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:issuer,'sec-fetch-site':'cross-site',Cookie:attempt.cookie},body});
  const results=await Promise.all([send(),send()]);assert.equal(results.filter(response=>cookie(response,'drama_session')).length,1);assert.equal(results.filter(response=>location(response).searchParams.get('error')==='apple_expired').length,1);assert.equal(exchanges,before+1);
});

test('Apple failure diagnostics distinguish private keys, upstream rejection and identity tokens without logging secrets',async()=>{
  const existing=await register('apple-diagnostics-fixture@example.test');const before=totalUsers();
  const secretMarker='APPLE-DIAGNOSTIC-SECRET-SENTINEL',email='apple-diagnostic-private@example.test';
  const captured:unknown[][]=[];const originalError=console.error;
  console.error=(...values:unknown[])=>{captured.push(values);};
  const events=()=>captured.map(values=>{assert.equal(values.length,1);assert.equal(typeof values[0],'string');return JSON.parse(values[0] as string) as Record<string,unknown>;});
  const check=(stage:string,expected:Record<string,unknown>={})=>{
    const rows=events();assert.equal(rows.length,1);const event=rows[0];assert.equal(event.event,'apple_auth_failure');assert.equal(event.stage,stage);assert.equal(event.failure,'apple_failed');
    for(const[key,value]of Object.entries(expected))assert.equal(event[key],value);
    const allowed=['event','stage','failure','upstream_status','upstream_error','error_code','error_name','key_format'];assert.ok(Object.keys(event).every(key=>allowed.includes(key)));
    const raw=JSON.stringify(captured);for(const sentinel of [secretMarker,email,'unused-test-access-token','unused-test-refresh-token',password,'BEGIN PRIVATE KEY'])assert.equal(raw.includes(sentinel),false,'Diagnostics must not log private values');
    captured.length=0;return event;
  };
  try{
    const invalidKey=await start('/wallet',existing.session);const savedKey=config.applePrivateKey,previousExchanges=exchanges;
    config.applePrivateKey=secretMarker+'-NOT-A-PRIVATE-KEY';
    try{failure(await callback(invalidKey,{code:secretMarker+'-AUTHORIZATION-CODE'}),'apple_failed');}finally{config.applePrivateKey=savedKey;}
    check('private_key',{error_name:'TypeError',key_format:'other'});assert.equal(exchanges,previousExchanges);
    const jsonKey=await start('/wallet',existing.session);config.applePrivateKey=JSON.stringify(savedKey);
    try{failure(await callback(jsonKey),'apple_failed');}finally{config.applePrivateKey=savedKey;}
    check('private_key',{error_name:'TypeError',key_format:'json_string'});assert.equal(exchanges,previousExchanges);

    for(const upstream of ['invalid_client','invalid_grant']){
      const attempt=await start('/wallet',existing.session);
      failure(await callback(attempt,{providerError:upstream,errorDescription:secretMarker+' '+email,code:secretMarker+'-AUTHORIZATION-CODE'}),'apple_failed');
      check('token_exchange',{upstream_status:400,upstream_error:upstream});
    }
    const untrustedError=await start('/wallet',existing.session);
    failure(await callback(untrustedError,{providerError:secretMarker,errorDescription:email}),'apple_failed');
    assert.equal(check('token_exchange',{upstream_status:400}).upstream_error,undefined,'Unknown provider fields are omitted');

    const malformedReply=await start('/wallet',existing.session);
    failure(await callback(malformedReply,{tokenResponse:{access_token:secretMarker,refresh_token:email}}),'apple_failed');
    check('id_token_parse',{upstream_status:200});

    const wrongSignature=await start('/wallet',existing.session);
    const token=await identityToken(wrongSignature,{email},true);
    failure(await callback(wrongSignature,{token}),'apple_failed');
    assert.equal(JSON.stringify(captured).includes(token),false,'Signed identity tokens must not enter diagnostics');
    check('id_token_verify',{upstream_status:200,error_code:'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'});

    const providerCallback=await start('/wallet',existing.session);
    failure(await callback(providerCallback,{error:'server_error',errorDescription:secretMarker+' '+email}),'apple_failed');
    check('provider_callback',{upstream_error:'server_error'});
    const unknownCallback=await start('/wallet',existing.session);
    failure(await callback(unknownCallback,{error:secretMarker,errorDescription:email}),'apple_failed');
    assert.equal(check('provider_callback').upstream_error,undefined);

    const cancelled=await start('/wallet',existing.session);
    failure(await callback(cancelled,{error:'access_denied'}),'apple_cancelled');assert.equal(captured.length,0);
    failure(await callback(cancelled),'apple_expired');assert.equal(captured.length,0);
    assert.equal(totalUsers(),before);
  }finally{console.error=originalError;}
});
