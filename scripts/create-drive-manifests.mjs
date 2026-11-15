#!/usr/bin/env node
// Portable Node 18+ utility. Reads media and atomically writes readiness JSON;
// never uploads, transcodes, renames, deletes or changes source videos.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import {lstat,readdir,open,readFile,rename,link,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';

const MANIFEST='lingying-ready.json',MAX_MANIFEST=1024*1024,MAX_EPISODE=200*1024*1024,MAX_COVER=5*1024*1024;
const DESCRIPTION='Imported draft. Review the title, synopsis, language and genre in LingYing before publishing.';
const LANGUAGES=['en','cmn','yue','ja','ko','hi','id','pt-BR','es','ar','bn','ur','vi','th','fil','tr','ru','fr','de','ms','ta','zh-TW','zh-CN'];
const GENRES=['romance','romantic-comedy','drama','comedy','action','adventure','thriller','mystery','crime','horror','sci-fi','fantasy','supernatural','historical','family','detective','psychological','youth','coming-of-age','workplace','medical','legal','war-military','martial-arts','sports','music-dance','slice-of-life','tragedy','superhero','animation'];
const CREATION=['human','ai-assisted','ai-generated'];
const natural=new Intl.Collator('en',{numeric:true,sensitivity:'base'}),exact=new Intl.Collator('en',{numeric:true,sensitivity:'variant'});
const sorted=names=>names.sort((a,b)=>natural.compare(a,b)||exact.compare(a,b));
const seriesName=name=>/^\d{3,6}[_ -]clips?(?:[_ -].+)?$/iu.test(name)&&!/[\u0000-\u001f\u007f/\\]/u.test(name);
const safeName=name=>typeof name==='string'&&name.length>0&&name.length<=255&&name.trim().length>0&&!name.startsWith('.')&&!/[\u0000-\u001f\u007f/\\]/u.test(name);
const fingerprint=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const same=(a,b)=>fingerprint(a)===fingerprint(b);
async function optionalStat(file){try{return await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

async function hashFile(folder,name,maxBytes){
  check(safeName(name),'A media filename is invalid or exceeds 255 characters.');
  const file=path.join(folder,name),initial=await lstat(file);
  check(initial.isFile()&&!initial.isSymbolicLink(),'Only regular media files are accepted.');
  check(Number.isSafeInteger(initial.size)&&initial.size>0&&initial.size<=maxBytes,`A media file is empty or exceeds its ${maxBytes/1024/1024} MiB limit.`);
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const before=await handle.stat();check(same(before,initial),'A media file changed before checksum calculation.');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:64*1024})){bytes+=chunk.length;check(bytes<=maxBytes,'A media file grew beyond its size limit.');hash.update(chunk);}
    const after=await handle.stat(),current=await lstat(file);
    check(!current.isSymbolicLink()&&current.isFile()&&same(before,after)&&same(after,current)&&bytes===before.size,'A media file changed while its checksum was calculated. Finish exporting first.');
    return{name,bytes,sha256:hash.digest('hex'),snapshot:fingerprint(current)};
  }finally{await handle.close();}
}
function titleWithoutNumber(name,folder){
  let title=name.replace(/\.mp4$/iu,'').replace(/(?:^|[_ .-]+)\d{1,4}$/u,'');
  const prefix=/^(\d{3,6})[_ -]/u.exec(path.basename(folder))?.[1];
  if(prefix&&title.startsWith(prefix)&&/[_ .-]/u.test(title[prefix.length]||''))title=title.slice(prefix.length+1);
  return title.replace(/_+/gu,' ').replace(/\s+/gu,' ').trim();
}
function capped(value,max=120){let output='';for(const character of value){if(output.length+character.length>max)break;output+=character;}return output;}
function inferTitle(names,folder){
  const titles=names.map(name=>titleWithoutNumber(name,folder)).filter(title=>title.length>=2);
  if(titles.length&&titles.every(title=>title.toLowerCase()===titles[0].toLowerCase()))return capped(titles[0]);
  if(titles.length===1)return capped(titles[0]);
  return capped('Imported series '+path.basename(folder).replace(/[_-]+/gu,' '));
}
function episodeNumbers(names){
  const trailing=names.map(name=>/(?:^|[_ .-]+)(\d{1,4})$/u.exec(name.replace(/\.mp4$/iu,''))?.[1]);
  check(trailing.every(Boolean)||trailing.every(value=>!value),'Episode filenames mix numbered and unnumbered endings. Rename them consistently before preparing the manifest.');
  const numbers=trailing.every(Boolean)?trailing.map(Number):names.map((_name,index)=>index+1);
  check(numbers.every(number=>Number.isInteger(number)&&number>=1&&number<=1000)&&new Set(numbers).size===numbers.length,'Episode numbers must be unique and between 1 and 1000.');
  return numbers;
}
function metadata(series,overrides,names,folder){
  const value={title:overrides.title??series?.title??inferTitle(names,folder),description:overrides.description??series?.description??DESCRIPTION,language:overrides.language??series?.language??'en',genres:overrides.genre??series?.genres??['drama'],creation_type:overrides['creation-type']??series?.creation_type??'ai-generated'};
  check(typeof value.title==='string'&&value.title.trim().length>=2&&value.title.trim().length<=120,'The series title must contain 2–120 characters.');
  check(typeof value.description==='string'&&value.description.trim().length>=10&&value.description.trim().length<=4000,'The synopsis must contain 10–4000 characters.');
  check(LANGUAGES.includes(value.language),'The spoken language is not supported. Use en, cmn, yue, ja or another supported language code.');
  check(Array.isArray(value.genres)&&value.genres.length>=1&&value.genres.length<=3&&value.genres.every(genre=>GENRES.includes(genre))&&new Set(value.genres).size===value.genres.length,'Choose 1–3 distinct supported genre identifiers.');
  check(CREATION.includes(value.creation_type),'The creation type must be human, ai-assisted or ai-generated.');
  value.title=value.title.trim();value.description=value.description.trim();return value;
}
function coverName(names){
  const images=names.filter(name=>/\.(?:jpe?g|png|webp)$/iu.test(name));
  for(const stem of ['cover','poster','thumbnail','artwork']){const matches=images.filter(name=>new RegExp('^'+stem+'\\.(?:jpe?g|png|webp)$','iu').test(name));if(matches.length===1)return matches[0];if(matches.length>1)return null;}
  return images.length===1?images[0]:null;
}
async function inspectDirectory(folder){
  const info=await lstat(folder);check(info.isDirectory()&&!info.isSymbolicLink(),'Series directories must be real directories, not symbolic links.');
  const entries=await readdir(folder,{withFileTypes:true});check(entries.length<=20000,'A series folder contains more than 20,000 entries.');
  check(!entries.some(entry=>entry.isSymbolicLink()),'Symbolic links are not accepted inside a series folder.');
  return{info,names:sorted(entries.filter(entry=>entry.isFile()&&!entry.name.startsWith('.')).map(entry=>entry.name))};
}
export async function createDriveManifest(folder,overrides={}){
  const initial=await inspectDirectory(folder),target=path.join(folder,MANIFEST),old=await optionalStat(target);
  check(!old?.isSymbolicLink(),'The existing manifest must not be a symbolic link.');
  if(old&&!overrides.overwrite)return{folder:path.basename(folder),status:'retained',message:'Existing manifest retained. Use --overwrite to refresh it after source changes.'};
  let oldBytes=null,oldSeries;
  if(old){check(old.isFile()&&old.size<=MAX_MANIFEST,'The existing manifest is invalid or too large.');oldBytes=await readFile(target);try{oldSeries=JSON.parse(oldBytes.toString('utf8').replace(/^\uFEFF/u,'')).series;}catch{throw new Error('The existing manifest is invalid JSON; fix or move it before regeneration.');}}
  const names=initial.names.filter(name=>/\.mp4$/iu.test(name));
  check(names.length>=1&&names.length<=1000,'Each ready series must contain 1–1000 direct MP4 episode files.');
  const numbers=episodeNumbers(names),series=metadata(oldSeries,overrides,names,folder),hashed=[];
  for(let index=0;index<names.length;index++){
    const item=await hashFile(folder,names[index],MAX_EPISODE),suffix=' '+String(numbers[index]).padStart(3,'0');
    hashed.push({...item,number:numbers[index],title:capped(titleWithoutNumber(names[index],folder)||series.title,120-suffix.length)+suffix});
  }
  const selectedCover=overrides.cover??coverName(initial.names);
  check(selectedCover===null||typeof selectedCover==='string'&&safeName(selectedCover)&&/\.(?:jpe?g|png|webp)$/iu.test(selectedCover),'The cover filename must be a direct JPEG, PNG or WebP file.');
  const cover=selectedCover?await hashFile(folder,selectedCover,MAX_COVER):null;
  const current=await inspectDirectory(folder);
  check(current.info.dev===initial.info.dev&&current.info.ino===initial.info.ino,'The series directory changed during preparation.');
  check(JSON.stringify(current.names.filter(name=>/\.mp4$/iu.test(name)))===JSON.stringify(names),'Episode files were added or removed during preparation. Finish exporting first.');
  for(const item of [...hashed,...(cover?[cover]:[])])check(fingerprint(await lstat(path.join(folder,item.name)))===item.snapshot,'A source file changed before the manifest could be written.');
  const latest=await optionalStat(target);
  check(old?same(old,latest||{})&&!latest?.isSymbolicLink()&&createHash('sha256').update(await readFile(target)).digest('hex')===createHash('sha256').update(oldBytes).digest('hex'):!latest,'The manifest changed during preparation; no manual edits were overwritten.');
  const clean=({snapshot,...item})=>item;
  const manifest={version:1,series,episodes:hashed.map(clean).sort((a,b)=>a.number-b.number),...(cover?{cover:clean(cover)}:{})};
  const text=JSON.stringify(manifest,null,2)+'\n';check(Buffer.byteLength(text)<=MAX_MANIFEST,'The generated manifest exceeds 1 MiB.');
  const temp=path.join(folder,'.lingying-ready-'+randomUUID()+'.tmp');
  try{const handle=await open(temp,'wx',0o600);try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}if(old)await rename(temp,target);else await link(temp,target);}finally{await rm(temp,{force:true});}
  return{folder:path.basename(folder),status:'generated',title:series.title,episodes:manifest.episodes.length,cover:manifest.cover?.name||null,manifest:MANIFEST,reviewRequired:true};
}

export async function main(args=process.argv.slice(2)){
  const{values,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{help:{type:'boolean'},overwrite:{type:'boolean'},title:{type:'string'},description:{type:'string'},language:{type:'string'},genre:{type:'string',multiple:true},'creation-type':{type:'string'},cover:{type:'string'}}});
  if(values.help){console.log('Usage: node create-drive-manifests.mjs <parent-folder-or-001_clip> [--language en] [--genre drama] [--creation-type ai-generated] [--title "One series title"] [--description "Synopsis"] [--cover poster.jpg] [--overwrite]\n\nRequires Node 18+. Reads direct MP4 episodes in numbered folders, preserving unique trailing episode numbers. Writes lingying-ready.json atomically. Videos are never changed or uploaded. Existing manifests are retained unless --overwrite is specified; existing series metadata is preserved during overwrite unless explicitly overridden. Review the manifest metadata before uploading it with the complete series.');return;}
  check(positionals.length===1,'Provide one local parent folder or one numbered series folder. Use --help for details.');
  const root=path.resolve(positionals[0]),rootInfo=await lstat(root);check(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink(),'The input must be a real local directory.');
  let folders;
  if(seriesName(path.basename(root)))folders=[root];
  else{const entries=await readdir(root,{withFileTypes:true});check(entries.length<=20000,'The parent folder contains too many entries.');check(!entries.some(entry=>entry.isSymbolicLink()&&seriesName(entry.name)),'A numbered series folder is a symbolic link.');folders=sorted(entries.filter(entry=>entry.isDirectory()&&seriesName(entry.name)).map(entry=>entry.name)).map(name=>path.join(root,name));}
  check(folders.length>0&&folders.length<=1000,'No supported numbered series folders were found, or the folder contains more than 1000 series.');
  check(values.title===undefined||folders.length===1,'Use --title only with a single series folder. Edit individual manifests for multiple titles.');
  const results=[],errors=[];
  for(const folder of folders){try{results.push(await createDriveManifest(folder,values));}catch(error){errors.push({folder:path.basename(folder),message:error.message});}}
  console.log(JSON.stringify({results,errors,sourceMediaChanged:false,uploadsPerformed:false},null,2));if(errors.length)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error.message,sourceMediaChanged:false,uploadsPerformed:false}));process.exitCode=1;});
