import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import express from 'express';
import type {Server} from 'node:http';
import {bindRuntime} from '../cloudflare/runtime';
import {prepareVideo,serveObject} from '../cloudflare/storage';
import {AppError} from '../server/errors';
import {DEMO_PREVIEW_BYTES} from '../cloudflare/preview-meta';

const fixture=await readFile(new URL('./fixtures/cloudflare-media/long-audio-movie-duration.mp4',import.meta.url));
const directory=await mkdtemp(path.join(tmpdir(),'lingying-media-regression-'));
let silentVideo:Buffer,shortAudio:Buffer,base:string,server:Server;
const publicOrigin='https://lingying.example.test';
const sample=Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
const assetRequests:Array<{method:string;range:string|null;path:string}>=[];
let assetMode:'ranges'|'full'|'missing'|'headless'='ranges';

function bindVideo(bytes:Buffer,previewBytes=sample){
  bindRuntime({} as any,{
    PUBLIC_APP_URL:publicOrigin,APP_URL:'https://api.example.test',
    MEDIA:{head:async()=>({size:bytes.length}),get:async(_key:string,options:{range:{offset:number;length:number}})=>({arrayBuffer:async()=>Uint8Array.from(bytes.subarray(options.range.offset,options.range.offset+options.range.length)).buffer})},
    ASSETS:{fetch:async(input:Request)=>{
      const request=new Request(input);assetRequests.push({method:request.method,range:request.headers.get('Range'),path:new URL(request.url).pathname});
      if(assetMode==='missing')return new Response(null,{status:404});
      const headers=new Headers({'Content-Type':'video/mp4','Content-Length':String(previewBytes.length),'Cache-Control':'public, max-age=31536000','Access-Control-Allow-Origin':'*'});
      if(request.method==='HEAD'){if(assetMode==='headless')headers.delete('Content-Length');return new Response(null,{headers});}
      const range=request.headers.get('Range');
      if(range&&(assetMode==='ranges'||assetMode==='headless')){
        const [,start,end]=/^bytes=(\d+)-(\d+)$/.exec(range)!;
        const selected=previewBytes.subarray(Number(start),Number(end)+1);headers.set('Content-Length',String(selected.length));headers.set('Content-Range',`bytes ${start}-${end}/${previewBytes.length}`);
        return new Response(selected,{status:206,headers});
      }
      return new Response(previewBytes,{headers});
    }},
  } as any);
}

before(async()=>{
  for(const [filename,audio] of [['video.mp4',false],['audio.mp4',true]] as const){
    const args=['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:r=1:d=1'];
    if(audio)args.push('-f','lavfi','-i','anullsrc=r=8000:cl=mono');
    args.push('-t','1','-c:v','libx264','-pix_fmt','yuv420p');if(audio)args.push('-c:a','aac');else args.push('-an');
    args.push('-movflags','+faststart','-y',path.join(directory,filename));execFileSync('ffmpeg',args);
  }
  silentVideo=await readFile(path.join(directory,'video.mp4'));shortAudio=await readFile(path.join(directory,'audio.mp4'));
  const app=express();app.use((_req,res,next)=>{res.setHeader('Access-Control-Allow-Origin',publicOrigin);res.setHeader('Access-Control-Allow-Credentials','true');res.vary('Origin');next();});
  app.get('/stream',(req,res,next)=>{void serveObject('demo/preview.mp4',req,res,'video/mp4').catch(next);});
  app.use((error:AppError,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status||500).json({error:{code:error.code}}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});

async function rejected(bytes:Buffer,code:string){bindVideo(bytes);await assert.rejects(prepareVideo('tmp/fixture'),(error:unknown)=>error instanceof AppError&&error.status===422&&error.code===code);}
function replaceAtomType(bytes:Buffer,type:string,index=0){const result=Buffer.from(bytes);let offset=-1;for(let n=0;n<=index;n++)offset=result.indexOf(type,offset+1,'ascii');assert(offset>=0,`${type} fixture metadata is missing`);result.write('free',offset,'ascii');return result;}

// This is actual playable H.264/AAC media, not metadata synthesized to match the parser.
test('Cloudflare rejects long AAC audio when the movie and video tracks declare one second',async()=>{await rejected(fixture,'VIDEO_TOO_LONG');});
test('Cloudflare rejects an ordinary over-limit H.264 video',async()=>{await rejected(await readFile(new URL('./fixtures/cloudflare-media/long-video.mp4',import.meta.url)),'VIDEO_TOO_LONG');});
test('Cloudflare accepts a legitimate 180-second H.264/AAC export with encoder priming',async()=>{const bytes=await readFile(new URL('./fixtures/cloudflare-media/boundary-video-audio-180.mp4',import.meta.url));bindVideo(bytes);assert.equal((await prepareVideo('tmp/fixture')).duration,180);});
test('Cloudflare accepts a valid short H.264 video without audio and valid short H.264/AAC',async()=>{
  for(const bytes of [silentVideo,shortAudio]){bindVideo(bytes);const result=await prepareVideo('tmp/fixture');assert(result.duration>0&&result.duration<=2);assert.equal(result.bytes,bytes.length);}
});
test('Cloudflare requires duration metadata on both video and audio tracks',async()=>{await rejected(replaceAtomType(shortAudio,'mdhd',0),'INVALID_VIDEO');await rejected(replaceAtomType(shortAudio,'mdhd',1),'INVALID_VIDEO');});
test('Cloudflare rejects zero or unsupported-version media-track duration metadata',async()=>{
  const zero=Buffer.from(shortAudio),offset=zero.indexOf('mdhd');zero.writeUInt32BE(0,offset+20);await rejected(zero,'INVALID_VIDEO');
  const invalid=Buffer.from(shortAudio);invalid[offset+4]=2;await rejected(invalid,'INVALID_VIDEO');
});
test('Cloudflare rejects malformed, multi-entry or non-unit-rate media edits',async()=>{
  const edit=shortAudio.lastIndexOf('elst');assert(edit>=0);assert.equal(shortAudio[edit+4],0);
  for(const mutate of [(b:Buffer)=>b[edit+4]=2,(b:Buffer)=>b.writeUInt32BE(2,edit+8),(b:Buffer)=>b.writeInt16BE(2,edit+20),(b:Buffer)=>b.writeInt32BE(-1,edit+16),(b:Buffer)=>b.writeUInt32BE(0,edit+12)]){const bytes=Buffer.from(shortAudio);mutate(bytes);await rejected(bytes,'INVALID_VIDEO');}
});
test('Cloudflare retains its H.264 and AAC codec guards',async()=>{
  const video=Buffer.from(shortAudio),audio=Buffer.from(shortAudio);const avc=video.indexOf('avc1',video.indexOf('moov')),aac=audio.indexOf('mp4a');assert(avc>=0&&aac>=0);video.write('hev1',avc,'ascii');audio.write('ac-3',aac,'ascii');await rejected(video,'INVALID_VIDEO');await rejected(audio,'INVALID_VIDEO');
});

test('sample API GET streams bytes without redirect and retains exact credentialed CORS',async()=>{
  assetMode='ranges';assetRequests.length=0;bindVideo(silentVideo);const response=await fetch(base+'/stream',{redirect:'manual'});
  assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('access-control-allow-origin'),publicOrigin);assert.equal(response.headers.get('access-control-allow-credentials'),'true');assert.match(response.headers.get('vary')||'',/Origin/);assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(Number(response.headers.get('content-length')),sample.length);assert.deepEqual(Buffer.from(await response.arrayBuffer()),sample);assert.deepEqual(assetRequests.map(r=>r.path),['/demo-preview.mp4','/demo-preview.mp4']);
});
test('ASSETS HEAD without Content-Length still serves the bundled preview with its checked byte size',async()=>{
  const bytes=await readFile(new URL('../public/demo-preview.mp4',import.meta.url));assert.equal(bytes.length,DEMO_PREVIEW_BYTES);
  assetMode='headless';bindVideo(silentVideo,bytes);
  const head=await fetch(base+'/stream',{method:'HEAD',redirect:'manual'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
  const response=await fetch(base+'/stream',{headers:{Range:'bytes=0-1023'},redirect:'manual'});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 0-1023/${bytes.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(0,1024));
});
test('sample API HEAD has GET metadata without fetching or sending the sample body',async()=>{
  assetMode='ranges';assetRequests.length=0;bindVideo(silentVideo);const response=await fetch(base+'/stream',{method:'HEAD',redirect:'manual'});assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),sample.length);assert.equal((await response.arrayBuffer()).byteLength,0);assert.deepEqual(assetRequests.map(r=>r.method),['HEAD']);
});
test('sample API byte ranges return exact 206 bodies including suffix and open-ended ranges',async()=>{
  assetMode='ranges';bindVideo(silentVideo);
  for(const [range,start,end] of [['bytes=2-5',2,5],['bytes=-4',sample.length-4,sample.length-1],['bytes=30-',30,sample.length-1]] as const){
    const response=await fetch(base+'/stream',{headers:{Range:range},redirect:'manual'});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${sample.length}`);assert.equal(Number(response.headers.get('content-length')),end-start+1);assert.equal(response.headers.get('access-control-allow-origin'),publicOrigin);assert.deepEqual(Buffer.from(await response.arrayBuffer()),sample.subarray(start,end+1));
  }
});
test('sample API rejects invalid or unsatisfiable ranges with 416 without fetching the body',async()=>{
  assetMode='ranges';bindVideo(silentVideo);
  for(const range of ['bytes=99-','bytes=5-2','bytes=-0','bytes=0-1,4-5','bytes=']){assetRequests.length=0;const response=await fetch(base+'/stream',{headers:{Range:range},redirect:'manual'});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),`bytes */${sample.length}`);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.arrayBuffer()).byteLength,0);assert.deepEqual(assetRequests.map(r=>r.method),['HEAD']);}
});
test('sample API streams only requested bytes if the asset adapter ignores Range',async()=>{
  assetMode='full';bindVideo(silentVideo);const response=await fetch(base+'/stream',{headers:{Range:'bytes=3-8'},redirect:'manual'});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),sample.subarray(3,9));
});
test('a missing sample asset returns an error without a redirect or stale content length',async()=>{
  assetMode='missing';bindVideo(silentVideo);const response=await fetch(base+'/stream',{redirect:'manual'});assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);assert.equal((await response.json()).error.code,'MEDIA_UNAVAILABLE');
});
