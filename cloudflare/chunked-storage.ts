import {getRuntime} from './runtime';
import {prepareVideo} from './storage';
import type {EpisodeUploadStorage} from '../server/chunked-storage';
export type {EpisodeUploadStorage,EpisodeUploadPart} from '../server/chunked-storage';
export const episodeUploadStorage:EpisodeUploadStorage={
  enabled:()=>true,
  async create(key){return(await getRuntime().env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:'video/mp4'}})).uploadId;},
  async part(key,id,number,bytes){return getRuntime().env.MEDIA.resumeMultipartUpload(key,id).uploadPart(number,bytes);},
  async complete(key,id,parts){await getRuntime().env.MEDIA.resumeMultipartUpload(key,id).complete(parts);},
  async abort(key,id){await getRuntime().env.MEDIA.resumeMultipartUpload(key,id).abort();},
  async head(key){const head=await getRuntime().env.MEDIA.head(key);return head?{size:head.size}:null;},
  async validate(key,maxSeconds){const result=await prepareVideo(key,maxSeconds);return{bytes:result.bytes,duration:result.duration};},
  async remove(key){await getRuntime().env.MEDIA.delete(key);},
};
