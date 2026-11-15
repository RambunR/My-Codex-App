export const CLIPWEAVE_MAX_MANIFEST_BYTES:number;
export const CLIPWEAVE_MAX_SEAL_BYTES:number;
export const MAX_CLIPWEAVE_MANIFEST_BYTES:number;
export const MAX_CLIPWEAVE_SEAL_BYTES:number;
export class ClipWeaveValidationError extends Error {readonly code:string;readonly state:'WAIT'|'REJECT';readonly status:number;constructor(code:string,message:string,state?:'WAIT'|'REJECT');}
export interface ClipWeaveSeal {schema_version?:1;app?:'ClipWeave';export_id:string;manifest:'upload_manifest.json';manifest_size_bytes:number;manifest_sha256:string;text_summary:'EXPORT_SUMMARY.txt';batch_upload_ready:boolean;ready_series_ids:string[];status:string;finished_at:string;[key:string]:unknown;}
export interface ClipWeaveFile {path:string;role:string;series_id:string|null;required:boolean;size_bytes:number|null;sha256:string|null;issue?:unknown;[key:string]:unknown;}
export interface ClipWeaveClip {index:number;file:string;source_start:number;source_end:number;duration:number;overlap_previous:number|boolean;subtitle_srt?:string|null;subtitle_ass?:string|null;[key:string]:unknown;}
export interface ClipWeaveSeries {source_id:string;series_key:string|number;order:number;name:string;source_url?:unknown;source_duration:number|null;expected_clip_count:number|null;actual_clip_count:number|null;clips_complete:boolean;upload_ready:boolean;reasons:string[];metadata_requested:boolean;cover_requested:boolean;clips:ClipWeaveClip[];[key:string]:unknown;}
export interface ClipWeaveManifest {schema_version:1;app:'ClipWeave';export_id:string;operation:'process';status:string;finished_at:string;batch_upload_ready:boolean;global_reasons:string[];series:ClipWeaveSeries[];files:ClipWeaveFile[];completeness_scope:'generated_export';original_series_complete:boolean|null;[key:string]:unknown;}
export interface ClipWeaveExport {seal:ClipWeaveSeal;manifest:ClipWeaveManifest;manifestSha256:string;}
export function validateClipWeaveRelativePath(value:unknown):string;
export function parseClipWeaveSeal(raw:Uint8Array|string):ClipWeaveSeal;
export function verifyClipWeaveManifest(seal:ClipWeaveSeal,raw:Uint8Array|string):ClipWeaveManifest;
export function parseClipWeaveExport(sealRaw:Uint8Array|string,manifestRaw:Uint8Array|string):ClipWeaveExport;
export function selectReadyClipWeaveSeries(exported:ClipWeaveExport):ClipWeaveSeries[];
export function clipWeaveRequiredFiles(manifest:ClipWeaveManifest,series:ClipWeaveSeries|string):ClipWeaveFile[];
export function clipWeaveSourceIdentity(exportId:string,sourceId:string):string;
