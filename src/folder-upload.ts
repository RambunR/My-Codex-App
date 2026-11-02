export interface SelectedVideo {file:File;relativePath:string}
export interface VideoSelection {videos:SelectedVideo[];ignored:number;total:number}
export type FolderUploadErrorCode='FOLDER_READ_FAILED'|'TOO_MANY_VIDEOS'|'FOLDER_TOO_LARGE';
export class FolderReadError extends Error {
  constructor(readonly code:FolderUploadErrorCode,cause?:unknown){super(code,{cause});this.name='FolderReadError';}
}

export const MAX_FOLDER_VIDEOS=1000;
export const MAX_FOLDER_ENTRIES=20_000;
const defaults=['mp4','mov','webm','m4v'] as const;
const natural=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const exact=new Intl.Collator('en',{numeric:true,sensitivity:'variant'});
const normalize=(path:string)=>path.replace(/\\/g,'/').replace(/^\/+/, '');
const hidden=(path:string)=>normalize(path).split('/').some(part=>part.startsWith('.')||part.toLowerCase()==='__macosx'||part.toLowerCase()==='thumbs.db'||part.toLowerCase()==='desktop.ini');
const extension=(name:string)=>/\.([^.\/\\]+)$/.exec(name)?.[1].toLowerCase()||'';
function allowed(name:string,path:string,formats:readonly string[]){return!hidden(path)&&formats.includes(extension(name));}
function ordered(videos:SelectedVideo[]){return videos.sort((a,b)=>natural.compare(a.relativePath,b.relativePath)||exact.compare(a.relativePath,b.relativePath));}
function formatsFor(mode:'folder'|'files',formats:readonly string[]){return mode==='folder'?['mp4']:formats.map(value=>value.replace(/^\./,'').toLowerCase());}

/** Folder selection is deliberately MP4-only; manual files keep supported formats. */
export function selectVideoFiles(selected:Iterable<File>|ArrayLike<File>,options:{mode:'folder'|'files';formats?:readonly string[]}={mode:'folder'}):VideoSelection{
  const videos:SelectedVideo[]=[];let total=0,ignored=0;
  const formats=formatsFor(options.mode,options.formats??defaults);
  for(const file of Array.from(selected)){
    if(++total>MAX_FOLDER_ENTRIES)throw new FolderReadError('FOLDER_TOO_LARGE');
    const relativePath=normalize(file.webkitRelativePath||file.name);
    if(!allowed(file.name,relativePath,formats)){ignored++;continue;}
    if(videos.length>=MAX_FOLDER_VIDEOS)throw new FolderReadError('TOO_MANY_VIDEOS');
    videos.push({file,relativePath});
  }
  return{videos:ordered(videos),ignored,total};
}

function readEntryFile(entry:FileSystemFileEntry):Promise<File>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new FolderReadError('FOLDER_READ_FAILED')),15_000);
    const fail=(cause?:unknown)=>{clearTimeout(timer);reject(new FolderReadError('FOLDER_READ_FAILED',cause));};
    try{entry.file(file=>{clearTimeout(timer);resolve(file);},fail);}catch(cause){fail(cause);}
  });
}
function readEntries(reader:FileSystemDirectoryReader):Promise<FileSystemEntry[]>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new FolderReadError('FOLDER_READ_FAILED')),15_000);
    const fail=(cause?:unknown)=>{clearTimeout(timer);reject(new FolderReadError('FOLDER_READ_FAILED',cause));};
    try{reader.readEntries(entries=>{clearTimeout(timer);resolve(entries);},fail);}catch(cause){fail(cause);}
  });
}

/** Capture drag entries before awaiting: browsers clear DataTransfer after drop. */
export async function collectDroppedVideos(items:DataTransferItemList|DataTransferItem[],fallbackFiles:FileList|File[],formats:readonly string[]=defaults):Promise<VideoSelection&{folder:boolean}>{
  const captured:Array<{entry:FileSystemEntry|null;file:File|null}>=[];
  try{
    for(const item of Array.from(items))if(item.kind==='file'){
      const entry=typeof item.webkitGetAsEntry==='function'?item.webkitGetAsEntry():null;
      // getAsFile is also called synchronously, before DataTransfer is invalidated.
      const file=typeof item.getAsFile==='function'?item.getAsFile():null;
      captured.push({entry,file});
    }
  }catch(cause){throw new FolderReadError('FOLDER_READ_FAILED',cause);}
  const fallback=Array.from(fallbackFiles);
  const folder=captured.some(item=>item.entry?.isDirectory)||fallback.some(file=>!!file.webkitRelativePath);
  if(folder&&!captured.some(item=>item.entry?.isDirectory)&&fallback.length)return{...selectVideoFiles(fallback,{mode:'folder',formats}),folder:true};
  if(!folder){
    const direct=captured.map(item=>item.file).filter((file):file is File=>!!file);
    if(direct.length&&direct.length===captured.length)return{...selectVideoFiles(direct,{mode:'files',formats}),folder:false};
    if(!captured.some(item=>item.entry)&&fallback.length>=captured.length)return{...selectVideoFiles(fallback,{mode:'files',formats}),folder:false};
    if(captured.length&&!captured.some(item=>item.entry))throw new FolderReadError('FOLDER_READ_FAILED');
  }
  if(!captured.some(item=>item.entry))return{...selectVideoFiles(fallback,{mode:folder?'folder':'files',formats}),folder};

  const videos:SelectedVideo[]=[];let total=0,ignored=0,visited=0;
  const accepted=formatsFor(folder?'folder':'files',formats);
  const append=(file:File,relativePath:string)=>{
    if(videos.length>=MAX_FOLDER_VIDEOS)throw new FolderReadError('TOO_MANY_VIDEOS');
    videos.push({file,relativePath});
  };
  const visit=async(entry:FileSystemEntry,parent=''):Promise<void>=>{
    if(++visited>MAX_FOLDER_ENTRIES)throw new FolderReadError('FOLDER_TOO_LARGE');
    const relativePath=normalize(entry.fullPath||[parent,entry.name].filter(Boolean).join('/'));
    if(entry.isDirectory){
      let reader:FileSystemDirectoryReader;
      try{reader=(entry as FileSystemDirectoryEntry).createReader();}catch(cause){throw new FolderReadError('FOLDER_READ_FAILED',cause);}
      // Chromium can return directory contents in batches of only 100 entries.
      for(;;){const entries=await readEntries(reader);if(!entries.length)break;for(const child of entries)await visit(child,relativePath);}
    }else if(entry.isFile){
      total++;
      if(!allowed(entry.name,relativePath,accepted)){ignored++;return;}
      if(videos.length>=MAX_FOLDER_VIDEOS)throw new FolderReadError('TOO_MANY_VIDEOS');
      append(await readEntryFile(entry as FileSystemFileEntry),relativePath);
    }else throw new FolderReadError('FOLDER_READ_FAILED');
  };
  for(const item of captured){
    if(item.entry)await visit(item.entry);
    else if(item.file){
      if(++visited>MAX_FOLDER_ENTRIES)throw new FolderReadError('FOLDER_TOO_LARGE');total++;
      const relativePath=normalize(item.file.webkitRelativePath||item.file.name);
      if(allowed(item.file.name,relativePath,accepted))append(item.file,relativePath);else ignored++;
    }else throw new FolderReadError('FOLDER_READ_FAILED');
  }
  return{videos:ordered(videos),ignored,total,folder};
}
