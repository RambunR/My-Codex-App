import {z} from 'zod';
import {MAX_EPISODE_BYTES} from './config.js';
import {SPOKEN_LANGUAGE_CODES} from './spoken-languages.js';
import {GENRES} from './taxonomy.js';
import {DRIVE_IMPORT_MANIFEST_NAME,type DriveFile,type DriveManifestEpisode,type DriveManifestFile,type DriveSeriesManifest} from './drive-import-types.js';

export const MAX_DRIVE_MANIFEST_BYTES=1024*1024;
export const DRIVE_DRAFT_DESCRIPTION='Imported draft. Review the title, synopsis, language and genre in LingYing before publishing.';
export class DriveManifestError extends Error {
  readonly code:string;readonly status=422;
  constructor(code:string,message:string){super(message);this.name='DriveManifestError';this.code=code;}
}
const fail=(code:string,message:string):never=>{throw new DriveManifestError(code,message);};
export function validDriveId(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/u.test(value);}
export function isDriveSeriesFolderName(name:string){return /^\d{3,6}[_ -]clips?(?:[_ -].+)?$/iu.test(name)&&!/[\u0000-\u001f\u007f/\\]/u.test(name);}
const safeName=(value:string)=>value.trim().length>0&&!value.startsWith('.')&&!/[\u0000-\u001f\u007f/\\]/u.test(value)&&value!=='.'&&value!=='..';
const filename=z.string().min(1).max(255).refine(safeName);
const digest=z.string().regex(/^[a-f0-9]{64}$/iu).transform(value=>value.toLowerCase());
const episode=z.object({name:filename.refine(name=>/\.mp4$/iu.test(name)),bytes:z.number().int().positive().max(MAX_EPISODE_BYTES),sha256:digest,number:z.number().int().min(1).max(1000),title:z.string().trim().min(1).max(120).optional()}).strict();
const cover=z.object({name:filename.refine(name=>/\.(?:jpe?g|png|webp)$/iu.test(name)),bytes:z.number().int().positive().max(5*1024*1024),sha256:digest}).strict();
const schema=z.object({
  version:z.literal(1),
  series:z.object({title:z.string().trim().min(2).max(120),description:z.string().trim().min(10).max(4000).default(DRIVE_DRAFT_DESCRIPTION),language:z.enum(SPOKEN_LANGUAGE_CODES as [string,...string[]]).default('en'),genres:z.array(z.enum(GENRES)).min(1).max(3).refine(values=>new Set(values).size===values.length).default(['drama']),creation_type:z.enum(['human','ai-assisted','ai-generated']).default('ai-generated')}).strict(),
  episodes:z.array(episode).min(1).max(1000),cover:cover.optional(),
}).strict().superRefine((value,ctx)=>{
  const names=new Set<string>(),numbers=new Set<number>();
  for(const item of value.episodes){if(names.has(item.name)||numbers.has(item.number))ctx.addIssue({code:'custom',message:'Duplicate file names or episode numbers.'});names.add(item.name);numbers.add(item.number);}
  if(value.cover&&names.has(value.cover.name))ctx.addIssue({code:'custom',message:'Duplicate file names.'});
});

/** Source JSON is data only. Unknown account, pricing, URL or instruction fields
 * are rejected; ownership, all-free draft pricing and publication are server-owned. */
export function parseDriveManifest(input:string|unknown):DriveSeriesManifest{
  let value:unknown=input;
  try{
    const text=typeof input==='string'?input:JSON.stringify(input);
    if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>MAX_DRIVE_MANIFEST_BYTES)fail('INVALID_DRIVE_MANIFEST','The ready manifest is missing or exceeds 1 MiB.');
    value=typeof input==='string'?JSON.parse(text.replace(/^\uFEFF/u,'')):input;
  }catch(error){if(error instanceof DriveManifestError)throw error;fail('INVALID_DRIVE_MANIFEST','The ready manifest must contain valid JSON.');}
  const parsed=schema.safeParse(value);
  if(!parsed.success)fail('INVALID_DRIVE_MANIFEST','Manifest metadata or file entries are invalid. Check names, episode numbers, sizes and SHA-256 checksums.');
  return parsed.data as DriveSeriesManifest;
}

export interface MatchedDriveManifestFiles {
  episodes:Array<{manifest:DriveManifestEpisode;file:DriveFile}>;
  cover?:{manifest:DriveManifestFile;file:DriveFile};
}
export function matchDriveManifestFiles(manifest:DriveSeriesManifest,files:DriveFile[]):MatchedDriveManifestFiles{
  if(files.length>20000)fail('DRIVE_FILES_AMBIGUOUS','The folder contains too many entries for a safe import.');
  const ids=new Set<string>(),byName=new Map<string,DriveFile[]>();
  for(const file of files){
    if(!validDriveId(file.id)||ids.has(file.id))fail('DRIVE_FILES_AMBIGUOUS','Drive returned duplicate or invalid file identities.');
    ids.add(file.id);const entries=byName.get(file.name)||[];entries.push(file);byName.set(file.name,entries);
    if(file.mimeType==='application/vnd.google-apps.shortcut')fail('DRIVE_FILES_AMBIGUOUS','Drive shortcuts are not supported inside an import series folder.');
  }
  const expected=new Set(manifest.episodes.map(item=>item.name));
  for(const file of files)if(file.mimeType!=='application/vnd.google-apps.folder'&&/\.mp4$/iu.test(file.name)&&!expected.has(file.name))fail('DRIVE_FILES_UNEXPECTED','The folder contains an MP4 that is not listed in the ready manifest.');
  const match=(item:DriveManifestFile):DriveFile=>{
    const entries=byName.get(item.name)||[];
    if(!entries.length)fail('DRIVE_FILES_PENDING','Waiting for all files listed in the ready manifest to finish uploading.');
    if(entries.length!==1)fail('DRIVE_FILES_AMBIGUOUS','Multiple Drive files have the same expected name.');
    const file=entries[0];
    if(file.mimeType.startsWith('application/vnd.google-apps.'))fail('DRIVE_FILES_AMBIGUOUS','An expected media file is a folder, shortcut or Google document.');
    if(!Number.isSafeInteger(file.size)||file.size!==item.bytes)fail('DRIVE_FILES_PENDING','A file size does not yet match the ready manifest.');
    if(file.sha256Checksum&&file.sha256Checksum.toLowerCase()!==item.sha256.toLowerCase())fail('DRIVE_CHECKSUM_MISMATCH','A Drive file does not match its ready-manifest checksum.');
    return file;
  };
  return{episodes:manifest.episodes.map(item=>({manifest:item,file:match(item)})),...(manifest.cover?{cover:{manifest:manifest.cover,file:match(manifest.cover)}}:{})};
}

/** A stable source fingerprint includes renames and parent moves as well as
 * content revisions. The engine rechecks it before committing imported media. */
export function driveFileRevision(file:DriveFile){return JSON.stringify({id:file.id,name:file.name,mimeType:file.mimeType,size:file.size,version:file.version,modifiedTime:file.modifiedTime,md5Checksum:file.md5Checksum||'',sha256Checksum:file.sha256Checksum||'',parents:[...(file.parents||[])].sort()});}
export {DRIVE_IMPORT_MANIFEST_NAME};
