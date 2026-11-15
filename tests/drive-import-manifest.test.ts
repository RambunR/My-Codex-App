import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {MAX_EPISODE_BYTES} from '../shared/config';
import {parseDriveManifest,matchDriveManifestFiles,DriveManifestError,MAX_DRIVE_MANIFEST_BYTES,DRIVE_DRAFT_DESCRIPTION,isDriveSeriesFolderName,validDriveId,driveFileRevision} from '../shared/drive-import-manifest';
import type {DriveFile} from '../shared/drive-import-types';

const digest='a'.repeat(64),generator=path.resolve('scripts/create-drive-manifests.mjs');
const runGenerator=(args:string[])=>promisify(execFile)(process.execPath,[generator,...args],{timeout:15000,maxBuffer:1024*1024});
const base=()=>({version:1,series:{title:'An original test drama'},episodes:[{name:'001_Original_003.mp4',bytes:12,sha256:digest,number:3},{name:'001_Original_010.mp4',bytes:15,sha256:digest.toUpperCase(),number:10}]});
function remote(name:string,size:number,id=name.replace(/[^A-Za-z0-9_-]/g,'_')):DriveFile{return{id,name,size,mimeType:'video/mp4',version:'1',modifiedTime:'2026-11-15T00:00:00.000Z',parents:['series-folder']};}
function rejects(action:()=>unknown,code='INVALID_DRIVE_MANIFEST'){assert.throws(action,(error:unknown)=>error instanceof DriveManifestError&&error.code===code);}
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){const dir=await mkdtemp(path.join(tmpdir(),'lingying-drive-manifest-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('strict ready manifests normalize hashes and supply clearly reviewable draft defaults while preserving numbered gaps',()=>{
  const manifest=parseDriveManifest('\uFEFF'+JSON.stringify(base()));assert.deepEqual(manifest.episodes.map(item=>item.number),[3,10]);assert.equal(manifest.episodes[1].sha256,digest);
  assert.equal(manifest.series.description,DRIVE_DRAFT_DESCRIPTION);assert.equal(manifest.series.language,'en');assert.deepEqual(manifest.series.genres,['drama']);assert.equal(manifest.series.creation_type,'ai-generated');
  assert.equal(isDriveSeriesFolderName('001_clip'),true);assert.equal(isDriveSeriesFolderName('002_clips'),true);assert.equal(isDriveSeriesFolderName('1000_clips'),true);assert.equal(isDriveSeriesFolderName('../001_clip'),false);assert.equal(isDriveSeriesFolderName('unrelated'),false);
  assert.equal(validDriveId('folder-id_123'),true);for(const value of ["x' in parents",'../secret','https://attacker.test',null,''])assert.equal(validDriveId(value),false);
});
test('manifest account, payment, URL and instruction fields cannot become import authority',()=>{
  for(const field of ['creator_id','price_cents','free_episodes','url','instructions'])rejects(()=>parseDriveManifest({...base(),[field]:'untrusted'}));
  rejects(()=>parseDriveManifest({...base(),series:{...base().series,publisher_profile_id:'other-owner'}}));
  rejects(()=>parseDriveManifest({...base(),series:{title:'Valid title',language:'not-a-language'}}));
  rejects(()=>parseDriveManifest({...base(),series:{title:'Valid title',genres:['drama','drama']}}));
  rejects(()=>parseDriveManifest('not JSON'));rejects(()=>parseDriveManifest(' '.repeat(MAX_DRIVE_MANIFEST_BYTES+1)));
});
test('manifest filename, checksum, count and size constraints reject ambiguous or unsafe files',()=>{
  for(const name of ['../episode.mp4','/episode.mp4','C:\\episode.mp4','episode\n.mp4','.hidden.mp4','https://example.test/episode.mp4'])rejects(()=>parseDriveManifest({...base(),episodes:[{...base().episodes[0],name}]}));
  rejects(()=>parseDriveManifest({...base(),episodes:[{...base().episodes[0],bytes:MAX_EPISODE_BYTES+1}]}));
  rejects(()=>parseDriveManifest({...base(),episodes:[{...base().episodes[0],sha256:'not-a-hash'}]}));
  rejects(()=>parseDriveManifest({...base(),episodes:[]}));rejects(()=>parseDriveManifest({...base(),episodes:Array.from({length:1001},(_,index)=>({...base().episodes[0],name:index+'.mp4',number:index+1}))}));
  rejects(()=>parseDriveManifest({...base(),episodes:[base().episodes[0],{...base().episodes[1],number:3}]}));
  rejects(()=>parseDriveManifest({...base(),episodes:[base().episodes[0],{...base().episodes[1],name:base().episodes[0].name}]}));
  rejects(()=>parseDriveManifest({...base(),cover:{name:'poster.png',bytes:5*1024*1024+1,sha256:digest}}));
});
test('matching requires all exact files and no additional MP4, while ordinary sidecars can be ignored',()=>{
  const manifest=parseDriveManifest(base()),files=manifest.episodes.map(item=>remote(item.name,item.bytes));
  const matched=matchDriveManifestFiles(manifest,[...files,remote('notes.txt',9),{...remote('Readme',0),mimeType:'application/vnd.google-apps.document'}]);assert.deepEqual(matched.episodes.map(item=>item.manifest.number),[3,10]);
  rejects(()=>matchDriveManifestFiles(manifest,files.slice(0,1)),'DRIVE_FILES_PENDING');
  rejects(()=>matchDriveManifestFiles(manifest,[{...files[0],size:11},files[1]]),'DRIVE_FILES_PENDING');
  rejects(()=>matchDriveManifestFiles(manifest,[...files,remote('trailer.mp4',7)]),'DRIVE_FILES_UNEXPECTED');
  rejects(()=>matchDriveManifestFiles(manifest,[...files,{...files[0],id:'duplicate-other-id'}]),'DRIVE_FILES_AMBIGUOUS');
  rejects(()=>matchDriveManifestFiles(manifest,[files[0],{...files[1],id:files[0].id}]),'DRIVE_FILES_AMBIGUOUS');
  rejects(()=>matchDriveManifestFiles(manifest,[files[0],{...files[1],mimeType:'application/vnd.google-apps.shortcut'}]),'DRIVE_FILES_AMBIGUOUS');
  rejects(()=>matchDriveManifestFiles(manifest,[{...files[0],sha256Checksum:'b'.repeat(64)},files[1]]),'DRIVE_CHECKSUM_MISMATCH');
});
test('file revision fingerprints are stable and detect content, rename and parent changes',()=>{
  const file=remote('episode.mp4',12);assert.equal(driveFileRevision(file),driveFileRevision({...file,parents:[...(file.parents||[])]}));
  for(const values of [{version:'2'},{size:13},{name:'renamed.mp4'},{parents:['outside-root']},{sha256Checksum:digest}])assert.notEqual(driveFileRevision(file),driveFileRevision({...file,...values}));
});
test('portable generator preserves trailing episode numbers, hashes source files and never changes videos',async t=>{
  const root=await fixture(t),folder=path.join(root,'001_clip');await mkdir(folder);
  const three=Buffer.from('original episode three'),ten=Buffer.from('original episode ten');
  await writeFile(path.join(folder,'001_Original_003.mp4'),three);await writeFile(path.join(folder,'001_Original_010.mp4'),ten);await writeFile(path.join(folder,'notes.txt'),'not an episode');
  const {stdout}=await runGenerator([root]);const report=JSON.parse(stdout);assert.equal(report.errors.length,0);assert.equal(report.uploadsPerformed,false);assert.equal(report.sourceMediaChanged,false);
  const manifest=parseDriveManifest(await readFile(path.join(folder,'lingying-ready.json'),'utf8'));assert.equal(manifest.series.title,'Original');assert.deepEqual(manifest.episodes.map(item=>item.number),[3,10]);assert.deepEqual(manifest.episodes.map(item=>item.sha256),[sha(three),sha(ten)]);
  assert.deepEqual(await readFile(path.join(folder,manifest.episodes[0].name)),three);assert.deepEqual(await readFile(path.join(folder,manifest.episodes[1].name)),ten);
});
test('generator retains manual manifests and preserves edited series metadata on explicit regeneration',async t=>{
  const root=await fixture(t),folder=path.join(root,'002_clips');await mkdir(folder);await writeFile(path.join(folder,'005.mp4'),'episode five');
  await runGenerator([folder]);const target=path.join(folder,'lingying-ready.json'),edited=JSON.parse(await readFile(target,'utf8'));edited.series.title='Manually reviewed title';await writeFile(target,JSON.stringify(edited));const before=await readFile(target);
  const retained=await runGenerator([folder]);assert.equal(JSON.parse(retained.stdout).results[0].status,'retained');assert.deepEqual(await readFile(target),before);
  await runGenerator([folder,'--overwrite']);const after=parseDriveManifest(await readFile(target,'utf8'));assert.equal(after.series.title,'Manually reviewed title');assert.equal(after.episodes[0].number,5);
});
test('generator refuses duplicate episode suffixes, symbolic links and oversized media without marking the series ready',async t=>{
  const root=await fixture(t),folder=path.join(root,'003_clip');await mkdir(folder);await writeFile(path.join(folder,'003_One_001.mp4'),'one');await writeFile(path.join(folder,'003_Two_001.mp4'),'two');
  await assert.rejects(runGenerator([folder]));await assert.rejects(readFile(path.join(folder,'lingying-ready.json')),{code:'ENOENT'});
  await rm(path.join(folder,'003_Two_001.mp4'));await symlink(path.join(folder,'003_One_001.mp4'),path.join(folder,'004_link.mp4'));await assert.rejects(runGenerator([folder]));await rm(path.join(folder,'004_link.mp4'));
  const handle=await open(path.join(folder,'003_One_001.mp4'),'w');try{await handle.truncate(MAX_EPISODE_BYTES+1);}finally{await handle.close();}
  await assert.rejects(runGenerator([folder]));await assert.rejects(readFile(path.join(folder,'lingying-ready.json')),{code:'ENOENT'});
});
