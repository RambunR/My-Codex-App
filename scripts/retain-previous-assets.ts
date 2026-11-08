import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Plugin} from 'vite';

const MANIFEST='asset-release.json';
const safeAsset=(name:string)=>/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|css)$/.test(name);
interface ReleaseManifest{current:string[];previous:string[]}
interface ReleaseSnapshot{names:string[];current:Map<string,Buffer>;previous:Map<string,Buffer>}
const emptySnapshot=():ReleaseSnapshot=>({names:[],current:new Map(),previous:new Map()});
const names=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=2048&&value.every(item=>typeof item==='string'&&safeAsset(item))&&new Set(value).size===value.length;

async function assetBytes(directory:string,files:string[]){
  const result=new Map<string,Buffer>();
  try{const info=await lstat(path.join(directory,'assets'));if(!info.isDirectory()||info.isSymbolicLink())return result;}catch{return result;}
  for(const name of files){
    if(!safeAsset(name))continue;
    const file=path.join(directory,name);
    try{const info=await lstat(file);if(info.isFile()&&!info.isSymbolicLink())result.set(name,await readFile(file));}catch{/* Missing prior assets do not prevent a clean release. */}
  }
  return result;
}

async function snapshot(directory:string):Promise<ReleaseSnapshot>{
  let manifest:ReleaseManifest;
  try{
    const file=path.join(directory,MANIFEST),info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink())return emptySnapshot();
    const value:unknown=JSON.parse(await readFile(file,'utf8'));
    if(!value||typeof value!=='object'||!names((value as ReleaseManifest).current)||!names((value as ReleaseManifest).previous))return emptySnapshot();
    manifest=value as ReleaseManifest;
  }catch(error){
    // An output from before this plugin has one implicit current release. A
    // malformed manifest is ignored rather than following untrusted paths.
    if((error as NodeJS.ErrnoException).code!=='ENOENT')return emptySnapshot();
    try{
      const info=await lstat(path.join(directory,'assets'));if(!info.isDirectory()||info.isSymbolicLink())return emptySnapshot();
      const entries=await readdir(path.join(directory,'assets'),{withFileTypes:true});
      manifest={current:entries.filter(entry=>entry.isFile()&&safeAsset(`assets/${entry.name}`)).map(entry=>`assets/${entry.name}`).sort(),previous:[]};
    }catch{return emptySnapshot();}
  }
  return{names:[...manifest.current].sort(),current:await assetBytes(directory,manifest.current),previous:await assetBytes(directory,manifest.previous)};
}

/** Keep one previous set of generated JS/CSS so an already-open tab can load
 * its lazy chunks after a release. No HTML, uploads or source maps are retained.
 * Snapshots happen before Vite empties outDir. Identical rebuilds must preserve
 * the original previous release rather than replacing it with current output. */
export function retainPreviousAssets():Plugin{
  let directory='',before=emptySnapshot(),retained=new Map<string,Buffer>(),current=new Set<string>(),written=false;
  return{
    name:'lingying-retain-previous-assets',apply:'build',
    async configResolved(config){directory=path.resolve(config.root,config.build.outDir);before=await snapshot(directory);written=false;},
    generateBundle(_options,bundle){
      const next=Object.keys(bundle).filter(safeAsset).sort();
      const same=next.length===before.names.length&&next.every((name,index)=>name===before.names[index]);
      retained=same?before.previous:before.current;current=new Set(next);
      const release:ReleaseManifest={current:next,previous:[...retained.keys()].sort()};
      this.emitFile({type:'asset',fileName:MANIFEST,source:JSON.stringify(release,null,2)+'\n'});
    },
    writeBundle(){written=true;},
    async closeBundle(){
      if(!written||!retained.size)return;
      const assetsDirectory=path.join(directory,'assets');await mkdir(assetsDirectory,{recursive:true});
      const info=await lstat(assetsDirectory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('The generated assets directory must be a regular directory.');
      for(const[name,bytes]of retained){
        if(current.has(name))continue;
        try{await writeFile(path.join(directory,name),bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      }
    },
  };
}
