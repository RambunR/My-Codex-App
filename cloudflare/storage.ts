import {Readable} from 'node:stream';
import type {Request,Response} from 'express';
import {getRuntime,finishInBackground} from './runtime';
import {AppError,assert} from '../server/errors';

const mime=new Map<string,string>();
async function range(key:string,offset:number,length:number){const object=await getRuntime().env.MEDIA.get(key,{range:{offset,length}});assert(object,404,'MEDIA_UNAVAILABLE','Media file not found.');return Buffer.from(await object.arrayBuffer());}
interface Box{type:string;start:number;length:number;header:number;data:Buffer}
function boxes(buffer:Buffer):Box[]{
  const result:Box[]=[];let offset=0;
  while(offset+8<=buffer.length){let size=buffer.readUInt32BE(offset);let header=8;if(size===1){assert(offset+16<=buffer.length,422,'INVALID_VIDEO','Invalid video metadata.');size=Number(buffer.readBigUInt64BE(offset+8));header=16;}if(size===0)size=buffer.length-offset;
    assert(Number.isSafeInteger(size)&&size>=header&&offset+size<=buffer.length,422,'INVALID_VIDEO','Invalid video metadata.');result.push({type:buffer.toString('ascii',offset+4,offset+8),start:offset,length:size,header,data:buffer.subarray(offset+header,offset+size)});offset+=size;}
  return result;
}
function duration(data:Buffer){const v=data[0];const scaleOffset=v===1?20:12;const durationOffset=v===1?24:16;assert(data.length>=durationOffset+(v===1?8:4),422,'INVALID_VIDEO','Invalid duration metadata.');const scale=data.readUInt32BE(scaleOffset);const ticks=v===1?Number(data.readBigUInt64BE(durationOffset)):data.readUInt32BE(durationOffset);assert(scale>0&&Number.isSafeInteger(ticks),422,'INVALID_VIDEO','Invalid duration metadata.');return ticks/scale;}
export async function prepareVideo(key:string){
  const bucket=getRuntime().env.MEDIA;const head=await bucket.head(key);assert(head,404,'MEDIA_UNAVAILABLE','Media file not found.');
  let offset=0;let moov:Buffer|undefined;let foundFormat=false;let seen=0;
  while(offset+8<=head.size){assert(++seen<=200,422,'INVALID_VIDEO','The video container is too complex.');const header=await range(key,offset,Math.min(16,head.size-offset));let length=header.readUInt32BE(0);const type=header.toString('ascii',4,8);let headerLength=8;if(length===1){assert(header.length>=16,422,'INVALID_VIDEO','Invalid video container.');length=Number(header.readBigUInt64BE(8));headerLength=16;}if(length===0)length=head.size-offset;assert(Number.isSafeInteger(length)&&length>=headerLength&&offset+length<=head.size,422,'INVALID_VIDEO','Invalid video container.');
    if(type==='ftyp')foundFormat=true;
    if(type==='moov'){assert(length<=4*1024*1024,422,'INVALID_VIDEO','Video metadata is too large.');moov=await range(key,offset+headerLength,length-headerLength);break;}offset+=length;
  }
  assert(foundFormat&&moov,422,'INVALID_VIDEO','Please upload a browser-ready MP4 or MOV video using H.264 and AAC.');
  const children=boxes(moov);const movie=children.find(b=>b.type==='mvhd');assert(movie,422,'INVALID_VIDEO','Video duration is missing.');let seconds=duration(movie.data);let video=false;
  for(const track of children.filter(b=>b.type==='trak')){
    const media=boxes(track.data).find(b=>b.type==='mdia');if(!media)continue;const fields=boxes(media.data);const handler=fields.find(b=>b.type==='hdlr');if(!handler||handler.data.length<12)continue;const kind=handler.data.toString('ascii',8,12);if(kind!=='vide'&&kind!=='soun')continue;
    const minf=fields.find(b=>b.type==='minf');const stbl=minf&&boxes(minf.data).find(b=>b.type==='stbl');const stsd=stbl&&boxes(stbl.data).find(b=>b.type==='stsd');assert(stsd&&stsd.data.length>=16,422,'INVALID_VIDEO','Video codec metadata is missing.');const codec=stsd.data.toString('ascii',12,16);
    if(kind==='vide'){assert(codec==='avc1'||codec==='avc3',422,'INVALID_VIDEO','Use an H.264 MP4 video. HEVC/AV1 videos must be exported as H.264 first.');const mdhd=fields.find(b=>b.type==='mdhd');if(mdhd)seconds=Math.max(seconds,duration(mdhd.data));video=true;}
    else assert(codec==='mp4a',422,'INVALID_VIDEO','Use AAC audio in your MP4 video.');
  }
  assert(video&&Number.isFinite(seconds)&&seconds>0,422,'INVALID_VIDEO','This file has no readable video track.');assert(seconds<=180,422,'VIDEO_TOO_LONG','Episodes must be 3 minutes or less.');mime.set(key,'video/mp4');return{path:key,bytes:head.size,duration:seconds};
}
export async function prepareCover(key:string){const head=await getRuntime().env.MEDIA.head(key);assert(head&&head.size<=5*1024*1024,422,'INVALID_IMAGE','Covers must be no larger than 5 MB.');const b=await range(key,0,Math.min(16,head.size));let type='';if(b[0]===255&&b[1]===216&&b[2]===255)type='image/jpeg';else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')type='image/webp';assert(type,422,'INVALID_IMAGE','Please use a JPEG, PNG, or WebP cover.');mime.set(key,type);return{path:key,bytes:head.size};}
export async function putObject(source:string,key:string,contentType:string){const bucket=getRuntime().env.MEDIA;const body=await bucket.get(source);assert(body,404,'MEDIA_UNAVAILABLE','Upload is unavailable.');await bucket.put(key,body.body,{httpMetadata:{contentType:mime.get(source)||contentType}});}
export async function removeTempFile(key:string){if(!key.startsWith('tmp/'))return;mime.delete(key);await finishInBackground(getRuntime().env.MEDIA.delete(key));}
export async function deleteObject(key:string){if(!key||key.startsWith('public:')||key.startsWith('demo/'))return;await finishInBackground(getRuntime().env.MEDIA.delete(key));}
export async function serveObject(key:string,req:Request,res:Response,type:string){
  if(key==='demo/preview.mp4'){res.redirect('/demo-preview.mp4');return;}
  const bucket=getRuntime().env.MEDIA;const head=await bucket.head(key);assert(head,404,'MEDIA_UNAVAILABLE','Media file is unavailable.');
  let start=0,end=head.size-1;const requested=req.headers.range;
  if(requested){const m=/^bytes=(\d*)-(\d*)$/.exec(requested);if(!m||(!m[1]&&!m[2])){res.status(416).setHeader('Content-Range',`bytes */${head.size}`);res.end();return;}start=m[1]?Number(m[1]):Math.max(0,head.size-Number(m[2]));end=m[1]?(m[2]?Math.min(Number(m[2]),head.size-1):head.size-1):head.size-1;if(start>end||start>=head.size){res.status(416).setHeader('Content-Range',`bytes */${head.size}`);res.end();return;}}
  const object=await bucket.get(key,{range:{offset:start,length:end-start+1}});assert(object,404,'MEDIA_UNAVAILABLE','Media file is unavailable.');res.setHeader('Cache-Control','private, no-store');res.setHeader('Accept-Ranges','bytes');res.type(object.httpMetadata?.contentType||type);res.setHeader('Content-Length',end-start+1);if(requested){res.status(206);res.setHeader('Content-Range',`bytes ${start}-${end}/${head.size}`);}const stream=Readable.fromWeb(object.body as any);res.once('close',()=>stream.destroy());stream.on('error',error=>res.destroy(error));stream.pipe(res);
}
