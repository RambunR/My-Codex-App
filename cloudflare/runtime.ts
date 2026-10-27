import type {DurableObjectStorage,R2Bucket,Fetcher,DurableObjectNamespace} from '@cloudflare/workers-types';
export interface Env {
  APP:DurableObjectNamespace; MEDIA:R2Bucket; ASSETS:Fetcher;
  ENVIRONMENT?:string; APP_URL?:string; PAYMENTS_MODE?:string; USD_TO_HKD?:string;
  STRIPE_SECRET_KEY?:string; STRIPE_WEBHOOK_SECRET?:string; BOOTSTRAP_TOKEN?:string;
  GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string;
  SEED_CATALOG?:string;
}
let runtime:{storage:DurableObjectStorage;env:Env;waitUntil?:(promise:Promise<unknown>)=>void}|undefined;
export function bindRuntime(storage:DurableObjectStorage,env:Env,waitUntil?:(promise:Promise<unknown>)=>void){runtime={storage,env,waitUntil};}
export function getRuntime(){if(!runtime)throw new Error('Cloudflare durable runtime is not initialized.');return runtime;}
export function finishInBackground<T>(promise:Promise<T>):Promise<T>{getRuntime().waitUntil?.(promise);return promise;}
