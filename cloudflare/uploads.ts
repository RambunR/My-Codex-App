import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {getRuntime} from './runtime';
import {MAX_EPISODE_BYTES} from '../shared/config';
import {AppError} from '../server/errors';

const MULTIPART_PART_BYTES=5*1024*1024;
let active=0;
const storage:multer.StorageEngine={
  _handleFile(_req,file,callback){
    if(active>=3){callback(new AppError(503,'SERVER_BUSY','Uploads are busy. Please retry shortly.'));return;}
    active++;
    let finished=false;
    const finish=(error?:unknown,info?:Partial<Express.Multer.File>)=>{if(finished)return;finished=true;active--;callback(error,info);};
    const key=`tmp/${randomUUID()}`;
    void(async()=>{
      const bucket=getRuntime().env.MEDIA;
      const multipart=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:file.mimetype}});
      let limited=false;const onLimit=()=>{limited=true;};file.stream.once('limit',onLimit);
      try{
        const parts:Array<{partNumber:number;etag:string}>=[];const buffer=Buffer.allocUnsafe(MULTIPART_PART_BYTES);let buffered=0;let size=0;
        const flush=async()=>{if(!buffered)return;parts.push(await multipart.uploadPart(parts.length+1,new Uint8Array(buffer.buffer,buffer.byteOffset,buffered)));buffered=0;};
        for await(const part of file.stream){
          const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);size+=chunk.length;let offset=0;
          // R2 requires equal-sized non-final parts. Network chunks may cross
          // the boundary, so split them instead of flushing an oversized part.
          while(offset<chunk.length){const length=Math.min(MULTIPART_PART_BYTES-buffered,chunk.length-offset);chunk.copy(buffer,buffered,offset,offset+length);buffered+=length;offset+=length;if(buffered===MULTIPART_PART_BYTES)await flush();}
        }
        if(limited)throw new multer.MulterError('LIMIT_FILE_SIZE');
        if(!size)throw new AppError(422,'INVALID_VIDEO','The uploaded file is empty.');
        await flush();await multipart.complete(parts);finish(undefined,{path:key,filename:key,size});
      }catch(error){await multipart.abort().catch(()=>{});finish(error);}
      finally{file.stream.removeListener('limit',onLimit);}
    })().catch(error=>finish(error));
  },
  _removeFile(_req,file,callback){getRuntime().env.MEDIA.delete(file.path).then(()=>callback(null)).catch(callback);},
};
export const upload=multer({storage,limits:{fileSize:MAX_EPISODE_BYTES+1,files:1,fields:8,fieldSize:10000}});
export const coverUpload=multer({storage,limits:{fileSize:5*1024*1024,files:1,fields:2}});
