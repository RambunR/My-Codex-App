import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseClipWeaveSeal,parseClipWeaveExport,selectReadyClipWeaveSeries,clipWeaveRequiredFiles,clipWeaveSourceIdentity,validateClipWeaveRelativePath,ClipWeaveValidationError,type ClipWeaveManifest} from '../shared/clipweave-export';

// Deliberately synthetic contract fixtures; not an actual producer export.
const checksum=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const finished='2026-11-15T10:00:00Z',digest='a'.repeat(64);
function asset(path:string,role:string,series_id:string|null='source-one',required=true){return{path,role,series_id,required,size_bytes:10,sha256:digest};}
function fixture():any{return{schema_version:1,app:'ClipWeave',export_id:'export-one',operation:'process',status:'completed',finished_at:finished,batch_upload_ready:true,global_reasons:[],completeness_scope:'generated_export',original_series_complete:null,series:[{source_id:'source-one',series_key:'001',order:1,name:'An exported short drama',source_url:'https://source.example.test/reference-only',source_duration:18,expected_clip_count:2,actual_clip_count:2,clips_complete:true,upload_ready:true,reasons:[],metadata_requested:false,cover_requested:false,clips:[{index:1,file:'001_clips/01_Source/Source_001.mp4',source_start:0,source_end:10,duration:10,overlap_previous:0},{index:2,file:'001_clips/01_Source/Source_002.mp4',source_start:8,source_end:18,duration:10,overlap_previous:2}]}],files:[asset('batch.json','batch_manifest',null),asset('001_clips/export.json','source_manifest'),asset('001_clips/01_Source/Source_001.mp4','clip'),asset('001_clips/01_Source/Source_002.mp4','clip')]};}
function sealed(manifest=fixture(),raw=Buffer.from(JSON.stringify(manifest))){const seal={schema_version:1,app:'ClipWeave',export_id:manifest.export_id,manifest:'upload_manifest.json',manifest_size_bytes:raw.length,manifest_sha256:checksum(raw),text_summary:'EXPORT_SUMMARY.txt',batch_upload_ready:manifest.batch_upload_ready,ready_series_ids:manifest.series.filter((series:any)=>series.upload_ready&&series.reasons.length===0).map((series:any)=>series.source_id),status:'finalized',finished_at:'2026-11-15T10:00:05Z'};return{manifest,raw,seal,sealRaw:Buffer.from(JSON.stringify(seal))};}
function parsed(manifest=fixture()){const sample=sealed(manifest);return parseClipWeaveExport(sample.sealRaw,sample.raw);}
function rejects(action:()=>unknown,code?:string,state?:string){assert.throws(action,(error:unknown)=>error instanceof ClipWeaveValidationError&&(!code||error.code===code)&&(!state||error.state===state));}

test('exact raw manifest bytes are sealed before JSON decoding; BOM and later seal timestamp are supported without changing bytes',()=>{
  const sample=sealed();const result=parseClipWeaveExport(sample.sealRaw,sample.raw);assert.equal(result.manifestSha256,checksum(sample.raw));assert.equal(result.manifest.original_series_complete,null);assert.equal(result.seal.finished_at,'2026-11-15T10:00:05Z');
  for(const changed of [Buffer.concat([sample.raw,Buffer.from('\n')]),Buffer.from(sample.raw.toString().replace('export-one','export-two')),Buffer.concat([Buffer.from([239,187,191]),sample.raw])])rejects(()=>parseClipWeaveExport(sample.sealRaw,changed),'CLIPWEAVE_SEAL_MISMATCH');
  const bom=sealed(sample.manifest,Buffer.concat([Buffer.from([239,187,191]),sample.raw]));assert.equal(parseClipWeaveExport(bom.sealRaw,bom.raw).manifest.export_id,'export-one');
  const broken=Buffer.from(sample.raw);broken[0]=33;rejects(()=>parseClipWeaveExport(sample.sealRaw,broken),'CLIPWEAVE_SEAL_MISMATCH');
});
test('app, schema, export identity and process operation are explicit import boundaries',()=>{
  for(const values of [{schema_version:2},{app:'OtherExporter'},{operation:'download'},{completeness_scope:'original_series'},{original_series_complete:'unknown'}])rejects(()=>parsed({...fixture(),...values}));
  const sample=sealed();sample.seal.export_id='another-export';rejects(()=>parseClipWeaveExport(JSON.stringify(sample.seal),sample.raw),'CLIPWEAVE_SEAL_MISMATCH');
  for(const values of [{schema_version:2},{app:'OtherExporter'},{manifest:'../upload_manifest.json'},{text_summary:'other.txt'},{ready_series_ids:['source-one','source-one']}])rejects(()=>parseClipWeaveSeal(JSON.stringify({...sample.seal,...values})));
});
test('running, stopped, cancelled and unsealed checksum preparation never produces an accepted seal',()=>{
  const {seal}=sealed();for(const status of ['running','stopped','cancelled','canceled','unsealed','verifying','failed','error'])rejects(()=>parseClipWeaveSeal(JSON.stringify({...seal,status})),'CLIPWEAVE_NOT_FINALIZED','WAIT');
  rejects(()=>parseClipWeaveSeal(JSON.stringify({...seal,finished_at:null})),'CLIPWEAVE_NOT_FINALIZED','WAIT');
  rejects(()=>parseClipWeaveSeal(new Uint8Array([255,254,253])),'CLIPWEAVE_INVALID');
});
test('a finished partial batch imports only a fully ready healthy series and preserves unknown original-story completeness',()=>{
  const data=fixture();data.status='failed';data.batch_upload_ready=false;data.global_reasons=['One source failed'];data.series.push({...structuredClone(data.series[0]),source_id:'source-two',series_key:'002',order:2,upload_ready:false,clips_complete:false,expected_clip_count:null,actual_clip_count:null,source_duration:null,clips:null,reasons:['Export interrupted']});data.files.push({...asset('002_clips/missing.mp4','clip','source-two'),size_bytes:null,sha256:null,issue:'Missing output'});
  const result=parsed(data),selected=selectReadyClipWeaveSeries(result);assert.deepEqual(selected.map(series=>series.source_id),['source-one']);assert.equal(result.manifest.original_series_complete,null);assert.ok(clipWeaveRequiredFiles(result.manifest,selected[0]).every(file=>file.series_id!=='source-two'));
  const sample=sealed(data);sample.seal.ready_series_ids.push('source-two');rejects(()=>parseClipWeaveExport(JSON.stringify(sample.seal),sample.raw));
  data.batch_upload_ready=true;rejects(()=>parsed(data));
});
test('source ids and series order are unique while selection follows explicit order rather than array or filename sorting',()=>{
  const data=fixture(),other=structuredClone(data.series[0]);other.source_id='source-two';other.series_key='002';other.order=2;other.clips=other.clips.map((clip:any)=>({...clip,file:clip.file.replace('001_clips','002_clips')}));data.series.unshift(other);data.files.push(...data.files.filter((file:any)=>file.series_id==='source-one').map((file:any)=>({...file,path:file.path.replace('001_clips','002_clips'),series_id:'source-two'})));
  assert.deepEqual(selectReadyClipWeaveSeries(parsed(data)).map(series=>series.source_id),['source-one','source-two']);data.series[0].order=1;rejects(()=>parsed(data));
});
test('all required shared and selected-series assets are retained, including captions and support records; full videos never become clips',()=>{
  const data=fixture();data.series[0].clips[0].subtitle_srt='001_clips/01_Source/Source_001.srt';data.files.push(asset('001_clips/01_Source/Source_001.srt','clip_caption_srt'),asset('001_clips/full_english.srt','full_transcript'),asset('downloads/original.mp4','original_download'),asset('downloads/full.mp4','full_video'),asset('lead_references/source-one/person.jpg','lead_reference'));
  const result=parsed(data),series=selectReadyClipWeaveSeries(result)[0],required=clipWeaveRequiredFiles(result.manifest,series);
  assert.equal(series.clips.length,2);assert.equal(required.length,9);assert.equal(required.filter(file=>file.role==='clip').length,2);assert.ok(required.some(file=>file.path==='batch.json'));assert.ok(required.some(file=>file.role==='full_transcript'));
  data.files.find((file:any)=>file.role==='clip_caption_srt').required=false;rejects(()=>parsed(data),'CLIPWEAVE_CAPTION_MAPPING');
});
test('required issues or unknown bytes/hashes cannot pass even with ready flags, including shared batch records',()=>{
  for(const override of [{size_bytes:null},{size_bytes:0},{sha256:null},{issue:'Source absent'}]){const data=fixture();Object.assign(data.files[0],override);rejects(()=>parsed(data),'CLIPWEAVE_FILES_PENDING','WAIT');}
  const data=fixture();data.files[0].required=false;rejects(()=>parsed(data));
  data.files[0].required=true;data.files[0].series_id='source-one';rejects(()=>parsed(data));
});
test('requested metadata and promotional covers require their exact primary inventory assets',()=>{
  for(const field of ['metadata_requested','cover_requested']){const data=fixture();data.series[0][field]=true;rejects(()=>parsed(data),'CLIPWEAVE_FILES_PENDING','WAIT');}
  const data=fixture();data.series[0].metadata_requested=true;data.series[0].cover_requested=true;data.files.push(asset('series_metadata/001/title_and_summary.json','series_metadata'),asset('series_covers/source-one/series_cover_1080x1920.png','series_cover'));
  assert.equal(selectReadyClipWeaveSeries(parsed(data)).length,1);data.files.push(asset('series_covers/source-one/other.png','series_cover'));rejects(()=>parsed(data),'CLIPWEAVE_PATH_AMBIGUOUS');
});
test('safe paths preserve exact Unicode but reject traversal, links, absolute paths, Windows prefixes and portable collisions',()=>{
  assert.equal(validateClipWeaveRelativePath('001_clips/01_靈映/作品_001.mp4'),'001_clips/01_靈映/作品_001.mp4');
  for(const path of ['../clip.mp4','/clip.mp4','C:/clip.mp4','C:\\clip.mp4','folder//clip.mp4','folder/./clip.mp4','folder/../clip.mp4','https://attacker.test/clip.mp4','file://host/clip.mp4','folder/shortcut.lnk','folder/link.url','folder/name.','folder/name ','folder/CON.mp4','folder\\clip.mp4'])rejects(()=>validateClipWeaveRelativePath(path),'CLIPWEAVE_PATH_UNSAFE');
  for(const extra of ['BATCH.JSON','batch.json/inside.txt']){const data=fixture();data.files.push(asset(extra,'diagnostic',null,false));rejects(()=>parsed(data),'CLIPWEAVE_PATH_AMBIGUOUS');}
  const data=fixture();data.files.push(asset('misc/caf\u00e9.txt','diagnostic',null,false),asset('misc/cafe\u0301.txt','diagnostic',null,false));rejects(()=>parsed(data),'CLIPWEAVE_PATH_AMBIGUOUS');
});
test('indexes, ownership and required clip mapping must be exact and consecutive',()=>{
  for(const mutate of [(data:any)=>data.series[0].clips[1].index=3,(data:any)=>data.series[0].clips[1].file=data.series[0].clips[0].file,(data:any)=>data.series[0].actual_clip_count=1,(data:any)=>data.files.find((file:any)=>file.role==='clip').role='original_download']){const data=fixture();mutate(data);rejects(()=>parsed(data));}
  const data=fixture();data.files.push(asset('001_clips/01_Source/unindexed.mp4','clip'));rejects(()=>parsed(data),'CLIPWEAVE_CLIP_MAPPING');
});
test('source coverage rejects gaps, wrong overlaps and missing ending without summing overlapped clips as unique source duration',()=>{
  const result=parsed();assert.equal(result.manifest.series[0].clips.reduce((sum,clip)=>sum+clip.duration,0),20);assert.equal(result.manifest.series[0].source_duration,18);assert.equal(result.manifest.original_series_complete,null);
  for(const mutate of [(data:any)=>{data.series[0].clips[0].source_start=1;data.series[0].clips[0].duration=9;},(data:any)=>{const clip=data.series[0].clips[1];clip.source_start=11;clip.source_end=21;clip.overlap_previous=0;data.series[0].source_duration=21;},(data:any)=>data.series[0].clips[1].overlap_previous=1,(data:any)=>data.series[0].source_duration=19,(data:any)=>data.series[0].clips[1].duration=11]){const data=fixture();mutate(data);rejects(()=>parsed(data),'CLIPWEAVE_CLIP_TIMING');}
});
test('asset sizes parse decimal int64 strings without precision loss and refuse unsafe or malformed values',()=>{
  const data=fixture();data.files[0].size_bytes='9007199254740991';assert.equal(parsed(data).manifest.files[0].size_bytes,Number.MAX_SAFE_INTEGER);
  for(const size_bytes of ['9007199254740992',9007199254740992,'1.5','01','-1']){const bad=fixture();bad.files[0].size_bytes=size_bytes;rejects(()=>parsed(bad));}
});
test('export/source pair alone determines identity; a sealed revision changes provenance but cannot create a new identity',()=>{
  const first=parsed(),changed=fixture();changed.series[0].name='Reviewed source title';const second=parsed(changed);
  assert.notEqual(first.manifestSha256,second.manifestSha256);assert.equal(clipWeaveSourceIdentity(first.manifest.export_id,'source-one'),clipWeaveSourceIdentity(second.manifest.export_id,'source-one'));
  assert.notEqual(clipWeaveSourceIdentity('export-one','source-one'),clipWeaveSourceIdentity('export-two','source-one'));assert.notEqual(clipWeaveSourceIdentity('export-one','source-one'),clipWeaveSourceIdentity('export-one','source-two'));
  for(const value of [null,false,true])assert.equal(parsed({...fixture(),original_series_complete:value}).manifest.original_series_complete,value);
});


test('overlap flags remain boolean and match source timings without coercing true to one second',()=>{
  const data=fixture();data.series[0].clips[0].overlap_previous=false;data.series[0].clips[1].overlap_previous=true;
  const clips=parsed(data).manifest.series[0].clips;assert.equal(clips[0].overlap_previous,false);assert.equal(clips[1].overlap_previous,true);assert.equal(clips[0].source_end-clips[1].source_start,2);
  const wrong=fixture();wrong.series[0].clips[0].overlap_previous=true;rejects(()=>parsed(wrong),'CLIPWEAVE_CLIP_TIMING');
  for(const overlap_previous of [false,'true',null,{},-1]){const wrong=fixture();wrong.series[0].clips[1].overlap_previous=overlap_previous;rejects(()=>parsed(wrong),'CLIPWEAVE_CLIP_TIMING');}
  const gapless=fixture();Object.assign(gapless.series[0].clips[1],{source_start:10,source_end:20,overlap_previous:true});gapless.series[0].source_duration=20;rejects(()=>parsed(gapless),'CLIPWEAVE_CLIP_TIMING');
});
test('producer source URLs remain inert data and do not grant a network fetch capability',()=>{
  const previous=globalThis.fetch;let calls=0;globalThis.fetch=(()=>{calls++;throw new Error('Unexpected provider network request');}) as typeof fetch;
  try{const data=fixture();data.series[0].source_url='file:///private/source-only-reference';const result=parsed(data);assert.equal(result.manifest.series[0].source_url,data.series[0].source_url);assert.equal(result.manifest.original_series_complete,null);assert.equal(calls,0);}
  finally{globalThis.fetch=previous;}
});


test('seal schema labels may be absent while the hashed manifest remains the schema authority; series order and data keys may be zero',()=>{
  const data=fixture();data.series[0].order=0;data.series[0].series_key=0;const sample=sealed(data);
  const seal:any={...sample.seal};delete seal.schema_version;delete seal.app;
  const exported=parseClipWeaveExport(JSON.stringify(seal),sample.raw);assert.equal(exported.seal.schema_version,undefined);assert.equal(exported.seal.app,undefined);assert.equal(exported.manifest.schema_version,1);assert.equal(exported.manifest.app,'ClipWeave');assert.equal(exported.manifest.series[0].order,0);assert.equal(exported.manifest.series[0].series_key,0);
  for(const values of [{schema_version:2},{app:'Other'},{schema_version:null},{app:null}])rejects(()=>parseClipWeaveExport(JSON.stringify({...seal,...values}),sample.raw),'CLIPWEAVE_SCHEMA_UNSUPPORTED');
  for(const key of [-1,1.5,null]){const wrong=fixture();wrong.series[0].series_key=key;rejects(()=>parsed(wrong));}
  const missing=fixture();delete missing.app;rejects(()=>parsed(missing),'CLIPWEAVE_SCHEMA_UNSUPPORTED');
});


test('explicit clip indexes order an unsorted producer array without rewriting its sealed raw bytes',()=>{
  const data=fixture();data.series[0].clips.reverse();const sample=sealed(data),before=Buffer.from(sample.raw);
  const result=parseClipWeaveExport(sample.sealRaw,sample.raw);assert.deepEqual(result.manifest.series[0].clips.map(clip=>clip.index),[1,2]);assert.deepEqual(selectReadyClipWeaveSeries(result)[0].clips.map(clip=>clip.source_start),[0,8]);assert.deepEqual(data.series[0].clips.map((clip:any)=>clip.index),[2,1]);assert.deepEqual(sample.raw,before);assert.equal(result.manifestSha256,checksum(before));
  const wrong=fixture();wrong.series[0].clips[0].index=2;wrong.series[0].clips[1].index=1;rejects(()=>parsed(wrong),'CLIPWEAVE_CLIP_TIMING');
});
