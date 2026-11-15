import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {DriveFile,DriveReader} from '../shared/drive-import-types';
import {
  ClipWeaveDriveError,listClipWeaveChildren,resolveClipWeavePath,loadClipWeaveExport,
  resolveClipWeaveSeries,revalidateClipWeaveSnapshot,hasClipWeaveControls,isClipWeaveExportFolderName,
} from '../server/clipweave-drive';

const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const bytes=(text:string)=>new TextEncoder().encode(text);
class MemoryDrive implements DriveReader {
  files=new Map<string,DriveFile>();bodies=new Map<string,Uint8Array>();listCalls=0;ranges:Array<{id:string;offset:number;length:number}>=[];
  pageSize=1000;repeatToken=false;afterRead?:((id:string)=>void);
  add(id:string,name:string,mimeType:string,parent:string|null,body?:Uint8Array,checksum=false){
    this.files.set(id,{id,name,mimeType,size:body?.length??0,version:'1',modifiedTime:'2026-11-15T00:00:00Z',...(parent?{parents:[parent]}:{}),...(checksum&&body?{sha256Checksum:sha(body)}:{})});
    if(body)this.bodies.set(id,body);return id;
  }
  folder(id:string,name:string,parent:string|null){return this.add(id,name,'application/vnd.google-apps.folder',parent);}
  bump(id:string){const file=this.files.get(id)!;file.version=String(Number(file.version)+1);}
  async getFile(id:string){const file=this.files.get(id);if(!file)throw Object.assign(new Error('not found'),{code:'DRIVE_ACCESS_DENIED'});return structuredClone(file);}
  async listChildren(id:string,token?:string){
    this.listCalls++;const children=[...this.files.values()].filter(file=>file.parents?.includes(id));
    if(this.repeatToken)return{files:[],nextPageToken:'same-token'};
    const start=Number(token||0),files=children.slice(start,start+this.pageSize).map(file=>structuredClone(file));
    return{files,...(start+this.pageSize<children.length?{nextPageToken:String(start+this.pageSize)}:{})};
  }
  async readText():Promise<string>{throw new Error('Control parsing must not normalize UTF-8 text or BOMs.');}
  async readRange(id:string,offset:number,length:number){this.ranges.push({id,offset,length});const data=this.bodies.get(id)!;this.afterRead?.(id);return data.slice(offset,offset+length);}
}
function fixture({caption=false,cover=false,padding=0}:{caption?:boolean;cover?:boolean;padding?:number}={}){
  const drive=new MemoryDrive();drive.folder('configured-root','Uploads',null);drive.folder('export-root','ClipWeave_20261115','configured-root');
  drive.folder('clips-folder','001_clips','export-root');drive.folder('media-folder','01_Original drama','clips-folder');
  const batch=bytes('{"done":true}'),video1=bytes('episode one original bytes'),video2=bytes('episode two original bytes');
  const path1='001_clips/01_Original drama/original_001.mp4',path2='001_clips/01_Original drama/original_002.mp4';
  drive.add('batch','batch.json','application/json','export-root',batch,true);
  drive.add('video-1','original_001.mp4','video/mp4','media-folder',video1,true);drive.add('video-2','original_002.mp4','video/mp4','media-folder',video2,true);
  const files:any[]=[{path:'batch.json',role:'batch_manifest',series_id:null,required:true,size_bytes:batch.length,sha256:sha(batch)},
    {path:path1,role:'clip',series_id:'source-1',required:true,size_bytes:video1.length,sha256:sha(video1)},
    {path:path2,role:'clip',series_id:'source-1',required:true,size_bytes:video2.length,sha256:sha(video2)}];
  const clips:any[]=[{index:1,file:path1,source_start:0,source_end:12,duration:12,overlap_previous:0},{index:2,file:path2,source_start:10,source_end:20,duration:10,overlap_previous:2}];
  if(caption){const body=bytes('1\n00:00:00,000 --> 00:00:01,000\nCaption');drive.add('caption','original_001.srt','application/x-subrip','media-folder',body,true);const path='001_clips/01_Original drama/original_001.srt';files.push({path,role:'clip_caption_srt',series_id:'source-1',required:true,size_bytes:body.length,sha256:sha(body)});clips[0].subtitle_srt=path;}
  if(cover){drive.folder('covers-folder','series_covers','export-root');drive.folder('cover-source','source-1','covers-folder');const body=bytes('cover original bytes');drive.add('cover','series_cover_1080x1920.png','image/png','cover-source',body,true);files.push({path:'series_covers/source-1/series_cover_1080x1920.png',role:'series_cover',series_id:'source-1',required:true,size_bytes:body.length,sha256:sha(body)});}
  const manifest:any={schema_version:1,app:'ClipWeave',export_id:'export-20261115',operation:'process',status:'completed',finished_at:'2026-11-15T00:00:00Z',batch_upload_ready:true,global_reasons:[],completeness_scope:'generated_export',original_series_complete:null,
    series:[{source_id:'source-1',series_key:'001',order:1,name:'Original drama',source_url:'https://example.test/source',source_duration:20,expected_clip_count:2,actual_clip_count:2,clips_complete:true,upload_ready:true,reasons:[],metadata_requested:false,cover_requested:cover,clips}],files,...(padding?{padding:'x'.repeat(padding)}:{})};
  const setManifest=()=>{
    const body=bytes(JSON.stringify(manifest)),seal=bytes(JSON.stringify({schema_version:1,app:'ClipWeave',export_id:manifest.export_id,manifest:'upload_manifest.json',manifest_size_bytes:body.length,manifest_sha256:sha(body),text_summary:'EXPORT_SUMMARY.txt',batch_upload_ready:manifest.batch_upload_ready,ready_series_ids:['source-1'],status:'completed',finished_at:'2026-11-15T00:00:02Z'}));
    drive.add('manifest','upload_manifest.json','application/json','export-root',body);drive.add('seal','EXPORT_FINALIZED.json','application/json','export-root',seal);
  };
  setManifest();drive.add('summary','EXPORT_SUMMARY.txt','text/plain','export-root',bytes('Finalized generated export; original story completeness unknown.'));
  return{drive,manifest,setManifest,load:()=>loadClipWeaveExport(drive,'export-root',{configuredRootId:'configured-root'})};
}
async function rejectState(action:()=>Promise<unknown>,code:string,state='REJECT'){
  await assert.rejects(action,(error:unknown)=>error instanceof ClipWeaveDriveError&&error.code===code&&error.state===state);
}

test('sealed nested exports resolve all pages and only inventory assets, without downloading media',async()=>{
  const f=fixture({caption:true,cover:true});f.drive.pageSize=2;
  const loaded=await f.load(),resolved=await resolveClipWeaveSeries(f.drive,loaded,'source-1');
  assert.equal(loaded.manifest.original_series_complete,null);assert.deepEqual(resolved.series.clips.map(clip=>clip.index),[1,2]);
  assert.deepEqual(resolved.assets.map(asset=>asset.inventory.role),['batch_manifest','clip','clip','clip_caption_srt','series_cover']);
  assert.ok(resolved.snapshot.entries.some(entry=>entry.path==='001_clips/01_Original drama'&&entry.kind==='folder'));
  assert.ok(resolved.assets.every(asset=>asset.file.parents?.includes(asset.parentId)));
  assert.ok(f.drive.ranges.every(range=>['seal','manifest'].includes(range.id)));
  await revalidateClipWeaveSnapshot(f.drive,resolved.snapshot);assert.ok(f.drive.listCalls>5);
});
test('a seal arriving before the last video or required caption/cover remains waiting',async()=>{
  for(const missing of ['video-2','caption','cover']){const f=fixture({caption:true,cover:true});f.drive.files.delete(missing);const loaded=await f.load();await rejectState(()=>resolveClipWeaveSeries(f.drive,loaded,'source-1'),'CLIPWEAVE_FILES_PENDING','WAIT');}
  const f=fixture();f.drive.files.delete('summary');await rejectState(()=>f.load(),'CLIPWEAVE_FILES_PENDING','WAIT');
});
test('duplicate/colliding Drive controls and nested names are ambiguous rather than first-match wins',async()=>{
  for(const name of ['EXPORT_FINALIZED.json','export_finalized.json']){const f=fixture();f.drive.add('other-seal',name,'application/json','export-root',bytes('{}'));await rejectState(()=>f.load(),'CLIPWEAVE_AMBIGUOUS');}
  const f=fixture();f.drive.add('other-video','original_001.mp4','video/mp4','media-folder',bytes('other'));const loaded=await f.load();await rejectState(()=>resolveClipWeaveSeries(f.drive,loaded,'source-1'),'CLIPWEAVE_AMBIGUOUS');
});
test('unsafe paths, shortcuts and files outside a pinned parent are refused',async()=>{
  const f=fixture();for(const path of ['../video.mp4','C:/video.mp4','https://example.test/video.mp4'])await assert.rejects(resolveClipWeavePath(f.drive,'export-root',path));
  f.drive.files.get('media-folder')!.mimeType='application/vnd.google-apps.shortcut';await rejectState(()=>resolveClipWeavePath(f.drive,'export-root','001_clips/01_Original drama/original_001.mp4'),'CLIPWEAVE_INVALID_PATH');
  f.drive.files.get('export-root')!.parents=['another-parent'];await rejectState(()=>f.load(),'CLIPWEAVE_SOURCE_CHANGED');
});
test('Unicode exact-name paths work while canonically colliding names are rejected',async()=>{
  const f=fixture();f.drive.add('unicode','中文_é.mp4','video/mp4','media-folder',bytes('original'));
  const path='001_clips/01_Original drama/中文_é.mp4';assert.equal((await resolveClipWeavePath(f.drive,'export-root',path)).file.id,'unicode');
  f.drive.add('unicode-collision','中文_e\u0301.mp4','video/mp4','media-folder',bytes('other'));await rejectState(()=>resolveClipWeavePath(f.drive,'export-root',path),'CLIPWEAVE_AMBIGUOUS');
});
test('Drive SHA-256 mismatch is rejected even when the size is unchanged',async()=>{
  const f=fixture();f.drive.files.get('video-2')!.sha256Checksum='f'.repeat(64);const loaded=await f.load();await rejectState(()=>resolveClipWeaveSeries(f.drive,loaded,'source-1'),'CLIPWEAVE_CHECKSUM_MISMATCH');
});
test('controls authenticate exact raw bytes, support manifests larger than legacy text limit, and pin revisions',async()=>{
  const large=fixture({padding:5*1024*1024});const loaded=await large.load();assert.equal(loaded.seal.export_id,'export-20261115');assert.equal(large.drive.ranges.filter(range=>range.id==='manifest').length,2);assert.ok(large.drive.ranges.every(range=>range.length<=5*1024*1024));
  const f=fixture();f.drive.bodies.set('manifest',bytes(new TextDecoder().decode(f.drive.bodies.get('manifest')!)+'\n'));f.drive.files.get('manifest')!.size++;
  await assert.rejects(f.load(),(error:any)=>error.code==='CLIPWEAVE_SEAL_MISMATCH');
  const changing=fixture();changing.drive.afterRead=id=>{if(id==='manifest')changing.drive.bump('seal');};await rejectState(()=>changing.load(),'CLIPWEAVE_SOURCE_CHANGED');
});
test('fresh snapshot checks detect replaced nested folders, changed files and seals, but ignore unrelated later drops',async()=>{
  for(const change of ['file','folder','seal','missing']){
    const f=fixture(),loaded=await f.load(),resolved=await resolveClipWeaveSeries(f.drive,loaded,'source-1');
    if(change==='file')f.drive.bump('video-1');if(change==='seal')f.drive.bump('seal');if(change==='missing')f.drive.files.delete('video-1');
    if(change==='folder'){f.drive.files.delete('media-folder');f.drive.folder('replacement','01_Original drama','clips-folder');f.drive.files.get('video-1')!.parents=['replacement'];f.drive.files.get('video-2')!.parents=['replacement'];}
    await rejectState(()=>revalidateClipWeaveSnapshot(f.drive,resolved.snapshot),'CLIPWEAVE_SOURCE_CHANGED');
  }
  const f=fixture(),resolved=await resolveClipWeaveSeries(f.drive,await f.load(),'source-1');f.drive.add('unlisted','unrelated.mp4','video/mp4','media-folder',bytes('notapproved'));f.drive.bump('media-folder');await revalidateClipWeaveSnapshot(f.drive,resolved.snapshot);
});
test('pagination loops and request-heavy fragmented paths have explicit bounds',async()=>{
  const f=fixture();f.drive.repeatToken=true;await rejectState(()=>listClipWeaveChildren(f.drive,'export-root'),'CLIPWEAVE_AMBIGUOUS');
  const fragmented=fixture();await rejectState(()=>resolveClipWeavePath(fragmented.drive,'export-root','001_clips/01_Original drama/original_001.mp4',{maxListRequests:2}),'CLIPWEAVE_LIMIT');
  assert.equal(isClipWeaveExportFolderName('ClipWeave_20261115'),true);assert.equal(isClipWeaveExportFolderName('001_clips'),false);assert.equal(hasClipWeaveControls([...fragmented.drive.files.values()]),true);
});
