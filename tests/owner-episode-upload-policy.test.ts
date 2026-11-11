import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-owner-episode-policy-'));
Object.assign(process.env,{DATA_DIR:directory,NODE_ENV:'test',SEED_DEMO:'false',PAYMENTS_MODE:'disabled',STRIPE_TEST_MODE:'false',PLATFORM_OWNER_USER_ID:'',PLATFORM_ADMIN_EMAIL_SHA256:''});
const {config}=await import('../server/config');
const {db,one,all,run,transaction}=await import('../server/db');
const {episodeUploadLimits,assertEpisodeUploadDuration}=await import('../server/episode-upload-policy');
const {MAX_EPISODE_SECONDS,MAX_TRACKED_EPISODE_SECONDS,MAX_EPISODE_BYTES}=await import('../shared/config');
const {AppError}=await import('../server/errors');
const {bindRuntime}=await import('../cloudflare/runtime');
const {prepareVideo}=await import('../cloudflare/storage');
after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
function account(role:'publisher'|'admin'='admin',email?:string){
  const id=randomUUID();run('INSERT INTO users(id,email,name,password_hash,role,publisher_active) VALUES(?,?,?,?,?,1)',id,email||id+'@owner-duration.test','LingYingDrama Offical','!unused-fixture',role);return id;
}
function clearOwner(){config.platformOwnerUserId='';config.platformAdminEmailHash='';}
function rejects(action:()=>unknown,code='VIDEO_TOO_LONG'){
  assert.throws(action,(error:unknown)=>error instanceof AppError&&error.status===422&&error.code===code);
}

test('only the pinned administrator receives longer episodes while every owner retains the 200 MiB cap',()=>{
  clearOwner();const owner=account(),otherAdmin=account(),publisher=account('publisher');config.platformOwnerUserId=owner;
  try{
    assert.deepEqual(episodeUploadLimits(owner),{maxEpisodeSeconds:null,maxEpisodeBytes:MAX_EPISODE_BYTES});
    for(const id of [otherAdmin,publisher,'missing-user'])assert.deepEqual(episodeUploadLimits(id),{maxEpisodeSeconds:MAX_EPISODE_SECONDS,maxEpisodeBytes:MAX_EPISODE_BYTES});
    for(const seconds of [301,7200,36000,MAX_TRACKED_EPISODE_SECONDS])assertEpisodeUploadDuration(owner,seconds);
    rejects(()=>assertEpisodeUploadDuration(owner,MAX_TRACKED_EPISODE_SECONDS+1),'INVALID_VIDEO');
    for(const id of [otherAdmin,publisher]){assertEpisodeUploadDuration(id,300);rejects(()=>assertEpisodeUploadDuration(id,300.001));}
  }finally{clearOwner();}
});

test('a matching display name or verified administrator email cannot substitute for the immutable owner ID',()=>{
  clearOwner();const owner=account(),namedAdmin=account('admin','jimmy.tsoi2001@gmail.com');config.platformOwnerUserId=owner;
  config.platformAdminEmailHash=createHash('sha256').update('jimmy.tsoi2001@gmail.com').digest('hex');
  run('INSERT INTO account_email_verifications(user_id,verified_email,verified_at) VALUES(?,?,?)',namedAdmin,'jimmy.tsoi2001@gmail.com',new Date().toISOString());
  try{assert.equal(episodeUploadLimits(namedAdmin).maxEpisodeSeconds,300);rejects(()=>assertEpisodeUploadDuration(namedAdmin,301));}
  finally{clearOwner();}
});

test('an unconfigured owner or a pinned ordinary publisher never gains the duration exception',()=>{
  clearOwner();const admin=account(),publisher=account('publisher');
  assert.equal(episodeUploadLimits(admin).maxEpisodeSeconds,300);config.platformOwnerUserId=publisher;
  try{assert.equal(episodeUploadLimits(publisher).maxEpisodeSeconds,300);rejects(()=>assertEpisodeUploadDuration(publisher,301));}
  finally{clearOwner();}
});

test('duration validation rechecks persisted roles without promoting an owner inside an existing write transaction',()=>{
  clearOwner();const owner=account();config.platformOwnerUserId=owner;
  try{
    assert.equal(episodeUploadLimits(owner).maxEpisodeSeconds,null);
    run("UPDATE users SET role='publisher' WHERE id=?",owner);
    const before=all('SELECT * FROM platform_owner_access_events');
    transaction(()=>{assert.equal(episodeUploadLimits(owner).maxEpisodeSeconds,300);rejects(()=>assertEpisodeUploadDuration(owner,301));});
    assert.equal(one('SELECT role FROM users WHERE id=?',owner)!.role,'publisher');assert.deepEqual(all('SELECT * FROM platform_owner_access_events'),before);
  }finally{clearOwner();}
});

test('owner limits are independent of live/test payment selection and reject unreadable or nonfinite durations',()=>{
  clearOwner();const owner=account();config.platformOwnerUserId=owner;
  try{
    for(const testMode of [false,true]){config.stripeTestMode=testMode;assert.equal(episodeUploadLimits(owner).maxEpisodeSeconds,null);}
    for(const value of [0,-1,NaN,Infinity])rejects(()=>assertEpisodeUploadDuration(owner,value),'INVALID_VIDEO');
  }finally{config.stripeTestMode=false;clearOwner();}
});

test('Cloudflare metadata accepts the server-selected unlimited policy while its default remains five minutes',async()=>{
  const original=await readFile(new URL('./fixtures/cloudflare-media/long-video.mp4',import.meta.url));
  const video=Buffer.from(original),movie=video.indexOf('mvhd');assert.ok(movie>=0);assert.equal(video[movie+4],0);
  const seconds=7200;video.writeUInt32BE(1000,movie+16);video.writeUInt32BE(seconds*1000,movie+20);
  bindRuntime({} as any,{MEDIA:{head:async()=>({size:video.length}),get:async(_key:string,options:{range:{offset:number;length:number}})=>({arrayBuffer:async()=>Uint8Array.from(video.subarray(options.range.offset,options.range.offset+options.range.length)).buffer})}} as any);
  await assert.rejects(prepareVideo('tmp/long-owner-fixture'),(error:unknown)=>error instanceof AppError&&error.code==='VIDEO_TOO_LONG');
  const accepted=await prepareVideo('tmp/long-owner-fixture',null);assert.equal(accepted.duration,seconds);assert.equal(accepted.bytes,video.length);
});
