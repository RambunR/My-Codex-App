#!/usr/bin/env node
// Read-only local verification. The downloadable build bundles the same shared
// contract as the Drive importer; no account, upload or media conversion occurs.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import {lstat,open,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {parseClipWeaveExport,selectReadyClipWeaveSeries,clipWeaveRequiredFiles,validateClipWeaveRelativePath,MAX_CLIPWEAVE_MANIFEST_BYTES,MAX_CLIPWEAVE_SEAL_BYTES} from '../shared/clipweave-export-core.mjs';

const CONTROLS=['EXPORT_SUMMARY.txt','upload_manifest.json','EXPORT_FINALIZED.json'];
class LocalVerificationError extends Error {
  constructor(state,code,message){super(message);this.name='LocalVerificationError';this.state=state;this.code=code;}
}
const fail=(state,code,message)=>{throw new LocalVerificationError(state,code,message);};
const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
const directoryIdentity=stat=>[stat.dev,stat.ino].join(':');
function fault(error){
  if(error?.state==='WAIT'||error?.state==='REJECT')return{state:error.state,code:String(error.code||'INVALID_EXPORT'),message:String(error.message||'The export could not be verified.')};
  if(String(error?.code||'').startsWith('ERR_PARSE_ARGS_'))return{state:'REJECT',code:'INVALID_INPUT',message:'A command option is unknown or malformed. Use --help for details.'};
  if(error?.code==='ENOENT'||error?.code==='ENOTDIR')return{state:'WAIT',code:'ASSET_PENDING',message:'An expected export file or directory is not present yet.'};
  if(error?.code==='EACCES'||error?.code==='EPERM')return{state:'REJECT',code:'LOCAL_ACCESS_DENIED',message:'The verifier cannot read an expected export file.'};
  return{state:'WAIT',code:'LOCAL_IO_UNAVAILABLE',message:'An export file could not be read consistently. Finish copying and try again.'};
}
async function resolveFile(root,relative){
  validateClipWeaveRelativePath(relative);
  const components=relative.split('/'),parents=[];let current=root;
  const rootStat=await lstat(root,{bigint:true});
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('REJECT','UNSAFE_EXPORT_PATH','The export root must be a real directory, not a symbolic link.');
  parents.push({path:root,identity:directoryIdentity(rootStat)});
  for(let index=0;index<components.length;index++){
    // Explicit comparison is needed on case-insensitive Windows/macOS disks.
    // lstat alone may resolve a differently spelled inventory component.
    const names=await readdir(current);
    if(!names.includes(components[index]))fail('WAIT','ASSET_PENDING','An exact expected export path component is not present yet.');
    current=path.join(current,components[index]);const stat=await lstat(current,{bigint:true});
    if(stat.isSymbolicLink())fail('REJECT','UNSAFE_EXPORT_PATH','Symbolic links are not accepted in an export path.');
    if(index<components.length-1){if(!stat.isDirectory())fail('REJECT','UNSAFE_EXPORT_PATH','An export path component is not a directory.');parents.push({path:current,identity:directoryIdentity(stat)});}
    else{if(!stat.isFile())fail('REJECT','UNSAFE_EXPORT_PATH','An expected export asset must be a regular file.');return{absolute:current,relative,identity:identity(stat),size:stat.size,parents};}
  }
  fail('REJECT','UNSAFE_EXPORT_PATH','An export asset path is empty.');
}
async function assertStable(descriptor){
  for(const parent of descriptor.parents){const stat=await lstat(parent.path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||directoryIdentity(stat)!==parent.identity)fail('WAIT','EXPORT_CHANGED','An export directory changed during verification. Try again after copying finishes.');}
  const stat=await lstat(descriptor.absolute,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||identity(stat)!==descriptor.identity)fail('WAIT','EXPORT_CHANGED','An export file changed during verification. Try again after copying finishes.');
}
async function readControl(root,name,maxBytes){
  const descriptor=await resolveFile(root,name);
  if(descriptor.size===0n)fail('WAIT','CONTROL_PENDING','An export control file is empty and may still be copying.');
  if(descriptor.size>BigInt(maxBytes))fail('REJECT','CONTROL_TOO_LARGE','An export control file exceeds its safe verification limit.');
  const handle=await open(descriptor.absolute,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  try{
    const before=await handle.stat({bigint:true});if(!before.isFile()||identity(before)!==descriptor.identity)fail('WAIT','EXPORT_CHANGED','An export control file changed while opening.');
    const chunks=[];let total=0;
    for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:64*1024})){total+=chunk.length;if(total>maxBytes)fail('REJECT','CONTROL_TOO_LARGE','An export control file grew beyond its safe verification limit.');chunks.push(chunk);}
    if(BigInt(total)!==descriptor.size||identity(await handle.stat({bigint:true}))!==descriptor.identity)fail('WAIT','EXPORT_CHANGED','An export control file changed while reading.');
    await assertStable(descriptor);return{bytes:Buffer.concat(chunks,total),descriptor};
  }finally{await handle.close();}
}
async function hashAsset(root,asset){
  const descriptor=await resolveFile(root,asset.path),expected=BigInt(asset.size_bytes);
  if(descriptor.size!==expected)fail('WAIT','ASSET_SIZE_PENDING','An expected file size does not match yet. Finish the copy or Drive sync before retrying.');
  const handle=await open(descriptor.absolute,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  try{
    const before=await handle.stat({bigint:true});if(!before.isFile()||identity(before)!==descriptor.identity)fail('WAIT','EXPORT_CHANGED','An export file changed while opening.');
    const hash=createHash('sha256');let bytes=0n;
    for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:64*1024})){bytes+=BigInt(chunk.length);if(bytes>expected)fail('WAIT','EXPORT_CHANGED','An export file grew while hashing.');hash.update(chunk);}
    if(bytes!==expected||identity(await handle.stat({bigint:true}))!==descriptor.identity)fail('WAIT','EXPORT_CHANGED','An export file changed while hashing.');
    await assertStable(descriptor);
    if(hash.digest('hex')!==asset.sha256.toLowerCase())fail('REJECT','ASSET_CHECKSUM_MISMATCH','A required asset does not match its declared SHA-256 checksum.');
    return descriptor;
  }finally{await handle.close();}
}

/** This verifies bytes present at the supplied local folder. If that folder is
 * a Drive desktop mirror, it still does not independently attest remote sync. */
export async function verifyClipWeaveExport(folder,{seriesId,wholeBatch=false}={}){
  const root=path.resolve(folder),report={format:'ClipWeave',state:'WAIT',exportId:null,manifestSha256:null,generatedExportIntact:false,originalSeriesComplete:null,reportedOriginalSeriesComplete:null,originalStoryCompletenessVerified:false,batchReady:false,series:[],errors:[],sourceMediaChanged:false,writesPerformed:false,uploadsPerformed:false,mediaProbed:false,remoteDriveVerified:false};
  try{
    const controls=new Map();
    for(const name of CONTROLS)controls.set(name,await readControl(root,name,name==='EXPORT_FINALIZED.json'?MAX_CLIPWEAVE_SEAL_BYTES:MAX_CLIPWEAVE_MANIFEST_BYTES));
    const parsed=parseClipWeaveExport(controls.get('EXPORT_FINALIZED.json').bytes,controls.get('upload_manifest.json').bytes);
    const {seal,manifest}=parsed;
    report.exportId=manifest.export_id;report.manifestSha256=parsed.manifestSha256;
    // Retain the producer's statement, without converting it into a verification
    // of the original story. Only the declared generated export is checked here.
    report.reportedOriginalSeriesComplete=manifest.original_series_complete;
    const ready=selectReadyClipWeaveSeries(parsed),selected=seriesId===undefined?ready:ready.filter(series=>series.source_id===seriesId);
    if(seriesId!==undefined&&!manifest.series.some(series=>series.source_id===seriesId))fail('REJECT','UNKNOWN_SERIES','The requested source ID is not listed in this sealed export.');
    if(!selected.length)fail('WAIT','NO_READY_SERIES','The sealed export has no selected series ready for import.');
    const checked=new Map(),descriptors=[];
    for(const series of selected){
      const assets=clipWeaveRequiredFiles(manifest,series),item={sourceId:series.source_id,name:series.name,state:'READY',requiredAssetsIntact:false,clipCount:series.expected_clip_count,expectedFiles:assets.length,verifiedFiles:0,errors:[]};
      for(const asset of assets){
        let result=checked.get(asset.path);
        if(!result){try{const descriptor=await hashAsset(root,asset);descriptors.push(descriptor);result={verified:true};}catch(error){result={verified:false,...fault(error)};}checked.set(asset.path,result);}
        if(result.verified)item.verifiedFiles++;
        else{item.errors.push({path:asset.path,...result});if(result.state==='REJECT'||item.state!=='REJECT')item.state=result.state;}
      }
      item.requiredAssetsIntact=item.state==='READY';report.series.push(item);
    }
    for(const descriptor of descriptors)await assertStable(descriptor);
    for(const [name,original] of controls){const current=await readControl(root,name,name==='EXPORT_FINALIZED.json'?MAX_CLIPWEAVE_SEAL_BYTES:MAX_CLIPWEAVE_MANIFEST_BYTES);if(current.descriptor.identity!==original.descriptor.identity||!current.bytes.equals(original.bytes))fail('WAIT','EXPORT_CHANGED','A seal, manifest or summary changed during verification. Restart verification of the new snapshot.');}
    const allVerified=report.series.every(series=>series.state==='READY');
    report.batchReady=seal.batch_upload_ready===true&&manifest.batch_upload_ready===true&&ready.length===manifest.series.length&&allVerified&&selected.length===manifest.series.length;
    report.generatedExportIntact=report.batchReady;
    if(wholeBatch&&!report.batchReady){report.state=report.series.some(series=>series.state==='REJECT')?'REJECT':'WAIT';report.errors.push({state:report.state,code:'BATCH_NOT_READY',message:'The complete batch is not ready. Healthy individual series can be verified separately.'});}
    else if(seriesId!==undefined)report.state=report.series[0].state;
    else if(report.batchReady)report.state='READY';
    else if(report.series.some(series=>series.state==='READY'))report.state='PARTIAL';
    else report.state=report.series.some(series=>series.state==='REJECT')?'REJECT':'WAIT';
    return report;
  }catch(error){const issue=fault(error);report.state=issue.state;report.errors.push(issue);return report;}
}

export async function main(args=process.argv.slice(2)){
  const{values,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{help:{type:'boolean'},series:{type:'string'},'whole-batch':{type:'boolean'}}});
  if(values.help){console.log('Usage: node verify-clipweave-export.mjs <ClipWeave-export-folder> [--series source_id] [--whole-batch]\n\nRequires Node 18+. Reads the original EXPORT_FINALIZED.json, upload_manifest.json and EXPORT_SUMMARY.txt, checks every required nested asset by exact path, size and SHA-256, and prints a JSON report. No file, video, seal, manifest or account is changed. READY means selected generated-export bytes are intact, not that the original story is complete. Local verification alone cannot prove Google Drive finished syncing. Exit codes: 0 READY, 2 WAIT/PARTIAL, 1 REJECT.');return;}
  if(positionals.length!==1)throw new LocalVerificationError('REJECT','INVALID_INPUT','Provide one sealed ClipWeave export folder. Use --help for details.');
  if(values.series!==undefined&&values['whole-batch'])throw new LocalVerificationError('REJECT','INVALID_INPUT','Choose either one source ID or the whole batch.');
  const report=await verifyClipWeaveExport(positionals[0],{seriesId:values.series,wholeBatch:values['whole-batch']===true});console.log(JSON.stringify(report,null,2));process.exitCode=report.state==='READY'?0:report.state==='REJECT'?1:2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({state:'REJECT',...fault(error),sourceMediaChanged:false,writesPerformed:false,uploadsPerformed:false}));process.exitCode=1;});
