import type Stripe from 'stripe';
import {config} from './config.js';

export const REQUIRED_STRIPE_EVENTS=[
  'checkout.session.completed','checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed','checkout.session.expired',
  'charge.refunded','charge.dispute.created','charge.dispute.closed',
]as const;
export interface StripeWebhookReadiness {status:'unchecked'|'pending'|'ready'|'error';code?:string}
const EXPECTED_ACCOUNT='acct_1StBIYJ6Er233b9c';
const REQUEST_OPTIONS:Stripe.RequestOptions={timeout:10_000,maxNetworkRetries:0};
const MAX_PAGES=5;
let state:StripeWebhookReadiness={status:'unchecked'};
let signature='',expiresAt=0,generation=0,pending:Promise<boolean>|null=null;

export function resetStripeReadiness(){generation++;signature='';expiresAt=0;pending=null;state={status:'unchecked'};}
export function stripeWebhookReadiness():StripeWebhookReadiness{return{...state};}
class ReadinessFailure extends Error {constructor(readonly code:string){super(code);}}
function requireCondition(condition:unknown,code:string):asserts condition{if(!condition)throw new ReadinessFailure(code);}
function configSignature(client:Stripe|null){return JSON.stringify([config.stripeAutoConfigureWebhook,config.production,config.sandbox,config.payments,config.stripeTestMode,config.stripeKey,config.appUrl,!!client]);}
function failureCode(error:unknown){
  if(error instanceof ReadinessFailure)return error.code;
  const e=error&&typeof error==='object'?error as {statusCode?:number;type?:string}:{};
  if(e.statusCode===403||e.type==='StripePermissionError')return'STRIPE_PERMISSION_DENIED';
  if(e.statusCode===401||e.type==='StripeAuthenticationError')return'STRIPE_AUTHENTICATION_FAILED';
  return'STRIPE_READINESS_UNAVAILABLE';
}
function endpointMatches(endpoint:Stripe.WebhookEndpoint,url:string){return endpoint.object==='webhook_endpoint'&&endpoint.livemode===true&&endpoint.status==='enabled'&&endpoint.url===url&&typeof endpoint.id==='string'&&endpoint.id.startsWith('we_');}
function enabledEvents(endpoint:Stripe.WebhookEndpoint){requireCondition(Array.isArray(endpoint.enabled_events)&&endpoint.enabled_events.every(value=>typeof value==='string'),'STRIPE_WEBHOOK_INVALID');return endpoint.enabled_events;}
function complete(endpoint:Stripe.WebhookEndpoint){const events=enabledEvents(endpoint);return events.includes('*')||REQUIRED_STRIPE_EVENTS.every(event=>events.includes(event));}

async function verify(client:Stripe|null):Promise<void>{
  requireCondition(config.production&&!config.sandbox&&config.payments==='stripe'&&!config.stripeTestMode&&/^(sk|rk)_live_/.test(config.stripeKey),'STRIPE_READINESS_CONFIG');
  let origin:URL;try{origin=new URL(config.appUrl);}catch{throw new ReadinessFailure('STRIPE_READINESS_CONFIG');}
  requireCondition(origin.protocol==='https:'&&!origin.username&&!origin.password,'STRIPE_READINESS_CONFIG');
  requireCondition(client,'STRIPE_CLIENT_UNAVAILABLE');
  const url=origin.origin+'/api/payments/webhook';
  const account=await client.accounts.retrieve({},REQUEST_OPTIONS);
  requireCondition(account.id===EXPECTED_ACCOUNT,'STRIPE_ACCOUNT_MISMATCH');
  requireCondition(account.charges_enabled===true,'STRIPE_CHARGES_DISABLED');
  const matches=new Map<string,Stripe.WebhookEndpoint>();
  let cursor:string|undefined;
  for(let page=0;page<MAX_PAGES;page++){
    // WebhookEndpoints is Stripe's Snapshot endpoint API. Thin event
    // destinations do not satisfy this app's signed Snapshot payload contract.
    const result=await client.webhookEndpoints.list({limit:100,...(cursor?{starting_after:cursor}:{})},REQUEST_OPTIONS);
    requireCondition(Array.isArray(result.data),'STRIPE_WEBHOOK_INVALID');
    for(const endpoint of result.data)if(endpointMatches(endpoint,url))matches.set(endpoint.id,endpoint);
    if(!result.has_more)break;
    const last=result.data.at(-1)?.id;
    requireCondition(page<MAX_PAGES-1&&typeof last==='string'&&last!==cursor,'STRIPE_WEBHOOK_LIST_LIMIT');cursor=last;
  }
  requireCondition(matches.size>0,'STRIPE_WEBHOOK_NOT_FOUND');
  requireCondition(matches.size===1,'STRIPE_WEBHOOK_AMBIGUOUS');
  const listed=[...matches.values()][0];
  if(!complete(listed)){
    const events=[...new Set([...enabledEvents(listed),...REQUIRED_STRIPE_EVENTS])];
    // Only the selected event list is writable here. Keep the existing ID,
    // URL, API version, status and signing secret; never create an endpoint.
    const updated=await client.webhookEndpoints.update(listed.id,{enabled_events:events as Stripe.WebhookEndpointUpdateParams.EnabledEvent[]},REQUEST_OPTIONS);
    requireCondition(endpointMatches(updated,url)&&updated.id===listed.id&&updated.api_version===listed.api_version&&complete(updated),'STRIPE_WEBHOOK_UPDATE_MISMATCH');
  }
  const verified=await client.webhookEndpoints.retrieve(listed.id,{},REQUEST_OPTIONS);
  requireCondition(endpointMatches(verified,url)&&verified.id===listed.id&&verified.api_version===listed.api_version&&complete(verified),'STRIPE_WEBHOOK_VERIFY_FAILED');
}

/** Verify the account and, when explicitly enabled, append only missing events.
 * Failures are cached briefly and reported using fixed, non-sensitive codes. */
export async function ensureStripeWebhookReady(client:Stripe|null):Promise<boolean>{
  if(!config.stripeAutoConfigureWebhook){resetStripeReadiness();return true;}
  const current=configSignature(client);
  if(signature!==current){resetStripeReadiness();signature=current;}
  if(pending)return pending;
  if(expiresAt>Date.now()&&(state.status==='ready'||state.status==='error'))return state.status==='ready';
  const token=generation;state={status:'pending'};
  const task=verify(client).then(()=>({status:'ready'}as StripeWebhookReadiness),error=>({status:'error',code:failureCode(error)}as StripeWebhookReadiness)).then(result=>{
    if(token!==generation||current!==configSignature(client))return false;
    state=result;expiresAt=Date.now()+(result.status==='ready'?300_000:30_000);return result.status==='ready';
  });
  pending=task;
  try{return await task;}finally{if(pending===task)pending=null;}
}
