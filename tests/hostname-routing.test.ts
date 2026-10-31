import {test} from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../cloudflare/legacy-gateway';
import {canonicalApiRedirect} from '../cloudflare/routing';
import {API_SITE_ORIGIN,PUBLIC_SITE_ORIGIN} from '../shared/site-origins';

test('legacy pages redirect to the public site without allowing the path or query to select a host',async()=>{
  for(const path of ['/','/studio/series/abc?view=stats','//attacker.example/wallet?next=https://attacker.example','/auth?mode=verify']){
    let called=false;
    const response=await gateway.fetch(new Request(API_SITE_ORIGIN+path),{LINGYING:{fetch:async()=>{called=true;return new Response();}}});
    assert.equal(response.status,308);assert.equal(called,false);
    const location=new URL(response.headers.get('location')!);
    assert.equal(location.origin,PUBLIC_SITE_ORIGIN);
    assert.equal(location.pathname,new URL(API_SITE_ORIGIN+path).pathname);
    assert.equal(location.search,new URL(API_SITE_ORIGIN+path).search);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  }
});

test('legacy API forwarding preserves browser binding cookies and the exact response',async()=>{
  const request=new Request(API_SITE_ORIGIN+'/api/auth/google/callback?state=fixture&error=access_denied',{headers:{Cookie:'drama_google=fixture; drama_session=fixture',Origin:PUBLIC_SITE_ORIGIN}});
  const returned=new Response(null,{status:303,headers:{Location:PUBLIC_SITE_ORIGIN+'/auth?error=google_cancelled','Set-Cookie':'drama_google=; Max-Age=0; Secure; HttpOnly; SameSite=Lax; Path=/api/auth/google'}});
  const response=await gateway.fetch(request,{LINGYING:{fetch:async forwarded=>{assert.equal(forwarded,request);assert.equal(forwarded.headers.get('cookie'),request.headers.get('cookie'));return returned;}}});
  assert.equal(response,returned);
});

test('legacy API POST forwarding preserves the raw webhook proof and streaming request body',async()=>{
  const body='{ "fixture": "signed raw bytes" }\n';
  const request=new Request(API_SITE_ORIGIN+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'local-fixture-signature'},body});
  const response=await gateway.fetch(request,{LINGYING:{fetch:async forwarded=>{
    assert.equal(forwarded.url,request.url);assert.equal(forwarded.method,'POST');
    assert.equal(forwarded.headers.get('stripe-signature'),'local-fixture-signature');assert.equal(await forwarded.text(),body);
    return Response.json({received:true});
  }}});
  assert.deepEqual(await response.json(),{received:true});
});

test('gateway rejects unrecognized hosts and non-API writes before touching the backend',async()=>{
  let calls=0;const env={LINGYING:{fetch:async()=>{calls++;return new Response();}}};
  assert.equal((await gateway.fetch(new Request('https://other.example/api/auth/login'),env)).status,403);
  const response=await gateway.fetch(new Request(API_SITE_ORIGIN+'/auth',{method:'POST',body:'private-body'}),env);
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');assert.equal(calls,0);
});

test('public API requests use a method-preserving redirect to the stable API origin',()=>{
  const env={APP_URL:API_SITE_ORIGIN,PUBLIC_APP_URL:PUBLIC_SITE_ORIGIN};
  const request=new Request(PUBLIC_SITE_ORIGIN+'/api/auth/login?next=%2Fwallet',{method:'POST',body:'fixture'});
  const response=canonicalApiRedirect(request,env)!;
  assert.equal(response.status,307);assert.equal(response.headers.get('location'),API_SITE_ORIGIN+'/api/auth/login?next=%2Fwallet');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(canonicalApiRedirect(new Request(API_SITE_ORIGIN+'/api/auth/google/start'),env),null);
  assert.equal(canonicalApiRedirect(new Request(PUBLIC_SITE_ORIGIN+'/studio'),env),null);
  assert.equal(canonicalApiRedirect(request,{APP_URL:API_SITE_ORIGIN}),null);
});
