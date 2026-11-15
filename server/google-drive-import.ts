import {createHash} from 'node:crypto';
import {importPKCS8,SignJWT} from 'jose';
import type {DriveFile,DrivePage,DriveReader} from '../shared/drive-import-types.js';
import {validDriveId,MAX_DRIVE_MANIFEST_BYTES} from '../shared/drive-import-manifest.js';
import {MAX_EPISODE_BYTES} from '../shared/config.js';

const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token';
const FILES_ENDPOINT='https://www.googleapis.com/drive/v3/files';
const READONLY_SCOPE='https://www.googleapis.com/auth/drive.readonly';
const FILE_FIELDS='id,name,mimeType,size,version,modifiedTime,md5Checksum,sha256Checksum,parents';
const MAX_RANGE_BYTES=5*1024*1024;
interface ServiceAccount {client_email:string;private_key:string}
export class GoogleDriveImportError extends Error {
  readonly code:string;readonly status:number;readonly retryAfterSeconds?:number;
  constructor(code:string,message:string,status=502,retryAfterSeconds?:number){super(message);this.name='GoogleDriveImportError';this.code=code;this.status=status;this.retryAfterSeconds=retryAfterSeconds;}
}
function fail(code:string,message:string,status=502):never{throw new GoogleDriveImportError(code,message,status);}
function credentials(raw:unknown):ServiceAccount|null{
  if(typeof raw!=='string'||raw.length>100000)return null;
  try{
    const value=JSON.parse(raw);
    if(value?.type!=='service_account'||typeof value.client_email!=='string'||value.client_email.length>254||!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/u.test(value.client_email)||typeof value.private_key!=='string'||value.private_key.length<500||value.private_key.length>20000||!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/u.test(value.private_key))return null;
    return{client_email:value.client_email,private_key:value.private_key};
  }catch{return null;}
}
/** Pure setup status: this proves only credential shape/presence. A separately
 * authorized connection check proves signing and actual folder permission. */
export function googleDriveCredentials(raw?:string){
  const value=credentials(raw);
  return{configured:!!value,serviceAccountEmail:value?.client_email||null,fingerprint:value?createHash('sha256').update(value.client_email+'\n'+value.private_key).digest('hex'):''};
}
async function readLimited(response:Response,maxBytes:number){
  const declared=response.headers.get('Content-Length');
  if(declared&&/^\d+$/u.test(declared)&&Number(declared)>maxBytes){await response.body?.cancel();fail('DRIVE_SOURCE_CHANGED','Drive returned more data than requested.',422);}
  if(!response.body)fail('DRIVE_UNAVAILABLE','Drive returned an empty response.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{
    for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maxBytes){await reader.cancel();fail('DRIVE_SOURCE_CHANGED','Drive returned more data than requested.',422);}chunks.push(next.value);}
  }catch(error){if(error instanceof GoogleDriveImportError)throw error;fail('DRIVE_UNAVAILABLE','Drive data could not be read. Try again later.');}
  finally{reader.releaseLock();}
  const output=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}return output;
}
async function jsonResponse(response:Response,maxBytes:number){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readLimited(response,maxBytes)));}
  catch(error){if(error instanceof GoogleDriveImportError)throw error;fail('DRIVE_UNAVAILABLE','Drive returned invalid metadata. Try again later.');}
}
function fileMetadata(value:any,expectedId?:string):DriveFile{
  // Native Google documents have no binary size. Keep them in listings so
  // unrelated Docs/Sheets can be ignored; they can never satisfy media input.
  const native=typeof value?.mimeType==='string'&&value.mimeType.startsWith('application/vnd.google-apps.');
  const size=value?.size===undefined&&native?0:Number(value?.size);
  if(!validDriveId(value?.id)||expectedId&&value.id!==expectedId||typeof value.name!=='string'||value.name.length<1||value.name.length>1024||typeof value.mimeType!=='string'||value.mimeType.length>200||!Number.isSafeInteger(size)||size<0||typeof value.version!=='string'||!/^\d{1,30}$/u.test(value.version)||typeof value.modifiedTime!=='string'||!Number.isFinite(Date.parse(value.modifiedTime))||value.parents!==undefined&&(!Array.isArray(value.parents)||value.parents.length>20||value.parents.some((id:unknown)=>!validDriveId(id))))fail('DRIVE_SOURCE_CHANGED','Drive returned incomplete or invalid file metadata.',422);
  if(value.md5Checksum!==undefined&&(typeof value.md5Checksum!=='string'||!/^[a-f0-9]{32}$/iu.test(value.md5Checksum)))fail('DRIVE_SOURCE_CHANGED','Drive returned an invalid checksum.',422);
  if(value.sha256Checksum!==undefined&&(typeof value.sha256Checksum!=='string'||!/^[a-f0-9]{64}$/iu.test(value.sha256Checksum)))fail('DRIVE_SOURCE_CHANGED','Drive returned an invalid checksum.',422);
  return{id:value.id,name:value.name,mimeType:value.mimeType,size,version:value.version,modifiedTime:value.modifiedTime,...(value.md5Checksum?{md5Checksum:value.md5Checksum.toLowerCase()}:{}),...(value.sha256Checksum?{sha256Checksum:value.sha256Checksum.toLowerCase()}:{}),...(value.parents?{parents:[...value.parents]}:{})};
}
export interface GoogleDriveReaderOptions {fetch?:typeof globalThis.fetch;now?:()=>number}
export function createGoogleDriveReader(raw:string,options:GoogleDriveReaderOptions={}):DriveReader{
  const account=credentials(raw);if(!account)fail('DRIVE_NOT_CONFIGURED','Private Drive credentials are not configured.',503);
  const fetcher=options.fetch||globalThis.fetch,now=options.now||Date.now;
  let accessToken='',expiresAt=0,pendingToken:Promise<string>|null=null;
  const send=async(url:URL|string,init:RequestInit,timeout=15000)=>{
    try{return await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(timeout)});}
    catch{fail('DRIVE_UNAVAILABLE','Google Drive could not be reached. Try again later.');}
  };
  const token=async():Promise<string>=>{
    if(accessToken&&expiresAt>now())return accessToken;
    if(pendingToken)return pendingToken;
    pendingToken=(async()=>{
      let assertion:string;
      try{const key=await importPKCS8(account.private_key,'RS256'),issued=Math.floor(now()/1000);assertion=await new SignJWT({scope:READONLY_SCOPE}).setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(account.client_email).setAudience(TOKEN_ENDPOINT).setIssuedAt(issued).setExpirationTime(issued+3600).sign(key);}
      catch{fail('DRIVE_AUTH_FAILED','Private Drive credentials could not be used. Check the service-account key.',503);}
      const response=await send(TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})},10000);
      if(!response.ok){await response.body?.cancel();fail('DRIVE_AUTH_FAILED','Google did not accept the Drive service-account credentials.',503);}
      const value=await jsonResponse(response,65536);
      if(typeof value?.access_token!=='string'||!value.access_token||value.access_token.length>16000||/[\r\n]/u.test(value.access_token)||!Number.isFinite(value.expires_in)||value.expires_in<=0)fail('DRIVE_AUTH_FAILED','Google returned an invalid Drive authorization response.',503);
      accessToken=value.access_token;expiresAt=now()+Math.max(1,Math.min(3600,value.expires_in)-30)*1000;return accessToken;
    })();
    try{return await pendingToken;}finally{pendingToken=null;}
  };
  const get=async(url:URL,extra:Record<string,string>={})=>{
    for(let attempt=0;attempt<2;attempt++){
      const response=await send(url,{method:'GET',headers:{Authorization:'Bearer '+await token(),Accept:'application/json','Accept-Encoding':'identity',...extra}},30000);
      if(response.status===401&&attempt===0){await response.body?.cancel();accessToken='';expiresAt=0;continue;}
      if(response.ok)return response;
      const status=response.status,retry=response.headers.get('Retry-After');await response.body?.cancel();
      if(status===429)throw new GoogleDriveImportError('DRIVE_RATE_LIMITED','Drive is temporarily rate limited. Try again later.',429,retry&&/^\d+$/u.test(retry)?Math.min(3600,Number(retry)):undefined);
      if(status===401)fail('DRIVE_AUTH_FAILED','Drive authorization failed. Check the service-account credentials.',503);
      if(status===403||status===404)fail('DRIVE_ACCESS_DENIED','The Drive service account cannot read this folder or file. Check Viewer access.',status);
      fail('DRIVE_UNAVAILABLE','Drive returned an unavailable response. Try again later.');
    }
    return fail('DRIVE_AUTH_FAILED','Drive authorization failed.',503);
  };
  const fileURL=(id:string)=>{if(!validDriveId(id))fail('DRIVE_SOURCE_CHANGED','Invalid Drive file identity.',422);return new URL(FILES_ENDPOINT+'/'+encodeURIComponent(id));};
  const getFile=async(id:string)=>{const url=fileURL(id);url.searchParams.set('fields',FILE_FIELDS);url.searchParams.set('supportsAllDrives','true');return fileMetadata(await jsonResponse(await get(url),65536),id);};
  return{
    getFile,
    async listChildren(id,pageToken){
      if(!validDriveId(id)||pageToken!==undefined&&(typeof pageToken!=='string'||pageToken.length>2048||/[\u0000-\u001f]/u.test(pageToken)))fail('DRIVE_SOURCE_CHANGED','Invalid Drive folder page.',422);
      const url=new URL(FILES_ENDPOINT);url.search=new URLSearchParams({q:`'${id}' in parents and trashed = false`,pageSize:'1000',fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true',orderBy:'folder,name_natural',...(pageToken?{pageToken}:{})}).toString();
      const value=await jsonResponse(await get(url),2*1024*1024);
      if(value?.incompleteSearch===true)fail('DRIVE_UNAVAILABLE','Drive did not return a complete folder listing. Try again later.');
      if(!Array.isArray(value?.files)||value.files.length>1000||value.nextPageToken!==undefined&&(typeof value.nextPageToken!=='string'||value.nextPageToken.length>2048))fail('DRIVE_SOURCE_CHANGED','Drive returned an invalid folder listing.',422);
      const files=value.files.map((item:any)=>fileMetadata(item));
      if(files.some((file:DriveFile)=>!file.parents?.includes(id)))fail('DRIVE_SOURCE_CHANGED','A Drive file is not a direct child of the expected folder.',422);
      return{files,...(value.nextPageToken?{nextPageToken:value.nextPageToken}:{})};
    },
    async readText(id,maxBytes=MAX_DRIVE_MANIFEST_BYTES){
      if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_DRIVE_MANIFEST_BYTES)fail('DRIVE_SOURCE_CHANGED','Invalid manifest size limit.',422);
      const file=await getFile(id);
      if(file.size<1||file.size>maxBytes||file.mimeType.startsWith('application/vnd.google-apps.'))fail('DRIVE_SOURCE_CHANGED','The ready manifest is empty, too large, or not a normal JSON file.',422);
      const url=fileURL(id);url.search=new URLSearchParams({alt:'media',supportsAllDrives:'true'}).toString();
      const response=await get(url,{Accept:'application/octet-stream'});
      if(response.status!==200){await response.body?.cancel();fail('DRIVE_SOURCE_CHANGED','Drive did not return the complete ready manifest.',422);}
      const bytes=await readLimited(response,maxBytes);if(bytes.byteLength!==file.size)fail('DRIVE_SOURCE_CHANGED','The ready manifest changed while it was being read.',422);
      try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('DRIVE_SOURCE_CHANGED','The ready manifest must be UTF-8 JSON.',422);}
    },
    async readRange(id,offset,length,totalBytes){
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>MAX_RANGE_BYTES||!Number.isSafeInteger(totalBytes)||totalBytes<1||totalBytes>MAX_EPISODE_BYTES||offset+length>totalBytes)fail('DRIVE_SOURCE_CHANGED','Invalid bounded Drive media range.',422);
      const url=fileURL(id);url.search=new URLSearchParams({alt:'media',supportsAllDrives:'true'}).toString();const end=offset+length-1;
      const response=await get(url,{Accept:'application/octet-stream',Range:`bytes=${offset}-${end}`});
      if(response.status!==206||response.headers.get('Content-Range')!==`bytes ${offset}-${end}/${totalBytes}`){await response.body?.cancel();fail('DRIVE_SOURCE_CHANGED','Drive did not honor the requested media range.',422);}
      const bytes=await readLimited(response,length);if(bytes.byteLength!==length)fail('DRIVE_SOURCE_CHANGED','Drive media changed or ended before the requested range.',422);return bytes;
    },
  };
}

/** Optional bounded helper for callers outside the incremental engine. */
export async function listDriveFolderFiles(reader:DriveReader,id:string,maxEntries=20000):Promise<DriveFile[]>{
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>20000)fail('DRIVE_SOURCE_CHANGED','Invalid Drive listing limit.',422);
  const files:DriveFile[]=[],tokens=new Set<string>();let token:string|undefined;
  do{const page:DrivePage=await reader.listChildren(id,token);files.push(...page.files);if(files.length>maxEntries)fail('DRIVE_SOURCE_CHANGED','The Drive folder contains too many files.',422);token=page.nextPageToken;if(token){if(tokens.has(token))fail('DRIVE_SOURCE_CHANGED','Drive repeated a folder page.',422);tokens.add(token);}}while(token);
  return files;
}
