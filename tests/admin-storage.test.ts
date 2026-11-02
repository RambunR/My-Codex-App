import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Server} from 'node:http';
import sharp from 'sharp';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-admin-storage-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';delete process.env.S3_BUCKET;
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const {getUser}=await import('../server/auth');
const origin='https://admin-storage.example.test',initialUsed=6*1024**3;
interface Actor{id:string;cookie:string}
let server:Server,base:string,cover:Buffer,video:Buffer;
function actor(role:'admin'|'publisher'='admin'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,quota_bytes,used_bytes) VALUES (?,?,?,?,?,?,?,?)',id,id+'@admin-storage.test','Storage '+role,'unused-local-fixture',role,role==='admin'?0:1,0,initialUsed);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3600_000);return{id,cookie:'drama_session='+token};
}
function series(owner:Actor){const id=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres,status) VALUES (?,?,?,?,?,?,?)',id,owner.id,'Storage regression '+id,'An original drama used only by a local storage regression fixture.','en','["drama"]','draft');return id;}
async function request(route:string,identity:Actor,body?:unknown,status=200){
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:identity.cookie,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
async function upload(id:string,identity:Actor,kind:'cover'|'video',bytes=kind==='cover'?cover:video,status=kind==='cover'?200:201){
  const form=new FormData();form.append(kind,new Blob([new Uint8Array(bytes)],{type:kind==='cover'?'image/png':'video/mp4'}),kind==='cover'?'cover.png':'episode.mp4');if(kind==='video'){form.append('title','Original episode');form.append('number','1');}
  const response=await fetch(base+'/api/studio/series/'+id+(kind==='cover'?'/cover':'/episodes'),{method:'POST',headers:{Cookie:identity.cookie,Origin:origin},body:form});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
const financial=()=>({users:all('SELECT id,role,publisher_active,quota_bytes,wallet_micros,earnings_micros FROM users ORDER BY id'),payments:all('SELECT * FROM payments ORDER BY id'),testPayments:all('SELECT * FROM test_payments ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id')});
before(async()=>{
  config.appUrl=origin;cover=await sharp({create:{width:64,height:64,channels:3,background:'#59679a'}}).png().toBuffer();const file=path.join(directory,'fixture.mp4');
  await promisify(execFile)(config.ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=64x64:r=1','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',file]);video=await readFile(file);
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('admin-owned cover and direct episode uploads exceed the stored quota without changing finances or the numeric quota',async()=>{
  const admin=actor(),id=series(admin),before=financial();const image=await upload(id,admin,'cover');assert.equal(image.owner_storage.storage_unlimited,true);assert.equal(image.user.storage_unlimited,true);assert.equal(image.owner_storage.quota_bytes,0);
  const coverBytes=one('SELECT cover_bytes FROM series WHERE id=?',id)!.cover_bytes;assert.ok(coverBytes>0);assert.equal(image.owner_storage.used_bytes,initialUsed+coverBytes);
  const episode=await upload(id,admin,'video');assert.equal(episode.owner_storage.storage_unlimited,true);assert.equal(episode.owner_storage.used_bytes,initialUsed+coverBytes+episode.bytes);assert.ok(episode.bytes>0);assert.deepEqual(financial(),before);
  assert.equal((await request('/api/studio/series/'+id,admin)).owner_storage.storage_unlimited,true);assert.equal((await request('/api/studio',admin)).user.storage_unlimited,true);assert.equal((await request('/api/admin',admin)).users.find((user:any)=>user.id===admin.id).storage_unlimited,true);
  const result=await request('/api/studio/storage-requests',admin,{requested_gb:100,reason:'There is already unlimited administrator storage.'},400);assert.equal(result.error.code,'STORAGE_UNLIMITED');assert.equal(one('SELECT COUNT(*) AS n FROM storage_requests WHERE user_id=?',admin.id)!.n,0);
});

test('publisher quotas still reject covers and episodes, including uploads by an administrator to that publisher series',async()=>{
  const owner=actor('publisher'),admin=actor(),id=series(owner),before=financial();
  for(const identity of [owner,admin])for(const kind of ['cover','video'] as const){const result=await upload(id,identity,kind,undefined,413);assert.equal(result.error.code,'QUOTA_EXCEEDED');}
  assert.equal((await request('/api/studio/series/'+id,admin)).owner_storage.storage_unlimited,false);assert.equal(getUser(owner.id)!.storage_unlimited,false);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',owner.id)!.used_bytes,initialUsed);assert.deepEqual(financial(),before);
});

test('unlimited storage does not bypass media validation, sandbox upload disablement, ownership or payment review holds',async()=>{
  const admin=actor(),other=actor('publisher'),id=series(admin),before=financial();await upload(id,admin,'video',Buffer.from('invalid MP4'),422);await upload(id,admin,'cover',Buffer.from('invalid PNG'),422);await upload(id,other,'video',undefined,403);
  config.sandbox=true;try{await upload(id,admin,'video',undefined,403);await upload(id,admin,'cover',undefined,403);}finally{config.sandbox=false;}
  const hold=randomUUID();run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES (?,?,?,?,?,?,?)',hold,'default',0,'dispute','admin-storage-hold-'+hold,admin.id,'open');
  try{await upload(id,admin,'video',undefined,423);await upload(id,admin,'cover',undefined,423);}finally{run("UPDATE payment_risk_cases SET status='resolved' WHERE id=?",hold);}
  assert.equal(one('SELECT COUNT(*) AS n FROM episodes WHERE series_id=?',id)!.n,0);assert.equal(one('SELECT used_bytes FROM users WHERE id=?',admin.id)!.used_bytes,initialUsed);assert.deepEqual(financial(),before);
});

test('removing an administrator role restores the unchanged publisher quota immediately',async()=>{
  const admin=actor(),id=series(admin);assert.equal(getUser(admin.id)!.storage_unlimited,true);run("UPDATE users SET role='publisher',publisher_active=1 WHERE id=?",admin.id);
  assert.equal(getUser(admin.id)!.storage_unlimited,false);await upload(id,admin,'video',undefined,413);await upload(id,admin,'cover',undefined,413);assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',admin.id)!.quota_bytes,0);
});

test('storage checks do not promote a different verified administrator candidate inside upload transactions',async()=>{
  const owner=actor('publisher'),editor=actor(),id=series(owner),email=one('SELECT email FROM users WHERE id=?',owner.id)!.email;
  run('INSERT INTO account_email_verifications (user_id,verified_email,verified_at) VALUES (?,?,?)',owner.id,email,new Date().toISOString());config.platformAdminEmailHash=createHash('sha256').update(email).digest('hex');
  try{
    // Cover capacity is read atomically after storage completes. A role-changing
    // getUser call here would attempt BEGIN inside the existing transaction.
    await upload(id,editor,'cover',undefined,413);assert.equal(one('SELECT role FROM users WHERE id=?',owner.id)!.role,'publisher');
    await upload(id,editor,'video',undefined,413);assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',owner.id)!.n,0);
    // The owner's real authenticated request establishes audited admin access.
    assert.equal((await request('/api/auth/me',owner)).user.storage_unlimited,true);assert.equal(one('SELECT role FROM users WHERE id=?',owner.id)!.role,'admin');
    const accepted=await upload(id,editor,'cover');assert.equal(accepted.owner_storage.storage_unlimited,true);assert.equal(one('SELECT COUNT(*) AS n FROM platform_owner_access_events WHERE user_id=?',owner.id)!.n,1);assert.equal(one('SELECT quota_bytes FROM users WHERE id=?',owner.id)!.quota_bytes,0);
  }finally{config.platformAdminEmailHash='';}
});
