import {Readable} from 'node:stream';
import {patchVideoBytes,type VideoBytePatch} from './mp4-playback';

/** Transform only overlapping metadata bytes, retaining streaming backpressure. */
export function compatibleVideoStream(input:Readable,start:number,patches:VideoBytePatch[]){
  if(!patches.length)return input;
  return Readable.from((async function*(){
    let offset=start;
    try{for await(const chunk of input){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);yield patchVideoBytes(bytes,offset,patches);offset+=bytes.length;}}
    finally{input.destroy();}
  })());
}
