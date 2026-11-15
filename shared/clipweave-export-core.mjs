// Shared Node18/Workers contract. Source records are data, never commands or
// account/publication authority. Used by both Drive and the local verifier.
// Conservative contract assumptions pending real producer JSON: schema_version
// and app identify the manifest; optional seal identifiers must match when
// present. Status names are not a guessed allowlist;
// finished timestamps may differ; source timing uses seconds (1ms roundoff).
// overlap_previous can be seconds or a boolean flag, never a coerced number.
// A sealed generated-export inventory does not independently prove the story
// is complete; preserve original_series_complete exactly as supplied.
import {createHash} from 'node:crypto';

export const CLIPWEAVE_MAX_MANIFEST_BYTES=8*1024*1024;
export const CLIPWEAVE_MAX_SEAL_BYTES=64*1024;
export const MAX_CLIPWEAVE_MANIFEST_BYTES=CLIPWEAVE_MAX_MANIFEST_BYTES;
export const MAX_CLIPWEAVE_SEAL_BYTES=CLIPWEAVE_MAX_SEAL_BYTES;
const EPSILON=0.001;
const terminalForbidden=new Set(['pending','queued','running','processing','preparing','verifying','staging','stopped','cancelled','canceled','unsealed','in_progress','in-progress']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export class ClipWeaveValidationError extends Error {
  constructor(code,message,state='REJECT'){super(message);this.name='ClipWeaveValidationError';this.code=code;this.state=state;this.status=422;}
}
const fail=(code,message,state='REJECT')=>{throw new ClipWeaveValidationError(code,message,state);};
const need=(condition,message,code='CLIPWEAVE_INVALID',state='REJECT')=>{if(!condition)fail(code,message,state);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>=1&&value.length<=200&&!/[\u0000-\u001f\u007f]/u.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER;
const strings=value=>Array.isArray(value)&&value.length<=20000&&value.every(item=>typeof item==='string'&&item.length<=4000);
const overlapMatches=(value,expected)=>typeof value==='boolean'?value===(expected>EPSILON):finite(value)&&value>=0&&Math.abs(value-expected)<=EPSILON;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/iu.test(value);
const normalizedPath=value=>value.normalize('NFC').toLowerCase();
function bytesOf(raw,max,label){
  const bytes=typeof raw==='string'?new TextEncoder().encode(raw):raw;
  need(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=max,`${label} is empty or exceeds its size limit.`);
  return bytes;
}
function parseBytes(bytes,label){
  try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));need(record(value),`${label} must be a JSON object.`);return value;}
  catch(error){if(error instanceof ClipWeaveValidationError)throw error;fail('CLIPWEAVE_INVALID',`${label} must contain valid UTF-8 JSON.`);}
}
function provenance(value,label,{seal=false}={}){
  need(seal?(value.schema_version===undefined||value.schema_version===1)&&(value.app===undefined||value.app==='ClipWeave'):value.schema_version===1&&value.app==='ClipWeave',`${label} uses an unsupported ClipWeave schema.`,'CLIPWEAVE_SCHEMA_UNSUPPORTED');
  need(identifier(value.export_id),`${label} has an invalid export_id.`);
}
function finished(value,label,{seal=false}={}){
  need(typeof value.status==='string'&&value.status.trim().length>0&&value.status.length<=100,`${label} has no status.`);
  const status=value.status.trim().toLowerCase();
  need(!terminalForbidden.has(status)&&!(seal&&['failed','error'].includes(status)),`${label} has not been finalized.`,'CLIPWEAVE_NOT_FINALIZED','WAIT');
  need(typeof value.finished_at==='string'&&value.finished_at.length<=100&&Number.isFinite(Date.parse(value.finished_at)),`${label} has no valid finished_at.`,'CLIPWEAVE_NOT_FINALIZED','WAIT');
}
/** Validate literal portable relative paths without normalizing the value used
 * to resolve exact Unicode Drive names. Canonicalization is only for collision
 * detection. No URL, drive prefix, empty component, traversal or backslash. */
export function validateClipWeaveRelativePath(value){
  need(typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\u0000-\u001f\u007f\\:]/u.test(value)&&!value.startsWith('/')&&!value.endsWith('/'),'An inventory path is not a safe relative path.','CLIPWEAVE_PATH_UNSAFE');
  const parts=value.split('/');
  need(parts.length<=32&&parts.every(part=>part.length>0&&part.length<=255&&part!=='.'&&part!=='..'&&!/[. ]$/u.test(part)&&!/^\s/u.test(part)&&!/[<>"|?*]/u.test(part)&&!/(?:^|\.)(?:lnk|url)$/iu.test(part)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part)),'An inventory path contains an unsafe or colliding component.','CLIPWEAVE_PATH_UNSAFE');
  return value;
}
export function parseClipWeaveSeal(raw){
  const value=parseBytes(bytesOf(raw,CLIPWEAVE_MAX_SEAL_BYTES,'Export seal'),'Export seal');provenance(value,'Export seal',{seal:true});finished(value,'Export seal',{seal:true});
  need(value.manifest==='upload_manifest.json'&&value.text_summary==='EXPORT_SUMMARY.txt','The seal must name the exact root manifest and summary.');
  need(integer(value.manifest_size_bytes)&&value.manifest_size_bytes>0&&value.manifest_size_bytes<=CLIPWEAVE_MAX_MANIFEST_BYTES&&digest(value.manifest_sha256),'The seal has no valid manifest byte length and SHA-256.');
  need(typeof value.batch_upload_ready==='boolean'&&Array.isArray(value.ready_series_ids)&&value.ready_series_ids.length<=1000&&value.ready_series_ids.every(identifier),'The seal readiness records are invalid.');
  need(new Set(value.ready_series_ids).size===value.ready_series_ids.length,'The seal repeats a source identity.');
  return{...value,manifest_sha256:value.manifest_sha256.toLowerCase()};
}
function safeSize(value){
  if(typeof value==='string'&&/^(?:0|[1-9]\d*)$/u.test(value)&&value.length<=20){const parsed=BigInt(value);need(parsed<=BigInt(Number.MAX_SAFE_INTEGER),'An asset byte size exceeds the exact integer limit.');return Number(parsed);}
  need(value===null||integer(value),'An asset byte size is not an exact nonnegative integer.');return value;
}
function parseFile(value){
  need(record(value),'An inventory file entry is invalid.');validateClipWeaveRelativePath(value.path);
  need(typeof value.role==='string'&&/^[a-z][a-z0-9_]{0,79}$/u.test(value.role)&&typeof value.required==='boolean'&&(value.series_id===null||identifier(value.series_id)),'An inventory file role, owner or required flag is invalid.');
  const size=safeSize(value.size_bytes);need(value.sha256===null||digest(value.sha256),'An asset checksum must be SHA-256 or null.');
  return{...value,size_bytes:size,sha256:typeof value.sha256==='string'?value.sha256.toLowerCase():null};
}
function parseSeries(value){
  need(record(value)&&identifier(value.source_id)&&(identifier(value.series_key)||integer(value.series_key))&&integer(value.order),'A source-series identity or order is invalid.');
  need(typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=4000&&typeof value.upload_ready==='boolean'&&typeof value.clips_complete==='boolean'&&strings(value.reasons)&&typeof value.metadata_requested==='boolean'&&typeof value.cover_requested==='boolean','A source-series readiness record is invalid.');
  if(value.upload_ready)need((value.expected_clip_count===null||integer(value.expected_clip_count))&&(value.actual_clip_count===null||integer(value.actual_clip_count))&&(value.source_duration===null||finite(value.source_duration)&&value.source_duration>0),'A ready source-series count or duration is invalid.');
  need((!value.upload_ready&&value.clips==null)||Array.isArray(value.clips)&&value.clips.length<=1000,'A source-series clip list is invalid.');
  return{...value,expected_clip_count:integer(value.expected_clip_count)?value.expected_clip_count:null,actual_clip_count:integer(value.actual_clip_count)?value.actual_clip_count:null,source_duration:finite(value.source_duration)&&value.source_duration>0?value.source_duration:null,clips:(value.clips??[]).map(clip=>{need(record(clip),'A clip record is invalid.');return{...clip};})};
}
function noCollisions(files){
  const exact=new Set(),canonical=new Set();
  for(const file of files){const key=normalizedPath(file.path);need(!exact.has(file.path)&&!canonical.has(key),'Inventory paths duplicate or collide.','CLIPWEAVE_PATH_AMBIGUOUS');exact.add(file.path);canonical.add(key);}
  for(const path of canonical){const parts=path.split('/');for(let n=1;n<parts.length;n++)need(!canonical.has(parts.slice(0,n).join('/')),'An inventory file collides with a parent directory.','CLIPWEAVE_PATH_AMBIGUOUS');}
}
function requiredAssetsComplete(files){
  for(const file of files)need(file.size_bytes!==null&&file.size_bytes>0&&digest(file.sha256)&&(file.issue===undefined||file.issue===null||file.issue===''),'A required asset has a missing-file issue, byte length or checksum.','CLIPWEAVE_FILES_PENDING','WAIT');
}
export function clipWeaveRequiredFiles(manifest,series){
  const sourceId=typeof series==='string'?series:series.source_id;
  need(manifest.series.some(item=>item.source_id===sourceId),'The source is not in this export.');
  return manifest.files.filter(file=>file.required&&(file.series_id===sourceId||file.series_id===null));
}
function validateReadySeries(manifest,series){
  need(series.clips.every(clip=>integer(clip.index)&&clip.index>=1&&clip.index<=1000),'Clip indexes must be exact positive integers.','CLIPWEAVE_CLIP_ORDER');
  series={...series,clips:[...series.clips].sort((a,b)=>a.index-b.index)};
  need(series.clips_complete&&integer(series.expected_clip_count)&&series.expected_clip_count>=1&&series.expected_clip_count<=1000&&series.actual_clip_count===series.expected_clip_count&&series.clips.length===series.expected_clip_count,'A ready source does not have its complete expected clip count.','CLIPWEAVE_CLIPS_INCOMPLETE');
  need(finite(series.source_duration)&&series.source_duration>0,'A ready source has no known duration.','CLIPWEAVE_CLIPS_INCOMPLETE');
  const required=clipWeaveRequiredFiles(manifest,series);requiredAssetsComplete(required);
  const byPath=new Map(required.map(file=>[file.path,file]));const used=new Set();let previous;
  for(let n=0;n<series.clips.length;n++){
    const clip=series.clips[n];need(clip.index===n+1,'Clip indexes must be consecutive in manifest order.','CLIPWEAVE_CLIP_ORDER');validateClipWeaveRelativePath(clip.file);
    const asset=byPath.get(clip.file);need(asset&&asset.role==='clip'&&asset.series_id===series.source_id&&/\.mp4$/iu.test(asset.path)&&!used.has(asset.path),'A clip does not have one required owned MP4 asset.','CLIPWEAVE_CLIP_MAPPING');used.add(asset.path);
    need(finite(clip.source_start)&&finite(clip.source_end)&&finite(clip.duration)&&(typeof clip.overlap_previous==='boolean'||finite(clip.overlap_previous)&&clip.overlap_previous>=0)&&clip.source_start>=0&&clip.source_end>clip.source_start&&clip.duration>0&&Math.abs(clip.source_end-clip.source_start-clip.duration)<=EPSILON&&clip.source_end<=series.source_duration+EPSILON,'Clip source timing is invalid.','CLIPWEAVE_CLIP_TIMING');
    if(!previous)need(clip.source_start<=EPSILON&&overlapMatches(clip.overlap_previous,0),'Source coverage must start at zero.','CLIPWEAVE_CLIP_TIMING');
    else{const overlap=Math.max(0,previous.source_end-clip.source_start);need(clip.source_start<=previous.source_end+EPSILON&&clip.source_start>previous.source_start&&clip.source_end>previous.source_end&&overlapMatches(clip.overlap_previous,overlap),'Clip coverage has a gap or an incorrect overlap.','CLIPWEAVE_CLIP_TIMING');}
    for(const [field,role]of [['subtitle_srt','clip_caption_srt'],['subtitle_ass','clip_caption_ass']])if(clip[field]!==undefined&&clip[field]!==null&&clip[field]!==''){
      validateClipWeaveRelativePath(clip[field]);const caption=byPath.get(clip[field]);need(caption&&caption.role===role&&caption.series_id===series.source_id,'A referenced caption is not a required owned asset.','CLIPWEAVE_CAPTION_MAPPING');
    }
    previous=clip;
  }
  need(Math.abs(previous.source_end-series.source_duration)<=EPSILON,'Clip source coverage does not reach the source end.','CLIPWEAVE_CLIP_TIMING');
  need(required.filter(file=>file.role==='clip'&&file.series_id===series.source_id).length===used.size,'Required episode assets are missing from the clip index.','CLIPWEAVE_CLIP_MAPPING');
  const covers=required.filter(file=>file.series_id===series.source_id&&file.role==='series_cover'),metadata=required.filter(file=>file.series_id===series.source_id&&file.role==='series_metadata');
  need(covers.length<=1&&metadata.length<=1,'A series has ambiguous primary cover or metadata assets.','CLIPWEAVE_PATH_AMBIGUOUS');
  need(!series.cover_requested||covers.length===1,'A requested cover is missing from the required inventory.','CLIPWEAVE_FILES_PENDING','WAIT');
  need(!series.metadata_requested||metadata.length===1,'Requested series metadata is missing from the required inventory.','CLIPWEAVE_FILES_PENDING','WAIT');
  return series;
}
/** Exact raw bytes are authenticated before decoding or parsing the manifest.
 * JSON whitespace/BOM/newline changes therefore cannot be silently repaired. */
export function verifyClipWeaveManifest(seal,raw){
  const bytes=bytesOf(raw,CLIPWEAVE_MAX_MANIFEST_BYTES,'Upload manifest');
  need(bytes.byteLength===seal.manifest_size_bytes&&hash(bytes)===seal.manifest_sha256,'The upload manifest does not match the finalized seal.','CLIPWEAVE_SEAL_MISMATCH');
  const value=parseBytes(bytes,'Upload manifest');provenance(value,'Upload manifest');finished(value,'Upload manifest');
  need(value.export_id===seal.export_id,'The seal and manifest identify different export snapshots.','CLIPWEAVE_SEAL_MISMATCH');
  need(value.operation==='process','Only process exports can become drama episodes.','CLIPWEAVE_OPERATION_UNSUPPORTED');
  need(value.completeness_scope==='generated_export'&&(value.original_series_complete===null||typeof value.original_series_complete==='boolean'),'The manifest has no supported completeness scope.');
  need(typeof value.batch_upload_ready==='boolean'&&value.batch_upload_ready===seal.batch_upload_ready&&strings(value.global_reasons),'Batch readiness does not match the seal.');
  need(Array.isArray(value.series)&&value.series.length>=1&&value.series.length<=1000&&Array.isArray(value.files)&&value.files.length>=1&&value.files.length<=20000,'The export inventory is missing or too large.');
  const manifest={...value,series:value.series.map(parseSeries),files:value.files.map(parseFile)};
  const identities=new Set(),orders=new Set();
  for(const series of manifest.series){need(!identities.has(series.source_id)&&!orders.has(series.order),'Source identities or orders repeat.');identities.add(series.source_id);orders.add(series.order);}
  for(const file of manifest.files)need(file.series_id===null||identities.has(file.series_id),'An inventory asset belongs to an unknown source.');
  noCollisions(manifest.files);
  const batch=manifest.files.filter(file=>file.path==='batch.json');need(batch.length===1&&batch[0].required&&batch[0].series_id===null&&batch[0].role==='batch_manifest','batch.json must be a checksummed shared required asset.');
  need(seal.ready_series_ids.every(id=>identities.has(id)),'The seal names an unknown ready source.');
  for(const series of manifest.series)if(seal.ready_series_ids.includes(series.source_id))need(series.upload_ready&&series.reasons.length===0,'The seal marks an unready source as ready.');
  if(manifest.batch_upload_ready)need(manifest.global_reasons.length===0&&manifest.series.every(series=>series.upload_ready&&series.reasons.length===0&&seal.ready_series_ids.includes(series.source_id)),'A fully ready batch contains unready sources.');
  const selected=selectReadyClipWeaveSeries({seal,manifest,manifestSha256:seal.manifest_sha256}),ordered=new Map(selected.map(series=>[series.source_id,series]));
  manifest.series=manifest.series.map(series=>ordered.get(series.source_id)||series);
  return manifest;
}
export function parseClipWeaveExport(sealRaw,manifestRaw){const seal=parseClipWeaveSeal(sealRaw),manifest=verifyClipWeaveManifest(seal,manifestRaw);return{seal,manifest,manifestSha256:seal.manifest_sha256};}
export function selectReadyClipWeaveSeries(exported){
  const selected=exported.manifest.series.filter(series=>series.upload_ready&&series.reasons.length===0&&exported.seal.ready_series_ids.includes(series.source_id)).sort((a,b)=>a.order-b.order);
  return selected.map(series=>validateReadySeries(exported.manifest,series));
}
export function clipWeaveSourceIdentity(exportId,sourceId){need(identifier(exportId)&&identifier(sourceId),'An import source identity is invalid.');return'clipweave:'+hash(new TextEncoder().encode(JSON.stringify([exportId,sourceId])));}
