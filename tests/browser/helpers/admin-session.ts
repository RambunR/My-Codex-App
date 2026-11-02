import {request,type APIRequestContext,type Page} from '@playwright/test';
import {readFile,rename,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

type StorageState=Awaited<ReturnType<APIRequestContext['storageState']>>;
const baseURL='http://127.0.0.1:3001',email='admin@demo.aidramio.test';
const runId=process.env.LINGYING_BROWSER_RUN_ID;
if(!runId||!/^\w[\w-]{10,80}$/.test(runId))throw new Error('Demo administrator sessions require the isolated Playwright run ID.');
const cachePath=path.join(tmpdir(),`lingying-browser-admin-${runId}.json`);
let cached:StorageState|undefined;

/** Reuse a real, validated login within this local test-server run. The cache
 * is never used against a configurable/production origin, and separate runs
 * cannot inherit a prior run's administrator cookies. */
export async function demoAdminSession(page:Page){
  if(!cached){try{cached=JSON.parse(await readFile(cachePath,'utf8')) as StorageState;}catch{/* First use in this run performs an actual login. */}}
  const context=await request.newContext({baseURL,...cached?{storageState:cached}:{}});
  try{
    let response=await context.get('/api/auth/me'),body=await response.json();
    if(!response.ok()||body.user?.id!=='demo-admin'||body.user?.email!==email||body.user?.role!=='admin'){
      response=await context.post('/api/auth/login',{data:{email,password:'DemoPass123!'}});body=await response.json();
      if(!response.ok()||body.user?.id!=='demo-admin'||body.user?.email!==email||body.user?.role!=='admin')throw new Error(`Local demo administrator login failed (${response.status()}).`);
    }
    cached=await context.storageState();const temporary=`${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary,JSON.stringify(cached),{mode:0o600});await rename(temporary,cachePath);
    await page.context().addCookies(cached.cookies);return body.user;
  }finally{await context.dispose();}
}
