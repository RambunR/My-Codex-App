import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import type multer from 'multer';
import {upload} from '../cloudflare/uploads';
import {bindRuntime} from '../cloudflare/runtime';

const MiB=1024*1024,partBytes=5*MiB;
const storage=(upload as unknown as {storage:multer.StorageEngine}).storage;
interface FixtureOptions {createError?:Error;partError?:Error;completeError?:Error;abortError?:Error;createGate?:Promise<void>}
function bucketFixture(options:FixtureOptions={}){
  const calls={created:0,aborted:0,completed:0,parts:[] as Buffer[],objects:new Map<string,Buffer>()};
  const bucket={async createMultipartUpload(key:string){
    calls.created++;await options.createGate;if(options.createError)throw options.createError;
    const ownParts:Buffer[]=[];
    return{
      async uploadPart(partNumber:number,data:Uint8Array){if(options.partError)throw options.partError;assert.equal(partNumber,ownParts.length+1);const part=Buffer.from(data);ownParts.push(part);calls.parts.push(part);return{partNumber,etag:'fixture-'+partNumber};},
      async complete(parts:Array<{partNumber:number;etag:string}>){
        calls.completed++;if(options.completeError)throw options.completeError;
        assert.equal(parts.length,ownParts.length);
        // Enforce R2's actual contract, rather than accepting arbitrary stream
        // chunk sizes. Every non-final part must have the same size >=5 MiB.
        const nonFinal=ownParts.slice(0,-1);
        if(nonFinal.some(p=>p.length<partBytes||p.length!==nonFinal[0].length)||ownParts.at(-1)!.length>ownParts[0].length)throw new Error('R2 multipart parts have unequal or invalid sizes');
        calls.objects.set(key,Buffer.concat(ownParts));
      },
      async abort(){calls.aborted++;if(options.abortError)throw options.abortError;},
    };
  }};
  bindRuntime({} as any,{MEDIA:bucket} as any);return calls;
}
function handle(stream:Readable){
  let callbacks=0;
  const result=new Promise<{file:any;error:Error|null}>(resolve=>storage._handleFile({} as any,{stream,mimetype:'video/mp4',originalname:'001_He Said I Wasn’t Smart Enough for Cambri_001.mp4'} as any,(error,file)=>{callbacks++;resolve({error:error||null,file});}));
  return{result,get callbacks(){return callbacks;}};
}
const digest=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');

test('Cloudflare multipart uploads preserve irregular incoming chunks using equal R2 parts and an exact tail',async()=>{
  const calls=bucketFixture();
  const chunks=[3*MiB,3*MiB,3*MiB,4*MiB,1*MiB+137].map((size,i)=>Buffer.alloc(size,i+1));
  const upload=handle(Readable.from(chunks));const{error,file}=await upload.result;
  assert.equal(error,null);assert.equal(upload.callbacks,1);assert.equal(calls.aborted,0);assert.equal(calls.completed,1);
  assert.deepEqual(calls.parts.map(part=>part.length),[partBytes,partBytes,4*MiB+137]);
  const original=Buffer.concat(chunks);assert.equal(file.size,original.length);assert.equal(digest(calls.objects.get(file.path)!),digest(original));
});

test('a single incoming chunk larger than two R2 parts is split without losing bytes',async()=>{
  const calls=bucketFixture(),original=Buffer.alloc(partBytes*2+91,0x5b);
  const{error,file}=await handle(Readable.from([original])).result;
  assert.equal(error,null);assert.deepEqual(calls.parts.map(part=>part.length),[partBytes,partBytes,91]);assert.equal(digest(calls.objects.get(file.path)!),digest(original));
});

test('exact multipart boundaries and small uploads complete without an empty trailing part',async()=>{
  for(const size of [41,partBytes,partBytes*2]){
    const calls=bucketFixture();const{error,file}=await handle(Readable.from([Buffer.alloc(size,3)])).result;
    assert.equal(error,null);assert.equal(file.size,size);assert.ok(calls.parts.every(part=>part.length>0));assert.equal(calls.parts.reduce((sum,p)=>sum+p.length,0),size);
  }
});

test('empty or size-limited files abort and never complete an R2 object',async()=>{
  const empty=bucketFixture();const noBytes=await handle(Readable.from([])).result;
  assert.equal((noBytes.error as any).code,'INVALID_VIDEO');assert.equal(empty.aborted,1);assert.equal(empty.completed,0);
  const limited=bucketFixture();let stream!:Readable;stream=Readable.from((async function*(){yield Buffer.alloc(31);stream.emit('limit');})());const attempt=handle(stream),result=await attempt.result;
  assert.equal((result.error as any).code,'LIMIT_FILE_SIZE');assert.equal(limited.aborted,1);assert.equal(limited.completed,0);assert.equal(limited.objects.size,0);
});

test('R2 failures report the original error once, abort partial uploads, and release upload slots',async()=>{
  for(const stage of ['createError','partError','completeError'] as const){
    const expected=new Error(stage+' fixture'),calls=bucketFixture({[stage]:expected,abortError:new Error('abort fixture')});
    const attempt=handle(Readable.from([Buffer.alloc(23)])),result=await attempt.result;
    assert.equal(result.error,expected);await new Promise(resolve=>setImmediate(resolve));assert.equal(attempt.callbacks,1);assert.equal(calls.aborted,stage==='createError'?0:1);assert.equal(calls.objects.size,0);
  }
  const calls=bucketFixture();const result=await handle(Readable.from([Buffer.alloc(9)])).result;
  assert.equal(result.error,null);assert.equal(calls.completed,1);
});

test('three active Cloudflare uploads reject a fourth and release slots after completion',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),calls=bucketFixture({createGate:gate});
  const active=Array.from({length:3},()=>handle(Readable.from([Buffer.alloc(7)])));
  try{const busy=await handle(Readable.from([Buffer.alloc(7)])).result;assert.equal((busy.error as any).code,'SERVER_BUSY');assert.equal(calls.created,3);}finally{release();}
  const finished=await Promise.all(active.map(p=>p.result));assert.ok(finished.every(p=>p.error===null));
  assert.equal((await handle(Readable.from([Buffer.alloc(7)])).result).error,null);
});
