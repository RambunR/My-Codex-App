import {after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type Stripe from 'stripe';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-stripe-readiness-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';
const {config}=await import('../server/config');
const {REQUIRED_STRIPE_EVENTS,resetStripeReadiness,stripeWebhookReadiness,ensureStripeWebhookReady}=await import('../server/stripe-readiness');
const originalNow=Date.now;let now=1_000_000;
function configure(){Object.assign(config,{production:true,sandbox:false,payments:'stripe',stripeTestMode:false,stripeAutoConfigureWebhook:true,stripeKey:'rk_live_readiness_fixture',appUrl:'https://lingyingdrama.com',publicUrl:'https://viewer.example.test',stripeSiteOrigin:'https://old-financial-identity.example.test'});}
beforeEach(()=>{configure();now=1_000_000;Date.now=()=>now;resetStripeReadiness();});
after(async()=>{Date.now=originalNow;await rm(directory,{recursive:true,force:true});});
type Endpoint=Stripe.WebhookEndpoint;
function endpoint(overrides:Record<string,unknown>={}):Endpoint{return{id:'we_main',object:'webhook_endpoint',url:'https://lingyingdrama.com/api/payments/webhook',livemode:true,status:'enabled',api_version:'2026-06-30.basil',enabled_events:[...REQUIRED_STRIPE_EVENTS],...overrides}as Endpoint;}
type Call={operation:string;args:any[]};
function fixture(options:{account?:Record<string,unknown>;endpoints?:Endpoint[];pages?:{data:Endpoint[];has_more:boolean}[];error?:unknown;update?:Partial<Endpoint>;retrieved?:Partial<Endpoint>;gate?:Promise<unknown>}={}){
  const calls:Call[]=[],stored=new Map((options.endpoints??[endpoint()]).map(e=>[e.id,{...e}]));let page=0;
  const client={accounts:{retrieve:async(...args:any[])=>{calls.push({operation:'account',args});if(options.gate)await options.gate;if(options.error)throw options.error;return{id:'acct_1StBIYJ6Er233b9c',charges_enabled:true,...options.account};}},webhookEndpoints:{
    list:async(...args:any[])=>{calls.push({operation:'list',args});const result=options.pages?options.pages[page++]:{data:[...stored.values()],has_more:false};return{object:'list',...result};},
    update:async(id:string,params:any,requestOptions:any)=>{calls.push({operation:'update',args:[id,params,requestOptions]});const updated={...stored.get(id),...params,...options.update}as Endpoint;stored.set(id,updated);return updated;},
    retrieve:async(id:string,...args:any[])=>{calls.push({operation:'retrieve',args:[id,...args]});return{...stored.get(id),...options.retrieved};},
  }}as unknown as Stripe;
  return{client,calls,stored};
}
function operations(f:ReturnType<typeof fixture>,name:string){return f.calls.filter(c=>c.operation===name);}
function safeError(code:string){assert.deepEqual(stripeWebhookReadiness(),{status:'error',code});}

test('disabled automation bypasses all remote operations and leaves readiness unchecked',async()=>{
  config.stripeAutoConfigureWebhook=false;const f=fixture();assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(await ensureStripeWebhookReady(null),true);assert.equal(f.calls.length,0);assert.deepEqual(stripeWebhookReadiness(),{status:'unchecked'});
});

test('only explicitly enabled production live Stripe with an HTTPS API origin can make remote calls',async()=>{
  for(const patch of [{production:false},{sandbox:true},{payments:'demo'},{stripeTestMode:true},{stripeKey:'rk_test_fixture'},{appUrl:'http://lingyingdrama.com'},{appUrl:'invalid'},{appUrl:'https://person:password@lingyingdrama.com'}]){
    configure();resetStripeReadiness();Object.assign(config,patch);const f=fixture();assert.equal(await ensureStripeWebhookReady(f.client),false);safeError('STRIPE_READINESS_CONFIG');assert.equal(f.calls.length,0);
  }
  configure();assert.equal(await ensureStripeWebhookReady(null),false);safeError('STRIPE_CLIENT_UNAVAILABLE');
});

test('matching seven-event Snapshot endpoint is independently read back without changes, using API origin',async()=>{
  const f=fixture();assert.equal(await ensureStripeWebhookReady(f.client),true);assert.deepEqual(stripeWebhookReadiness(),{status:'ready'});assert.equal(operations(f,'update').length,0);assert.deepEqual(operations(f,'retrieve')[0].args[0],'we_main');
  assert.deepEqual(f.calls.map(c=>c.operation),['account','list','retrieve']);
  for(const call of f.calls)assert.deepEqual(call.args.at(-1),{timeout:10_000,maxNetworkRetries:0});
});

test('missing events are appended, preserving unrelated events and endpoint identity/settings',async()=>{
  const original=endpoint({enabled_events:['checkout.session.completed','charge.succeeded'],description:'Existing operator endpoint',secret:'whsec_fixture_not_a_real_secret'}),f=fixture({endpoints:[original]});
  assert.equal(await ensureStripeWebhookReady(f.client),true);const [write]=operations(f,'update');assert.equal(write.args[0],original.id);assert.deepEqual(Object.keys(write.args[1]),['enabled_events']);
  assert.deepEqual(write.args[1].enabled_events,[...new Set([...original.enabled_events,...REQUIRED_STRIPE_EVENTS])]);
  for(const field of ['id','url','api_version','status','secret','description']as const)assert.equal((f.stored.get(original.id)as any)[field],(original as any)[field]);
  assert.equal(operations(f,'retrieve').length,1);assert.equal(operations(f,'update').length,1);
});

test('all-events wildcard requires no update',async()=>{
  const f=fixture({endpoints:[endpoint({enabled_events:['*']})]});assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'update').length,0);assert.equal(operations(f,'retrieve').length,1);
});

test('wrong account and disabled charges stop before endpoint discovery',async()=>{
  for(const [account,code]of [[{id:'acct_different'},'STRIPE_ACCOUNT_MISMATCH'],[{charges_enabled:false},'STRIPE_CHARGES_DISABLED']]as const){resetStripeReadiness();const f=fixture({account});assert.equal(await ensureStripeWebhookReady(f.client),false);safeError(code);assert.equal(operations(f,'list').length,0);}
});

test('permission and provider errors expose only fixed codes without keys or provider payloads',async()=>{
  for(const [error,code]of [[{statusCode:403,message:'private provider payload rk_live_hidden'},'STRIPE_PERMISSION_DENIED'],[{statusCode:401},'STRIPE_AUTHENTICATION_FAILED'],[new Error('Secret private body'), 'STRIPE_READINESS_UNAVAILABLE']]as const){resetStripeReadiness();const f=fixture({error});assert.equal(await ensureStripeWebhookReady(f.client),false);safeError(code);assert.equal(JSON.stringify(stripeWebhookReadiness()).includes('private'),false);}
});

test('missing, disabled, test-mode, old-origin and thin destinations cannot trigger endpoint creation',async()=>{
  for(const endpoints of [[],[endpoint({status:'disabled'})],[endpoint({livemode:false})],[endpoint({url:config.stripeSiteOrigin+'/api/payments/webhook'})],[endpoint({object:'event_destination'})]]){
    resetStripeReadiness();const f=fixture({endpoints});assert.equal(await ensureStripeWebhookReady(f.client),false);safeError('STRIPE_WEBHOOK_NOT_FOUND');assert.equal(operations(f,'update').length,0);assert.equal(operations(f,'retrieve').length,0);
  }
});

test('multiple matching enabled live endpoints fail closed without modifying either',async()=>{
  const f=fixture({endpoints:[endpoint(),endpoint({id:'we_duplicate'})]});assert.equal(await ensureStripeWebhookReady(f.client),false);safeError('STRIPE_WEBHOOK_AMBIGUOUS');assert.equal(operations(f,'update').length,0);
});

test('bounded Snapshot pagination discovers the endpoint and does not stop at an empty candidate page',async()=>{
  const main=endpoint(),f=fixture({endpoints:[main],pages:[{data:[endpoint({id:'we_old',url:'https://old.example.test/hook'})],has_more:true},{data:[main],has_more:false}]});
  assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'list').length,2);assert.deepEqual(operations(f,'list')[1].args[0],{limit:100,starting_after:'we_old'});
  resetStripeReadiness();const limited=fixture({pages:Array.from({length:5},(_,index)=>({data:[endpoint({id:'we_'+index})],has_more:true}))});assert.equal(await ensureStripeWebhookReady(limited.client),false);safeError('STRIPE_WEBHOOK_LIST_LIMIT');assert.equal(operations(limited,'list').length,5);assert.equal(operations(limited,'update').length,0);
});

test('a changed update response or incomplete read-back never reports ready',async()=>{
  for(const patch of [{id:'we_other'},{url:'https://other.example.test/hook'},{api_version:'different-version'},{status:'disabled'},{livemode:false},{enabled_events:['checkout.session.completed']}]){
    resetStripeReadiness();const f=fixture({endpoints:[endpoint({enabled_events:[]})],update:patch});assert.equal(await ensureStripeWebhookReady(f.client),false);safeError('STRIPE_WEBHOOK_UPDATE_MISMATCH');
  }
  resetStripeReadiness();const stale=fixture({endpoints:[endpoint({enabled_events:[]})],retrieved:{enabled_events:['checkout.session.completed']}});assert.equal(await ensureStripeWebhookReady(stale.client),false);safeError('STRIPE_WEBHOOK_VERIFY_FAILED');
});

test('ready result caches for five minutes, invalidating on API origin or live credential changes',async()=>{
  const f=fixture();assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'account').length,1);
  now+=300_001;assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'account').length,2);
  config.stripeKey='rk_live_rotated_fixture';assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'account').length,3);
  config.appUrl='https://new.example.test';assert.equal(await ensureStripeWebhookReady(f.client),false);safeError('STRIPE_WEBHOOK_NOT_FOUND');assert.equal(operations(f,'account').length,4);
});

test('failed verification caches for only thirty seconds and can then recover',async()=>{
  const options:{account:Record<string,unknown>}={account:{charges_enabled:false}},f=fixture(options);assert.equal(await ensureStripeWebhookReady(f.client),false);options.account.charges_enabled=true;
  now+=29_999;assert.equal(await ensureStripeWebhookReady(f.client),false);assert.equal(operations(f,'account').length,1);
  now+=2;assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'account').length,2);
});

test('concurrent requests share a single pending verification',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),f=fixture({gate});const first=ensureStripeWebhookReady(f.client),second=ensureStripeWebhookReady(f.client);
  assert.deepEqual(stripeWebhookReadiness(),{status:'pending'});assert.equal(operations(f,'account').length,1);release();assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(operations(f,'list').length,1);
});

test('reset cancels stale readiness results and a new verification can run',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),f=fixture({gate});const old=ensureStripeWebhookReady(f.client);resetStripeReadiness();release();assert.equal(await old,false);assert.deepEqual(stripeWebhookReadiness(),{status:'unchecked'});
  assert.equal(await ensureStripeWebhookReady(f.client),true);assert.equal(operations(f,'account').length,2);
});
