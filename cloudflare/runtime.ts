import type {DurableObjectStorage,R2Bucket,Fetcher,DurableObjectNamespace} from '@cloudflare/workers-types';
export interface Env {
  APP:DurableObjectNamespace; MEDIA:R2Bucket; ASSETS:Fetcher;
  ENVIRONMENT?:string; APP_URL?:string; PUBLIC_APP_URL?:string; STRIPE_SITE_ORIGIN?:string; PAYMENTS_MODE?:string; USD_TO_HKD?:string;
  PLATFORM_OWNER_USER_ID?:string; OFFICIAL_CREATOR_NAME?:string;
  PLATFORM_ADMIN_EMAIL_SHA256?:string;
  STRIPE_SECRET_KEY?:string; STRIPE_WEBHOOK_SECRET?:string; BOOTSTRAP_TOKEN?:string;
  STRIPE_TEST_SECRET_KEY?:string; STRIPE_TEST_WEBHOOK_SECRET?:string;
  STRIPE_TEST_PAYOUTS_ENABLED?:string; STRIPE_TEST_PAYOUT_ACCOUNT_ID?:string; STRIPE_TEST_CONNECT_WEBHOOK_SECRET?:string;
  STRIPE_ACTIVATION_PRICE_ID?:string; STRIPE_WALLET_PRODUCT_ID?:string;
  STRIPE_TEST_ACTIVATION_PRICE_ID?:string; STRIPE_TEST_WALLET_PRODUCT_ID?:string;
  STRIPE_TEST_MODE?:string; PAYOUTS_ENABLED?:string; STRIPE_AUTO_CONFIGURE_WEBHOOK?:string;
  PASS_PROMOTION_ENABLED?:string;
  GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string;
  APPLE_CLIENT_ID?:string; APPLE_TEAM_ID?:string; APPLE_KEY_ID?:string; APPLE_PRIVATE_KEY?:string;
  RESEND_API_KEY?:string; MAIL_FROM?:string;
  EMAIL_PROVIDER?:string; CF_EMAIL_ACCOUNT_ID?:string; CF_EMAIL_API_TOKEN?:string;
  SEED_CATALOG?:string;
}
let runtime:{storage:DurableObjectStorage;env:Env;waitUntil?:(promise:Promise<unknown>)=>void}|undefined;
export function bindRuntime(storage:DurableObjectStorage,env:Env,waitUntil?:(promise:Promise<unknown>)=>void){runtime={storage,env,waitUntil};}
export function getRuntime(){if(!runtime)throw new Error('Cloudflare durable runtime is not initialized.');return runtime;}
export function finishInBackground<T>(promise:Promise<T>):Promise<T>{getRuntime().waitUntil?.(promise);return promise;}
