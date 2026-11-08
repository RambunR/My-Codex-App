import type {Env} from './runtime';
import {selectStripeSettings} from '../shared/stripe-settings';
export const config={wechatPayEnabled:false,testPayoutsEnabled:false,testPayoutAccount:'',testConnectWebhook:'',port:8080,production:true,sandbox:false,stripeTestMode:false,payoutsEnabled:false,stripeAutoConfigureWebhook:false,passPromotionEnabled:false,publicUrl:'',stripeSiteOrigin:'',platformOwnerUserId:'',platformAdminEmailHash:'',officialCreatorName:'LingYingDrama Offical',appUrl:'https://aidramio.example',dataDir:'/tmp',payments:'disabled',usdToHkd:7.8,...selectStripeSettings({},false),googleClientId:'',googleClientSecret:'',appleClientId:'',appleTeamId:'',appleKeyId:'',applePrivateKey:'',resendApiKey:'',mailFrom:'',mailProvider:'auto',cloudflareEmailAccountId:'',cloudflareEmailApiToken:'',seed:false,ffmpeg:'',ffprobe:'',runtime:'cloudflare',videoFormats:['mp4','mov','m4v']};
export function configure(env:Env){
  config.testPayoutsEnabled=env.STRIPE_TEST_PAYOUTS_ENABLED==='true';
  config.testPayoutAccount=env.STRIPE_TEST_PAYOUT_ACCOUNT_ID||'';
  config.testConnectWebhook=env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET||'';
  config.production=env.ENVIRONMENT!=='development';config.payments=env.PAYMENTS_MODE||'disabled';
  config.sandbox=env.ENVIRONMENT==='sandbox';
  config.platformOwnerUserId=env.PLATFORM_OWNER_USER_ID||'';config.officialCreatorName=env.OFFICIAL_CREATOR_NAME||'LingYingDrama Offical';
  config.platformAdminEmailHash=env.PLATFORM_ADMIN_EMAIL_SHA256||'';
  config.stripeTestMode=env.STRIPE_TEST_MODE==='true';
  config.payoutsEnabled=env.PAYOUTS_ENABLED==='true'||!config.production&&env.PAYOUTS_ENABLED!=='false';
  config.stripeAutoConfigureWebhook=env.STRIPE_AUTO_CONFIGURE_WEBHOOK==='true';
  config.passPromotionEnabled=env.PASS_PROMOTION_ENABLED==='true';
  if(config.production&&config.payments==='demo')throw new Error('Demo payments are prohibited in a deployed application.');
  Object.assign(config,selectStripeSettings(env,config.stripeTestMode));
  config.googleClientId=env.GOOGLE_CLIENT_ID||'';config.googleClientSecret=env.GOOGLE_CLIENT_SECRET||'';
  config.appleClientId=env.APPLE_CLIENT_ID||'';config.appleTeamId=env.APPLE_TEAM_ID||'';config.appleKeyId=env.APPLE_KEY_ID||'';config.applePrivateKey=env.APPLE_PRIVATE_KEY||'';
  config.resendApiKey=env.RESEND_API_KEY||'';config.mailFrom=env.MAIL_FROM||'';
  config.mailProvider=env.EMAIL_PROVIDER||'auto';config.cloudflareEmailAccountId=env.CF_EMAIL_ACCOUNT_ID||'';config.cloudflareEmailApiToken=env.CF_EMAIL_API_TOKEN||'';
  config.wechatPayEnabled=env.STRIPE_WECHAT_PAY_ENABLED==='true';
  config.usdToHkd=Number(env.USD_TO_HKD||7.8);if(!(config.usdToHkd>0))throw new Error('USD_TO_HKD must be positive.');
  config.seed=env.SEED_CATALOG==='true';if(env.APP_URL)config.appUrl=new URL(env.APP_URL).origin;
  config.publicUrl=env.PUBLIC_APP_URL?new URL(env.PUBLIC_APP_URL).origin:'';
  config.stripeSiteOrigin=env.STRIPE_SITE_ORIGIN?new URL(env.STRIPE_SITE_ORIGIN).origin:'';
  if(config.sandbox&&config.appUrl!=='https://aidramio-sandbox.jimmy-tsoi2001.workers.dev')throw new Error('The payment sandbox requires its isolated HTTPS origin.');
}
