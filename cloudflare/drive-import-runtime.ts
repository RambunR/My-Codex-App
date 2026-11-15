import type {DriveReader,DriveImportRuntime} from '../shared/drive-import-types';
import {validDriveId} from '../shared/drive-import-manifest';
import {createGoogleDriveReader,googleDriveCredentials} from '../server/google-drive-import';
import type {DriveImportStorage} from '../server/drive-import-engine';
import {runDriveImportEngine} from '../dist/cloudflare/server/drive-import-engine';
import {assert} from '../server/errors';
import {getRuntime} from './runtime';
import {prepareVideo,prepareCover} from './storage';

let cached:{fingerprint:string;reader:DriveReader}|undefined;
function connection(){return googleDriveCredentials(getRuntime().env.GOOGLE_DRIVE_IMPORT_CREDENTIALS);}
function reader(){
  const status=connection();assert(status.configured,503,'DRIVE_NOT_CONFIGURED','Private Google Drive credentials are not configured.');
  if(!cached||cached.fingerprint!==status.fingerprint)cached={fingerprint:status.fingerprint,reader:createGoogleDriveReader(getRuntime().env.GOOGLE_DRIVE_IMPORT_CREDENTIALS!)};
  return cached.reader;
}
/** Only the production Durable Object owns this adapter. Local/Node builds
 * retain the unavailable adapter and cannot start an accidental watcher. */
export const driveImportRuntime:DriveImportRuntime={
  available:()=>true,
  credentials:connection,
  async verifyFolder(folderId){
    assert(validDriveId(folderId),400,'INVALID_DRIVE_FOLDER','Enter a valid Google Drive folder ID.');
    const source=reader(),folder=await source.getFile(folderId);
    assert(folder.mimeType==='application/vnd.google-apps.folder',422,'INVALID_DRIVE_FOLDER','The source must be a Google Drive folder.');
    await source.listChildren(folderId);
  },
};

export function cloudflareDriveImportStorage():DriveImportStorage{
  const bucket=getRuntime().env.MEDIA;
  return{
    async create(key,kind){return(await bucket.createMultipartUpload(key,{httpMetadata:{contentType:kind==='video'?'video/mp4':'application/octet-stream'}})).uploadId;},
    async part(key,id,number,bytes){return(await bucket.resumeMultipartUpload(key,id).uploadPart(number,bytes as any)).etag;},
    async complete(key,id,parts){await bucket.resumeMultipartUpload(key,id).complete(parts);},
    async head(key){const head=await bucket.head(key);return head?{size:head.size}:null;},
    async read(key){const object=await bucket.get(key);assert(object,404,'MEDIA_UNAVAILABLE','Staged media is unavailable.');return object.body as unknown as ReadableStream<Uint8Array>;},
    async validateVideo(key,maxSeconds){return prepareVideo(key,maxSeconds);},
    async validateCover(key){
      const media=await prepareCover(key),header=await bucket.get(key,{range:{offset:0,length:Math.min(16,media.bytes)}});
      assert(header,404,'MEDIA_UNAVAILABLE','Staged cover is unavailable.');
      const bytes=new Uint8Array(await header.arrayBuffer());
      const type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':'image/webp';
      const object=await bucket.get(key);assert(object,404,'MEDIA_UNAVAILABLE','Staged cover is unavailable.');
      // Preserve the original cover bytes while assigning its sniffed MIME.
      // A <=5 MiB cover uses an R2 stream, never a full episode-sized buffer.
      await bucket.put(key,object.body,{httpMetadata:{contentType:type}});return media;
    },
    async abort(key,id){
      try{await bucket.resumeMultipartUpload(key,id).abort();}
      catch(error){if(!/NoSuchUpload|does not exist|not found|already (?:completed|aborted)/iu.test(String((error as any)?.message||'')))throw error;}
    },
    async remove(key){await bucket.delete(key);},
  };
}

export async function runDriveImportTick({scanRoot=false}:{scanRoot?:boolean}={}):Promise<{wakeInMs?:number}>{
  try{
    const credentials=connection();
    return await runDriveImportEngine({storage:cloudflareDriveImportStorage(),...(credentials.configured?{drive:reader()}:{}),credentialFingerprint:credentials.fingerprint,scanRoot});
  }catch{
    // Durable checkpoints survive a transient adapter/runtime error. Do not
    // log provider responses or credentials, and retain an automatic retry.
    return{wakeInMs:5*60_000};
  }
}
