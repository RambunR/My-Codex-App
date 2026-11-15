import {createHash} from 'node:crypto';
import type {DriveFile,DriveReader} from '../shared/drive-import-types.js';
import {driveFileRevision,validDriveId} from '../shared/drive-import-manifest.js';
import {
  parseClipWeaveExport,selectReadyClipWeaveSeries,clipWeaveRequiredFiles,validateClipWeaveRelativePath,
  CLIPWEAVE_MAX_MANIFEST_BYTES,CLIPWEAVE_MAX_SEAL_BYTES,
  type ClipWeaveSeal,type ClipWeaveManifest,type ClipWeaveSeries,type ClipWeaveFile,
} from '../shared/clipweave-export.js';

const FOLDER='application/vnd.google-apps.folder',SHORTCUT='application/vnd.google-apps.shortcut';
const SEAL='EXPORT_FINALIZED.json',MANIFEST='upload_manifest.json',SUMMARY='EXPORT_SUMMARY.txt';
const CONTROL_NAMES=new Set([SEAL,MANIFEST,SUMMARY]);
const MAX_MANIFEST_BYTES=CLIPWEAVE_MAX_MANIFEST_BYTES,MAX_SEAL_BYTES=CLIPWEAVE_MAX_SEAL_BYTES,PART_BYTES=5*1024*1024;
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

export class ClipWeaveDriveError extends Error {
  readonly status=422;
  constructor(readonly code:string,readonly state:'WAIT'|'REJECT',message:string){super(message);this.name='ClipWeaveDriveError';}
}
function fail(code:string,state:'WAIT'|'REJECT',message:string):never{throw new ClipWeaveDriveError(code,state,message);}
function identity(id:string){if(!validDriveId(id))fail('CLIPWEAVE_INVALID_PATH','REJECT','Invalid Drive folder or file identity.');}
function regularFile(file:DriveFile){if(file.mimeType.startsWith('application/vnd.google-apps.'))fail('CLIPWEAVE_INVALID_PATH','REJECT','A required export file is a folder, shortcut or Google document.');}
function collisionName(name:string){return name.normalize('NFC').toLowerCase();}

export interface ClipWeaveDriveLimits {maxEntries?:number;maxPages?:number;maxListRequests?:number}
interface Budget {remaining:number}
function limits(options:ClipWeaveDriveLimits={}){
  const value={maxEntries:options.maxEntries??20000,maxPages:options.maxPages??25,maxListRequests:options.maxListRequests??32};
  if(!Object.values(value).every(Number.isSafeInteger)||value.maxEntries<1||value.maxEntries>20000||value.maxPages<1||value.maxPages>100||value.maxListRequests<1||value.maxListRequests>1000)fail('CLIPWEAVE_LIMIT','REJECT','Invalid bounded export-listing limits.');
  return value;
}

/** Every page is read and validated; exact-name resolution never chooses the
 * first Drive match. The bound rejects oversized exports rather than silently
 * treating a partial listing as complete. */
export async function listClipWeaveChildren(reader:DriveReader,folderId:string,options:ClipWeaveDriveLimits={},budget?:Budget):Promise<DriveFile[]>{
  identity(folderId);const bound=limits(options),files:DriveFile[]=[],ids=new Set<string>(),tokens=new Set<string>();
  let token:string|undefined;
  for(let count=0;count<bound.maxPages;count++){
    if(budget&&--budget.remaining<0)fail('CLIPWEAVE_LIMIT','REJECT','This export requires more folder listings than one safe verification step permits.');
    const page=await reader.listChildren(folderId,token);
    if(!Array.isArray(page.files)||page.files.length>1000)fail('CLIPWEAVE_AMBIGUOUS','REJECT','Drive returned an invalid folder page.');
    for(const file of page.files){
      identity(file.id);
      if(!file.parents?.includes(folderId)||ids.has(file.id))fail('CLIPWEAVE_AMBIGUOUS','REJECT','Drive returned duplicate identities or an item outside its expected parent.');
      ids.add(file.id);files.push(file);
    }
    if(files.length>bound.maxEntries)fail('CLIPWEAVE_LIMIT','REJECT','The export folder contains too many entries for a safe complete listing.');
    token=page.nextPageToken;
    if(!token)return files;
    if(typeof token!=='string'||token.length>2048||/[\u0000-\u001f\u007f]/u.test(token)||tokens.has(token))fail('CLIPWEAVE_AMBIGUOUS','REJECT','Drive returned a repeated or invalid folder page.');
    tokens.add(token);
  }
  fail('CLIPWEAVE_LIMIT','REJECT','The export folder requires too many pages for a safe complete listing.');
}

/** A name identifies a discovery candidate only. Real identity and readiness
 * always come from its exact root controls and sealed export_id. */
export function isClipWeaveExportFolderName(name:string){return /^ClipWeave[_ -].+/iu.test(name)&&!/[\u0000-\u001f\u007f/\\]/u.test(name);}
export function hasClipWeaveControls(files:DriveFile[]){return files.some(file=>CONTROL_NAMES.has(file.name));}

export interface ClipWeaveSnapshotEntry {path:string;file:DriveFile;kind:'folder'|'file'}
interface ControlReference {file:DriveFile;sha256?:string}
export interface ClipWeaveDriveSnapshot {
  version:1;configuredRootId:string;exportFolder:DriveFile;exportId:string;sourceId:string|null;manifestSha256:string;
  controls:{seal:ControlReference&{sha256:string};manifest:ControlReference&{sha256:string};summary:ControlReference};
  entries:ClipWeaveSnapshotEntry[];
}
export interface LoadedClipWeaveExport {seal:ClipWeaveSeal;manifest:ClipWeaveManifest;manifestSha256:string;snapshot:ClipWeaveDriveSnapshot}
export interface ResolvedClipWeaveAsset {path:string;inventory:ClipWeaveFile;file:DriveFile;parentId:string}
export interface ResolvedClipWeaveSeries {series:ClipWeaveSeries;assets:ResolvedClipWeaveAsset[];snapshot:ClipWeaveDriveSnapshot}

class Resolver {
  readonly entries=new Map<string,ClipWeaveSnapshotEntry>();
  private readonly listings=new Map<string,Promise<DriveFile[]>>();
  private readonly budget:Budget;
  constructor(private reader:DriveReader,readonly rootId:string,private options:ClipWeaveDriveLimits={}){identity(rootId);this.budget={remaining:limits(options).maxListRequests};}
  listing(parent:string){
    let value=this.listings.get(parent);
    if(!value){value=listClipWeaveChildren(this.reader,parent,this.options,this.budget);this.listings.set(parent,value);}
    return value;
  }
  async resolve(path:string,kind:'file'|'folder'='file'){
    validateClipWeaveRelativePath(path);const components=path.split('/');let parent=this.rootId,node:DriveFile|undefined;
    for(let index=0;index<components.length;index++){
      const name=components[index],files=await this.listing(parent),matches=files.filter(file=>file.name===name);
      if(!matches.length)fail('CLIPWEAVE_FILES_PENDING','WAIT','Waiting for an expected export file or folder to finish syncing to Drive.');
      if(matches.length!==1||files.filter(file=>collisionName(file.name)===collisionName(name)).length!==1)fail('CLIPWEAVE_AMBIGUOUS','REJECT','A required export path has duplicate or colliding Drive names.');
      node=matches[0];if(node.mimeType===SHORTCUT)fail('CLIPWEAVE_INVALID_PATH','REJECT','Drive shortcuts cannot satisfy an export path.');
      const expected=index===components.length-1?kind:'folder';
      if(expected==='folder'&&node.mimeType!==FOLDER)fail('CLIPWEAVE_INVALID_PATH','REJECT','An expected export directory is not a real folder.');
      if(expected==='file')regularFile(node);
      this.entries.set(components.slice(0,index+1).join('/'),{path:components.slice(0,index+1).join('/'),file:node,kind:expected});
      if(index<components.length-1)parent=node.id;
    }
    return{file:node!,parentId:parent};
  }
}

export async function resolveClipWeavePath(reader:DriveReader,rootId:string,path:string,options:ClipWeaveDriveLimits={}){
  const resolver=new Resolver(reader,rootId,options),resolved=await resolver.resolve(path);
  return{...resolved,entries:[...resolver.entries.values()]};
}

async function rootFolder(reader:DriveReader,exportId:string,configuredRootId:string){
  identity(exportId);identity(configuredRootId);const root=await reader.getFile(exportId);
  if(root.id!==exportId||root.mimeType!==FOLDER||exportId!==configuredRootId&&!root.parents?.includes(configuredRootId))fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','The export is no longer the configured folder or its direct child.');
  return root;
}
async function rawControl(reader:DriveReader,file:DriveFile,maxBytes:number){
  regularFile(file);
  if(!Number.isSafeInteger(file.size)||file.size<1)fail('CLIPWEAVE_FILES_PENDING','WAIT','An export control file has not finished uploading.');
  if(file.size>maxBytes)fail('CLIPWEAVE_LIMIT','REJECT','An export control file exceeds its supported size limit.');
  const bytes=new Uint8Array(file.size);
  for(let offset=0;offset<file.size;offset+=PART_BYTES){const part=await reader.readRange(file.id,offset,Math.min(PART_BYTES,file.size-offset),file.size);if(part.length!==Math.min(PART_BYTES,file.size-offset))fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','An export control file changed while it was read.');bytes.set(part,offset);}
  const after=await reader.getFile(file.id);
  if(driveFileRevision(after)!==driveFileRevision(file))fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','An export control revision changed during verification.');
  return bytes;
}

export async function loadClipWeaveExport(reader:DriveReader,exportFolderId:string,options:ClipWeaveDriveLimits&{configuredRootId?:string}={}):Promise<LoadedClipWeaveExport>{
  const configuredRootId=options.configuredRootId??exportFolderId,root=await rootFolder(reader,exportFolderId,configuredRootId),resolver=new Resolver(reader,root.id,options);
  const seal=(await resolver.resolve(SEAL)).file,manifest=(await resolver.resolve(MANIFEST)).file,summary=(await resolver.resolve(SUMMARY)).file;
  const sealBytes=await rawControl(reader,seal,MAX_SEAL_BYTES),manifestBytes=await rawControl(reader,manifest,MAX_MANIFEST_BYTES);
  // Parsing verifies the exact manifest bytes against the seal before reading
  // JSON metadata. A BOM or newline change must not be silently normalized.
  const parsed=parseClipWeaveExport(sealBytes,manifestBytes);
  const sealAfter=await reader.getFile(seal.id),summaryAfter=await reader.getFile(summary.id);
  if(driveFileRevision(sealAfter)!==driveFileRevision(seal)||driveFileRevision(summaryAfter)!==driveFileRevision(summary))fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','An export control changed during verification.');
  if(summary.size<1)fail('CLIPWEAVE_FILES_PENDING','WAIT','The export summary has not finished uploading.');
  return{...parsed,snapshot:{version:1,configuredRootId,exportFolder:root,exportId:parsed.seal.export_id,sourceId:null,manifestSha256:parsed.manifestSha256,
    controls:{seal:{file:seal,sha256:sha256(sealBytes)},manifest:{file:manifest,sha256:sha256(manifestBytes)},summary:{file:summary}},entries:[...resolver.entries.values()]}};
}

export async function resolveClipWeaveSeries(reader:DriveReader,loaded:LoadedClipWeaveExport,sourceId:string,options:ClipWeaveDriveLimits={}):Promise<ResolvedClipWeaveSeries>{
  const series=selectReadyClipWeaveSeries(loaded).find(item=>item.source_id===sourceId);
  if(!series)fail('CLIPWEAVE_SERIES_NOT_READY','WAIT','This source is not in the sealed ready-series set.');
  const resolver=new Resolver(reader,loaded.snapshot.exportFolder.id,options),assets:ResolvedClipWeaveAsset[]=[];
  for(const inventory of clipWeaveRequiredFiles(loaded.manifest,series)){
    const {file,parentId}=await resolver.resolve(inventory.path);
    if(file.size!==inventory.size_bytes)fail('CLIPWEAVE_FILES_PENDING','WAIT','A required export file is missing bytes while Drive is syncing.');
    if(file.sha256Checksum&&file.sha256Checksum.toLowerCase()!==inventory.sha256?.toLowerCase())fail('CLIPWEAVE_CHECKSUM_MISMATCH','REJECT','A Drive file does not match the sealed SHA-256 inventory.');
    assets.push({path:inventory.path,inventory,file,parentId});
  }
  const entries=new Map(loaded.snapshot.entries.map(entry=>[entry.path,entry]));for(const entry of resolver.entries.values())entries.set(entry.path,entry);
  return{series,assets,snapshot:{...loaded.snapshot,sourceId,entries:[...entries.values()]}};
}

/** Re-resolve parent IDs and every literal required path from new complete
 * listings. Unlisted later files never become approved content. Directory
 * versions may change because of unrelated additions; identity and path edges
 * remain pinned, while actual asset/control versions must match exactly. */
export async function revalidateClipWeaveSnapshot(reader:DriveReader,snapshot:ClipWeaveDriveSnapshot,options:ClipWeaveDriveLimits={}):Promise<void>{
  if(snapshot.version!==1)fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','Unsupported saved export snapshot.');
  await rootFolder(reader,snapshot.exportFolder.id,snapshot.configuredRootId);
  const resolver=new Resolver(reader,snapshot.exportFolder.id,options);
  for(const expected of snapshot.entries){
    let resolved:{file:DriveFile;parentId:string};
    try{resolved=await resolver.resolve(expected.path,expected.kind);}catch(error){if(error instanceof ClipWeaveDriveError&&error.state==='WAIT')fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','A verified export path disappeared or moved.');throw error;}
    if(resolved.file.id!==expected.file.id||expected.kind==='file'&&driveFileRevision(resolved.file)!==driveFileRevision(expected.file))fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','A verified export file or folder was replaced or changed.');
  }
  const sealBytes=await rawControl(reader,snapshot.controls.seal.file,MAX_SEAL_BYTES),manifestBytes=await rawControl(reader,snapshot.controls.manifest.file,MAX_MANIFEST_BYTES);
  if(sha256(sealBytes)!==snapshot.controls.seal.sha256||sha256(manifestBytes)!==snapshot.manifestSha256)fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','The sealed export bytes changed before completion.');
  const parsed=parseClipWeaveExport(sealBytes,manifestBytes);
  if(parsed.seal.export_id!==snapshot.exportId||snapshot.sourceId&&!selectReadyClipWeaveSeries(parsed).some(series=>series.source_id===snapshot.sourceId))fail('CLIPWEAVE_SOURCE_CHANGED','REJECT','The saved source no longer belongs to this sealed ready export.');
}
