import Stripe from 'stripe';
import {fetch,ProxyAgent} from 'undici';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';

const root=fileURLToPath(new URL('../',import.meta.url));
const EXPECTED_ACCOUNT='acct_1StBIYJ6Er233b9c';
const specifications=[
  {kind:'activation',name:'Dramio Pass',description:'One-time HK$88 publisher pass. Publish short dramas with 5 GB of storage. No monthly subscription.',currency:'hkd',unit_amount:8800},
  {kind:'funding',name:'AIDramio wallet credit',description:'Closed-loop USD credit for episode unlocks. Choose an amount of at least US$5 in AIDramio.',currency:'usd',unit_amount:500},
];
const owned=(object,kind)=>object?.metadata?.app==='aidramio'&&object?.metadata?.kind===kind;
const testObject=object=>{if(object.livemode!==false)throw new Error('Refusing a non-test Stripe catalog object.');return object;};
const identity=object=>typeof object==='string'?object:object?.id;

async function operation(label,fn){
  try{return await fn();}
  catch(error){if(!error.operation)error.operation=label;throw error;}
}
async function listAll(list,params={}){
  const result=[];let starting_after;
  for(;;){
    const page=await list({...params,limit:100,...(starting_after?{starting_after}:{})});
    for(const item of page.data)testObject(item);
    result.push(...page.data);
    if(!page.has_more)return result;
    if(!page.data.length)throw new Error('Stripe returned an invalid empty catalog page.');
    starting_after=page.data.at(-1).id;
  }
}
function matchesPrice(price,spec,productId){
  if(!owned(price,spec.kind)||identity(price.product)!==productId||price.currency!==spec.currency||price.type!=='one_time')return false;
  return price.unit_amount===spec.unit_amount&&!price.custom_unit_amount;
}

/** Creates test catalog objects only. It never creates Checkout, a charge, or a subscription. */
export async function provisionTestCatalog(stripe,{outputPath=path.join(root,'stripe/catalog.test.json'),report=event=>console.log(JSON.stringify(event))}={}){
  const catalog={version:1,mode:'test',expected_account:EXPECTED_ACCOUNT,account_verified:false,status:'provisioning',products:{},updated_at:new Date().toISOString()};
  // Catalog renames must preserve the already-connected endpoint identities.
  try{
    const previous=JSON.parse(await readFile(outputPath,'utf8'));
    if(previous.mode==='test'&&previous.expected_account===EXPECTED_ACCOUNT){
      if(previous.webhook)catalog.webhook=previous.webhook;
      if(previous.main_webhook)catalog.main_webhook=previous.main_webhook;
    }
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try{
    const account=await operation('verify_account',()=>stripe.accounts.retrieve());
    if(account.id!==EXPECTED_ACCOUNT)throw Object.assign(new Error('The test key belongs to a different Stripe account; no changes were made.'),{operation:'verify_account'});
    catalog.account_verified=true;
  }catch(error){
    if(error.statusCode!==403&&error.type!=='StripePermissionError')throw error;
    report({operation:'verify_account',status:'unavailable',reason:'restricted_key_has_no_account_read_permission',expected_account:EXPECTED_ACCOUNT});
  }
  const save=async()=>{
    catalog.updated_at=new Date().toISOString();
    await mkdir(path.dirname(outputPath),{recursive:true});
    const temporary=outputPath+'.tmp';
    await writeFile(temporary,JSON.stringify(catalog,null,2)+'\n');
    await rename(temporary,outputPath);
  };
  const products=await operation('list_products',()=>listAll(params=>stripe.products.list(params)));
  for(const spec of specifications){
    const metadata={app:'aidramio',kind:spec.kind,environment:'test',...(spec.kind==='funding'?{amount_selection:'application_checkout',minimum_amount:'500',maximum_amount:'99999999'}:{})};
    let product=products.find(p=>owned(p,spec.kind)&&p.active)||products.find(p=>owned(p,spec.kind));
    if(!product){
      product=testObject(await operation('create_product_'+spec.kind,()=>stripe.products.create({name:spec.name,description:spec.description,metadata},{idempotencyKey:'aidramio:test:catalog:v1:product:'+spec.kind})));
      products.push(product);
      report({operation:'create_product',kind:spec.kind,product_id:product.id,mode:'test'});
    }else if(!product.active||product.name!==spec.name||product.description!==spec.description||Object.entries(metadata).some(([name,value])=>product.metadata?.[name]!==value)){
      product=testObject(await operation('update_product_'+spec.kind,()=>stripe.products.update(product.id,{active:true,name:spec.name,description:spec.description,metadata},{idempotencyKey:'aidramio:test:catalog:v1:update-product:'+spec.kind+(spec.kind==='funding'?':fixed-usd500-v2':':dramio-pass-v1')})));
      report({operation:'update_owned_product',kind:spec.kind,product_id:product.id,mode:'test'});
    }else report({operation:'reuse_product',kind:spec.kind,product_id:product.id,mode:'test'});

    catalog.products[spec.kind]={name:spec.name,product_id:product.id,price_id:null,currency:spec.currency,one_time:true,unit_amount:spec.unit_amount,...(spec.kind==='funding'?{amount_selection:'application_checkout',minimum_amount:500,preset_amount:500,maximum_amount:99_999_999}:{}),status:'product_ready_price_pending'};
    await save();
    const prices=await operation('list_prices_'+spec.kind,()=>listAll(params=>stripe.prices.list(params),{product:product.id}));
    let price=prices.find(p=>p.active&&matchesPrice(p,spec,product.id))||prices.find(p=>matchesPrice(p,spec,product.id));
    if(!price){
      price=testObject(await operation('create_price_'+spec.kind,()=>stripe.prices.create({product:product.id,currency:spec.currency,metadata,unit_amount:spec.unit_amount},{idempotencyKey:'aidramio:test:catalog:v1:price:'+spec.kind+(spec.kind==='funding'?':fixed-usd500-v2':'')})));
      report({operation:'create_price',kind:spec.kind,price_id:price.id,currency:spec.currency,mode:'test'});
    }else if(!price.active){
      price=testObject(await operation('reactivate_price_'+spec.kind,()=>stripe.prices.update(price.id,{active:true},{idempotencyKey:'aidramio:test:catalog:v1:reactivate-price:'+price.id})));
      report({operation:'reactivate_owned_price',kind:spec.kind,price_id:price.id,mode:'test'});
    }else report({operation:'reuse_price',kind:spec.kind,price_id:price.id,mode:'test'});
    if(!matchesPrice(price,spec,product.id))throw Object.assign(new Error('Stripe returned a price that does not match the requested test catalog.'),{operation:'verify_price_'+spec.kind});
    catalog.products[spec.kind].price_id=price.id;
    catalog.products[spec.kind].status='ready';
    await save();
    if(identity(product.default_price)!==price.id){
      await operation('set_default_price_'+spec.kind,()=>stripe.products.update(product.id,{default_price:price.id},{idempotencyKey:'aidramio:test:catalog:v1:default:'+product.id+':'+price.id}));
    }
  }
  catalog.status='complete';await save();
  report({operation:'catalog_complete',mode:'test',account_verified:catalog.account_verified,output:path.relative(root,outputPath),product_count:2,real_money_charged:false});
  return catalog;
}

function stdinKey(){
  return new Promise((resolve,reject)=>{
    const input=createInterface({input:process.stdin,terminal:false});let found=false;
    input.once('line',line=>{found=true;input.close();process.stdin.pause();resolve(line.trim());});
    input.once('close',()=>{if(!found)reject(new Error('No Stripe test key was received on standard input.'));});
  });
}
function sanitize(value,key){
  let text=String(value??'');if(key)text=text.split(key).join('[redacted]');
  return text.replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+/g,'[redacted Stripe key]').replace(/whsec_[A-Za-z0-9_]+/g,'[redacted webhook secret]');
}
async function main(){
  let key='',dispatcher;
  try{
    const {values}=parseArgs({options:{'stdin-key':{type:'boolean'},'catalog-only':{type:'boolean'},help:{type:'boolean'}},allowPositionals:false});
    if(values.help){console.log('Usage: node scripts/provision-stripe-test.mjs [--catalog-only] [--stdin-key]\nTest catalog only: one-time publisher activation HK$88 and a base US$5 closed-loop wallet-credit price.\nThe application selects custom wallet amounts of at least US$5 using server-defined Checkout amounts; Stripe native pay-what-you-want pricing is not used.\nSupply STRIPE_TEST_SECRET_KEY securely, or send one key line on stdin with terminal echo disabled.\nRequired catalog permissions: Products read/write and Prices read/write. Account read is optional.\nNo live keys, Checkout sessions, charges, subscriptions, webhooks or Cloudflare resources are created.');return;}
    key=values['stdin-key']?await stdinKey():process.env.STRIPE_TEST_SECRET_KEY||'';
    if(!/^(?:rk|sk)_test_[A-Za-z0-9_]+$/.test(key))throw new Error('A Stripe test secret/restricted key is required. Use secure STRIPE_TEST_SECRET_KEY or --stdin-key; never put a key in command-line arguments or Git.');
    const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;dispatcher=proxy?new ProxyAgent(proxy):undefined;
    const stripe=new Stripe(key,{host:'api.stripe.com',protocol:'https',maxNetworkRetries:2,httpClient:Stripe.createFetchHttpClient((url,init)=>fetch(url,{...init,dispatcher}))});
    await provisionTestCatalog(stripe);
  }catch(error){
    console.error(JSON.stringify({operation:error.operation||'initialize',http_status:error.statusCode||null,type:sanitize(error.type||error.name,key),message:sanitize(error.message,key)}));process.exitCode=1;
  }finally{key='';await dispatcher?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
