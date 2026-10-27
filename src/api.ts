import { useCallback, useEffect, useState } from 'react';
export class ApiError extends Error { constructor(public code:string,message:string,public status:number){super(message);} }
export async function api<T=any>(url:string,options:RequestInit={}) :Promise<T>{
  const headers=new Headers(options.headers);if(options.body && !(options.body instanceof FormData))headers.set('Content-Type','application/json');
  const response=await fetch(url,{...options,headers,credentials:'same-origin'});
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
