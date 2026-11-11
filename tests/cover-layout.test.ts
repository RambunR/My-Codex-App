import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import sharp from 'sharp';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-cover-layout-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
delete process.env.S3_BUCKET;
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {one,all,run,db}=await import('../server/db');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const {setSeriesModeration}=await import('../server/moderation');
const origin='https://cover-layout.example.test';
const details={title:'An original cover layout drama',description:'A complete original short drama synopsis for cover layout regression tests.',language:'en',genres:['drama'],creation_type:'human',price_cents:10,free_episodes:1};
interface Actor{id:string;cookie:string}
let owner:Actor,other:Actor,viewer:Actor,admin:Actor,server:Server,base:string,wideCover:Buffer;
function identity(role='publisher'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?,?)',id,id+'@cover-layout.test','Cover creator '+id,'unused-local-hash',role,role==='viewer'?0:1,1_000_000,700_000);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);
  return{id,cookie:'drama_session='+token};
}
async function request(route:string,body?:unknown,actor?:Actor,status=200,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+route,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,status,method+' '+route+': '+JSON.stringify(data));return data;
}
async function create(values:Record<string,unknown>={},actor=owner){return(await request('/api/studio/series',{...details,title:'Cover '+randomUUID(),...values},actor,201)).id as string;}
async function edit(id:string,values:Record<string,unknown>={},actor=owner,status=200){const current=one('SELECT title FROM series WHERE id=?',id)!;return request('/api/studio/series/'+id,{...details,title:current.title,...values},actor,status,'PATCH');}
async function read(id:string,actor=owner){return(await request('/api/studio/series/'+id,undefined,actor)).series;}
function legacy(){const id=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,cover_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,owner.id,'Legacy retained cover',details.description,'en','["drama"]','human',10,1,'public:/images/midnight.jpg',1234);return id;}
function publish(id:string){run("UPDATE series SET status='published' WHERE id=?",id);}
function snapshot(){return{users:all('SELECT * FROM users ORDER BY id'),episodes:all('SELECT * FROM episodes ORDER BY id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),payments:all('SELECT * FROM payments ORDER BY id'),testPayments:all('SELECT * FROM test_payments ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id')};}
async function upload(id:string,actor=owner,status=200){const form=new FormData();form.append('cover',new Blob([new Uint8Array(wideCover)],{type:'image/png'}),'entire-original-frame.png');const response=await fetch(base+'/api/studio/series/'+id+'/cover',{method:'POST',headers:{Cookie:actor.cookie,Origin:origin},body:form});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
async function coverBytes(id:string){const response=await fetch(base+'/api/studio/series/'+id+'/cover',{headers:{Cookie:owner.cookie},redirect:'manual'});assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());}
before(async()=>{
  config.appUrl=origin;owner=identity();other=identity();viewer=identity('viewer');admin=identity('admin');
  const width=800,height=400,pixels=Buffer.alloc(width*height*3);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*3;const color=x<160?[240,20,30]:x>=640?[15,30,245]:[20,220,40];for(let channel=0;channel<3;channel++)pixels[index+channel]=color[channel];}
  wideCover=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer();
  const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('new uploads default to persisted 9:16 and all creator-selectable cover ratios survive additive initialization',async()=>{
  const defaultId=await create();assert.equal((await read(defaultId)).cover_aspect_ratio,'9:16');assert.equal(one('SELECT aspect_ratio FROM series_cover_layouts WHERE series_id=?',defaultId)!.aspect_ratio,'9:16');
  const created=[];for(const ratio of ['9:16','1:1','16:9']){const id=await create({cover_aspect_ratio:ratio});created.push({id,ratio});assert.equal((await read(id)).cover_aspect_ratio,ratio);}
  const before=snapshot();db.exec(DATABASE_SCHEMA);createApp();assert.deepEqual(snapshot(),before);for(const{id,ratio}of created)assert.equal((await read(id)).cover_aspect_ratio,ratio);
});

test('legacy series read as 2:3 without rewriting their media, quota or cover-layout metadata',async()=>{
  const id=legacy(),before=one('SELECT * FROM series WHERE id=?',id),money=snapshot();
  assert.equal(one('SELECT * FROM series_cover_layouts WHERE series_id=?',id),undefined);assert.equal((await read(id)).cover_aspect_ratio,'2:3');publish(id);
  assert.equal((await request('/api/series/'+id)).series.cover_aspect_ratio,'2:3');await request('/api/series');await request('/api/admin/series',undefined,admin);
  db.exec(DATABASE_SCHEMA);createApp();assert.equal((await read(id)).cover_aspect_ratio,'2:3');assert.equal(one('SELECT * FROM series_cover_layouts WHERE series_id=?',id),undefined);
  const after=one('SELECT * FROM series WHERE id=?',id)!;assert.equal(after.cover_key,before!.cover_key);assert.equal(after.cover_bytes,before!.cover_bytes);assert.deepEqual(snapshot(),money);
});

test('omitted legacy-client edits preserve both an explicit cover selection and the untouched legacy fallback',async()=>{
  const selected=await create({cover_aspect_ratio:'16:9'}),old=legacy();await edit(selected,{title:'An old editor changes the title'});await edit(old,{title:'An old editor changes legacy metadata'});
  assert.equal((await read(selected)).cover_aspect_ratio,'16:9');assert.equal((await read(old)).cover_aspect_ratio,'2:3');assert.equal(one('SELECT * FROM series_cover_layouts WHERE series_id=?',old),undefined);
  await edit(old,{cover_aspect_ratio:'1:1'});await edit(old,{title:'A later edit without the ratio'});assert.equal((await read(old)).cover_aspect_ratio,'1:1');
});

test('invalid, null and legacy-only cover choices are rejected atomically on create and update',async()=>{
  const id=await create({cover_aspect_ratio:'1:1'}),before=one('SELECT * FROM series WHERE id=?',id),layout=one('SELECT * FROM series_cover_layouts WHERE series_id=?',id),count=one('SELECT COUNT(*) AS n FROM series')!.n;
  for(const cover_aspect_ratio of ['2:3','4:3','9 / 16','9:16; DROP TABLE series','',null,1,{},['9:16']]){
    await request('/api/studio/series',{...details,cover_aspect_ratio},owner,400);await edit(id,{title:'This invalid edit must roll back',cover_aspect_ratio},owner,400);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM series')!.n,count);assert.deepEqual(one('SELECT * FROM series WHERE id=?',id),before);assert.deepEqual(one('SELECT * FROM series_cover_layouts WHERE series_id=?',id),layout);
});

test('selected cover layout appears consistently in public, Studio, administrator, history and publisher responses',async()=>{
  const id=await create({cover_aspect_ratio:'1:1'});publish(id);const episode=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'Retained short episode',1,1,64,'private/layout-episode.mp4');run('INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?)',viewer.id,episode,0.5);
  const detail=(await request('/api/series/'+id)).series,publicList=(await request('/api/series')).series.find((row:any)=>row.id===id),studio=(await request('/api/studio',undefined,owner)).series.find((row:any)=>row.id===id),managed=(await request('/api/admin/series?limit=50',undefined,admin)).series.find((row:any)=>row.id===id),history=(await request('/api/history',undefined,viewer)).history.find((row:any)=>row.id===id),publisher=(await request('/api/publishers/'+detail.publisher_id)).series.find((row:any)=>row.id===id);
  for(const row of [detail,publicList,studio,managed,history,publisher,await read(id)])assert.equal(row.cover_aspect_ratio,'1:1');assert.equal(detail.creator_id,undefined);assert.equal(studio.creator_id,owner.id);assert.equal(managed.creator_id,owner.id);
});

test('cover layout edits retain creator ownership, moderator locks and administrator audit evidence',async()=>{
  const id=await create({cover_aspect_ratio:'9:16'}),before=snapshot();await request('/api/studio/series',{...details,cover_aspect_ratio:'1:1'},undefined,401);await request('/api/studio/series',{...details,cover_aspect_ratio:'1:1'},viewer,403);await edit(id,{cover_aspect_ratio:'16:9'},other,403);assert.equal((await read(id)).cover_aspect_ratio,'9:16');
  setSeriesModeration(admin.id,id,'takedown','A rights complaint requires a private content review.');await edit(id,{cover_aspect_ratio:'16:9'},owner,423);assert.equal((await read(id)).cover_aspect_ratio,'9:16');
  await edit(id,{cover_aspect_ratio:'1:1'},admin);assert.equal((await read(id)).cover_aspect_ratio,'1:1');const events=(await request('/api/admin/series/'+id+'/moderation',undefined,admin)).events,changed=events.find((event:any)=>event.action==='metadata');assert.equal(changed.snapshot.before.cover_aspect_ratio,'9:16');assert.equal(changed.snapshot.after.cover_aspect_ratio,'1:1');assert.deepEqual(snapshot(),before);assert.equal(one('SELECT creator_id FROM series WHERE id=?',id)!.creator_id,owner.id);await request('/api/series/'+id,undefined,undefined,404);
});

test('cover layout changes preserve the complete original frame and do not resave media or alter charged quota',async()=>{
  const id=await create({cover_aspect_ratio:'9:16'});await upload(id);const stored=await coverBytes(id),metadata=await sharp(stored).metadata();assert.equal(metadata.width,800);assert.equal(metadata.height,400);
  const decoded=await sharp(stored).removeAlpha().raw().toBuffer({resolveWithObject:true});const pixel=(x:number)=>Array.from(decoded.data.subarray((200*decoded.info.width+x)*decoded.info.channels,(200*decoded.info.width+x)*decoded.info.channels+3));const left=pixel(3),right=pixel(796);assert.ok(left[0]>200&&left[1]<50&&left[2]<60,'The original left edge must remain visible');assert.ok(right[2]>200&&right[0]<60&&right[1]<60,'The original right edge must remain visible');
  const before=snapshot(),reference=one('SELECT cover_key,cover_bytes FROM series WHERE id=?',id),hash=createHash('sha256').update(stored).digest('hex');
  for(const cover_aspect_ratio of ['1:1','16:9','9:16']){await edit(id,{cover_aspect_ratio});assert.equal(createHash('sha256').update(await coverBytes(id)).digest('hex'),hash);assert.deepEqual(one('SELECT cover_key,cover_bytes FROM series WHERE id=?',id),reference);assert.deepEqual(snapshot(),before);}
  await upload(id,other,403);assert.deepEqual(snapshot(),before);
});

test('Cloudflare cover validation, storage and streaming retain the original image bytes and actual content type',async()=>{
  const {bindRuntime}=await import('../cloudflare/runtime');const {prepareCover,putObject,serveObject}=await import('../cloudflare/storage');const express=(await import('express')).default;
  const objects=new Map<string,{bytes:Buffer;contentType:string}>([['tmp/original-frame',{bytes:wideCover,contentType:'image/png'}]]);
  const bucket={head:async(key:string)=>{const object=objects.get(key);return object?{size:object.bytes.length}:null;},get:async(key:string,options?:{range?:{offset:number;length:number}})=>{const object=objects.get(key);if(!object)return null;const range=options?.range,bytes=range?object.bytes.subarray(range.offset,range.offset+range.length):object.bytes;return{arrayBuffer:async()=>Uint8Array.from(bytes).buffer,body:new Response(new Uint8Array(bytes)).body,httpMetadata:{contentType:object.contentType}};},put:async(key:string,body:ReadableStream,options:{httpMetadata:{contentType:string}})=>{objects.set(key,{bytes:Buffer.from(await new Response(body).arrayBuffer()),contentType:options.httpMetadata.contentType});}};
  bindRuntime({} as any,{MEDIA:bucket} as any);const processed=await prepareCover('tmp/original-frame');assert.equal(processed.path,'tmp/original-frame');assert.equal(processed.bytes,wideCover.length);await putObject(processed.path,'covers/frame.webp','image/webp');assert.deepEqual(objects.get('covers/frame.webp')!.bytes,wideCover);assert.equal(objects.get('covers/frame.webp')!.contentType,'image/png');
  const app=express();app.get('/cover',(req,res,next)=>{void serveObject('covers/frame.webp',req,res,'image/webp').catch(next);});const local=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>local.once('listening',resolve));
  try{const response=await fetch('http://127.0.0.1:'+(local.address() as {port:number}).port+'/cover');assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/^image\/png/);assert.equal(Number(response.headers.get('content-length')),wideCover.length);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wideCover);}finally{await new Promise<void>(resolve=>local.close(()=>resolve()));}
});
