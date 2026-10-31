import {after,before,beforeEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Server} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-public-origin-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';
process.env.PUBLIC_APP_URL='';process.env.STRIPE_SECRET_KEY='sk_test_local_origin_fixture_only';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const finance=await import('../server/finance');
const {apiOrigin,publicAppUrl,publicRedirect,apiUrl}=await import('../server/origins');
const realFetch=globalThis.fetch;
const api='https://api.lingying.example',publicSite='https://watch.lingying.example';
const password='OriginViewerPassword123!';
const signing=await generateKeyPair('RS256',{extractable:true});
const jwk={...await exportJWK(signing.publicKey),kid:'origin-google-key',use:'sig',alg:'RS256'};
const codes=new Map<string,{nonce:string;subject:string;email:string;challenge:string}>();
const messages:any[]=[];
let server:Server,base:string;
let exchangeRedirect='';

function session(response:Response){return response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))?.split(';')[0]||'';}
async function request(route:string,options:RequestInit={}){return realFetch(base+route,{redirect:'manual',...options});}
async function json(route:string,body?:unknown,cookie='',status=200,extra:Record<string,string>={}){
  const response=await request(route,{method:body===undefined?'GET':'POST',headers:{Origin:publicSite,'Sec-Fetch-Site':'same-site',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return{response,data,cookie:session(response)};
}
async function register(){const email=randomUUID()+'@origin.test';return json('/api/auth/register',{name:'Origin Viewer',email,password},'',201);}

before(async()=>{
  config.appUrl=api;config.publicUrl=publicSite;config.production=true;config.seed=false;config.payments='disabled';
  config.googleClientId='origin-client.apps.googleusercontent.com';config.googleClientSecret='local-origin-client-secret';
  config.appleClientId='com.example.lingying.web';config.appleTeamId='ORIGINTEAM';config.appleKeyId='ORIGINKEY';config.applePrivateKey='unused-on-cancellation';
  config.mailProvider='disabled';
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]},{headers:{'Cache-Control':'public, max-age=600'}});
    if(url==='https://oauth2.googleapis.com/token'){
      const body=new URLSearchParams(String(init?.body));exchangeRedirect=body.get('redirect_uri')||'';
      assert.equal(exchangeRedirect,api+'/api/auth/google/callback');
      const identity=codes.get(body.get('code')||'');assert(identity,'Only local registered codes may be exchanged');
      assert.equal(createHash('sha256').update(body.get('code_verifier')||'').digest('base64url'),identity.challenge);
      const token=await new SignJWT({email:identity.email,email_verified:true,nonce:identity.nonce,name:'Origin Google Viewer'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://accounts.google.com').setAudience(config.googleClientId).setSubject(identity.subject).setIssuedAt().setExpirationTime('5m').sign(signing.privateKey);
      return Response.json({id_token:token});
    }
    if(url==='https://api.resend.com/emails'){messages.push(JSON.parse(String(init?.body)));return Response.json({id:'local-origin-mail'});}
    throw new Error('Unexpected external request in isolated origin fixture');
  };
  const {createApp,errorHandler}=await import('../server/app');const app=createApp();app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{config.appUrl=api;config.publicUrl=publicSite;config.production=true;config.payments='disabled';config.mailProvider='disabled';});
after(async()=>{mock.restoreAll();globalThis.fetch=realFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('credentialed CORS accepts exactly configured public/API origins and restricts preflight methods and headers',async()=>{
  for(const origin of [publicSite,api]){
    const response=await request('/api/auth/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
    assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),'true');
    assert.match(response.headers.get('vary')||'',/Origin/);assert.match(response.headers.get('vary')||'',/Access-Control-Request-Headers/);
    assert.equal(response.headers.get('access-control-allow-headers'),'Content-Type, Range');
  }
  for(const headers of [
    {Origin:'https://hostile.example','Access-Control-Request-Method':'POST'},
    {Origin:publicSite+'.hostile.example','Access-Control-Request-Method':'POST'},
    {Origin:'null','Access-Control-Request-Method':'POST'},
    {Origin:publicSite,'Access-Control-Request-Method':'TRACE'},
    {Origin:publicSite,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'},
    {Origin:publicSite,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-untrusted-header'},
  ] as Record<string,string>[])assert.equal((await request('/api/auth/login',{method:'OPTIONS',headers})).status,403);
  const hostile=await request('/api/auth/me',{headers:{Origin:'https://hostile.example'}});assert.equal(hostile.headers.get('access-control-allow-origin'),null);assert.equal(hostile.headers.get('access-control-allow-credentials'),null);
});

test('new public origin uses existing private sessions while unknown origins and cross-site mutations remain blocked',async()=>{
  const user=await register();assert.match(user.cookie,/^drama_session=/);
  const setCookie=user.response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))!;
  assert.match(setCookie,/; Secure/i);assert.match(setCookie,/; HttpOnly/i);assert.match(setCookie,/; SameSite=Lax/i);assert.doesNotMatch(setCookie,/; Domain=/i);
  const profile=await json('/api/auth/me',undefined,user.cookie);assert.equal(profile.data.user.id,user.data.user.id);assert.equal(profile.response.headers.get('access-control-allow-origin'),publicSite);
  const before=one('SELECT name FROM users WHERE id=?',user.data.user.id)!.name;
  for(const extra of [{Origin:'https://hostile.example'},{Origin:publicSite,'Sec-Fetch-Site':'cross-site'}]){
    const response=await request('/api/account',{method:'PATCH',headers:{'Content-Type':'application/json','Sec-Fetch-Site':'same-site',Cookie:user.cookie,...extra},body:JSON.stringify({name:'Hostile update',language:'en'})});assert.equal(response.status,403);
  }
  assert.equal(one('SELECT name FROM users WHERE id=?',user.data.user.id)!.name,before);
  const stranger=await json('/api/auth/me');assert.equal(stranger.data.user,null);
});

async function googleStart(cookie=''){
  const response=await request('/api/auth/google/start?next=%2Fwallet',{headers:cookie?{Cookie:cookie}:{}});assert.equal(response.status,302);
  const location=new URL(response.headers.get('location')!);assert.equal(location.searchParams.get('redirect_uri'),api+'/api/auth/google/callback');
  const binding=response.headers.getSetCookie().find(value=>value.startsWith('drama_google='))!;assert.doesNotMatch(binding,/; Domain=/i);
  return{response,url:location,binding:binding.split(';')[0],state:location.searchParams.get('state')!,nonce:location.searchParams.get('nonce')!,challenge:location.searchParams.get('code_challenge')!};
}

test('Google keeps registered API callback and browser binding while verified success and cancellation return to the public website',async()=>{
  const flow=await googleStart();const code=randomUUID();codes.set(code,{nonce:flow.nonce,subject:randomUUID(),email:randomUUID()+'@google-origin.test',challenge:flow.challenge});
  const response=await request('/api/auth/google/callback?'+new URLSearchParams({state:flow.state,code}),{headers:{Cookie:flow.binding}});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),publicSite+'/wallet');assert.equal(exchangeRedirect,api+'/api/auth/google/callback');
  const cookie=session(response);assert(cookie);assert.doesNotMatch(response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))!,/; Domain=/i);
  const account=await json('/api/auth/me',undefined,cookie);assert.equal(account.data.user.name,'Origin Google Viewer');assert.equal((await json('/api/auth/me')).data.user,null);
  const replay=await request('/api/auth/google/callback?'+new URLSearchParams({state:flow.state,code}),{headers:{Cookie:flow.binding}});assert.equal(session(replay),'');assert.equal(new URL(replay.headers.get('location')!).searchParams.get('error'),'google_expired');
  const cancelled=await googleStart();const stop=await request('/api/auth/google/callback?'+new URLSearchParams({state:cancelled.state,error:'access_denied'}),{headers:{Cookie:cancelled.binding}});const target=new URL(stop.headers.get('location')!);assert.equal(target.origin,publicSite);assert.equal(target.searchParams.get('error'),'google_cancelled');assert.equal(session(stop),'');
});

test('explicit Google linking from public website keeps the original account and wallet while rotating the API session',async()=>{
  const user=await register();run('UPDATE users SET wallet_micros=? WHERE id=?',4_000_000,user.data.user.id);
  const linked=await json('/api/auth/google/link',{password,language:'en'},user.cookie);const url=new URL(linked.data.url);
  assert.equal(url.searchParams.get('redirect_uri'),api+'/api/auth/google/callback');
  const binder=linked.response.headers.getSetCookie().find(value=>value.startsWith('drama_google='))!.split(';')[0];
  const code=randomUUID();codes.set(code,{nonce:url.searchParams.get('nonce')!,subject:randomUUID(),email:user.data.user.email,challenge:url.searchParams.get('code_challenge')!});
  const response=await request('/api/auth/google/callback?'+new URLSearchParams({state:url.searchParams.get('state')!,code}),{headers:{Cookie:user.cookie+'; '+binder}});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),publicSite+'/account?google=linked');
  const replacement=session(response);assert(replacement&&replacement!==user.cookie);
  const current=await json('/api/auth/me',undefined,replacement);assert.equal(current.data.user.id,user.data.user.id);assert.equal(current.data.user.wallet_micros,4_000_000);
  assert.equal((await json('/api/auth/me',undefined,user.cookie)).data.user,null);
  assert.equal(one('SELECT user_id FROM oauth_identities WHERE provider=? AND user_id=?','google',user.data.user.id)!.user_id,user.data.user.id);
});

test('Apple retains original form_post callback and independent host-only binding when cancellation returns to public website',async()=>{
  const response=await request('/api/auth/apple/start?next=%2Faccount');assert.equal(response.status,302);const url=new URL(response.headers.get('location')!);assert.equal(url.searchParams.get('redirect_uri'),api+'/api/auth/apple/callback');
  const binding=response.headers.getSetCookie().find(value=>value.startsWith('drama_apple='))!;assert.match(binding,/; SameSite=None/i);assert.doesNotMatch(binding,/; Domain=/i);
  const callback=await request('/api/auth/apple/callback',{method:'POST',headers:{Cookie:binding.split(';')[0],Origin:'https://appleid.apple.com','Sec-Fetch-Site':'cross-site','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({state:url.searchParams.get('state')!,error:'user_cancelled_authorize'})});
  assert.equal(callback.status,303);const target=new URL(callback.headers.get('location')!);assert.equal(target.origin,publicSite);assert.equal(target.searchParams.get('error'),'apple_cancelled');assert.equal(session(callback),'');
});

test('new Checkout returns to public website while pending signed events retain stable API site metadata and exact test credit',async()=>{
  config.payments='stripe';config.stripeTestMode=true;config.stripeWebhook='whsec_local_origin_fixture';config.stripeKey='sk_test_local_origin_fixture_only';finance.configureStripe();
  const user=await register();const calls:any[]=[];
  const created=mock.method(finance.stripe!.checkout.sessions,'create',async(params:any):Promise<any>=>{calls.push(params);return{id:'cs_test_origin_'+randomUUID(),livemode:false,url:'https://checkout.stripe.com/local-fixture'};});
  try{
    const checkout=await json('/api/payments/checkout',{kind:'funding',amount_cents:500},user.cookie);const call=calls.at(-1);assert.equal(call.metadata.site,api);assert.equal(call.success_url,publicSite+'/wallet?checkout=success&session_id={CHECKOUT_SESSION_ID}');assert.equal(call.cancel_url,publicSite+'/wallet?checkout=cancelled');
    const pending=one('SELECT * FROM test_payments WHERE id=?',checkout.data.paymentId)!;assert.equal(pending.status,'pending');assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.data.user.id)!.wallet_micros,0);
    const payload=JSON.stringify({id:'evt_origin_'+randomUUID(),object:'event',type:'checkout.session.completed',livemode:false,data:{object:{id:pending.provider_session,livemode:false,payment_status:'paid',amount_total:500,currency:'usd',metadata:{site:api,paymentId:pending.id,userId:user.data.user.id}}}});
    const wrongSite=JSON.parse(payload);wrongSite.data.object.metadata.site=publicSite;const wrongBody=JSON.stringify(wrongSite);
    const wrongSignature=finance.stripe!.webhooks.generateTestHeaderString({payload:wrongBody,secret:config.stripeWebhook});
    const ignored=await request('/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':wrongSignature},body:wrongBody});assert.deepEqual(await ignored.json(),{received:true,ignored:true});assert.equal(one('SELECT status FROM test_payments WHERE id=?',pending.id)!.status,'pending');
    const signature=finance.stripe!.webhooks.generateTestHeaderString({payload,secret:config.stripeWebhook});
    const paid=await request('/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});assert.equal(paid.status,200);assert.deepEqual(await paid.json(),{received:true});
    assert.equal((await json('/api/wallet',undefined,user.cookie)).data.user.wallet_micros,5_000_000);assert.equal(one('SELECT wallet_micros FROM users WHERE id=?',user.data.user.id)!.wallet_micros,0);
    await request('/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});assert.equal((await json('/api/wallet',undefined,user.cookie)).data.user.wallet_micros,5_000_000);
  }finally{created.mock.restore();config.stripeTestMode=false;}
});

test('recovery proofs use public fragment URLs and API media URLs remain on stable credential origin',async()=>{
  config.mailProvider='resend';config.resendApiKey='re_local_origin_fixture';config.mailFrom='LingYing <accounts@verified.example>';
  const {sendAccountEmail}=await import('../server/mail');await sendAccountEmail('origin@example.test','reset','a'.repeat(64),'local-origin-request');
  const link=new URL(messages.at(-1).text.match(/https:\/\/[^\s]+/)[0]);assert.equal(link.origin,publicSite);assert.equal(link.pathname,'/auth');assert.equal(link.searchParams.has('token'),false);assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'),'a'.repeat(64));
  const creator=await register();const seriesId=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,cover_key,status) VALUES (?,?,?,?,?,?,?,?,?)',seriesId,creator.data.user.id,'Origin story','A published story with private cover storage.','en','["drama"]','human','private-origin-cover','published');
  const series=await json('/api/series/'+seriesId);assert.equal(series.data.series.cover,api+'/api/series/'+seriesId+'/cover');
  assert.equal(apiUrl('/api/episodes/one/stream'),api+'/api/episodes/one/stream');assert.equal(apiOrigin(),api);assert.equal(publicAppUrl(),publicSite);
  for(const value of ['//hostile.example/path','https://hostile.example/path','/\\hostile.example'])assert.equal(publicRedirect(value),publicSite+'/');
  config.publicUrl='';assert.equal(publicAppUrl(),api);assert.equal(publicRedirect('/wallet'),'/wallet');assert.equal(apiUrl('/api/auth/me'),'/api/auth/me');
});
