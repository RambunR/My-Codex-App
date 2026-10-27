import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';

const dir=await mkdtemp(path.join(tmpdir(),'aidramio-email-auth-'));
process.env.DATA_DIR=dir;process.env.PAYMENTS_MODE='demo';process.env.NODE_ENV='test';process.env.SEED_DEMO='false';
const {config}=await import('../server/config');
const {one,run,db}=await import('../server/db');
const {emailVerificationState,markEmailVerified}=await import('../server/email-auth');
const {mailEnabled,sendAccountEmail}=await import('../server/mail');
const realFetch=globalThis.fetch;
const realWarn=console.warn;
const messages:any[]=[];
const cloudflareMessages:any[]=[];
const cloudflareAccount='95040c4f244233138195b80657887486';
let cloudflareOutcome:'queued'|'delivered'|'rejected'|'bounced'|'mismatched'|'http-failure'='queued';
const warnings:string[]=[];
let failDelivery=false;
let server:Server,base:string;
const password='AccountPassword123!';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

async function request(route:string,body?:unknown,session='',expected=200,headers:Record<string,string>={}){
  const response=await realFetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(session?{Cookie:session}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(data)}`);
  return{response,data,session:response.headers.getSetCookie().find(value=>value.startsWith('drama_session='))?.split(';')[0]||''};
}
async function register(email=randomUUID()+'@example.test'){
  const previous=config.mailProvider;config.mailProvider='disabled';
  try{const result=await request('/api/auth/register',{name:'Recovery Viewer',email,password},'',201);return{id:result.data.user.id,email,session:result.session};}
  finally{config.mailProvider=previous;}
}
function tokenFrom(message:any){
  const matched=message.text.match(/https?:\/\/[^\s]+/);assert.ok(matched);
  const url=new URL(matched[0]);assert.equal(url.origin,base);assert.equal(url.searchParams.has('token'),false,'email proofs belong in a URL fragment, outside HTTP logs');
  const token=new URLSearchParams(url.hash.slice(1)).get('token')!;assert.match(token,/^[a-f\d]{64}$/);
  return{token,url};
}
async function settle(){await new Promise(resolve=>setTimeout(resolve,5));}
function resetCooldown(email:string,kind:'reset'|'verify'){
  run('UPDATE account_email_requests SET last_sent_at_ms=? WHERE subject_hash=?',Date.now()-61_000,hash(`${kind}:${email.toLowerCase()}`));
}

before(async()=>{
  config.resendApiKey='re_local_test_mail_key';config.mailFrom='AIDramio <accounts@verified.example>';
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url===`https://api.cloudflare.com/client/v4/accounts/${cloudflareAccount}/email/sending/send`){
      const req=new Request(input,init);assert.equal(req.method,'POST');assert.equal(req.headers.get('Authorization'),'Bearer cf_local_test_email_key');assert.equal(req.headers.has('Idempotency-Key'),false);
      const body=await req.json() as any;cloudflareMessages.push(body);
      if(cloudflareOutcome==='http-failure')return Response.json({success:false,errors:[{message:'private provider detail'}]},{status:403});
      return Response.json({success:cloudflareOutcome!=='rejected',errors:cloudflareOutcome==='rejected'?[{message:'private provider detail'}]:[],result:{delivered:cloudflareOutcome==='delivered'?[body.to]:cloudflareOutcome==='mismatched'?['another@example.test']:[],queued:cloudflareOutcome==='queued'?[body.to]:[],permanent_bounces:cloudflareOutcome==='bounced'?[body.to]:[]}});
    }
    if(url==='https://api.resend.com/emails'){
      const req=new Request(input,init);assert.equal(req.method,'POST');assert.equal(req.headers.get('Authorization'),'Bearer re_local_test_mail_key');assert.ok(req.headers.get('Idempotency-Key'));
      messages.push(await req.json());
      return failDelivery?Response.json({message:'provider private failure'},{status:503}):Response.json({id:'local-message-'+messages.length});
    }
    return realFetch(input,init);
  };
  console.warn=(...values)=>warnings.push(values.map(String).join(' '));
  const {createApp,errorHandler}=await import('../server/app');const app=createApp();app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;config.appUrl=base;
});
after(async()=>{await settle();globalThis.fetch=realFetch;console.warn=realWarn;if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('account email is explicitly unavailable until both provider key and sender are configured',async()=>{
  const before=messages.length;config.resendApiKey='';
  try{
    assert.equal((await request('/api/config')).data.auth.email,false);
    assert.equal((await request('/api/auth/forgot-password',{email:'unavailable@example.test'},'',503)).data.error.code,'MAIL_UNAVAILABLE');
    assert.equal((await request('/api/auth/resend-verification',{email:'unavailable@example.test'},'',503)).data.error.code,'MAIL_UNAVAILABLE');
  }finally{config.resendApiKey='re_local_test_mail_key';}
  config.mailFrom='';try{assert.equal((await request('/api/config')).data.auth.email,false);}finally{config.mailFrom='AIDramio <accounts@verified.example>';}
  assert.equal((await request('/api/config')).data.auth.email,true);assert.equal(messages.length,before);
});

test('password requests acknowledge existing, unknown, provider-only and cooldown cases identically without exposing tokens',async()=>{
  const user=await register();const providerId=randomUUID(),providerEmail=randomUUID()+'@example.test';
  run('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)',providerId,providerEmail,'Provider Viewer','!google-only:'+randomUUID());
  const before=messages.length;
  const accepted=await request('/api/auth/forgot-password',{email:user.email});
  const unknown=await request('/api/auth/forgot-password',{email:randomUUID()+'@example.test'});
  const providerOnly=await request('/api/auth/forgot-password',{email:providerEmail});
  const repeated=await request('/api/auth/forgot-password',{email:user.email});
  for(const result of[accepted,unknown,providerOnly,repeated])assert.deepEqual(result.data,{ok:true});
  await settle();assert.equal(messages.length,before+1);
  const {token,url}=tokenFrom(messages.at(-1));assert.equal(url.searchParams.get('mode'),'reset');
  const proof=one('SELECT * FROM account_email_tokens WHERE user_id=?',user.id)!;
  assert.equal(proof.token_hash,hash(token));assert.notEqual(proof.token_hash,token);assert.equal(proof.kind,'reset');assert.equal(proof.email,user.email);
  assert.ok(proof.expires_at>Date.now()+29*60_000);assert.ok(proof.expires_at<=Date.now()+30*60_000);
  assert.equal(one('SELECT * FROM account_email_tokens WHERE user_id=?',providerId),undefined);
});

test('single-use concurrent password recovery changes only the password, revokes sessions and preserves account assets',async()=>{
  const user=await register();const second=await request('/api/auth/login',{email:user.email,password});
  run('UPDATE users SET wallet_micros=?,earnings_micros=?,publisher_active=1,used_bytes=? WHERE id=?',9_000_000,4_000_000,1234,user.id);
  const sid=randomUUID();run('INSERT INTO series (id,creator_id,title,description,language,genres) VALUES (?,?,?,?,?,?)',sid,user.id,'Preserved Drama','A preserved publisher series for password recovery.','en','["drama"]');
  run('INSERT INTO oauth_attempts (state_hash,browser_hash,nonce,code_verifier,next_path,language,intent,user_id,session_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',hash(randomUUID()),hash(randomUUID()),'nonce','verifier','/account','en','link',user.id,'session',Date.now()+60_000);
  const before=messages.length;await request('/api/auth/forgot-password',{email:user.email});await settle();assert.equal(messages.length,before+1);
  const {token}=tokenFrom(messages.at(-1));const newPassword='RecoveredPassword456!';
  const responses=await Promise.all([0,1].map(()=>realFetch(base+'/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:newPassword})})));
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,400]);
  const failed=responses.find(response=>response.status===400)!;assert.equal((await failed.json()).error.code,'EMAIL_TOKEN_INVALID');
  assert.equal((await request('/api/auth/me',undefined,user.session)).data.user,null);assert.equal((await request('/api/auth/me',undefined,second.session)).data.user,null);
  assert.equal(one('SELECT * FROM oauth_attempts WHERE user_id=?',user.id),undefined);assert.equal(one('SELECT * FROM account_email_tokens WHERE user_id=?',user.id),undefined);
  await request('/api/auth/login',{email:user.email,password},'',401);
  const logged=await request('/api/auth/login',{email:user.email,password:newPassword});assert.equal(logged.data.user.id,user.id);assert.equal(logged.data.user.wallet_micros,9_000_000);assert.equal(logged.data.user.earnings_micros,4_000_000);assert.equal(logged.data.user.publisher_active,1);assert.equal(logged.data.user.used_bytes,1234);
  assert.equal(one('SELECT creator_id FROM series WHERE id=?',sid)!.creator_id,user.id);
  assert.equal(emailVerificationState(user.id).email_verified,true,'a valid emailed password-reset proof also proves the account email');
});

test('verification is a POST-only, expiring email-bound proof and never signs a visitor into an account',async()=>{
  const user=await register();assert.equal(emailVerificationState(user.id).email_verified,false);
  await request('/api/auth/resend-verification',{email:user.email});await settle();const first=tokenFrom(messages.at(-1));assert.equal(first.url.searchParams.get('mode'),'verify');
  const receipt=one('SELECT * FROM account_email_tokens WHERE user_id=?',user.id)!;assert.ok(receipt.expires_at>Date.now()+23*60*60_000);
  await request('/api/auth/verify-email?token='+first.token,undefined,'',404);assert.equal(emailVerificationState(user.id).email_verified,false);
  await request('/api/auth/reset-password',{token:first.token,password:'IncorrectPurpose123!'},'',400);
  run('UPDATE account_email_tokens SET expires_at=? WHERE token_hash=?',Date.now()-1,hash(first.token));
  assert.equal((await request('/api/auth/verify-email',{token:first.token},'',400)).data.error.code,'EMAIL_TOKEN_INVALID');
  resetCooldown(user.email,'verify');await request('/api/auth/resend-verification',{email:user.email});await settle();const second=tokenFrom(messages.at(-1));assert.notEqual(second.token,first.token);
  run('UPDATE users SET email=? WHERE id=?','changed-'+user.email,user.id);
  await request('/api/auth/verify-email',{token:second.token},'',400);
  run('UPDATE users SET email=? WHERE id=?',user.email,user.id);
  const verified=await request('/api/auth/verify-email',{token:second.token});assert.deepEqual(verified.data,{ok:true});assert.equal(verified.session,'');
  assert.equal(emailVerificationState(user.id).email_verified,true);assert.equal((await request('/api/auth/me')).data.user,null);
  await request('/api/auth/verify-email',{token:second.token},'',400);
  const before=messages.length;resetCooldown(user.email,'verify');await request('/api/auth/resend-verification',{email:user.email});await settle();assert.equal(messages.length,before);
});

test('reset rejects expired proofs, intervening password changes and provider-only accounts even if a proof is forged in storage',async()=>{
  const user=await register();await request('/api/auth/forgot-password',{email:user.email});await settle();const {token}=tokenFrom(messages.at(-1));
  run('UPDATE account_email_tokens SET expires_at=? WHERE token_hash=?',Date.now()-1,hash(token));
  await request('/api/auth/reset-password',{token,password:'ExpiredPassword123!'},'',400);
  resetCooldown(user.email,'reset');await request('/api/auth/forgot-password',{email:user.email});await settle();const next=tokenFrom(messages.at(-1));
  run('UPDATE users SET password_hash=? WHERE id=?','!apple-only:'+randomUUID(),user.id);
  await request('/api/auth/reset-password',{token:next.token,password:'ProviderTakeover123!'},'',400);
  assert.match(one('SELECT password_hash FROM users WHERE id=?',user.id)!.password_hash,/^!apple-only:/);
});

test('a failed mail provider has a generic acknowledgement, sanitized operational warning and no usable delivery token',async()=>{
  const user=await register();const before=messages.length;failDelivery=true;
  try{
    const accepted=await request('/api/auth/forgot-password',{email:user.email});assert.deepEqual(accepted.data,{ok:true});
    await settle();assert.equal(messages.length,before+1);assert.equal(one('SELECT * FROM account_email_tokens WHERE user_id=?',user.id),undefined);
    assert.ok(warnings.some(value=>value.includes('account email delivery failed')));
    assert.ok(warnings.every(value=>!value.includes(user.email)&&!value.includes('re_local_test_mail_key')&&!value.includes('provider private failure')));
  }finally{failDelivery=false;}
});

test('durable resend cooldown survives handler recreation and target budgets apply without account enumeration',async()=>{
  const user=await register();const before=messages.length;
  for(let attempt=0;attempt<6;attempt++){
    resetCooldown(user.email,'verify');await request('/api/auth/resend-verification',{email:user.email});await settle();
  }
  assert.equal(messages.length,before+5,'the sixth request is acknowledged but cannot send another target email within an hour');
  const {registerEmailAuth}=await import('../server/email-auth');const express=(await import('express')).default;
  const fresh=express();fresh.use(express.json());registerEmailAuth(fresh);
  const recreated=fresh.listen(0,'127.0.0.1');await new Promise<void>(resolve=>recreated.once('listening',resolve));
  try{
    const r=await realFetch(`http://127.0.0.1:${(recreated.address() as any).port}/api/auth/resend-verification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email})});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});await settle();assert.equal(messages.length,before+5);
  }finally{await new Promise<void>(resolve=>recreated.close(()=>resolve()));}
});

test('trusted existing Google email proofs are recognized only for the current account email',async()=>{
  const user=await register();run('INSERT INTO oauth_identities (provider,subject,user_id,email) VALUES (?,?,?,?)','google',randomUUID(),user.id,user.email);
  assert.equal(emailVerificationState(user.id).email_verified,true);
  run('UPDATE oauth_identities SET email=? WHERE user_id=?','different@example.test',user.id);assert.equal(emailVerificationState(user.id).email_verified,false);
  assert.equal(markEmailVerified(user.id,'different@example.test'),false);assert.equal(emailVerificationState(user.id).email_verified,false);
  assert.equal(markEmailVerified(user.id,user.email.toUpperCase()),true);assert.equal(emailVerificationState(user.id).email_verified,true);
});

test('registration queues verification without making provider rejection fail account creation',async()=>{
  const email=randomUUID()+'@example.test';const before=messages.length;failDelivery=true;
  try{const registered=await request('/api/auth/register',{name:'New Email Viewer',email,password},'',201);assert.equal(registered.data.user.email_verified,false);await settle();assert.equal(messages.length,before+1);assert.equal(one('SELECT * FROM account_email_tokens WHERE user_id=?',registered.data.user.id),undefined);}
  finally{failDelivery=false;}
});

function useCloudflare(){
  const previous={mailProvider:config.mailProvider,cloudflareEmailAccountId:config.cloudflareEmailAccountId,cloudflareEmailApiToken:config.cloudflareEmailApiToken,mailFrom:config.mailFrom};
  config.mailProvider='cloudflare';config.cloudflareEmailAccountId=cloudflareAccount;config.cloudflareEmailApiToken='cf_local_test_email_key';config.mailFrom='AIDramio <accounts@verified.example>';cloudflareOutcome='queued';
  return()=>{Object.assign(config,previous);cloudflareOutcome='queued';};
}

test('mail selection prefers configured Cloudflare in auto mode and explicit providers never silently fall back',async()=>{
  const restore=useCloudflare(),cfBefore=cloudflareMessages.length,resendBefore=messages.length;
  try{
    config.cloudflareEmailApiToken='';assert.equal(mailEnabled(),false);
    await assert.rejects(sendAccountEmail('selection@example.test','verify','a'.repeat(64),randomUUID()),/unavailable/);
    assert.equal(messages.length,resendBefore);assert.equal(cloudflareMessages.length,cfBefore);
    config.cloudflareEmailApiToken='cf_local_test_email_key';config.mailProvider='auto';assert.equal(mailEnabled(),true);
    await sendAccountEmail('selection@example.test','verify','a'.repeat(64),randomUUID());assert.equal(cloudflareMessages.length,cfBefore+1);assert.equal(messages.length,resendBefore);
    config.cloudflareEmailAccountId='../unsafe-account';assert.equal(mailEnabled(),false,'complete but invalid Cloudflare configuration must not fall through to another provider');
    config.cloudflareEmailAccountId=cloudflareAccount;config.mailProvider='resend';assert.equal(mailEnabled(),true);
    await sendAccountEmail('selection@example.test','verify','a'.repeat(64),randomUUID());assert.equal(messages.length,resendBefore+1);assert.equal(cloudflareMessages.length,cfBefore+1);
    config.mailProvider='disabled';assert.equal(mailEnabled(),false);config.mailProvider='unexpected';assert.equal(mailEnabled(),false);
    config.mailProvider='cloudflare';config.mailFrom='AIDramio\r\nBcc: attacker@example.test';assert.equal(mailEnabled(),false);
  }finally{restore();}
});

test('Cloudflare structured sending accepts queued or delivered recipients and preserves fragment email links',async()=>{
  const restore=useCloudflare();
  try{
    for(const outcome of['queued','delivered'] as const){
      cloudflareOutcome=outcome;const token='b'.repeat(64);
      await sendAccountEmail('cloudflare-recipient@example.test','reset',token,randomUUID());
      const sent=cloudflareMessages.at(-1);assert.deepEqual(sent.from,{address:'accounts@verified.example',name:'AIDramio'});assert.equal(sent.to,'cloudflare-recipient@example.test');
      assert.equal(sent.subject,'Reset your AIDramio password');assert.ok(sent.html.includes('<!doctype html>'));assert.ok(sent.text.includes('30 minutes'));
      const link=tokenFrom(sent);assert.equal(link.token,token);assert.equal(link.url.searchParams.get('mode'),'reset');
    }
  }finally{restore();}
});

test('Cloudflare HTTP success still rejects unsuccessful, bounced or mismatched recipients without leaking provider details or using Resend',async()=>{
  const restore=useCloudflare(),resendBefore=messages.length;
  try{
    for(const outcome of['rejected','bounced','mismatched','http-failure'] as const){
      cloudflareOutcome=outcome;
      await assert.rejects(sendAccountEmail('rejected-recipient@example.test','verify','c'.repeat(64),randomUUID()),error=>{
        assert.ok(error instanceof Error);assert.equal(error.message,'Account email delivery failed.');assert.ok(!error.message.includes('private provider detail'));return true;
      });
    }
    assert.equal(messages.length,resendBefore,'an attempted Cloudflare delivery must not be duplicated through another provider');
  }finally{restore();}
});

test('a rejected Cloudflare send keeps the public acknowledgement generic and removes its unusable recovery proof',async()=>{
  const restore=useCloudflare();
  try{
    const user=await register();cloudflareOutcome='rejected';const cfBefore=cloudflareMessages.length,resendBefore=messages.length;
    const accepted=await request('/api/auth/forgot-password',{email:user.email});assert.deepEqual(accepted.data,{ok:true});
    const absent=await request('/api/auth/forgot-password',{email:randomUUID()+'@example.test'});assert.deepEqual(absent.data,accepted.data);
    await settle();assert.equal(cloudflareMessages.length,cfBefore+1);assert.equal(messages.length,resendBefore);assert.equal(one('SELECT * FROM account_email_tokens WHERE user_id=?',user.id),undefined);
    assert.ok(warnings.every(warning=>!warning.includes(user.email)&&!warning.includes('cf_local_test_email_key')&&!warning.includes('private provider detail')));
  }finally{restore();}
});
