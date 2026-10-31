import { useCallback, useEffect, useState } from 'react';
import { API_SITE_ORIGIN, PUBLIC_SITE_ORIGIN } from '../shared/site-origins';

function configuredOrigin(value:string|undefined,fallback:string){
  const url=new URL(value||fallback);
  const local=url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';
  if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('API deployment origins must use HTTPS.');
  return url.origin;
}
// Vite values are public, trusted build configuration. They cannot be changed
// through query parameters, account preferences, or browser storage.
export const publicSiteOrigin=configuredOrigin(import.meta.env?.VITE_PUBLIC_SITE_ORIGIN,PUBLIC_SITE_ORIGIN);
export const apiSiteOrigin=configuredOrigin(import.meta.env?.VITE_API_SITE_ORIGIN,API_SITE_ORIGIN);
const browserOrigin=()=>typeof window==='undefined'?'':window.location.origin;
const apiPath=(path:string)=>path==='/api'||path.startsWith('/api/');

export function apiUrl(value:string,origin=browserOrigin()){
  if(origin!==publicSiteOrigin||!apiPath(value))return value;
  const target=new URL(value,apiSiteOrigin);
  // Reject URL normalization that would escape the API namespace.
  return target.origin===apiSiteOrigin&&apiPath(target.pathname)?target.href:value;
}
function trustedApiUrl(value:string){
  try{const url=new URL(value,browserOrigin()||publicSiteOrigin);return url.origin===apiSiteOrigin&&apiPath(url.pathname);}catch{return false;}
}
export const apiCrossOrigin=(url:string):'use-credentials'|undefined=>trustedApiUrl(apiUrl(url))?'use-credentials':undefined;
export class ApiError extends Error { constructor(public code:string,message:string,public status:number){super(message);} }
export async function api<T=any>(url:string,options:RequestInit={}) :Promise<T>{
  const headers=new Headers(options.headers);if(options.body && !(options.body instanceof FormData))headers.set('Content-Type','application/json');
  const target=apiUrl(url);
  const response=await fetch(target,{...options,headers,credentials:trustedApiUrl(target)?'include':'same-origin'});
  const data=await response.json().catch(()=>({error:{code:'NETWORK',message:'Unable to reach the server.'}}));
  if(!response.ok)throw new ApiError(data.error?.code||'UNKNOWN',data.error?.message||'Something went wrong.',response.status);
  return data;
}
export const post=<T=any>(url:string,body:unknown={})=>api<T>(url,{method:'POST',body:JSON.stringify(body)});
export function useApi<T>(url:string|undefined){
  const [data,setData]=useState<T>();const [error,setError]=useState<Error>();const [loading,setLoading]=useState(true);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{if(!url){setLoading(false);return;}let active=true;setLoading(true);setError(undefined);api<T>(url).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[url,revision]);
  const refresh=useCallback(()=>setRevision(x=>x+1),[]);return{data,error,loading,refresh,setData};
}
