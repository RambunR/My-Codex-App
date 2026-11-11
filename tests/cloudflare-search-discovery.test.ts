import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchDiscoveryResponse} from '../cloudflare/search-discovery';
import {missingSearchDocument,seriesSearchDocument,staticSearchDocument} from '../shared/search-discovery';
import type {Env} from '../cloudflare/runtime';

const origin='https://lingyingdrama.com';
const shell='<!doctype html><html><head><title>Old</title></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';
function fixture(document:unknown,status=200){
  const apiRequests:Request[]=[],assetRequests:Request[]=[];
  const env={APP_URL:origin,PUBLIC_APP_URL:origin,APP:{idFromName:()=>1,get:()=>({fetch:async(request:Request)=>{apiRequests.push(request);return Response.json(document,{status});}})},ASSETS:{fetch:async(request:Request)=>{assetRequests.push(request);return new Response(shell,{headers:{'Content-Type':'text/html','Content-Encoding':'br','Content-Length':'42',ETag:'"old-shell"','Last-Modified':'Mon, 02 Nov 2026 00:00:00 GMT'}});}}}as unknown as Env;
  return{env,apiRequests,assetRequests};
}
test('Cloudflare rewrites anonymous public HTML with real metadata and drops stale compressed-body validators',async()=>{
  const document=seriesSearchDocument({id:'public.v2',title:'A real story',description:'An actual synopsis.',language:'en',genres:['drama'],episodeCount:3},origin),f=fixture(document),response=await searchDiscoveryResponse(new Request(origin+'/series/public.v2',{headers:{Cookie:'private=token',Authorization:'Bearer secret','CF-Connecting-IP':'203.0.113.41','X-Forwarded-For':'198.51.100.9','If-None-Match':'"old-shell"',Range:'bytes=0-42','If-Modified-Since':'Mon, 02 Nov 2026 00:00:00 GMT'}}),f.env);
  assert.ok(response);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Robots-Tag'),'index, follow');assert.ok((await response.text()).includes('A real story | LingYing 靈映'));
  for(const name of ['Content-Encoding','Content-Length','ETag','Last-Modified'])assert.equal(response.headers.has(name),false,name);
  for(const name of ['Cookie','Authorization','Range','If-None-Match','If-Modified-Since'])assert.equal(f.assetRequests[0].headers.has(name),false,name);
  assert.equal(f.apiRequests[0].headers.has('Cookie'),false);assert.equal(f.apiRequests[0].headers.has('Authorization'),false);assert.equal(f.apiRequests[0].headers.has('X-Forwarded-For'),false);assert.equal(f.apiRequests[0].headers.get('CF-Connecting-IP'),'203.0.113.41');assert.equal(new URL(f.apiRequests[0].url).searchParams.get('path'),'/series/public.v2');
});
test('old discovery API during rolling deployment preserves a usable noindex SPA, then genuine missing data returns 404',async()=>{
  const old=fixture({error:{code:'NOT_FOUND'}},404),fallback=await searchDiscoveryResponse(new Request(origin+'/series/unknown'),old.env);assert.ok(fallback);assert.equal(fallback.status,200);assert.match(fallback.headers.get('X-Robots-Tag')!,/noindex/u);assert.ok((await fallback.text()).includes('/assets/app.js'));
  const missing=fixture(missingSearchDocument('/series/unknown',origin),404),response=await searchDiscoveryResponse(new Request(origin+'/series/unknown'),missing.env);assert.ok(response);assert.equal(response.status,404);assert.match(response.headers.get('X-Robots-Tag')!,/noindex/u);
});
test('Cloudflare HEAD keeps final document status and canonical without sending a body; static assets bypass discovery',async()=>{
  const f=fixture(staticSearchDocument('/wallet',origin)),response=await searchDiscoveryResponse(new Request(origin+'/wallet',{method:'HEAD'}),f.env);assert.ok(response);assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('Link'),'<'+origin+'/wallet>; rel="canonical"');assert.match(response.headers.get('X-Robots-Tag')!,/noindex/u);
  assert.equal(f.apiRequests[0].headers.has('CF-Connecting-IP'),false);
  assert.equal(await searchDiscoveryResponse(new Request(origin+'/assets/app.js'),f.env),null);assert.equal(await searchDiscoveryResponse(new Request(origin+'/api/series/one'),f.env),null);
});
test('metadata for an untrusted canonical origin cannot make the page indexable',async()=>{
  const f=fixture(staticSearchDocument('/','https://attacker.test')),response=await searchDiscoveryResponse(new Request(origin+'/'),f.env);assert.ok(response);assert.match(response.headers.get('X-Robots-Tag')!,/noindex/u);assert.equal(response.headers.get('Link'),'<'+origin+'/>; rel="canonical"');
});
test('dynamic sitemap and robots are proxied without account credentials and old JSON endpoints use static fallback',async()=>{
  for(const path of ['/sitemap.xml','/sitemap-page.xml?page=2','/robots.txt']){
    const requests:Request[]=[],type=path==='/robots.txt'?'text/plain':'application/xml',body=type==='text/plain'?'User-agent: *\nDisallow: /api/':'<?xml version="1.0"?><urlset><url><loc>'+origin+'/series/actual</loc></url></urlset>';
    const env={APP:{idFromName:()=>1,get:()=>({fetch:async(request:Request)=>{requests.push(request);return new Response(body,{headers:{'Content-Type':type}});}})}}as unknown as Env;
    const response=await searchDiscoveryResponse(new Request(origin+path,{headers:{Cookie:'private=token',Authorization:'Bearer secret','CF-Connecting-IP':'2001:db8::42','X-Forwarded-For':'198.51.100.9'}}),env);assert.ok(response);assert.equal(await response.text(),body);assert.equal(requests[0].headers.has('Cookie'),false);assert.equal(requests[0].headers.has('Authorization'),false);assert.equal(requests[0].headers.has('X-Forwarded-For'),false);assert.equal(requests[0].headers.get('CF-Connecting-IP'),'2001:db8::42');assert.equal(new URL(requests[0].url).pathname,'/api/discovery'+path.split('?')[0]);if(path.includes('page='))assert.equal(new URL(requests[0].url).searchParams.get('page'),'2');
    const head=await searchDiscoveryResponse(new Request(origin+path,{method:'HEAD'}),env);assert.ok(head);assert.equal(await head.text(),'');
  }
  assert.equal(await searchDiscoveryResponse(new Request(origin+'/sitemap.xml'),fixture({error:{code:'NOT_FOUND'}},404).env),null);
});
