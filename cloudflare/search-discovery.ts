import type {Env} from './runtime';
import {responseSecurityHeaders} from '../shared/security-headers';
import {isSearchDocument,renderSearchShell,searchOrigin,searchPageRequest,searchRoute,staticSearchDocument} from '../shared/search-discovery';

export {searchPageRequest} from '../shared/search-discovery';
function headersFor(response:Response,pathname:string){const headers=new Headers(response.headers);for(const[name,value]of Object.entries(responseSecurityHeaders(pathname)))headers.set(name,value);return headers;}
function publicRequest(request:Request,path:string){const url=new URL(request.url);url.pathname=path;url.search='';return url;}
function discoveryHeaders(request:Request,accept:string){
  const headers=new Headers({Accept:accept}),address=request.headers.get('CF-Connecting-IP');
  // Cloudflare supplies this trusted outer address. Keep the existing API
  // limiter scoped to each visitor without forwarding caller credentials or
  // user-controlled Forwarded/X-Forwarded-For identity claims.
  if(address)headers.set('CF-Connecting-IP',address);
  return headers;
}

/** Public discovery never receives caller cookies or account credentials. A
 * versioned DTO distinguishes an unavailable old API during DO rollout from a
 * genuine unavailable series, keeping the existing SPA usable during rollout. */
export async function searchDiscoveryResponse(request:Request,env:Env):Promise<Response|null>{
  if(!['GET','HEAD'].includes(request.method))return null;
  const url=new URL(request.url),stub=()=>env.APP.get(env.APP.idFromName('platform'));
  if(['/robots.txt','/sitemap.xml','/sitemap-page.xml'].includes(url.pathname)){
    try{
      const target=publicRequest(request,'/api/discovery'+url.pathname);if(url.pathname==='/sitemap-page.xml')target.searchParams.set('page',url.searchParams.get('page')||'');
      const response=await stub().fetch(new Request(target,{method:'GET',headers:discoveryHeaders(request,url.pathname==='/robots.txt'?'text/plain':'application/xml'),signal:AbortSignal.timeout(8000)})as any)as unknown as Response;
      const expected=url.pathname==='/robots.txt'?'text/plain':'application/xml';
      if(response.headers.get('Content-Type')?.includes(expected)||url.pathname==='/sitemap-page.xml'&&response.status===404&&response.headers.get('Content-Type')?.includes('text/plain')){
        const headers=headersFor(response,url.pathname);headers.set('Cache-Control','private, no-store');headers.delete('Content-Length');
        if(request.method==='HEAD'){await response.body?.cancel();return new Response(null,{status:response.status,headers});}
        return new Response(response.body,{status:response.status,headers});
      }
      await response.body?.cancel();
    }catch{}
    // The old API may remain active for its documented five-minute deployment
    // grace period. Static discovery assets remain valid during that interval.
    return null;
  }
  if(!searchPageRequest(url.pathname))return null;
  const assetHeaders=new Headers(request.headers);
  for(const name of ['Cookie','Authorization','If-None-Match','If-Modified-Since','Range','If-Range'])assetHeaders.delete(name);
  const assetRequest=new Request(request,{method:'GET',headers:assetHeaders});
  const asset=await env.ASSETS.fetch(assetRequest as any)as unknown as Response;
  if(!asset.headers.get('Content-Type')?.includes('text/html')){if(request.method==='HEAD')await asset.body?.cancel();return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers:headersFor(asset,url.pathname)});}
  if(![200,404].includes(asset.status)){const headers=headersFor(asset,url.pathname);headers.set('X-Robots-Tag','noindex');if(request.method==='HEAD')await asset.body?.cancel();return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers});}
  const origin=searchOrigin(env.PUBLIC_APP_URL||env.APP_URL),route=searchRoute(url.pathname);
  let document={...staticSearchDocument('/auth',origin),canonical:origin+route.path,robots:'noindex, follow',status:asset.status};
  try{
    const target=publicRequest(request,'/api/discovery/document');target.searchParams.set('path',url.pathname+url.search);
    const response=await stub().fetch(new Request(target,{headers:discoveryHeaders(request,'application/json'),signal:AbortSignal.timeout(8000)})as any)as unknown as Response;
    const candidate=await response.json();
    if(isSearchDocument(candidate)&&candidate.status===response.status&&new URL(candidate.canonical).origin===origin)document=candidate;
  }catch{}
  const html=renderSearchShell(await asset.text(),document),headers=headersFor(asset,url.pathname);
  headers.set('Content-Type','text/html; charset=utf-8');headers.set('Cache-Control','private, no-store');headers.set('X-Robots-Tag',document.robots);headers.set('Link',`<${document.canonical}>; rel="canonical"`);
  for(const name of ['Content-Length','Content-Encoding','ETag','Last-Modified'])headers.delete(name);
  return new Response(request.method==='HEAD'?null:html,{status:document.status,headers});
}
