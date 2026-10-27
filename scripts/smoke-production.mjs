import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';

const directory=await mkdtemp(path.join(tmpdir(),'aidramio-production-'));
const port=Number(process.env.SMOKE_PORT||3002),url=`http://127.0.0.1:${port}`;
const email='smoke-admin@example.test',password=crypto.randomBytes(24).toString('base64url');
const environment={...process.env,NODE_ENV:'production',PORT:String(port),APP_URL:url,DATA_DIR:directory,SEED_DEMO:'false',PAYMENTS_MODE:'disabled',ADMIN_EMAIL:email,ADMIN_PASSWORD:password};
let child;
try{
  await promisify(execFile)(process.execPath,['node_modules/tsx/dist/cli.mjs','server/create-admin.ts'],{env:environment});
  child=spawn(process.execPath,['dist/server.js'],{env:environment,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null)throw new Error('Production server exited before readiness: '+output);
    try{const response=await fetch(url+'/api/health');if(response.ok&&(await response.json()).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Production readiness timed out');
  const config=await fetch(url+'/api/config').then(r=>r.json());assert.equal(config.paymentsMode,'disabled');assert.equal(config.demo,false);
  const catalogue=await fetch(url+'/api/series').then(r=>r.json());assert.equal(catalogue.series.length,0,'A fresh production instance must not contain demo content');
  const html=await fetch(url).then(r=>r.text());assert.ok(html.includes('id="root"'));const asset=/src="([^\"]+\.js)"/.exec(html)?.[1];assert.ok(asset,'Compiled client entry exists');
  const js=await fetch(url+asset);assert.equal(js.status,200);assert.ok((js.headers.get('cache-control')||'').includes('immutable'));assert.ok((await js.text()).length>1000);
  const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');assert.ok(setCookie?.includes('Secure'));assert.ok(setCookie?.includes('HttpOnly'));const cookie=setCookie.split(';')[0];await login.arrayBuffer();
  const headers={'Content-Type':'application/json',Cookie:cookie};
  const denied=await fetch(url+'/api/payments/checkout',{method:'POST',headers,body:JSON.stringify({kind:'funding',amount_cents:500})});assert.equal(denied.status,503);await denied.arrayBuffer();
  const demo=await fetch(url+'/api/payments/fake/demo-confirm',{method:'POST',headers,body:'{}'});assert.equal(demo.status,404);await demo.arrayBuffer();
  const admin=await fetch(url+'/api/admin',{headers:{Cookie:cookie}});assert.equal(admin.status,200);assert.equal((await admin.json()).stats.users,1);
  console.log('Production smoke passed: compiled client/API, fresh database, admin bootstrap/login, secure cookie flags, immutable assets, payments disabled, no demo-credit endpoint.');
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve();},5000))]);}
  await rm(directory,{recursive:true,force:true});
}
