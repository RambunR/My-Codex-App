import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fetch,ProxyAgent} from 'undici';

const root=process.cwd();const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const account=process.env.CLOUDFLARE_ACCOUNT_ID||base.account_id;
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token){console.error('Cloudflare deployment is blocked: CLOUDFLARE_API_TOKEN is not available in this workspace. Add it securely in environment settings, not in chat. Required account permissions: Workers Scripts Edit and Workers R2 Storage Edit.');process.exit(2);}
const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
const dispatcher=proxy?new ProxyAgent(proxy):undefined;
const sanitize=message=>String(message).split(token).join('[redacted]');
async function cf(route,options={}){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${route}`,{...options,dispatcher,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers}});
  const data=await response.json();
  if(!response.ok||data.success===false)throw new Error(sanitize(`Cloudflare ${response.status}: ${(data.errors||[]).map(e=>e.message).join('; ')||'request failed'}`));
  return data.result;
}
function command(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{cwd:root,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME||'/tmp/aidramio-cf-config',WRANGLER_SEND_METRICS:'false'},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Wrangler exited with status ${code}`)));});}
try{
  const scripts=await cf('/workers/scripts');const buckets=await cf('/r2/buckets');
  let previous;try{previous=JSON.parse(await readFile('.cloudflare/deployment.json','utf8'));}catch{}
  const desired=process.env.AIDRAMIO_PROJECT_NAME||'aidramio';
  if(!/^[a-z][a-z0-9-]{2,45}$/.test(desired))throw new Error('AIDRAMIO_PROJECT_NAME must be a lowercase Workers application name.');
  let name=previous?.account===account&&(previous.project===desired||previous.name===desired)?previous.name:desired;
  if(scripts.some(s=>s.id===name||s.name===name)&&!(previous?.account===account&&previous?.name===name))name=`${desired}-${randomBytes(3).toString('hex')}`;
  let bucket=previous?.account===account&&previous?.name===name?previous.bucket:`${name}-media-${account.slice(-6)}`;
  const existing=(buckets.buckets||[]).find(b=>b.name===bucket);
  if(existing&&!(previous?.account===account&&previous?.bucket===bucket))bucket=`${name}-media-${randomBytes(3).toString('hex')}`;
  if(!(buckets.buckets||[]).some(b=>b.name===bucket)){await cf('/r2/buckets',{method:'POST',body:JSON.stringify({name:bucket})});console.log(`Created private media bucket: ${bucket}`);}
  const configuration={...base,name,account_id:account,main:path.join(root,'cloudflare/worker.ts'),assets:{...base.assets,directory:path.join(root,'dist/client')},build:{...base.build,cwd:root},r2_buckets:[{binding:'MEDIA',bucket_name:bucket}]};
  await mkdir('.cloudflare',{recursive:true});const filename=path.join(root,'.cloudflare/wrangler.deploy.json');await writeFile(filename,JSON.stringify(configuration,null,2)+'\n');
  // Keep the identity of newly created resources even if a later deployment step needs a retry.
  await writeFile('.cloudflare/deployment.json',JSON.stringify({account,project:desired,name,bucket,status:'prepared'},null,2)+'\n');
  console.log(`Deploying new Cloudflare application: ${name}; live payments remain disabled.`);
  await command(['deploy','--config',filename]);
  const subdomain=await cf('/workers/subdomain');const url=`https://${name}.${subdomain.subdomain}.workers.dev`;
  let verified=false;
  for(let attempt=0;attempt<12;attempt++){
    try{const response=await fetch(`${url}/api/health`,{dispatcher});if(response.ok&&(await response.json()).ok){verified=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!verified)throw new Error('Cloudflare accepted the deployment, but the public health check did not pass. Inspect this application’s logs before claiming it is live.');
  const response=await fetch(`${url}/api/config`,{dispatcher});const cfg=await response.json();if(cfg.runtime!=='cloudflare'||cfg.paymentsMode!=='disabled')throw new Error('Unexpected deployed runtime or payment mode.');
  await writeFile('.cloudflare/deployment.json',JSON.stringify({account,project:desired,name,bucket,url,status:'verified',deployed_at:new Date().toISOString()},null,2)+'\n');
  console.log(`Verified application URL: ${url}`);
}catch(error){console.error(sanitize(error.message));process.exitCode=1;}
finally{await dispatcher?.close();}
