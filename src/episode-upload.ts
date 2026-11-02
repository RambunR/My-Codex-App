import {api,apiUrl,ApiError} from './api';
import {MAX_EPISODE_BYTES} from '../shared/config';

export interface EpisodeUploadTransport {mode:'multipart'|'chunked';chunkBytes?:number}
interface UploadMessages {failed:string;retry:string;cancel:string;confirmationUnknown:string}
interface UploadOptions {
  seriesId:string;file:File;number:number;transport?:EpisodeUploadTransport;
  current:()=>boolean;
  request:(request:XMLHttpRequest|null)=>void;
  progress:(percent:number,processing:boolean)=>void;
  messages:UploadMessages;
}
class UploadConnectionError extends Error {}
class UploadCancelledError extends Error {}
export class UploadConfirmationUnknownError extends Error {}
const MAX_CHUNK_BYTES=5*1024*1024;
const MAX_PARTS=Math.ceil(MAX_EPISODE_BYTES/MAX_CHUNK_BYTES);

/** Keep every transfer below Cloudflare's request-body ceiling. The server owns
 * validation, part accounting and idempotent completion; no browser decoder is
 * required to decide whether a file may be sent. */
export async function uploadEpisodeFile(options:UploadOptions):Promise<void>{
  const{file,messages}=options;
  const path=`/api/studio/series/${encodeURIComponent(options.seriesId)}`;
  const filename=file.name.split(/[\\/]/).at(-1)||file.name;
  const title=filename.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').slice(0,120);
  const cancelled=()=>new UploadCancelledError(messages.cancel);
  const active=()=>{if(!options.current())throw cancelled();};
  const send=<T=any>(url:string,method:string,body:Document|XMLHttpRequestBodyInit|null,contentType?:string,onProgress?:(loaded:number,total:number)=>void)=>new Promise<T>((resolve,reject)=>{
    if(!options.current()){reject(cancelled());return;}
    const request=new XMLHttpRequest();let settled=false;
    const finish=(error?:Error,result?:T)=>{
      if(settled)return;settled=true;request.onload=null;request.onerror=null;request.onabort=null;request.ontimeout=null;request.upload.onprogress=null;options.request(null);
      error?reject(error):resolve(result!);
    };
    request.open(method,apiUrl(url));request.withCredentials=true;request.timeout=body instanceof FormData?0:180000;
    if(contentType)request.setRequestHeader('Content-Type',contentType);
    request.upload.onprogress=event=>{if(options.current()&&event.lengthComputable)onProgress?.(event.loaded,event.total);};
    request.onload=()=>{
      let result:any;try{result=JSON.parse(request.responseText);}catch{finish(new UploadConnectionError(messages.retry));return;}
      if(request.status>=200&&request.status<300)finish(undefined,result);
      else finish(new ApiError(result.error?.code||'UPLOAD_FAILED',result.error?.message||messages.failed,request.status));
    };
    request.onerror=()=>finish(new UploadConnectionError(messages.retry));request.ontimeout=()=>finish(new UploadConnectionError(messages.retry));request.onabort=()=>finish(cancelled());
    options.request(request);
    // Stop can be pressed between requests; never send another part after it.
    if(!options.current()){request.abort();finish(cancelled());return;}
    try{request.send(body);}catch{finish(new UploadConnectionError(messages.retry));}
  });
  const retryable=(error:unknown)=>error instanceof UploadConnectionError||error instanceof ApiError&&error.status>=500;
  const retryOnce=async<T>(operation:()=>Promise<T>)=>{
    try{return await operation();}catch(error){if(!retryable(error)||!options.current())throw error;await new Promise(resolve=>window.setTimeout(resolve,300));active();return operation();}
  };
  if(options.transport?.mode!=='chunked'){
    const body=new FormData();body.append('number',String(options.number));body.append('title',title);body.append('video',file,filename);
    await send(`${path}/episodes`,'POST',body,undefined,(loaded,total)=>options.progress(Math.round(loaded/total*100),loaded===total));return;
  }
  let session:string|undefined,completionStarted=false,completionUnknown=false;
  const clean=async()=>{
    if(!session)return undefined;
    // A completed session returns its existing episode and never deletes media.
    // Expiry handles an init response lost before the session ID reached us.
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),10000);
    try{return await api<{cancelled?:boolean;completed?:boolean;id?:string}>(session,{method:'DELETE',keepalive:true,signal:controller.signal});}
    catch{return undefined;}finally{window.clearTimeout(timer);}
  };
  try{
    const started=await send<{id:string;chunkBytes:number;partCount:number}>(`${path}/episode-uploads`,'POST',JSON.stringify({title,number:options.number,filename,size:file.size}),'application/json');
    if(typeof started.id!=='string'||!started.id||started.id.length>128)throw new Error(messages.failed);
    session=`${path}/episode-uploads/${encodeURIComponent(started.id)}`;
    if(started.chunkBytes!==MAX_CHUNK_BYTES||!Number.isSafeInteger(started.partCount)||started.partCount<1||started.partCount>MAX_PARTS||started.partCount!==Math.ceil(file.size/started.chunkBytes))throw new Error(messages.failed);
    active();
    for(let part=1;part<=started.partCount;part++){
      active();const offset=(part-1)*started.chunkBytes,chunk=file.slice(offset,Math.min(file.size,offset+started.chunkBytes));
      await retryOnce(async()=>{const receipt=await send<{partNumber:number}>(`${session}/parts/${part}`,'PUT',chunk,'application/octet-stream',loaded=>options.progress(Math.min(100,Math.round((offset+loaded)/file.size*100)),false));if(receipt.partNumber!==part)throw new UploadConnectionError(messages.retry);});
      active();options.progress(Math.round((offset+chunk.size)/file.size*100),false);
    }
    active();options.progress(100,true);completionStarted=true;
    try{
      await retryOnce(async()=>{
        const result=await send<{id:string}>(`${session}/complete`,'POST','{}','application/json');
        if(typeof result.id!=='string'||!result.id)throw new UploadConnectionError(messages.retry);
      });
    }catch(error){completionUnknown=retryable(error);throw error;}
  }catch(error){
    const cleanup=await clean();
    // An interrupted response can follow a committed episode. Reconcile that
    // session instead of starting another upload or reusing its episode number.
    if(completionStarted&&options.current()&&cleanup?.completed&&cleanup.id)return;
    if(completionUnknown&&options.current()&&!cleanup?.cancelled)throw new UploadConfirmationUnknownError(messages.confirmationUnknown);
    throw error;
  }
}
