import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {importSPKI,jwtVerify} from 'jose';
import {createGoogleDriveReader,googleDriveCredentials,GoogleDriveImportError,listDriveFolderFiles} from '../server/google-drive-import';
import type {DriveReader} from '../shared/drive-import-types';

const TOKEN='https://oauth2.googleapis.com/token',FILES='https://www.googleapis.com/drive/v3/files';
const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const email='lingying-reader@project.iam.gserviceaccount.com',raw=JSON.stringify({type:'service_account',client_email:email,private_key:pair.privateKey,token_uri:'https://attacker.test/token'});
const meta=(values:Record<string,unknown>={})=>({id:'file-one',name:'episode.mp4',mimeType:'video/mp4',size:'15',version:'7',modifiedTime:'2026-11-15T00:00:00.000Z',parents:['series-folder'],...values});
function fixture(handler:(url:URL,init:RequestInit)=>Promise<Response>|Response,clock=()=>Date.now(),authorization?:(init:RequestInit)=>Promise<Response>|Response){
  const calls:Array<{url:URL;init:RequestInit}>=[];let assertion='';
  const fetcher=(async(input:RequestInfo|URL,init:RequestInit={})=>{const url=new URL(input instanceof Request?input.url:String(input));calls.push({url,init});if(url.href===TOKEN){assertion=new URLSearchParams(String(init.body)).get('assertion')||'';return authorization?authorization(init):Response.json({access_token:'fake-test-token',expires_in:3600,token_type:'Bearer'});}return handler(url,init);}) as typeof fetch;
  return{reader:createGoogleDriveReader(raw,{fetch:fetcher,now:clock}),calls,assertion:()=>assertion};
}
const rejection=(code:string)=>(error:unknown)=>error instanceof GoogleDriveImportError&&error.code===code;

test('credential status is pure, hides keys and treats malformed values as unconfigured',()=>{
  const status=googleDriveCredentials(raw);assert.equal(status.configured,true);assert.equal(status.serviceAccountEmail,email);assert.match(status.fingerprint,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(status).includes('PRIVATE KEY'),false);
  for(const value of [undefined,'not JSON','{}',JSON.stringify({type:'authorized_user'}),JSON.stringify({type:'service_account',client_email:'attacker@test.example',private_key:pair.privateKey})])assert.deepEqual(googleDriveCredentials(value),{configured:false,serviceAccountEmail:null,fingerprint:''});
});
test('service account signs a fixed-audience readonly JWT, ignores token_uri and caches tokens per reader',async()=>{
  let now=Date.parse('2026-11-15T00:00:00Z');const f=fixture(()=>Response.json(meta()),()=>now);
  await f.reader.getFile('file-one');await f.reader.getFile('file-one');assert.equal(f.calls.filter(call=>call.url.href===TOKEN).length,1);
  const verified=await jwtVerify(f.assertion(),await importSPKI(pair.publicKey,'RS256'),{audience:TOKEN,issuer:email,currentDate:new Date(now)});assert.equal(verified.protectedHeader.alg,'RS256');assert.equal(verified.payload.scope,'https://www.googleapis.com/auth/drive.readonly');assert.equal(Number(verified.payload.exp)-Number(verified.payload.iat),3600);
  assert.ok(f.calls.every(call=>['oauth2.googleapis.com','www.googleapis.com'].includes(call.url.hostname)));assert.ok(f.calls.every(call=>call.init.redirect==='manual'));
  now+=3600_000;await f.reader.getFile('file-one');assert.equal(f.calls.filter(call=>call.url.href===TOKEN).length,2);
});
test('folder listing requests only direct untrashed children with bounded pages and keeps native sidecar documents',async()=>{
  const f=fixture(url=>{assert.equal(url.origin+url.pathname,FILES);assert.equal(url.searchParams.get('q'),"'series-folder' in parents and trashed = false");assert.equal(url.searchParams.get('pageSize'),'1000');assert.equal(url.searchParams.get('pageToken'),'next-page');assert.ok(url.searchParams.get('fields')?.includes('parents'));return Response.json({files:[meta(),meta({id:'notes-doc',name:'Read me',mimeType:'application/vnd.google-apps.document',size:undefined})],nextPageToken:'final-page'});});
  const page=await f.reader.listChildren('series-folder','next-page');assert.equal(page.files[0].size,15);assert.equal(page.files[1].size,0);assert.equal(page.nextPageToken,'final-page');
  const outside=fixture(()=>Response.json({files:[meta({parents:['outside-folder']})]}));await assert.rejects(outside.reader.listChildren('series-folder'),rejection('DRIVE_SOURCE_CHANGED'));
  const incomplete=fixture(()=>Response.json({files:[],incompleteSearch:true}));await assert.rejects(incomplete.reader.listChildren('series-folder'),rejection('DRIVE_UNAVAILABLE'));
});
test('bounded media reads require exact 206 Content-Range and never accept ignored range responses',async()=>{
  const f=fixture((_url,init)=>{assert.equal(new Headers(init.headers).get('Range'),'bytes=5-9');return new Response(Uint8Array.from([1,2,3,4,5]),{status:206,headers:{'Content-Range':'bytes 5-9/15'}});});assert.deepEqual(await f.reader.readRange('file-one',5,5,15),Uint8Array.from([1,2,3,4,5]));
  for(const response of [new Response('full object',{status:200}),new Response('short',{status:206,headers:{'Content-Range':'bytes 0-4/15'}}),new Response('x',{status:206,headers:{'Content-Range':'bytes 5-9/15'}}),new Response('123456',{status:206,headers:{'Content-Range':'bytes 5-9/15'}})]){const bad=fixture(()=>response);await assert.rejects(bad.reader.readRange('file-one',5,5,15),rejection('DRIVE_SOURCE_CHANGED'));}
  const invalid=fixture(()=>{throw new Error('Must not fetch an invalid range.');});for(const args of [[-1,5,15],[0,5*1024*1024+1,200*1024*1024],[10,10,15]])await assert.rejects(invalid.reader.readRange('file-one',...args as [number,number,number]),rejection('DRIVE_SOURCE_CHANGED'));assert.equal(invalid.calls.length,0);
});
test('manifest text downloads are bounded normal files with exact UTF-8 byte length',async()=>{
  const text='{"version":1,"title":"靈映"}',bytes=new TextEncoder().encode(text);
  const f=fixture(url=>url.searchParams.get('alt')==='media'?new Response(bytes):Response.json(meta({name:'lingying-ready.json',mimeType:'application/json',size:String(bytes.byteLength)})));assert.equal(await f.reader.readText('file-one'),text);
  const oversize=fixture(()=>Response.json(meta({size:String(1024*1024+1)})));await assert.rejects(oversize.reader.readText('file-one'),rejection('DRIVE_SOURCE_CHANGED'));assert.equal(oversize.calls.filter(call=>call.url.searchParams.get('alt')==='media').length,0);
  const doc=fixture(()=>Response.json(meta({mimeType:'application/vnd.google-apps.document',size:undefined})));await assert.rejects(doc.reader.readText('file-one'),rejection('DRIVE_SOURCE_CHANGED'));
});
test('provider failures expose safe status/code only and do not follow redirected URLs',async()=>{
  for(const[status,code]of [[403,'DRIVE_ACCESS_DENIED'],[404,'DRIVE_ACCESS_DENIED'],[429,'DRIVE_RATE_LIMITED'],[500,'DRIVE_UNAVAILABLE'],[302,'DRIVE_UNAVAILABLE']] as const){
    const f=fixture(()=>new Response('private-provider-body',{status,headers:{'Retry-After':'90',Location:'https://attacker.test'}}));
    await assert.rejects(f.reader.getFile('file-one'),(error:unknown)=>rejection(code)(error)&&error instanceof Error&&!error.message.includes('private-provider-body'));assert.equal(f.calls.length,2);
  }
});
test('authorization refresh occurs once and invalid source identities never enter a request URL',async()=>{
  let requests=0;const f=fixture(()=>++requests===1?new Response('expired',{status:401}):Response.json(meta()));assert.equal((await f.reader.getFile('file-one')).id,'file-one');assert.equal(f.calls.filter(call=>call.url.href===TOKEN).length,2);
  const invalid=fixture(()=>Response.json(meta()));await assert.rejects(invalid.reader.getFile('../private'),rejection('DRIVE_SOURCE_CHANGED'));assert.equal(invalid.calls.length,0);
});
test('bounded pagination rejects repeated continuation tokens and excessive entry counts',async()=>{
  const reader={listChildren:async()=>({files:[{id:'one'}],nextPageToken:'repeat'})} as unknown as DriveReader;
  await assert.rejects(listDriveFolderFiles(reader,'folder-root'),rejection('DRIVE_SOURCE_CHANGED'));
  const tooMany={listChildren:async()=>({files:[{id:'one'},{id:'two'}]})} as unknown as DriveReader;await assert.rejects(listDriveFolderFiles(tooMany,'folder-root',1),rejection('DRIVE_SOURCE_CHANGED'));
});


test('Drive int64 sizes are parsed exactly and support-asset ranges remain bounded above the episode-size limit',async()=>{
  const large=5*1024**3;
  const f=fixture(url=>url.searchParams.get('alt')==='media'?new Response('12345',{status:206,headers:{'Content-Range':`bytes ${large-5}-${large-1}/${large}`}}):Response.json(meta({size:String(large)})));
  assert.equal((await f.reader.getFile('file-one')).size,large);
  assert.deepEqual(await f.reader.readRange('file-one',large-5,5,large),new TextEncoder().encode('12345'));
  for(const size of ['9007199254740993','9223372036854775807','1e3',' 15','0x10','1.5','-1']){
    const bad=fixture(()=>Response.json(meta({size})));await assert.rejects(bad.reader.getFile('file-one'),rejection('DRIVE_SOURCE_CHANGED'));
  }
  const invalid=fixture(()=>{throw new Error('Unsafe range must not request data.');});
  await assert.rejects(invalid.reader.readRange('file-one',Number.MAX_SAFE_INTEGER,5,Number.MAX_SAFE_INTEGER),rejection('DRIVE_SOURCE_CHANGED'));assert.equal(invalid.calls.length,0);
});

const disabledInfo={'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'SERVICE_DISABLED',domain:'googleapis.com',metadata:{service:'drive.googleapis.com',consumer:'projects/private-provider-project'}};
function safeDiagnostic(code:string,status?:number){return(error:unknown)=>{
  assert.ok(error instanceof GoogleDriveImportError);assert.equal(error.code,code);if(status!==undefined)assert.equal(error.status,status);
  for(const secret of ['private-provider-body','private-provider-project','fake-test-token','PRIVATE KEY',email])assert.equal(error.message.includes(secret),false);return true;
};}

test('disabled Drive API diagnostics require recognized modern or legacy structured reasons rather than private provider messages',async()=>{
  for(const error of [{details:[disabledInfo],message:'private-provider-body'},{errors:[{reason:'accessNotConfigured',domain:'usageLimits'}],message:'private-provider-body'}]){
    const f=fixture(()=>Response.json({error},{status:403}));await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic('DRIVE_API_DISABLED',403));assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.init.redirect==='manual'));
  }
});

test('untrusted or malformed error details cannot impersonate disabled Drive API or escape the original HTTP failure classification',async()=>{
  const wrongDetails=[{...disabledInfo,'@type':'example.test/ErrorInfo'},{...disabledInfo,domain:'example.test'},{...disabledInfo,reason:'OTHER_REASON'},{...disabledInfo,metadata:{service:'sheets.googleapis.com'}},{...disabledInfo,metadata:{service:['drive.googleapis.com']}},{...disabledInfo,metadata:undefined}];
  const bodies=[...wrongDetails.map(detail=>JSON.stringify({error:{details:[detail]}})),JSON.stringify({error:{message:'SERVICE_DISABLED: Enable Google Drive API. private-provider-body'}}),JSON.stringify({error:{message:'rateLimitExceeded private-provider-body'}}),JSON.stringify({error:{errors:[{reason:'accessNotConfigured',domain:'global'}]}}),JSON.stringify({error:{errors:[{reason:'rateLimitExceeded',domain:'global'}]}}),JSON.stringify({error:{details:[{...disabledInfo,reason:'QUOTA_EXCEEDED',metadata:{service:'sheets.googleapis.com'}}]}}),JSON.stringify({error:{details:disabledInfo}}),'not JSON private-provider-body','null','[]'];
  for(const body of bodies){const f=fixture(()=>new Response(body,{status:403}));await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic('DRIVE_ACCESS_DENIED',403));}
  for(const[status,code]of [[404,'DRIVE_ACCESS_DENIED'],[500,'DRIVE_UNAVAILABLE']] as const){const f=fixture(()=>Response.json({error:{details:[disabledInfo]}},{status}));await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic(code));}
});

test('provider error parsing is bounded to 32 KiB and safely handles declared oversize, streaming overflow and broken bodies',async()=>{
  const declared=fixture(()=>Response.json({error:{details:[disabledInfo]}},{status:403,headers:{'Content-Length':String(32*1024+1)}}));await assert.rejects(declared.reader.getFile('file-one'),safeDiagnostic('DRIVE_ACCESS_DENIED',403));
  const oversized=fixture(()=>Response.json({error:{details:[disabledInfo],private:'private-provider-body'+'x'.repeat(32*1024)}},{status:403}));await assert.rejects(oversized.reader.getFile('file-one'),safeDiagnostic('DRIVE_ACCESS_DENIED',403));
  let pulls=0,cancelled=false;const streaming=fixture(()=>new Response(new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(4096).fill(120));},cancel(){cancelled=true;}}),{status:403}));await assert.rejects(streaming.reader.getFile('file-one'),safeDiagnostic('DRIVE_ACCESS_DENIED',403));assert.equal(cancelled,true);assert.ok(pulls<=10,'error parsing must stop rather than drain an unbounded provider body');
  for(const response of [new Response(null,{status:403}),new Response(Uint8Array.of(255),{status:403}),new Response(new ReadableStream({start(controller){controller.error(new Error('private-provider-body'));}}),{status:403})]){const f=fixture(()=>response);await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic('DRIVE_ACCESS_DENIED',403));}
});

test('rate limits retain a bounded retry delay without accepting provider text or confusing folder permissions with quota',async()=>{
  const limits=[...['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','sharingRateLimitExceeded'].map(reason=>({errors:[{reason,domain:'usageLimits'}]})),...['RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED'].map(reason=>({details:[{...disabledInfo,reason}]}))];
  for(const error of limits){const f=fixture(()=>Response.json({error:{...error,message:'private-provider-body'}},{status:403,headers:{'Retry-After':'90'}}));await assert.rejects(f.reader.getFile('file-one'),error=>safeDiagnostic('DRIVE_RATE_LIMITED',429)(error)&&error instanceof GoogleDriveImportError&&error.retryAfterSeconds===90);}
  for(const[retry,expected]of [['999999',3600],['not-a-delay',undefined],['-1',undefined]] as const){const f=fixture(()=>new Response('private-provider-body',{status:429,headers:{'Retry-After':retry}}));await assert.rejects(f.reader.getFile('file-one'),error=>safeDiagnostic('DRIVE_RATE_LIMITED',429)(error)&&error instanceof GoogleDriveImportError&&error.retryAfterSeconds===expected);}
});

test('OAuth rejection, rate limits and provider outages keep separate safe diagnostics and never request Drive metadata without a token',async()=>{
  for(const[status,code]of [[400,'DRIVE_AUTH_FAILED'],[401,'DRIVE_AUTH_FAILED'],[403,'DRIVE_AUTH_FAILED'],[429,'DRIVE_RATE_LIMITED'],[500,'DRIVE_UNAVAILABLE'],[503,'DRIVE_UNAVAILABLE']] as const){
    const f=fixture(()=>{assert.fail('Rejected authorization cannot reach Drive metadata.');},undefined,()=>Response.json({error:'invalid_grant',error_description:'private-provider-body',details:[disabledInfo]},{status,headers:{'Retry-After':'90'}}));await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic(code));assert.equal(f.calls.length,1);assert.equal(f.calls[0].url.href,TOKEN);
  }
  for(const value of [{access_token:'',expires_in:3600},{access_token:'fake-test-token\nprivate-provider-body',expires_in:3600},{access_token:'fake-test-token',expires_in:0}]){const f=fixture(()=>Response.json(meta()),undefined,()=>Response.json(value));await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic('DRIVE_AUTH_FAILED',503));assert.equal(f.calls.length,1);}
});

test('signing failures, transport failures and a persistent 401 remain redacted with at most one authorization refresh',async()=>{
  const invalidRaw=JSON.stringify({type:'service_account',client_email:email,private_key:'-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(600)+'\n-----END PRIVATE KEY-----'});assert.equal(googleDriveCredentials(invalidRaw).configured,true);let calls=0;
  const invalid=createGoogleDriveReader(invalidRaw,{fetch:(async()=>{calls++;throw new Error('Signing must fail before requesting authorization.');}) as typeof fetch});await assert.rejects(invalid.getFile('file-one'),safeDiagnostic('DRIVE_AUTH_FAILED',503));assert.equal(calls,0);
  for(const tokenFailure of [false,true]){const fail=()=>{throw new Error('private-provider-body: Bearer fake-test-token');},f=fixture(tokenFailure?()=>Response.json(meta()):fail,undefined,tokenFailure?fail:undefined);await assert.rejects(f.reader.getFile('file-one'),safeDiagnostic('DRIVE_UNAVAILABLE'));assert.equal(f.calls.length,tokenFailure?1:2);}
  const expired=fixture(()=>new Response('private-provider-body',{status:401}));await assert.rejects(expired.reader.getFile('file-one'),safeDiagnostic('DRIVE_AUTH_FAILED',503));assert.equal(expired.calls.filter(call=>call.url.href===TOKEN).length,2);assert.equal(expired.calls.filter(call=>call.url.origin+call.url.pathname===FILES+'/file-one').length,2);assert.equal(expired.calls.length,4);
});
