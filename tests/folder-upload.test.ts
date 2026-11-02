import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectDroppedVideos,selectVideoFiles,FolderReadError,MAX_FOLDER_ENTRIES,MAX_FOLDER_VIDEOS} from '../src/folder-upload';

function video(name:string,relativePath=''){
  const file=new File(['local fixture'],name,{type:'video/mp4'});
  if(relativePath)Object.defineProperty(file,'webkitRelativePath',{value:relativePath});
  return file;
}
function fileEntry(path:string,onRead=()=>{}){
  return{name:path.split('/').at(-1)!,fullPath:path,isFile:true,isDirectory:false,file:(success:(file:File)=>void)=>{onRead();queueMicrotask(()=>success(video(path.split('/').at(-1)!)));}} as unknown as FileSystemFileEntry;
}
function directory(path:string,batches:FileSystemEntry[][],onRead=()=>{}){
  return{name:path.split('/').at(-1)!,fullPath:path,isFile:false,isDirectory:true,createReader:()=>{
    let index=0;return{readEntries:(success:(entries:FileSystemEntry[])=>void)=>{onRead();queueMicrotask(()=>success(batches[index++]||[]));}};
  }} as unknown as FileSystemDirectoryEntry;
}
function item(entry:FileSystemEntry|null,file:File|null=null){return{kind:'file',webkitGetAsEntry:()=>entry,getAsFile:()=>file} as unknown as DataTransferItem;}
const paths=(selection:{videos:{relativePath:string}[]})=>selection.videos.map(value=>value.relativePath);
const code=(expected:string)=>(error:unknown)=>error instanceof FolderReadError&&error.code===expected;

test('mixed ClipWeave folders accept upper/lowercase MP4s in numeric path order and ignore companion files',()=>{
  const root='ClipWeave Exports\\ClipWeave_20260101_120000_example\\002_clips\\01_002_An Unexpected Choice—第一集';
  const files=['10.mp4','2.MP4','1.mp4','captions.srt','metadata.json','poster.jpg','audio.mp3','other.mov','._1.mp4','Thumbs.db','mp4'].map(name=>video(name,root+'\\'+name));
  const result=selectVideoFiles(files,{mode:'folder'});
  assert.deepEqual(result.videos.map(value=>value.file.name),['1.mp4','2.MP4','10.mp4']);
  assert.equal(result.total,11);assert.equal(result.ignored,8);
  assert.ok(result.videos.every(value=>value.relativePath.startsWith(root.replace(/\\/g,'/')+'/')));
});

test('hidden metadata MP4s stay ignored while ordinary underscore filenames and duplicate basenames in different subfolders remain',()=>{
  const result=selectVideoFiles([
    video('clip.mp4','Story/10/clip.mp4'),video('clip.mp4','Story/2/clip.mp4'),video('_opening.mp4','Story/1/_opening.mp4'),
    video('clip.mp4','Story/__MACOSX/clip.mp4'),video('clip.mp4','Story/.cache/clip.mp4'),video('._clip.mp4','Story/._clip.mp4'),
  ]);
  assert.deepEqual(paths(result),['Story/1/_opening.mp4','Story/2/clip.mp4','Story/10/clip.mp4']);assert.equal(result.ignored,3);
});

test('manual file selection retains only runtime-supported video formats',()=>{
  const result=selectVideoFiles([video('03.webm'),video('02.MOV'),video('01.mp4'),video('04.txt')],{mode:'files',formats:['mp4','mov']});
  assert.deepEqual(result.videos.map(value=>value.file.name),['01.mp4','02.MOV']);assert.equal(result.ignored,2);assert.equal(result.total,4);
  const empty=selectVideoFiles([video('captions.srt'),video('poster.png')]);assert.equal(empty.videos.length,0);assert.equal(empty.ignored,2);
});

test('dropped folders read every directory-reader batch and avoid reading ignored file bodies',async()=>{
  let acceptedReads=0,ignoredReads=0,batches=0;
  const nested2=directory('/A story—動畫/2',[[fileEntry('/A story—動畫/2/clip.MP4',()=>acceptedReads++)]]);
  const nested10=directory('/A story—動畫/10',[[fileEntry('/A story—動畫/10/clip.mp4',()=>acceptedReads++)]]);
  const hidden=directory('/A story—動畫/__MACOSX',[[fileEntry('/A story—動畫/__MACOSX/._clip.mp4',()=>ignoredReads++)]]);
  const root=directory('/A story—動畫',[[nested10,fileEntry('/A story—動畫/poster.png',()=>ignoredReads++)],[nested2,hidden,fileEntry('/A story—動畫/metadata.json',()=>ignoredReads++)]],()=>batches++);
  const result=await collectDroppedVideos([item(root)],[],['mp4','mov']);
  assert.equal(result.folder,true);assert.deepEqual(paths(result),['A story—動畫/2/clip.MP4','A story—動畫/10/clip.mp4']);
  assert.equal(result.total,5);assert.equal(result.ignored,3);assert.equal(acceptedReads,2);assert.equal(ignoredReads,0);assert.equal(batches,3);
});

test('all drag entries are captured synchronously and a mixed folder drop stays MP4-only',async()=>{
  const captured:string[]=[];
  const root=directory('/Episodes',[[fileEntry('/Episodes/01.mp4')]],()=>assert.deepEqual(captured,['folder','loose-video','loose-mov']));
  const items=[['folder',root,null],['loose-video',fileEntry('/02.mp4'),video('02.mp4')],['loose-mov',fileEntry('/03.mov'),video('03.mov')]].map(([name,entry,file])=>({kind:'file',webkitGetAsEntry:()=>{captured.push(name as string);return entry;},getAsFile:()=>file})) as unknown as DataTransferItem[];
  const result=await collectDroppedVideos(items,[],['mp4','mov']);
  assert.equal(result.folder,true);assert.equal(result.videos.length,2);assert.equal(result.ignored,1);assert.equal(result.total,3);
});

test('loose drag files and directory-picker fallback preserve their distinct format policies',async()=>{
  const loose=await collectDroppedVideos([item(null,video('02.mov')),item(null,video('01.mp4')),item(null,video('poster.png'))],[],['mp4','mov']);
  assert.equal(loose.folder,false);assert.deepEqual(paths(loose),['01.mp4','02.mov']);assert.equal(loose.ignored,1);
  const fallback=await collectDroppedVideos([],[video('02.mov','Export/02.mov'),video('01.MP4','Export/nested/01.MP4')],['mp4','mov']);
  assert.equal(fallback.folder,true);assert.deepEqual(paths(fallback),['Export/nested/01.MP4']);assert.equal(fallback.ignored,1);
  await assert.rejects(()=>collectDroppedVideos([item(null)],[],['mp4']),code('FOLDER_READ_FAILED'));
});

test('unreadable descendants reject the entire scan instead of silently returning a partial upload batch',async()=>{
  const broken={name:'denied',fullPath:'/Story/denied',isDirectory:true,isFile:false,createReader:()=>({readEntries:(_success:unknown,error:(cause:unknown)=>void)=>error(new Error('Local access denied'))})} as unknown as FileSystemDirectoryEntry;
  const root=directory('/Story',[[fileEntry('/Story/01.mp4'),broken]]);
  await assert.rejects(()=>collectDroppedVideos([item(root)],[],['mp4']),code('FOLDER_READ_FAILED'));
  const unreadable={name:'broken.mp4',fullPath:'/broken.mp4',isFile:true,isDirectory:false,file:(_success:unknown,error:(cause:unknown)=>void)=>error(new Error('File disappeared'))} as unknown as FileSystemFileEntry;
  await assert.rejects(()=>collectDroppedVideos([item(unreadable)],[],['mp4']),code('FOLDER_READ_FAILED'));
});

test('oversized video batches and excessive directory enumeration fail with separate bounded errors',async()=>{
  const repeated=video('episode.mp4');assert.throws(()=>selectVideoFiles(Array(MAX_FOLDER_VIDEOS+1).fill(repeated)),code('TOO_MANY_VIDEOS'));
  assert.throws(()=>selectVideoFiles(Array(MAX_FOLDER_ENTRIES+1).fill(video('notes.txt'))),code('FOLDER_TOO_LARGE'));
  const nonvideo=fileEntry('/Large/notes.txt');
  const neverEnding={name:'Large',fullPath:'/Large',isFile:false,isDirectory:true,createReader:()=>({readEntries:(success:(entries:FileSystemEntry[])=>void)=>success([nonvideo])})} as unknown as FileSystemDirectoryEntry;
  await assert.rejects(()=>collectDroppedVideos([item(neverEnding)],[],['mp4']),code('FOLDER_TOO_LARGE'));
});
