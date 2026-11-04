// Explicit, opt-in remote Stripe SANDBOX integration check. Uses a disposable
// local application database/session, never the production account database.
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {fetch as proxyFetch,ProxyAgent} from 'undici';

if(process.env.LINGYING_RUN_REMOTE_SANDBOX_TEST!=='true')throw new Error('Set LINGYING_RUN_REMOTE_SANDBOX_TEST=true to explicitly run a simulated Stripe withdrawal.');
const cfAccount='95040c4f244233138195b80657887486',ownerId='000ca929-30da-4e8b-a2a6-2135d184fe9b',connected='acct_1UXy05J6ErvOVs1A';
const dispatcher=process.env.HTTPS_PROXY?new ProxyAgent(process.env.HTTPS_PROXY):undefined;
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 return ['127.0.0.1','localhost'].includes(url.hostname)?originalFetch(input,init):proxyFetch(input,{...init,dispatcher});
};
let server,db;
try{
 const settingsResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts/lingying/settings`,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});
 const settings=await settingsResponse.json();if(!settingsResponse.ok||!settings.success)throw new Error('CF_SETTINGS_UNAVAILABLE');
 const binding=settings.result.bindings.find(b=>b.name==='STRIPE_TEST_SECRET_KEY');
 const sandboxKey=process.env.STRIPE_TEST_SECRET_KEY||(binding?.type==='plain_text'?binding.text:'');
 if(! /^(sk|rk)_test_/.test(sandboxKey))throw new Error('TEST_KEY_NOT_AVAILABLE_TO_LOCAL_CHECK');
 const resume=process.env.LINGYING_SANDBOX_CHECK_DIR;
 if(resume&&!/^\/tmp\/lingying-remote-sandbox-[A-Za-z0-9]+$/.test(resume))throw new Error('INVALID_LOCAL_AUDIT_DIRECTORY');
 const dir=resume||await mkdtemp(path.join(tmpdir(),'lingying-remote-sandbox-'));
 Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'production',SEED_DEMO:'false',PAYMENTS_MODE:'stripe',STRIPE_TEST_MODE:'true',STRIPE_TEST_SECRET_KEY:sandboxKey,STRIPE_TEST_WEBHOOK_SECRET:'whsec_local_request_check_only',STRIPE_TEST_PAYOUTS_ENABLED:'true',STRIPE_TEST_PAYOUT_ACCOUNT_ID:connected,PLATFORM_OWNER_USER_ID:ownerId,PAYOUTS_ENABLED:'false',STRIPE_AUTO_CONFIGURE_WEBHOOK:'false'});
 const database=await import('../server/db.ts');db=database.db;
 const {config}=await import('../server/config.ts');const {createApp,errorHandler}=await import('../server/app.ts');
 const token=randomBytes(32).toString('hex');
 database.run('INSERT OR IGNORE INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,1)',ownerId,'local-sandbox-verification@example.invalid','Local sandbox verification','!disabled','admin');
 database.run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),ownerId,Date.now()+600000);
 const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;config.appUrl=base;config.publicUrl=base;
 const call=async(route,body)=>{
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:'drama_session='+token,Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){console.log(JSON.stringify({stage:route,status:response.status,code:data.error?.code,message:data.error?.message,local_audit_directory:dir}));throw new Error('SANDBOX_FLOW_BLOCKED');}
  return data;
 };
 const setup=await call('/api/studio/test-withdrawals');
 console.log(JSON.stringify({stage:'readiness',platform:setup.platformAccount,connected:setup.connectedAccount,currency:setup.currency,unlimited:setup.unlimited}));
 // US$200 forces replenishment of the provider's currently smaller test balance,
 // exercising the unlimited allowance, fixed test funding token, fee and payout.
 const retained=resume?setup.requests.find(r=>!['paid','failed','rejected'].includes(r.status)):null;
 const created=retained?{request:retained}:await call('/api/studio/test-withdrawals',{amount_cents:20000,request_key:randomUUID()});
 console.log(JSON.stringify({stage:'requested',request:created.request,local_audit_directory:dir}));
 const processed=await call(`/api/studio/test-withdrawals/${created.request.id}/process`,{});
 const synced=await call(`/api/studio/test-withdrawals/${created.request.id}/sync`,{});
 const live=database.one('SELECT wallet_micros,earnings_micros,stripe_account_id FROM users WHERE id=?',ownerId);
 if(live.wallet_micros!==0||live.earnings_micros!==0||live.stripe_account_id!==null||database.one('SELECT COUNT(*) AS n FROM withdrawals').n!==0)throw new Error('ISOLATION_CHECK_FAILED');
 const report={stage:'sandbox_flow_verified',request:synced.request,processed_status:processed.request.status,live_finance_unchanged:true,local_audit_directory:dir,production_session_used:false};
 await writeFile(path.join(dir,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.log(JSON.stringify({stage:'verification_failed',code:['CF_SETTINGS_UNAVAILABLE','TEST_KEY_NOT_AVAILABLE_TO_LOCAL_CHECK','SANDBOX_FLOW_BLOCKED','ISOLATION_CHECK_FAILED','INVALID_LOCAL_AUDIT_DIRECTORY'].includes(error.message)?error.message:'SANDBOX_CHECK_ERROR'}));process.exitCode=1;}
finally{if(server)await new Promise(resolve=>server.close(resolve));db?.close();await dispatcher?.close();}
