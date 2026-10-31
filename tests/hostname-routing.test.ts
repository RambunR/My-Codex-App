import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import gateway from '../cloudflare/legacy-gateway';
import {canonicalApiRedirect,canonicalPageRedirect} from '../cloudflare/routing';
import {API_SITE_ORIGIN,CUSTOM_SITE_ORIGIN,LEGACY_API_SITE_ORIGIN,LEGACY_PUBLIC_SITE_ORIGIN,PUBLIC_SITE_ORIGIN} from '../shared/site-origins';

const aliasOrigins=[LEGACY_API_SITE_ORIGIN,LEGACY_PUBLIC_SITE_ORIGIN,'https://www.lingyingdrama.com'];
const primary={APP_URL:API_SITE_ORIGIN,PUBLIC_APP_URL:PUBLIC_SITE_ORIGIN};

test('public and API defaults both serve the custom domain without redirecting to a legacy host',()=>{
  assert.equal(CUSTOM_SITE_ORIGIN,'https://lingyingdrama.com');
  assert.equal(PUBLIC_SITE_ORIGIN,CUSTOM_SITE_ORIGIN);
  assert.equal(API_SITE_ORIGIN,CUSTOM_SITE_ORIGIN);
  for(const method of ['GET','HEAD'])for(const path of ['/','/browse?sort=new','/auth?mode=login','/brand-mark.png?v=fixture']){
    assert.equal(canonicalPageRedirect(new Request(CUSTOM_SITE_ORIGIN+path,{method}),primary),null);
  }
  for(const path of ['/api/health','/api/auth/google/start','/api/auth/apple/callback','/api/payments/checkout']){
    const request=new Request(CUSTOM_SITE_ORIGIN+path,{method:path.endsWith('callback')||path.endsWith('checkout')?'POST':'GET'});
    assert.equal(canonicalApiRedirect(request,primary),null);
    assert.equal(canonicalPageRedirect(request,primary),null);
  }
});

test('tracked deployment keeps the same custom public/API origin and runs routing before assets',()=>{
  const deployment=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(deployment.vars.APP_URL,CUSTOM_SITE_ORIGIN);
  assert.equal(deployment.vars.PUBLIC_APP_URL,CUSTOM_SITE_ORIGIN);
  assert.equal(deployment.assets.run_worker_first,true,'Asset-first SPA fallbacks must not bypass canonical redirects.');
});

test('legacy pages redirect to the custom site without allowing the path or query to select a host',async()=>{
  for(const method of ['GET','HEAD'])for(const path of ['/','/studio/series/abc?view=stats','//attacker.example/wallet?next=https://attacker.example','/auth?mode=verify']){
    let called=false;
    const response=await gateway.fetch(new Request(LEGACY_API_SITE_ORIGIN+path,{method}),{LINGYING:{fetch:async()=>{called=true;return new Response();}}});
    assert.equal(response.status,308);assert.equal(called,false);
    const location=new URL(response.headers.get('location')!);
    assert.equal(location.origin,CUSTOM_SITE_ORIGIN);
    assert.equal(location.pathname,new URL(LEGACY_API_SITE_ORIGIN+path).pathname);
    assert.equal(location.search,new URL(LEGACY_API_SITE_ORIGIN+path).search);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  }
});

test('legacy API forwarding preserves browser binding cookies and the exact backend response',async()=>{
  const request=new Request(LEGACY_API_SITE_ORIGIN+'/api/auth/google/callback?state=fixture&error=access_denied',{headers:{Cookie:'drama_google=fixture; drama_session=fixture',Origin:PUBLIC_SITE_ORIGIN}});
  const returned=new Response(null,{status:303,headers:{Location:PUBLIC_SITE_ORIGIN+'/auth?error=google_cancelled','Set-Cookie':'drama_google=; Max-Age=0; Secure; HttpOnly; SameSite=Lax; Path=/api/auth/google'}});
  const response=await gateway.fetch(request,{LINGYING:{fetch:async forwarded=>{assert.equal(forwarded,request);assert.equal(forwarded.headers.get('cookie'),request.headers.get('cookie'));return returned;}}});
  assert.equal(response,returned);
});

test('legacy gateway and final canonical routing preserve the raw signed webhook body',async()=>{
  const body='{ "fixture": "signed raw bytes" }\n';
  const request=new Request(LEGACY_API_SITE_ORIGIN+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'local-fixture-signature'},body});
  const response=await gateway.fetch(request,{LINGYING:{fetch:async forwarded=>{
    assert.equal(forwarded.url,request.url);assert.equal(forwarded.method,'POST');
    assert.equal(canonicalApiRedirect(forwarded,primary),null);
    assert.equal(canonicalPageRedirect(forwarded,primary),null);
    assert.equal(forwarded.headers.get('stripe-signature'),'local-fixture-signature');assert.equal(await forwarded.text(),body);
    return Response.json({received:true});
  }}});
  assert.deepEqual(await response.json(),{received:true});
});

test('gateway rejects other hosts and non-API writes before touching the backend',async()=>{
  let calls=0;const env={LINGYING:{fetch:async()=>{calls++;return new Response();}}};
  for(const origin of ['https://other.example',CUSTOM_SITE_ORIGIN,LEGACY_PUBLIC_SITE_ORIGIN]){
    assert.equal((await gateway.fetch(new Request(origin+'/api/auth/login'),env)).status,403);
  }
  const response=await gateway.fetch(new Request(LEGACY_API_SITE_ORIGIN+'/auth',{method:'POST',body:'private-body'}),env);
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');assert.equal(calls,0);
});

test('alias API requests redirect to the custom API without consuming the method or body',async()=>{
  for(const origin of aliasOrigins){
    const request=new Request(origin+'/api/auth/login?next=%2Fwallet',{method:'POST',body:'fixture body'});
    const response=canonicalApiRedirect(request,primary)!;
    assert.equal(response.status,307);
    assert.equal(response.headers.get('location'),CUSTOM_SITE_ORIGIN+'/api/auth/login?next=%2Fwallet');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal(request.method,'POST');assert.equal(await request.text(),'fixture body');
  }
  assert.equal(canonicalApiRedirect(new Request(CUSTOM_SITE_ORIGIN+'/api/auth/google/start'),primary),null);
  assert.equal(canonicalApiRedirect(new Request(LEGACY_PUBLIC_SITE_ORIGIN+'/studio'),primary),null);
  assert.equal(canonicalApiRedirect(new Request(LEGACY_PUBLIC_SITE_ORIGIN+'/api/auth/login'),{APP_URL:CUSTOM_SITE_ORIGIN}),null);
});

test('signed webhook POSTs reach signature verification directly on aliases and the custom domain',async()=>{
  for(const origin of [...aliasOrigins,CUSTOM_SITE_ORIGIN]){
    const request=new Request(origin+'/api/payments/webhook',{method:'POST',headers:{'Stripe-Signature':'local-proof'},body:'fixture raw body'});
    assert.equal(canonicalApiRedirect(request,primary),null);
    assert.equal(canonicalPageRedirect(request,primary),null);
    assert.equal(await request.text(),'fixture raw body');
  }
  const browserGet=canonicalApiRedirect(new Request(LEGACY_API_SITE_ORIGIN+'/api/payments/webhook'),primary)!;
  assert.equal(browserGet.status,307,'Only webhook POST delivery handling bypasses canonical API routing.');
});

test('legacy and www alias page or asset requests use the custom origin and preserve path/query',()=>{
  for(const origin of aliasOrigins)for(const method of ['GET','HEAD']){
    for(const path of ['/','/browse?sort=new&language=zh-TW','/wallet?checkout=success&session_id=fixture','/auth?mode=login','/brand-mark.png?v=fixture','/assets/app-fixture.js','//other.example/path?next=https://other.example']){
      const response=canonicalPageRedirect(new Request(origin+path,{method}),primary)!;
      assert.equal(response.status,308);
      const result=new URL(response.headers.get('location')!);
      assert.equal(result.origin,CUSTOM_SITE_ORIGIN);assert.equal(result.pathname,new URL(origin+path).pathname);assert.equal(result.search,new URL(origin+path).search);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    }
  }
});

test('canonical page routing leaves API paths and writes unchanged without a redirect loop',()=>{
  assert.equal(canonicalPageRedirect(new Request(CUSTOM_SITE_ORIGIN+'/account'),primary),null);
  assert.equal(canonicalPageRedirect(new Request(LEGACY_API_SITE_ORIGIN+'/api/auth/google/callback'),primary),null);
  assert.equal(canonicalPageRedirect(new Request(LEGACY_API_SITE_ORIGIN+'/auth',{method:'POST'}),primary),null);
  assert.equal(canonicalPageRedirect(new Request(LEGACY_API_SITE_ORIGIN+'/auth'),{}),null);
});
