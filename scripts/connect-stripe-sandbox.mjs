import Stripe from 'stripe';
import {fetch,ProxyAgent} from 'undici';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const ACCOUNT='95040c4f244233138195b80657887486';
const STRIPE_ACCOUNT='acct_1StBIYJ6Er233b9c';
const WORKER='aidramio-sandbox';
const MAIN='aidramio';
const SITE='https://aidramio-sandbox.jimmy-tsoi2001.workers.dev';
const WEBHOOK=SITE+'/api/payments/webhook';
const EVENTS=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(value,message,operation='verify_sandbox')=>{if(!value)throw Object.assign(new Error(message),{operation});};
async function operation(name,fn){try{return await fn();}catch(error){if(!error.operation)error.operation=name;throw error;}}

function stdinKey(){return new Promise((resolve,reject)=>{const input=createInterface({input:process.stdin,terminal:false});let received=false;input.once('line',line=>{received=true;input.close();process.stdin.pause();resolve(line.trim());});input.once('close',()=>{if(!received)reject(new Error('No Stripe test key was received on standard input.'));});});}
function sanitize(value,secrets){let text=String(value??'');for(const secret of secrets)if(secret)text=text.split(secret).join('[redacted]');return text.replace(/(?:sk|rk)_(?:test|live)_[^\s"'<>]+/g,'[redacted Stripe key]').replace(/whsec_[^\s"'<>]+/g,'[redacted webhook secret]').replace(/https:\/\/checkout\.stripe\.com\/[^\s"'<>]+/g,'[redacted Checkout URL]');}

export async function connectStripeSandbox({stripe,stripeKey,cloudflareToken,dispatcher,request=fetch,verify=true,catalogPath=path.join(root,'stripe/catalog.test.json'),report=event=>console.log(JSON.stringify(event)),secretBag=[]}){
  check(/^(?:rk|sk)_test_[A-Za-z0-9_]+$/.test(stripeKey),'Only a Stripe test key can configure this isolated payment sandbox.','validate_test_key');
  check(Boolean(cloudflareToken),'CLOUDFLARE_API_TOKEN is required in the secure environment.','validate_cloudflare_auth');
  secretBag.push(stripeKey,cloudflareToken);
  async function cf(route,options={}){
    const response=await request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+route,{...options,dispatcher,signal:AbortSignal.timeout(20_000),headers:{Authorization:'Bearer '+cloudflareToken,'Content-Type':'application/json',...options.headers}});
    const data=await response.json();
    if(!response.ok||data.success===false)throw Object.assign(new Error((data.errors||[]).map(e=>e.message).join('; ')||'Cloudflare request failed.'),{statusCode:response.status});
    return data.result;
  }
  const [sandbox,main]=await operation('verify_sandbox_isolation',()=>Promise.all([cf('/workers/scripts/'+WORKER+'/settings'),cf('/workers/scripts/'+MAIN+'/settings')]));
  const sb=new Map((sandbox.bindings||[]).map(b=>[b.name,b]));
  const mb=new Map((main.bindings||[]).map(b=>[b.name,b]));
  check(sb.get('ENVIRONMENT')?.text==='sandbox'&&sb.get('APP_URL')?.text===SITE,'The target Worker is not configured for the fixed isolated sandbox origin.');
  check(sb.get('APP')?.namespace_id&&mb.get('APP')?.namespace_id&&sb.get('APP').namespace_id!==mb.get('APP').namespace_id,'Sandbox and production must have distinct Durable Object namespaces.');
  check(sb.get('MEDIA')?.bucket_name==='aidramio-sandbox-media-887486'&&sb.get('MEDIA').bucket_name!==mb.get('MEDIA')?.bucket_name,'Sandbox must use its own dedicated media bucket.');
  report({operation:'verify_sandbox_isolation',status:'passed',worker:WORKER});

  try{const account=await operation('verify_stripe_account',()=>stripe.accounts.retrieve());check(account.id===STRIPE_ACCOUNT,'The test key belongs to a different Stripe account.','verify_stripe_account');}
  catch(error){if(error.statusCode!==403&&error.type!=='StripePermissionError')throw error;report({operation:'verify_stripe_account',status:'account_read_not_permitted'});}

  let catalog;try{catalog=JSON.parse(await readFile(catalogPath,'utf8'));check(catalog.mode==='test','The catalog file is not a test catalog.','read_test_catalog');}catch(error){if(error.code!=='ENOENT')throw error;catalog={version:1,mode:'test',expected_account:STRIPE_ACCOUNT};}
  const endpoints=[];let starting_after;
  for(;;){const page=await operation('list_test_webhooks',()=>stripe.webhookEndpoints.list({limit:100,...(starting_after?{starting_after}:{})}));endpoints.push(...page.data);if(!page.has_more)break;check(page.data.length,'Stripe returned an invalid webhook page.','list_test_webhooks');starting_after=page.data.at(-1).id;}
  const atUrl=endpoints.filter(e=>e.url===WEBHOOK);
  const owned=atUrl.filter(e=>e.livemode===false&&e.metadata?.app==='aidramio'&&(e.metadata?.environment==='test'||e.metadata?.env==='test'));
  check(!atUrl.some(e=>!owned.includes(e)),'An unowned webhook already uses the sandbox URL; this helper will not alter or duplicate it.','select_test_webhook');
  let endpoint=owned.find(e=>e.id===catalog.webhook?.id)||(owned.length===1?owned[0]:undefined);
  check(owned.length<2||endpoint,'Multiple owned sandbox webhooks exist without a matching catalog identity.','select_test_webhook');
  let signingSecret;
  if(endpoint){
    check(sb.get('STRIPE_WEBHOOK_SECRET')?.type==='secret_text','The existing sandbox webhook signing secret cannot be recovered through Stripe API. Add that endpoint signing secret securely to the sandbox Worker before retrying.','reuse_test_webhook');
    const sameEvents=endpoint.enabled_events?.length===EVENTS.length&&EVENTS.every(event=>endpoint.enabled_events.includes(event));
    if(endpoint.status!=='enabled'||!sameEvents)endpoint=await operation('update_owned_test_webhook',()=>stripe.webhookEndpoints.update(endpoint.id,{disabled:false,enabled_events:EVENTS}));
    report({operation:'reuse_test_webhook',status:'ready',webhook_id:endpoint.id});
  }else{
    endpoint=await operation('create_test_webhook',()=>stripe.webhookEndpoints.create({url:WEBHOOK,enabled_events:EVENTS,description:'AIDramio isolated payment sandbox: test Checkout events only.',metadata:{app:'aidramio',environment:'test',env:'test',sandbox_worker:WORKER}},{idempotencyKey:'aidramio:test:sandbox-webhook:v1'}));
    check(endpoint.livemode===false&&endpoint.url===WEBHOOK,'Stripe did not return the expected test webhook.','create_test_webhook');
    signingSecret=endpoint.secret;check(typeof signingSecret==='string'&&signingSecret.startsWith('whsec_'),'Stripe did not return the new endpoint signing secret; configure it securely before retrying.','create_test_webhook');
    secretBag.push(signingSecret);report({operation:'create_test_webhook',status:'created',webhook_id:endpoint.id});
  }

  // Only these two secrets are copied, only to the fixed isolated Worker.
  // Never write their values to the catalog, another file, or output.
  if(signingSecret)await operation('store_sandbox_webhook_secret',()=>cf('/workers/scripts/'+WORKER+'/secrets',{method:'PUT',body:JSON.stringify({name:'STRIPE_WEBHOOK_SECRET',type:'secret_text',text:signingSecret})}));
  await operation('store_sandbox_stripe_key',()=>cf('/workers/scripts/'+WORKER+'/secrets',{method:'PUT',body:JSON.stringify({name:'STRIPE_SECRET_KEY',type:'secret_text',text:stripeKey})}));
  report({operation:'configure_sandbox_worker_secrets',status:'stored',worker:WORKER});
  catalog.webhook={id:endpoint.id,url:WEBHOOK};catalog.updated_at=new Date().toISOString();
  await mkdir(path.dirname(catalogPath),{recursive:true});await writeFile(catalogPath+'.tmp',JSON.stringify(catalog,null,2)+'\n');await rename(catalogPath+'.tmp',catalogPath);

  if(verify)await verifySandbox({stripe,request,dispatcher,report,secretBag});
  report({operation:'sandbox_setup',status:verify?'verified':'configured',worker:WORKER,webhook_id:endpoint.id});
  return{webhook_id:endpoint.id,worker:WORKER,verified:verify};
}

export async function verifySandbox({stripe,request=fetch,dispatcher,report=event=>console.log(JSON.stringify(event)),secretBag=[]}){
  async function api(route,{body,cookie,method=body===undefined?'GET':'POST'}={}){
    const response=await request(SITE+route,{method,dispatcher,signal:AbortSignal.timeout(20_000),headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:SITE}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'Sandbox API request failed.'),{statusCode:response.status});return{data,response};
  }
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    try{const {data}=await api('/api/config');check(data.sandbox===true&&data.paymentsTestMode===true,'The public site does not identify itself as an isolated test payment site.','verify_public_sandbox');if(data.paymentsReady===true){ready=true;break;}}
    catch(error){if(error.operation==='verify_public_sandbox')throw error;}
    await sleep(500);
  }
  check(ready,'Sandbox payment credentials did not become ready after configuration.','wait_sandbox_ready');
  const password=randomBytes(32).toString('base64url'),email='stripe-setup-'+randomBytes(12).toString('hex')+'@sandbox.aidramio.invalid';secretBag.push(password,email);
  const registered=await operation('register_sandbox_verification_user',()=>api('/api/auth/register',{body:{name:'Payment setup check',email,password}}));
  const userId=registered.data.user?.id;
  const cookie=registered.response.headers.getSetCookie().find(v=>v.startsWith('drama_session='))?.split(';')[0];
  check(userId&&cookie,'Sandbox registration did not create its verification session.','register_sandbox_verification_user');secretBag.push(cookie);
  const sessions=[];
  function checkoutId(url){secretBag.push(url);const parsed=new URL(url);check(parsed.protocol==='https:'&&parsed.hostname==='checkout.stripe.com','Unexpected Checkout origin.','verify_checkout');const id=parsed.pathname.match(/(?:^|\/)(cs_test_[A-Za-z0-9_]+)/)?.[1];check(id,'Checkout did not contain a test Session identifier.','verify_checkout');return id;}
  try{
    for(const spec of [{kind:'funding',amount:23456,currency:'usd'},{kind:'activation',amount:8800,currency:'hkd'}]){
      const checkout=await operation('create_'+spec.kind+'_checkout',()=>api('/api/payments/checkout',{cookie,body:{kind:spec.kind,...(spec.kind==='funding'?{amount_cents:spec.amount}:{})}}));
      const id=checkoutId(checkout.data.url);
      const session=await operation('retrieve_'+spec.kind+'_checkout',()=>stripe.checkout.sessions.retrieve(id));
      check(session.livemode===false&&session.mode==='payment'&&session.client_reference_id===checkout.data.paymentId&&session.metadata?.paymentId===checkout.data.paymentId&&session.metadata?.userId===userId&&session.metadata?.app==='aidramio','Checkout identity does not match the isolated verification request.','verify_'+spec.kind+'_checkout');
      sessions.push({id,paymentId:checkout.data.paymentId,kind:spec.kind,expired:false});
      check(session.amount_total===spec.amount&&session.currency===spec.currency&&session.status==='open'&&session.payment_status==='unpaid','Checkout amount, currency or unpaid status is incorrect.','verify_'+spec.kind+'_checkout');
      if(spec.kind==='activation'){
        const again=await operation('repeat_activation_checkout',()=>api('/api/payments/checkout',{cookie,body:{kind:'activation'}}));
        check(checkoutId(again.data.url)===id&&again.data.paymentId===checkout.data.paymentId,'One-time activation did not reuse its pending Checkout.','repeat_activation_checkout');
      }
      report({operation:'verify_'+spec.kind+'_checkout',status:'passed',checkout_session_id:id,payment_id:checkout.data.paymentId});
    }
    for(const session of sessions){await operation('expire_test_checkout',()=>stripe.checkout.sessions.expire(session.id));session.expired=true;report({operation:'expire_test_checkout',status:'expired',checkout_session_id:session.id});}
    let delivered=false;
    for(let attempt=0;attempt<40;attempt++){
      const {data}=await operation('check_signed_webhook_delivery',()=>api('/api/wallet',{cookie}));
      check(data.user?.wallet_micros===0&&data.user?.publisher_active===0,'An unpaid verification Checkout changed the sandbox wallet or publisher activation.','check_signed_webhook_delivery');
      if(sessions.every(session=>data.payments?.some(p=>p.id===session.paymentId&&p.status==='expired'))){delivered=true;break;}
      await sleep(1000);
    }
    check(delivered,'Stripe expired the sessions, but signed webhook delivery has not marked both sandbox payments expired. Check the endpoint delivery log; no cards were charged.','check_signed_webhook_delivery');
    report({operation:'check_signed_webhook_delivery',status:'passed',payment_ids:sessions.map(s=>s.paymentId)});
  }finally{
    for(const session of sessions.filter(s=>!s.expired))try{await stripe.checkout.sessions.expire(session.id);}catch{report({operation:'cleanup_test_checkout',status:'could_not_expire',checkout_session_id:session.id});}
  }
}

async function main(){
  let dispatcher;const secretBag=[];
  try{
    const {values}=parseArgs({options:{'stdin-key':{type:'boolean'},'verify-only':{type:'boolean'},verify:{type:'boolean',default:true},help:{type:'boolean'}},allowNegative:true,allowPositionals:false});
    if(values.help){console.log('Usage: node scripts/connect-stripe-sandbox.mjs [--stdin-key] [--verify|--no-verify] [--verify-only]\nConfigure only aidramio-sandbox after it has been deployed with isolated storage.\nSupply a Stripe test key through secure STRIPE_TEST_SECRET_KEY or one stdin line with terminal echo disabled. CLOUDFLARE_API_TOKEN is also required.\nDefault verification creates and expires two unpaid test Checkout Sessions and checks signed expiration webhook delivery. It never submits a card or touches production user data.');return;}
    const key=values['stdin-key']?await stdinKey():process.env.STRIPE_TEST_SECRET_KEY||'';
    secretBag.push(key,process.env.CLOUDFLARE_API_TOKEN||'');
    const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;dispatcher=proxy?new ProxyAgent(proxy):undefined;
    check(/^(?:rk|sk)_test_[A-Za-z0-9_]+$/.test(key),'A Stripe test key is required; live keys are refused.','validate_test_key');
    const stripe=new Stripe(key,{host:'api.stripe.com',protocol:'https',timeout:20_000,maxNetworkRetries:2,httpClient:Stripe.createFetchHttpClient((url,init)=>fetch(url,{...init,dispatcher}))});
    if(values['verify-only'])await verifySandbox({stripe,dispatcher,secretBag});
    else await connectStripeSandbox({stripe,stripeKey:key,cloudflareToken:process.env.CLOUDFLARE_API_TOKEN,dispatcher,verify:values.verify,secretBag});
  }catch(error){console.error(JSON.stringify({operation:error.operation||'initialize',http_status:error.statusCode||null,type:sanitize(error.type||error.name,secretBag),message:sanitize(error.message,secretBag)}));process.exitCode=1;}
  finally{secretBag.fill('');await dispatcher?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
