import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyClipWeaveExport} from '../scripts/verify-clipweave-export.mjs';
import {parseClipWeaveExport,selectReadyClipWeaveSeries} from '../shared/clipweave-export';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const cli=path.resolve('scripts/verify-clipweave-export.mjs'),legacy=path.resolve('scripts/create-drive-manifests.mjs');
const execute=(script:string,args:string[])=>promisify(execFile)(process.execPath,[script,...args],{timeout:15000,maxBuffer:1024*1024});
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void},{partial=false}={}){
  const directory=await mkdtemp(path.join(tmpdir(),'lingying-clipweave-local-')),root=path.join(directory,'ClipWeave_test');await mkdir(root);
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const files:any[]=[],bodies=new Map<string,Buffer>(),source='source-one';
  const asset=(relative:string,role:string,owner:string|null,bytes:Buffer|string)=>{const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);files.push({path:relative,role,series_id:owner,required:true,size_bytes:body.length,sha256:sha(body)});bodies.set(relative,body);return relative;};
  const first=asset('001_clips/01_故事/故事_001.mp4','clip',source,'original first video bytes'),second=asset('001_clips/01_故事/故事_002.mp4','clip',source,'original second video bytes');
  const caption=asset('001_clips/editable_captions/01_故事/故事_001.srt','clip_caption_srt',source,'1\n00:00:00,000 --> 00:00:01,000\nOriginal subtitle\n');
  asset('batch.json','batch_manifest',null,'{"finished":true}');asset('001_clips/export.json','source_manifest',source,'{"exported":true}');
  asset('EXPORT_SUMMARY.txt','human_summary',null,'Generated export finalized. Original story completeness remains unknown.');
  asset('series_metadata/001/title_and_summary.json','series_metadata',source,'{"title":"A real title","summary":"A real synopsis for review."}');
  asset('series_covers/source-one/series_cover_1080x1920.png','series_cover',source,'original cover image bytes');
  asset('downloads/source_backup.mp4','original_download',source,'full source backup, never an extra episode');
  asset('001_clips/full_english.srt','full_transcript',source,'Original full transcript');
  const series:any[]=[{source_id:source,series_key:'001',order:1,name:'A generated export',source_url:'https://example.test/source',source_duration:10,expected_clip_count:2,actual_clip_count:2,clips_complete:true,upload_ready:true,reasons:[],metadata_requested:true,cover_requested:true,clips:[{index:1,file:first,source_start:0,source_end:6,duration:6,overlap_previous:0,subtitle_srt:caption},{index:2,file:second,source_start:5,source_end:10,duration:5,overlap_previous:1}]}];
  if(partial)series.push({source_id:'source-failed',series_key:'002',order:2,name:'Failed sibling',source_duration:10,expected_clip_count:2,actual_clip_count:0,clips_complete:false,upload_ready:false,reasons:['The source export failed.'],metadata_requested:false,cover_requested:false,clips:[]});
  const manifest:any={schema_version:1,app:'ClipWeave',export_id:'export-local-fixture',operation:'process',status:partial?'completed_with_errors':'completed',finished_at:'2026-11-15T12:00:00Z',batch_upload_ready:!partial,global_reasons:partial?['One source failed.']:[],completeness_scope:'generated_export',original_series_complete:null,series,files};
  const seal:any={schema_version:1,app:'ClipWeave',export_id:manifest.export_id,manifest:'upload_manifest.json',text_summary:'EXPORT_SUMMARY.txt',batch_upload_ready:!partial,ready_series_ids:[source],status:'completed',finished_at:'2026-11-15T12:00:01Z'};
  const saveSeal=async()=>{const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');Object.assign(seal,{manifest_size_bytes:bytes.length,manifest_sha256:sha(bytes)});await writeFile(path.join(root,'upload_manifest.json'),bytes);await writeFile(path.join(root,'EXPORT_FINALIZED.json'),JSON.stringify(seal,null,2));};
  for(const[relative,body]of bodies){await mkdir(path.dirname(path.join(root,relative)),{recursive:true});await writeFile(path.join(root,relative),body);}await saveSeal();
  return{directory,root,manifest,seal,bodies,saveSeal};
}
async function snapshot(root:string):Promise<Record<string,string>>{
  const output:Record<string,string>={};
  async function visit(folder:string,prefix=''){for(const entry of await readdir(folder,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())await visit(path.join(folder,entry.name),relative+'/');else if(entry.isFile())output[relative]=sha(await readFile(path.join(folder,entry.name)));}}
  await visit(root);return output;
}

test('nested sealed exports verify every required role without changing source bytes or claiming original-story completeness',async t=>{
  const source=await fixture(t),before=await snapshot(source.root),report=await verifyClipWeaveExport(source.root);
  assert.equal(report.state,'READY');assert.equal(report.generatedExportIntact,true);assert.equal(report.batchReady,true);assert.equal(report.originalSeriesComplete,null);assert.equal(report.originalStoryCompletenessVerified,false);assert.equal(report.remoteDriveVerified,false);assert.equal(report.mediaProbed,false);
  assert.equal(report.series[0].clipCount,2);assert.equal(report.series[0].expectedFiles,source.manifest.files.length);assert.equal(report.series[0].verifiedFiles,source.manifest.files.length);assert.equal(report.series[0].requiredAssetsIntact,true);
  assert.equal(report.writesPerformed,false);assert.equal(report.uploadsPerformed,false);assert.deepEqual(await snapshot(source.root),before);
  const parsed=parseClipWeaveExport(await readFile(path.join(source.root,'EXPORT_FINALIZED.json')),await readFile(path.join(source.root,'upload_manifest.json')));
  assert.deepEqual(report.series.map((item:any)=>item.sourceId),selectReadyClipWeaveSeries(parsed).map(item=>item.source_id));
});
test('a seal arriving before the last video never proves readiness',async t=>{
  const source=await fixture(t);await rm(path.join(source.root,source.manifest.series[0].clips[1].file));const before=await snapshot(source.root),report=await verifyClipWeaveExport(source.root);
  assert.equal(report.state,'WAIT');assert.equal(report.generatedExportIntact,false);assert.ok(report.series[0].errors.some((error:any)=>error.code==='ASSET_PENDING'));assert.deepEqual(await snapshot(source.root),before);
});
test('one-byte same-size corruption is rejected even when every filename and size exists',async t=>{
  const source=await fixture(t),relative=source.manifest.series[0].clips[0].file,body=Buffer.from(source.bodies.get(relative)!);body[0]^=1;await writeFile(path.join(source.root,relative),body);
  const report=await verifyClipWeaveExport(source.root);assert.equal(report.state,'REJECT');assert.equal(report.series[0].errors[0].code,'ASSET_CHECKSUM_MISMATCH');assert.equal(report.series[0].requiredAssetsIntact,false);
});
test('a differently cased filename is not substituted for the exact declared Unicode path',async t=>{
  const source=await fixture(t),old=source.manifest.series[0].clips[0].file;
  source.manifest.series[0].clips[0].file=old.replace('.mp4','.MP4');source.manifest.files.find((file:any)=>file.path===old).path=source.manifest.series[0].clips[0].file;await source.saveSeal();
  assert.equal((await verifyClipWeaveExport(source.root)).state,'WAIT');
});
test('captions, covers, metadata, transcripts and backups are verified rather than just counting MP4s',async t=>{
  for(const role of ['clip_caption_srt','series_cover','series_metadata','full_transcript','original_download','batch_manifest']){
    const source=await fixture(t),asset=source.manifest.files.find((file:any)=>file.role===role);await rm(path.join(source.root,asset.path));const report=await verifyClipWeaveExport(source.root);
    assert.equal(report.state,'WAIT',role);assert.ok(report.series[0].errors.some((error:any)=>error.path===asset.path),role);
  }
});
test('raw manifest whitespace, BOM and newline changes fail seal verification before any readiness claim',async t=>{
  for(const added of ['\n','\ufeff']){
    const source=await fixture(t),manifestPath=path.join(source.root,'upload_manifest.json');await writeFile(manifestPath,added+await readFile(manifestPath,'utf8'));const report=await verifyClipWeaveExport(source.root);
    assert.equal(report.state,'REJECT');assert.equal(report.errors[0].code,'CLIPWEAVE_SEAL_MISMATCH');assert.equal(report.generatedExportIntact,false);
  }
});
test('healthy series in a finished partial batch remain distinguishable from whole-batch readiness',async t=>{
  const source=await fixture(t,{partial:true}),report=await verifyClipWeaveExport(source.root);
  assert.equal(report.state,'PARTIAL');assert.equal(report.batchReady,false);assert.equal(report.generatedExportIntact,false);assert.equal(report.series.length,1);assert.equal(report.series[0].state,'READY');assert.equal(report.series[0].requiredAssetsIntact,true);
  assert.equal((await verifyClipWeaveExport(source.root,{seriesId:'source-one'})).state,'READY');
  assert.equal((await verifyClipWeaveExport(source.root,{wholeBatch:true})).state,'WAIT');
  assert.equal((await verifyClipWeaveExport(source.root,{seriesId:'source-failed'})).state,'WAIT');
});
test('malicious paths, duplicate inventory entries, wrong indexes and timing gaps reject sealed data',async t=>{
  for(const change of [
    (s:any)=>{s.manifest.files[0].path='../outside.mp4';s.manifest.series[0].clips[0].file='../outside.mp4';},
    (s:any)=>s.manifest.files.push({...s.manifest.files[0]}),
    (s:any)=>{s.manifest.series[0].clips[1].index=3;},
    (s:any)=>{s.manifest.series[0].clips[1].source_start=7;s.manifest.series[0].clips[1].duration=3;s.manifest.series[0].clips[1].overlap_previous=0;},
  ]){const source=await fixture(t);change(source);await source.saveSeal();assert.equal((await verifyClipWeaveExport(source.root)).state,'REJECT');}
});
test('symbolic-link files and nested linked directories cannot escape the chosen export tree',async t=>{
  for(const linkDirectory of [false,true]){
    const source=await fixture(t),relative=source.manifest.series[0].clips[0].file,original=path.join(source.root,relative);
    if(linkDirectory){const inner=path.dirname(original),outside=path.join(source.directory,'outside');await mkdir(outside);await writeFile(path.join(outside,path.basename(original)),source.bodies.get(relative)!);await rm(inner,{recursive:true});await symlink(outside,inner);}
    else{const outside=path.join(source.directory,'outside.mp4');await writeFile(outside,source.bodies.get(relative)!);await rm(original);await symlink(outside,original);}
    const report=await verifyClipWeaveExport(source.root);assert.equal(report.state,'REJECT');assert.ok(report.series[0].errors.some((error:any)=>error.code==='UNSAFE_EXPORT_PATH'));
  }
});
test('missing root controls and stopped checksum preparation never become ready',async t=>{
  const missing=await fixture(t);await rm(path.join(missing.root,'EXPORT_SUMMARY.txt'));assert.equal((await verifyClipWeaveExport(missing.root)).state,'WAIT');
  const stopped=await fixture(t);stopped.seal.status='cancelled';await stopped.saveSeal();assert.equal((await verifyClipWeaveExport(stopped.root)).state,'WAIT');
});
test('standalone CLI returns a read-only report and meaningful pending/corrupt exit codes',async t=>{
  const source=await fixture(t),before=await snapshot(source.root),good=JSON.parse((await execute(cli,[source.root])).stdout);assert.equal(good.state,'READY');assert.deepEqual(await snapshot(source.root),before);
  await rm(path.join(source.root,source.manifest.series[0].clips[1].file));await assert.rejects(execute(cli,[source.root]),(error:any)=>error.code===2&&JSON.parse(error.stdout).state==='WAIT');
  assert.match((await execute(cli,['--help'])).stdout,/Local verification alone cannot prove Google Drive finished syncing/);
  await assert.rejects(execute(cli,['--not-supported']),(error:any)=>error.code===1&&JSON.parse(error.stderr).state==='REJECT');
});
test('legacy generator cannot mark sealed or older unsealed ClipWeave folders ready',async t=>{
  const source=await fixture(t),clips=path.join(source.root,'001_clips'),oldMarker=path.join(clips,'lingying-ready.json');await writeFile(oldMarker,'{"manually":"retained"}');
  for(const target of [source.root,clips])await assert.rejects(execute(legacy,[target]),(error:any)=>/ClipWeave export/.test(error.stderr||error.stdout));
  assert.equal(await readFile(oldMarker,'utf8'),'{"manually":"retained"}');
  const old=path.join(source.directory,'ClipWeave_unsealed','001_clips');await mkdir(old,{recursive:true});await writeFile(path.join(old,'001.mp4'),'unsealed exported clip');await assert.rejects(execute(legacy,[old]));await assert.rejects(readFile(path.join(old,'lingying-ready.json')),{code:'ENOENT'});
});
