import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
import express from 'express';
import type {Server} from 'node:http';
import {inspectMp4Playback,cachedMp4Playback,patchVideoBytes,type VideoBytePatch} from '../shared/mp4-playback';
import {compatibleVideoStream} from '../shared/video-stream';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-safari-media-'));
process.env.DATA_DIR=directory;process.env.S3_BUCKET='';
const {serveObject,putObject}=await import('../server/storage');
let original:Buffer,corrected:Buffer,patches:VideoBytePatch[],server:Server,base:string;
const source=path.join(directory,'bad-export.mp4'),fixed=path.join(directory,'fixed-export.mp4');
const probe=(file:string)=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,profile,level,pix_fmt,width,height','-of','json',file],{encoding:'utf8'}));
before(async()=>{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=128x224:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','4','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-profile:v','high','-level:v','6.2','-bsf:v','h264_metadata=tick_rate=32000/1','-c:a','aac','-movflags','+faststart','-y',source]);
  original=await readFile(source);patches=await inspectMp4Playback(original.length,async(offset,length)=>original.subarray(offset,offset+length));
  corrected=Buffer.from(patchVideoBytes(original,0,patches));await writeFile(fixed,corrected);
  await putObject(source,'videos/safari-fixture.mp4','video/mp4');
  const app=express();app.get('/clip',async(req,res,next)=>{try{await serveObject('videos/safari-fixture.mp4',req,res,'video/mp4');}catch(error){next(error);}});
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});

test('oversignalled AVC clocks and levels are corrected without changing file length or encoded pictures/audio',async()=>{
  assert.equal(probe(source).streams[0].level,62);assert.equal(patches.length,2);assert.equal(corrected.length,original.length);assert.equal(probe(fixed).streams[0].level,41);
  assert.deepEqual(probe(fixed).streams.slice(1),probe(source).streams.slice(1));
  const frames=(file:string)=>execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(line=>!line.startsWith('#'));
  assert.deepEqual(frames(fixed),frames(source),'Every decoded frame and its timestamp must stay identical.');
  const avc=original.indexOf('avcC');assert.notEqual(avc,-1);assert.equal(corrected[avc+7],41);
  const unchanged=await inspectMp4Playback(corrected.length,async(offset,length)=>corrected.subarray(offset,offset+length));assert.deepEqual(unchanged,[]);
});
test('byte patches remain exact across fragmented chunks and partial/suffix ranges',async()=>{
  const chunks:Buffer[]=[];for(let offset=0;offset<original.length;){const length=offset<2048?17:4096;chunks.push(original.subarray(offset,offset+length));offset+=length;}
  const output:Buffer[]=[];for await(const bytes of compatibleVideoStream(Readable.from(chunks),0,patches))output.push(Buffer.from(bytes));assert.deepEqual(Buffer.concat(output),corrected);
  for(const patch of patches)for(const delta of [-1,0,1]){const start=patch.offset+delta,end=Math.min(start+7,original.length);assert.deepEqual(Buffer.from(patchVideoBytes(original.subarray(start,end),start,patches)),corrected.subarray(start,end));}
  const tail=original.subarray(-20);assert.equal(patchVideoBytes(tail,original.length-20,patches),tail);
});
test('HTTP full, Safari two-byte, overlapping, suffix and HEAD requests retain coherent ranges and original storage',async()=>{
  const full=await fetch(base+'/clip');assert.equal(full.status,200);assert.equal(full.headers.get('x-lingying-playback'),'h264-compat-v1');assert.equal(full.headers.get('x-lingying-video-compatibility'),'normalized');assert.deepEqual(Buffer.from(await full.arrayBuffer()),corrected);
  for(const range of ['bytes=0-1',`bytes=${patches[0].offset-1}-${patches[1].offset+patches[1].bytes.length+1}`,'bytes=-17']){
    const response=await fetch(base+'/clip',{headers:{Range:range}});assert.equal(response.status,206);const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')!)!;const start=Number(match[1]),end=Number(match[2]);assert.equal(Number(match[3]),original.length);assert.equal(Number(response.headers.get('content-length')),end-start+1);assert.deepEqual(Buffer.from(await response.arrayBuffer()),corrected.subarray(start,end+1));
  }
  const head=await fetch(base+'/clip',{method:'HEAD',headers:{Range:'bytes=0-1'}});assert.equal(head.status,206);assert.equal(head.headers.get('content-length'),'2');assert.equal((await head.arrayBuffer()).byteLength,0);
  const invalid=await fetch(base+'/clip',{headers:{Range:'bytes=999999999-'}});assert.equal(invalid.status,416);await invalid.body?.cancel();
  assert.deepEqual(await readFile(path.join(directory,'objects/videos/safari-fixture.mp4')),original);
});
test('real complexity, unknown codecs, malformed boxes and excessive metadata are never relabelled',async()=>{
  const large=Buffer.from(original),avc=large.indexOf('avcC'),entry=large.lastIndexOf('avc1',avc);large.writeUInt16BE(4096,entry+28);
  assert.deepEqual(await inspectMp4Playback(large.length,async(o,n)=>large.subarray(o,o+n)),[]);
  const unknown=Buffer.from(original);unknown.write('avc3',entry);assert.deepEqual(await inspectMp4Playback(unknown.length,async(o,n)=>unknown.subarray(o,o+n)),[]);
  const tenBit=Buffer.from(original);tenBit[avc+5]=110;assert.deepEqual(await inspectMp4Playback(tenBit.length,async(o,n)=>tenBit.subarray(o,o+n)),[]);
  for(const bytes of [Buffer.alloc(20),original.subarray(0,30),Buffer.from('00000000moov')])assert.deepEqual(await inspectMp4Playback(bytes.length,async(o,n)=>bytes.subarray(o,o+n)),[]);
  const huge=Buffer.alloc(32);huge.writeUInt32BE(16);huge.write('ftyp',4);huge.writeUInt32BE(5*1024*1024,16);huge.write('moov',20);let largest=0;assert.deepEqual(await inspectMp4Playback(6*1024*1024,async(o,n)=>{largest=Math.max(largest,n);return huge.subarray(o,o+n);}),[]);assert.equal(largest,16);
});
test('versioned metadata reads coalesce, invalidate on object changes and recover after transient storage failure',async()=>{
  let reads=0;const read=async(o:number,n:number)=>{reads++;return original.subarray(o,o+n);};
  const results=await Promise.all([cachedMp4Playback('test-cache','v1',original.length,read),cachedMp4Playback('test-cache','v1',original.length,read)]);assert.deepEqual(results[0],patches);const first=reads;
  await cachedMp4Playback('test-cache','v1',original.length,read);assert.equal(reads,first);await cachedMp4Playback('test-cache','v2',original.length,read);assert.equal(reads,first*2);
  await assert.rejects(cachedMp4Playback('transient','v1',original.length,async()=>{throw new Error('Temporary read failure');}),/Temporary read failure/);
  assert.deepEqual(await cachedMp4Playback('transient','v1',original.length,read),patches);
});
test('25 fps, fractional cadence, Level 4.2 dimensions and end-of-file metadata retain their original presentation timing',async()=>{
  for(const [rate,dimensions,expected]of [['25','128x224',41],['30000/1001','128x224',41],['60','1280x1280',42]] as const){
    const input=path.join(directory,`cadence-${expected}-${rate.replace('/','_')}.mp4`),output=input+'.fixed.mp4';
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`testsrc2=s=${dimensions}:r=${rate}`,'-t','0.5','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-profile:v','high','-level:v','6.2','-bsf:v','h264_metadata=tick_rate=32000/1','-y',input]);
    const bytes=await readFile(input);let readBytes=0;
    const edits=await inspectMp4Playback(bytes.length,async(o,n)=>{readBytes+=n;return bytes.subarray(o,o+n);});assert.equal(edits.length,2,rate);assert.ok(readBytes<bytes.length);
    const normalized=patchVideoBytes(bytes,0,edits);assert.equal(normalized.length,bytes.length);await writeFile(output,normalized);assert.equal(probe(output).streams[0].level,expected);
    const packets=(file:string)=>execFileSync('ffprobe',['-v','error','-show_entries','packet=pts,dts,size','-of','csv',file],{encoding:'utf8'});
    assert.equal(packets(output),packets(input),'The MP4 presentation timeline must not be rounded with its nominal decoder clock.');
    const avc=bytes.indexOf('avcC'),end=avc-4+bytes.readUInt32BE(avc-4);assert.deepEqual(Buffer.from(normalized.subarray(0,avc-4)),bytes.subarray(0,avc-4));assert.deepEqual(Buffer.from(normalized.subarray(end)),bytes.subarray(end),'MP4 timing tables and encoded packets stay byte-identical.');
  }
});
