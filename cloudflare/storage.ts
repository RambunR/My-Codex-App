import {Readable} from 'node:stream';
import type {Request,Response} from 'express';
import {getRuntime,finishInBackground} from './runtime';
import {AppError,assert} from '../server/errors';
import {DEMO_PREVIEW_BYTES} from './preview-meta';

const mime=new Map<string,string>();
async function range(key:string,offset:number,length:number){const object=await getRuntime().env.MEDIA.get(key,{range:{offset,length}});assert(object,404,'MEDIA_UNAVAILABLE','Media file not found.');return Buffer.from(await object.arrayBuffer());}
interface Box{type:string;start:number;length:number;header:number;data:Buffer}
function boxes(buffer:Buffer):Box[]{
  const result:Box[]=[];let offset=0;
  while(offset+8<=buffer.length){let size=buffer.readUInt32BE(offset);let header=8;if(size===1){assert(offset+16<=buffer.length,422,'INVALID_VIDEO','Invalid video metadata.');size=Number(buffer.readBigUInt64BE(offset+8));header=16;}if(size===0)size=buffer.length-offset;
    assert(Number.isSafeInteger(size)&&size>=header&&offset+size<=buffer.length,422,'INVALID_VIDEO','Invalid video metadata.');result.push({type:buffer.toString('ascii',offset+4,offset+8),start:offset,length:size,header,data:buffer.subarray(offset+header,offset+size)});offset+=size;}
  return result;
}
interface Timing{ticks:number;scale:number;seconds:number}
function timing(data:Buffer):Timing{const v=data[0];assert(v===0||v===1,422,'INVALID_VIDEO','Invalid duration metadata.');const scaleOffset=v===1?20:12;const durationOffset=v===1?24:16;assert(data.length>=durationOffset+(v===1?8:4),422,'INVALID_VIDEO','Invalid duration metadata.');const scale=data.readUInt32BE(scaleOffset);const ticks=v===1?Number(data.readBigUInt64BE(durationOffset)):data.readUInt32BE(durationOffset);assert(scale>0&&Number.isSafeInteger(ticks),422,'INVALID_VIDEO','Invalid duration metadata.');return{ticks,scale,seconds:ticks/scale};}
function trackDuration(track:Box,media:Timing,movieScale:number,kind:string){
  const edits=boxes(track.data).find(box=>box.type==='edts');if(!edits)return media.seconds;
  const list=boxes(edits.data).find(box=>box.type==='elst');assert(list&&list.data.length>=8,422,'INVALID_VIDEO','Invalid media edit metadata.');
  const data=list.data,version=data[0];assert(version===0||version===1,422,'INVALID_VIDEO','Unsupported media edit metadata.');
  // Browser-ready exports normally use one unit-rate edit to skip encoder
  // priming. Reject unsupported timelines instead of guessing their duration.
  assert(data.readUInt32BE(4)===1&&data.length===(version===1?28:20),422,'INVALID_VIDEO','Use a single normal-speed media edit.');
  const segment=version===1?Number(data.readBigUInt64BE(8)):data.readUInt32BE(8);
  const start=version===1?Number(data.readBigInt64BE(16)):data.readInt32BE(12);
  const rateOffset=version===1?24:16;
  assert(Number.isSafeInteger(segment)&&segment>0&&Number.isSafeInteger(start)&&start>=0&&start<media.ticks&&data.readInt16BE(rateOffset)===1&&data.readUInt16BE(rateOffset+2)===0,422,'INVALID_VIDEO','Invalid media edit duration.');
  const presentation=segment/movieScale;
  // AAC mdhd includes priming samples removed by the edit. Account for both
  // the presentation span and every remaining sample; a short movie header or
  // short edit cannot conceal a longer audio track. Retain the raw video bound.
  return Math.max(presentation,kind==='soun'?(media.ticks-start)/media.scale:media.seconds);
}
export async function prepareVideo(key:string){
  const bucket=getRuntime().env.MEDIA;const head=await bucket.head(key);assert(head,404,'MEDIA_UNAVAILABLE','Media file not found.');
  let offset=0;let moov:Buffer|undefined;let foundFormat=false;let seen=0;
  while(offset+8<=head.size){assert(++seen<=200,422,'INVALID_VIDEO','The video container is too complex.');const header=await range(key,offset,Math.min(16,head.size-offset));let length=header.readUInt32BE(0);const type=header.toString('ascii',4,8);let headerLength=8;if(length===1){assert(header.length>=16,422,'INVALID_VIDEO','Invalid video container.');length=Number(header.readBigUInt64BE(8));headerLength=16;}if(length===0)length=head.size-offset;assert(Number.isSafeInteger(length)&&length>=headerLength&&offset+length<=head.size,422,'INVALID_VIDEO','Invalid video container.');
    if(type==='ftyp')foundFormat=true;
    if(type==='moov'){assert(length<=4*1024*1024,422,'INVALID_VIDEO','Video metadata is too large.');moov=await range(key,offset+headerLength,length-headerLength);break;}offset+=length;
  }
  assert(foundFormat&&moov,422,'INVALID_VIDEO','Please upload a browser-ready MP4 or MOV video using H.264 and AAC.');
  const children=boxes(moov);const movie=children.find(b=>b.type==='mvhd');assert(movie,422,'INVALID_VIDEO','Video duration is missing.');const movieTiming=timing(movie.data);let seconds=movieTiming.seconds;let video=false;
  for(const track of children.filter(b=>b.type==='trak')){
    const media=boxes(track.data).find(b=>b.type==='mdia');if(!media)continue;const fields=boxes(media.data);const handler=fields.find(b=>b.type==='hdlr');if(!handler||handler.data.length<12)continue;const kind=handler.data.toString('ascii',8,12);if(kind!=='vide'&&kind!=='soun')continue;
    const minf=fields.find(b=>b.type==='minf');const stbl=minf&&boxes(minf.data).find(b=>b.type==='stbl');const stsd=stbl&&boxes(stbl.data).find(b=>b.type==='stsd');assert(stsd&&stsd.data.length>=16,422,'INVALID_VIDEO','Video codec metadata is missing.');const codec=stsd.data.toString('ascii',12,16);
    const mdhd=fields.find(b=>b.type==='mdhd');assert(mdhd,422,'INVALID_VIDEO','Media track duration is missing.');const mediaTiming=timing(mdhd.data);assert(Number.isFinite(mediaTiming.seconds)&&mediaTiming.seconds>0,422,'INVALID_VIDEO','Invalid media track duration.');seconds=Math.max(seconds,trackDuration(track,mediaTiming,movieTiming.scale,kind));
    if(kind==='vide'){assert(codec==='avc1'||codec==='avc3',422,'INVALID_VIDEO','Use an H.264 MP4 video. HEVC/AV1 videos must be exported as H.264 first.');video=true;}
    else assert(codec==='mp4a',422,'INVALID_VIDEO','Use AAC audio in your MP4 video.');
  }
  assert(video&&Number.isFinite(seconds)&&seconds>0,422,'INVALID_VIDEO','This file has no readable video track.');assert(seconds<=180,422,'VIDEO_TOO_LONG','Episodes must be 3 minutes or less.');mime.set(key,'video/mp4');return{path:key,bytes:head.size,duration:seconds};
}
export async function prepareCover(key:string){const head=await getRuntime().env.MEDIA.head(key);assert(head&&head.size<=5*1024*1024,422,'INVALID_IMAGE','Covers must be no larger than 5 MB.');const b=await range(key,0,Math.min(16,head.size));let type='';if(b[0]===255&&b[1]===216&&b[2]===255)type='image/jpeg';else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')type='image/webp';assert(type,422,'INVALID_IMAGE','Please use a JPEG, PNG, or WebP cover.');mime.set(key,type);return{path:key,bytes:head.size};}
export async function putObject(source:string,key:string,contentType:string){const bucket=getRuntime().env.MEDIA;const body=await bucket.get(source);assert(body,404,'MEDIA_UNAVAILABLE','Upload is unavailable.');await bucket.put(key,body.body,{httpMetadata:{contentType:mime.get(source)||contentType}});}
export async function removeTempFile(key:string){if(!key.startsWith('tmp/'))return;mime.delete(key);await finishInBackground(getRuntime().env.MEDIA.delete(key));}
export async function deleteObject(key:string){if(!key||key.startsWith('public:')||key.startsWith('demo/'))return;await finishInBackground(getRuntime().env.MEDIA.delete(key));}

// Serve public preview bytes through the already-authorized API response. A
// redirect through the old hostname drops credentialed CORS on the asset hop.
async function servePreview(req:Request,res:Response){
  const env=getRuntime().env;
  const url=new URL('/demo-preview.mp4',env.PUBLIC_APP_URL||env.APP_URL||'https://assets.invalid');
  const head=await env.ASSETS.fetch(new globalThis.Request(url,{method:'HEAD',headers:{'Accept-Encoding':'identity'}}) as any) as unknown as globalThis.Response;
  // The Workers ASSETS binding can omit Content-Length on HEAD even when the
  // public asset endpoint supplies it. This bundled asset has a checked size.
  const length=head.headers.get('Content-Length');
  const size=length===null?DEMO_PREVIEW_BYTES:Number(length);
  assert(head.status===200&&Number.isSafeInteger(size)&&size>0,404,'MEDIA_UNAVAILABLE','Sample preview is unavailable.');
  let start=0,end=size-1;const requested=req.headers.range;
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Accept-Ranges','bytes');
  if(requested){
    const match=/^bytes=(\d*)-(\d*)$/.exec(requested);
    if(!match||(!match[1]&&!match[2])){res.status(416).setHeader('Content-Range',`bytes */${size}`);res.end();return;}
    start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
    end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.status(416).setHeader('Content-Range',`bytes */${size}`);res.end();return;}
  }
  let asset:globalThis.Response|undefined;
  if(req.method!=='HEAD'){
    const headers=new Headers({'Accept-Encoding':'identity'});if(requested)headers.set('Range',`bytes=${start}-${end}`);
    asset=await env.ASSETS.fetch(new globalThis.Request(url,{headers}) as any) as unknown as globalThis.Response;
    assert((asset.status===200||requested&&asset.status===206)&&asset.body,404,'MEDIA_UNAVAILABLE','Sample preview is unavailable.');
    if(asset.status===206)assert(asset.headers.get('Content-Range')===`bytes ${start}-${end}/${size}`,502,'MEDIA_UNAVAILABLE','Sample preview range is unavailable.');
  }
  res.type(head.headers.get('Content-Type')||'video/mp4');res.setHeader('Content-Length',end-start+1);
  if(requested){res.status(206);res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);}
  if(req.method==='HEAD'){res.end();return;}
  const input=Readable.fromWeb(asset!.body as any);
  // ASSETS supports byte ranges. Keep bounded streaming if a storage adapter
  // returns the complete file instead of honoring Range.
  const stream=requested&&asset!.status===200?Readable.from((async function*(){
    let skip=start,left=end-start+1;
    try{for await(const chunk of input){const buffer=Buffer.from(chunk);if(skip>=buffer.length){skip-=buffer.length;continue;}const part=buffer.subarray(skip,Math.min(buffer.length,skip+left));skip=0;left-=part.length;if(part.length)yield part;if(!left)break;}}
    finally{input.destroy();}
  })()):input;
  res.once('close',()=>{stream.destroy();input.destroy();});stream.on('error',error=>res.destroy(error));stream.pipe(res);
}
export async function serveObject(key:string,req:Request,res:Response,type:string){
  if(key==='demo/preview.mp4'){await servePreview(req,res);return;}
  const bucket=getRuntime().env.MEDIA;const head=await bucket.head(key);assert(head,404,'MEDIA_UNAVAILABLE','Media file is unavailable.');
  let start=0,end=head.size-1;const requested=req.headers.range;
  if(requested){const m=/^bytes=(\d*)-(\d*)$/.exec(requested);if(!m||(!m[1]&&!m[2])){res.status(416).setHeader('Content-Range',`bytes */${head.size}`);res.end();return;}start=m[1]?Number(m[1]):Math.max(0,head.size-Number(m[2]));end=m[1]?(m[2]?Math.min(Number(m[2]),head.size-1):head.size-1):head.size-1;if(start>end||start>=head.size){res.status(416).setHeader('Content-Range',`bytes */${head.size}`);res.end();return;}}
  const object=await bucket.get(key,{range:{offset:start,length:end-start+1}});assert(object,404,'MEDIA_UNAVAILABLE','Media file is unavailable.');res.setHeader('Cache-Control','private, no-store');res.setHeader('Accept-Ranges','bytes');res.type(object.httpMetadata?.contentType||type);res.setHeader('Content-Length',end-start+1);if(requested){res.status(206);res.setHeader('Content-Range',`bytes ${start}-${end}/${head.size}`);}const stream=Readable.fromWeb(object.body as any);res.once('close',()=>stream.destroy());stream.on('error',error=>res.destroy(error));stream.pipe(res);
}
