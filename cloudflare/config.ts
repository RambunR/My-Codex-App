import type {Env} from './runtime';
export const config={port:8080,production:true,sandbox:false,stripeTestMode:false,appUrl:'https://aidramio.example',dataDir:'/tmp',payments:'disabled',usdToHkd:7.8,stripeKey:'',stripeWebhook:'',stripeActivationPriceId:'',stripeWalletProductId:'',googleClientId:'',googleClientSecret:'',seed:false,ffmpeg:'',ffprobe:'',runtime:'cloudflare',videoFormats:['mp4','mov','m4v']};
export function configure(env:Env){
  config.production=env.ENVIRONMENT!=='development';config.payments=env.PAYMENTS_MODE||'disabled';
  config.sandbox=env.ENVIRONMENT==='sandbox';
  config.stripeTestMode=env.STRIPE_TEST_MODE==='true';
  if(config.production&&config.payments==='demo')throw new Error('Demo payments are prohibited in a deployed application.');
  config.stripeKey=env.STRIPE_SECRET_KEY||'';config.stripeWebhook=env.STRIPE_WEBHOOK_SECRET||'';
  config.stripeActivationPriceId=env.STRIPE_ACTIVATION_PRICE_ID||'';config.stripeWalletProductId=env.STRIPE_WALLET_PRODUCT_ID||'';
  config.googleClientId=env.GOOGLE_CLIENT_ID||'';config.googleClientSecret=env.GOOGLE_CLIENT_SECRET||'';
  config.usdToHkd=Number(env.USD_TO_HKD||7.8);if(!(config.usdToHkd>0))throw new Error('USD_TO_HKD must be positive.');
  config.seed=env.SEED_CATALOG==='true';if(env.APP_URL)config.appUrl=new URL(env.APP_URL).origin;
  if(config.sandbox&&config.appUrl!=='https://aidramio-sandbox.jimmy-tsoi2001.workers.dev')throw new Error('The payment sandbox requires its isolated HTTPS origin.');
}
