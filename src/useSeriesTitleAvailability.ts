import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {SERIES_LIMITS} from '../shared/series-validation';
import {normalizeSeriesTitle} from '../shared/series-titles';

export type TitleAvailabilityStatus='idle'|'checking'|'available'|'duplicate'|'error';
type CheckResult='available'|'duplicate'|'error'|'stale';
export class SeriesTitleCheckError extends Error {
  constructor(public readonly result:Exclude<CheckResult,'available'>){super('Series title availability was not confirmed.');}
}

// Availability is advisory until the write transaction checks it again. Keep
// each response bound to its original title/account/series so a slow request
// cannot approve or reject the title the creator has typed in the meantime.
export function useSeriesTitleAvailability(title:string,exclude:string|undefined,originalTitle:string|undefined,viewerId:string|undefined,enabled:boolean){
  const trimmed=title.trim();
  const valid=trimmed.length>=SERIES_LIMITS.titleMin&&trimmed.length<=SERIES_LIMITS.titleMax;
  const key=JSON.stringify([trimmed,exclude||'',viewerId||'']);
  const latest=useRef({title:trimmed,exclude,key,enabled:enabled&&valid});
  latest.current={title:trimmed,exclude,key,enabled:enabled&&valid};
  const [state,setState]=useState<{key:string;status:TitleAvailabilityStatus}>({key,status:'idle'});
  const mounted=useRef(true),generation=useRef(0);
  const request=useRef<{key:string;controller:AbortController}|null>(null);
  const timer=useRef<number|undefined>(undefined);
  const cancel=useCallback(()=>{
    window.clearTimeout(timer.current);timer.current=undefined;
    request.current?.controller.abort();request.current=null;generation.current++;
  },[]);
  const check=useCallback(async():Promise<CheckResult>=>{
    const current=latest.current;
    cancel();
    if(!mounted.current||!current.enabled)return 'stale';
    const version=generation.current,controller=new AbortController();
    request.current={key:current.key,controller};
    setState({key:current.key,status:'checking'});
    const timeout=window.setTimeout(()=>controller.abort(),15_000);
    const stillCurrent=()=>mounted.current&&latest.current.enabled&&latest.current.key===current.key&&generation.current===version;
    try{
      const query=new URLSearchParams({title:current.title,...(current.exclude?{exclude:current.exclude}:{})});
      const result=await api<{available:boolean}>(`/api/studio/title-availability?${query}`,{signal:controller.signal});
      if(typeof result.available!=='boolean')throw new Error('Invalid availability response.');
      if(!stillCurrent())return 'stale';
      const status=result.available?'available':'duplicate';
      setState({key:current.key,status});return status;
    }catch{
      if(!stillCurrent())return 'stale';
      setState({key:current.key,status:'error'});return 'error';
    }finally{
      window.clearTimeout(timeout);
      if(request.current?.controller===controller)request.current=null;
    }
  },[cancel]);
  const markDuplicate=useCallback((submittedTitle:string)=>{
    const current=latest.current;
    if(current.title!==submittedTitle.trim()||!mounted.current)return;
    cancel();setState({key:current.key,status:'duplicate'});
  },[cancel]);

  useEffect(()=>{
    mounted.current=true;
    return()=>{mounted.current=false;cancel();};
  },[cancel]);
  const unchanged=!!exclude&&originalTitle!==undefined&&normalizeSeriesTitle(trimmed)===normalizeSeriesTitle(originalTitle);
  useEffect(()=>{
    // Already-saved titles need no passive request. Explicit Save/Publish still
    // calls check(), including unchanged legacy duplicates, before writing.
    if(request.current?.key!==key){
      cancel();setState({key,status:'idle'});
      if(enabled&&valid&&!unchanged)timer.current=window.setTimeout(()=>void check(),450);
    }
    return()=>{
      window.clearTimeout(timer.current);timer.current=undefined;
      if(request.current?.key===key)cancel();
    };
  },[key,enabled,valid,unchanged,cancel,check]);

  return{status:enabled&&valid&&state.key===key?state.status:'idle' as TitleAvailabilityStatus,check,markDuplicate};
}
