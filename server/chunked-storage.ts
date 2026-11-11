export interface EpisodeUploadPart {partNumber:number;etag:string}
export interface EpisodeUploadStorage {
  enabled():boolean;
  create(key:string):Promise<string>;
  part(key:string,uploadId:string,partNumber:number,bytes:Uint8Array):Promise<EpisodeUploadPart>;
  complete(key:string,uploadId:string,parts:EpisodeUploadPart[]):Promise<void>;
  abort(key:string,uploadId:string):Promise<void>;
  head(key:string):Promise<{size:number}|null>;
  validate(key:string,maxSeconds?:number|null):Promise<{bytes:number;duration:number}>;
  remove(key:string):Promise<void>;
}
const unavailable=async():Promise<any>=>{throw new Error('Chunked uploads are unavailable on this runtime.');};
// The standalone Node server keeps its ordinary streamed multipart uploader.
export const episodeUploadStorage:EpisodeUploadStorage={enabled:()=>false,create:unavailable,part:unavailable,complete:unavailable,abort:unavailable,head:unavailable,validate:unavailable,remove:unavailable};
