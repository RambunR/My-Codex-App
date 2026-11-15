/** A bounded SHA-256 checkpoint for private, resumable Drive verification.
 * JSON round trips preserve it; no source bytes beyond the final partial block
 * are retained. Checkpoints are trusted internal state, not an authentication
 * proof and never a substitute for comparing the final digest to the manifest. */
export interface Sha256State {
  version:1;
  bytes:number;
  words:number[];
  buffer:number[];
}

const INITIAL=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
const K=new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate=(value:number,bits:number)=>(value>>>bits)|(value<<(32-bits));
const invalid=():never=>{throw new TypeError('Invalid resumable SHA-256 checkpoint.');};

function checked(value:unknown):Sha256State {
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const state=value as Partial<Sha256State>,bytes=state.bytes;
  if(Object.keys(state).sort().join(',')!=='buffer,bytes,version,words'||state.version!==1||typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<0||!Array.isArray(state.words)||state.words.length!==8||!Array.isArray(state.buffer)||state.buffer.length>63||state.buffer.length!==bytes%64)return invalid();
  for(let index=0;index<8;index++)if(!Number.isInteger(state.words[index])||state.words[index]<0||state.words[index]>0xffffffff)return invalid();
  for(let index=0;index<state.buffer.length;index++)if(!Number.isInteger(state.buffer[index])||state.buffer[index]<0||state.buffer[index]>255)return invalid();
  // Before the first whole block, the chaining words must still be initial.
  if(bytes<64&&state.words.some((word,index)=>word!==INITIAL[index]))return invalid();
  return state as Sha256State;
}

/** Process one complete 64-byte block. Schedule memory is reused by the call. */
function compress(words:number[],input:Uint8Array,offset:number,schedule:Uint32Array){
  for(let index=0;index<16;index++){
    const at=offset+index*4;
    schedule[index]=((input[at]<<24)|(input[at+1]<<16)|(input[at+2]<<8)|input[at+3])>>>0;
  }
  for(let index=16;index<64;index++){
    const x=schedule[index-15],y=schedule[index-2];
    const a=rotate(x,7)^rotate(x,18)^(x>>>3),b=rotate(y,17)^rotate(y,19)^(y>>>10);
    schedule[index]=(schedule[index-16]+a+schedule[index-7]+b)>>>0;
  }
  let[a,b,c,d,e,f,g,h]=words;
  for(let index=0;index<64;index++){
    const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[index]+schedule[index])>>>0;
    const second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
    h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0;
  }
  words[0]=(words[0]+a)>>>0;words[1]=(words[1]+b)>>>0;
  words[2]=(words[2]+c)>>>0;words[3]=(words[3]+d)>>>0;
  words[4]=(words[4]+e)>>>0;words[5]=(words[5]+f)>>>0;
  words[6]=(words[6]+g)>>>0;words[7]=(words[7]+h)>>>0;
}

export function createSha256State():Sha256State {
  return{version:1,bytes:0,words:INITIAL.slice(),buffer:[]};
}

/** Hash the next bytes and return a fresh JSON-safe checkpoint. Chunk order
 * is significant. The caller must persist it with the associated file offset. */
export function updateSha256State(value:unknown,chunk:Uint8Array):Sha256State {
  const state=checked(value);
  if(!(chunk instanceof Uint8Array))throw new TypeError('SHA-256 input must be a byte array.');
  if(chunk.byteLength>Number.MAX_SAFE_INTEGER-state.bytes)throw new RangeError('SHA-256 byte count exceeds the exact integer limit.');
  const words=state.words.slice(),schedule=new Uint32Array(64);
  let offset=0;
  if(state.buffer.length){
    const needed=64-state.buffer.length;
    if(chunk.length<needed)return{version:1,bytes:state.bytes+chunk.length,words,buffer:[...state.buffer,...chunk]};
    const block=new Uint8Array(64);block.set(state.buffer);block.set(chunk.subarray(0,needed),state.buffer.length);
    compress(words,block,0,schedule);offset=needed;
  }
  while(offset+64<=chunk.length){compress(words,chunk,offset,schedule);offset+=64;}
  return{version:1,bytes:state.bytes+chunk.length,words,buffer:Array.from(chunk.subarray(offset))};
}

/** Finalize a copy, preserving the checkpoint for crash-safe comparison/retry. */
export function finishSha256State(value:unknown):string {
  const state=checked(value),words=state.words.slice(),schedule=new Uint32Array(64);
  const tail=new Uint8Array(state.buffer.length<56?64:128);
  tail.set(state.buffer);tail[state.buffer.length]=0x80;
  // Divide before multiplying: bytes*8 can lose low bits near MAX_SAFE_INTEGER.
  const hi=Math.floor(state.bytes/0x20000000),lo=(state.bytes%0x20000000)*8;
  const view=new DataView(tail.buffer);view.setUint32(tail.length-8,hi,false);view.setUint32(tail.length-4,lo,false);
  for(let offset=0;offset<tail.length;offset+=64)compress(words,tail,offset,schedule);
  return words.map(word=>word.toString(16).padStart(8,'0')).join('');
}
