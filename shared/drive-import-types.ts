export const DRIVE_IMPORT_MANIFEST_NAME='lingying-ready.json';
export const DEFAULT_DRIVE_IMPORT_FOLDER='1zEO-UFQpVMu7GnYNB4mM-M_3__IwhPHo';
export const DRIVE_IMPORT_POLICY='clipweave-v1';
export const DRIVE_IMPORT_DAILY_CRON='15 0 * * *';
export interface DriveManifestFile {name:string;bytes:number;sha256:string}
export interface DriveManifestEpisode extends DriveManifestFile {number:number;title?:string}
export interface DriveSeriesManifest {version:1;series:{title:string;description:string;language:string;genres:string[];creation_type:'human'|'ai-assisted'|'ai-generated'};episodes:DriveManifestEpisode[];cover?:DriveManifestFile}
export interface DriveFile {id:string;name:string;mimeType:string;size:number;version:string;modifiedTime:string;md5Checksum?:string;sha256Checksum?:string;parents?:string[]}
export interface DrivePage {files:DriveFile[];nextPageToken?:string}
export interface DriveReader {
  getFile(id:string):Promise<DriveFile>;
  listChildren(id:string,pageToken?:string):Promise<DrivePage>;
  readText(id:string,maxBytes?:number):Promise<string>;
  readRange(id:string,offset:number,length:number,totalBytes:number):Promise<Uint8Array>;
}
export type DriveJobStatus='waiting'|'downloading'|'validating'|'complete'|'error'|'cancelled'|'review';
export interface DriveImportSettings {enabled:boolean;folderId:string;revision:number;verifiedAt:number|null}
export interface DriveImportJob {id:string;folderId:string;folderName:string;status:DriveJobStatus;seriesId:string|null;destinationDeleted?:boolean;episodeCount:number;finishedFiles:number;totalFiles:number;message:string;createdAt:string;updatedAt:string}
export interface DriveImportNotification {id:string;jobId:string|null;kind:'complete'|'error'|'attention';title:string;message:string;seriesId:string|null;createdAt:string;readAt:string|null}
export interface DriveImportStatus {settings:DriveImportSettings;connection:{configured:boolean;serviceAccountEmail:string|null;runtimeAvailable:boolean};jobs:DriveImportJob[];notifications:DriveImportNotification[];unread:number}
export interface DriveImportRuntime {
  available():boolean;
  credentials():{configured:boolean;serviceAccountEmail:string|null;fingerprint:string};
  verifyFolder(folderId:string):Promise<void>;
}
