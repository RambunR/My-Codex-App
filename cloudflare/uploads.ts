import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {getRuntime} from './runtime';
import {MAX_EPISODE_BYTES} from '../shared/config';
import {AppError} from '../server/errors';

let active=0;
const storage:multer.StorageEngine={
  _handleFile(_req,file,callback){
    if(active>=3){callback(new AppError(503,'SERVER_BUSY','Uploads are busy. Please retry shortly.'));return;}
    active++;
    const key=`tmp/${randomUUID()}`;const bucket=getRuntime().env.MEDIA;
    void(async()=>{
      const multipart=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:file.mimetype}});
      let limited=false;file.stream.once('limit',()=>{limited=true;});
      const parts:Array<{partNumber:number;etag:string}>=[];let buffers:Buffer[]=[];let buffered=0;let size=0;
      const flush=async()=>{if(!buffered)return;const data=Buffer.concat(buffers,buffered);buffers=[];buffered=0;parts.push(await multipart.uploadPart(parts.length+1,new Uint8Array(data)));};
      try{
        for await(const part of file.stream){const buffer=Buffer.isBuffer(part)?part:Buffer.from(part);size+=buffer.length;buffers.push(buffer);buffered+=buffer.length;if(buffered>=5*1024*1024)await flush();}
        if(limited)throw new multer.MulterError('LIMIT_FILE_SIZE');
        if(!size)throw new AppError(422,'INVALID_VIDEO','The uploaded file is empty.');
        await flush();await multipart.complete(parts);callback(null,{path:key,filename:key,size});
      }catch(error){await multipart.abort().catch(()=>{});callback(error as Error);}
    })().catch(error=>callback(error)).finally(()=>{active--;});
  },
  _removeFile(_req,file,callback){getRuntime().env.MEDIA.delete(file.path).then(()=>callback(null)).catch(callback);},
};
export const upload=multer({storage,limits:{fileSize:MAX_EPISODE_BYTES,files:1,fields:8,fieldSize:10000}});
export const coverUpload=multer({storage,limits:{fileSize:5*1024*1024,files:1,fields:2}});
