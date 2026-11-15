import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createSha256State,updateSha256State,finishSha256State,type Sha256State} from '../shared/resumable-sha256';

const expected=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const bytes=(text:string)=>new TextEncoder().encode(text);
const resume=(state:Sha256State):Sha256State=>JSON.parse(JSON.stringify(state));

test('resumable SHA-256 matches standard empty, ABC, multiblock and million-A vectors',()=>{
  const vectors=[['','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],['a'.repeat(1_000_000),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']];
  for(const[input,digest]of vectors)assert.equal(finishSha256State(updateSha256State(createSha256State(),bytes(input))),digest);
});

test('every padding boundary and JSON-restarted random partition matches native SHA-256',()=>{
  for(const size of [0,1,2,7,31,55,56,57,63,64,65,95,119,120,127,128,129,255,256,257,1023,1024,4095,4096,12345]){
    const input=randomBytes(size);
    for(const step of [1,7,55,63,64,65,127,509]){
      let state=createSha256State();
      for(let offset=0;offset<size;offset+=step)state=resume(updateSha256State(state,input.subarray(offset,offset+step)));
      assert.equal(state.bytes,size);assert.equal(state.buffer.length,size%64);assert.equal(finishSha256State(state),expected(input),`length=${size},step=${step}`);
    }
  }
  let state=createSha256State();const native=createHash('sha256');
  for(let index=0;index<100;index++){const chunk=randomBytes(Math.floor(Math.random()*8097));native.update(chunk);state=resume(updateSha256State(state,chunk));}
  assert.equal(finishSha256State(state),native.digest('hex'));
});

test('five-MiB chunks resume with bounded state and preserve input/checkpoint immutability',()=>{
  const chunk=randomBytes(5*1024*1024),copy=Buffer.from(chunk),initial=createSha256State(),saved=resume(initial);
  const first=updateSha256State(initial,chunk);assert.deepEqual(initial,saved);assert.deepEqual(chunk,copy);assert.ok(JSON.stringify(first).length<1200);
  const firstSaved=resume(first),second=updateSha256State(resume(first),chunk);
  assert.equal(finishSha256State(second),createHash('sha256').update(chunk).update(chunk).digest('hex'));
  assert.deepEqual(first,firstSaved);assert.deepEqual(first.words.length,8);assert.equal(first.buffer.length,0);
  const finished=finishSha256State(first);assert.equal(finishSha256State(first),finished);assert.deepEqual(first,firstSaved);
  const emptyUpdate=updateSha256State(first,new Uint8Array());assert.deepEqual(emptyUpdate,first);assert.notEqual(emptyUpdate,first);assert.notEqual(emptyUpdate.words,first.words);
});

test('invalid or inconsistent resumable checkpoints and count overflow fail closed',()=>{
  const valid=createSha256State();
  const malformed:unknown[]=[null,undefined,[],{},'{}',{...valid,version:2},{...valid,bytes:-1},{...valid,bytes:0.5},{...valid,bytes:Infinity},{...valid,bytes:Number.MAX_SAFE_INTEGER+1},{...valid,words:[0,1]},{...valid,words:Array(8)},{...valid,words:[...valid.words.slice(0,7),-1]},{...valid,words:[...valid.words.slice(0,7),0x100000000]},{...valid,words:[...valid.words.slice(0,7),1.5]},{...valid,buffer:[1]},{...valid,bytes:1,buffer:[256]},{...valid,bytes:1,buffer:[-1]},{...valid,bytes:1,buffer:[1.5]},{...valid,bytes:1,buffer:Array(1)},{...valid,bytes:64,buffer:Array(64).fill(0)},{...valid,extra:'not a checkpoint field'},{...valid,words:valid.words.map(value=>value^1)}];
  for(const value of malformed){assert.throws(()=>finishSha256State(value),/Invalid resumable/);assert.throws(()=>updateSha256State(value,new Uint8Array()),/Invalid resumable/);}
  assert.throws(()=>updateSha256State(valid,[1,2] as unknown as Uint8Array),/byte array/);
  const max:Sha256State={...valid,bytes:Number.MAX_SAFE_INTEGER,buffer:Array(63).fill(0)};
  assert.throws(()=>updateSha256State(max,new Uint8Array([1])),/exact integer limit/);
});

test('large logical counters finalize deterministically without unsafe byte-to-bit multiplication',()=>{
  // These synthetic internal states exercise length encoding only. They are
  // not presented as hashes of files that were actually read.
  for(const count of [0x20000000,0x20000001,2**40+7,Number.MAX_SAFE_INTEGER]){
    const state={...createSha256State(),bytes:count,buffer:Array(count%64).fill(0)};
    const digest=finishSha256State(state);assert.match(digest,/^[a-f0-9]{64}$/);
    assert.equal(finishSha256State(resume(state)),digest);assert.equal(state.bytes,count);
  }
});

test('a streamed file crossing the 32-bit bit-count boundary matches native SHA-256',()=>{
  // Reuse one small input allocation. A 512 MiB backup has a nonzero high
  // length word even though each persisted transfer chunk remains bounded.
  const chunk=new Uint8Array(1024*1024).fill(0x61),native=createHash('sha256');
  let state=createSha256State();
  for(let index=0;index<512;index++){state=updateSha256State(resume(state),chunk);native.update(chunk);}
  state=updateSha256State(resume(state),new Uint8Array([0x7f]));native.update(new Uint8Array([0x7f]));
  assert.equal(state.bytes,512*1024*1024+1);assert.equal(state.buffer.length,1);
  assert.equal(finishSha256State(resume(state)),native.digest('hex'));
});
