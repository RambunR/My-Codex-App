import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {selectStripeSettings} from '../shared/stripe-settings.js';

if (existsSync('.env')) process.loadEnvFile('.env');
export const config = {
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  sandbox: false,
  stripeTestMode: process.env.STRIPE_TEST_MODE === 'true',
  payoutsEnabled: process.env.PAYOUTS_ENABLED === 'true' || process.env.NODE_ENV !== 'production' && process.env.PAYOUTS_ENABLED !== 'false',
  testPayoutsEnabled:process.env.STRIPE_TEST_PAYOUTS_ENABLED==='true',
  testPayoutAccount:process.env.STRIPE_TEST_PAYOUT_ACCOUNT_ID||'',
  testConnectWebhook:process.env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET||'',
  stripeAutoConfigureWebhook: process.env.STRIPE_AUTO_CONFIGURE_WEBHOOK === 'true',
  passPromotionEnabled: process.env.PASS_PROMOTION_ENABLED === 'true',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  publicUrl: process.env.PUBLIC_APP_URL || '',
  stripeSiteOrigin: process.env.STRIPE_SITE_ORIGIN || '',
  platformOwnerUserId: process.env.PLATFORM_OWNER_USER_ID || '',
  platformAdminEmailHash: process.env.PLATFORM_ADMIN_EMAIL_SHA256 || '',
  officialCreatorName: process.env.OFFICIAL_CREATOR_NAME || 'LingYingDrama Offical',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  payments: process.env.PAYMENTS_MODE || (process.env.NODE_ENV === 'production' ? 'disabled' : 'demo'),
  wechatPayEnabled: process.env.STRIPE_WECHAT_PAY_ENABLED === 'true',
  usdToHkd: Number(process.env.USD_TO_HKD || 7.8),
  ...selectStripeSettings(process.env,process.env.STRIPE_TEST_MODE==='true'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  appleClientId: process.env.APPLE_CLIENT_ID || '',
  appleTeamId: process.env.APPLE_TEAM_ID || '',
  appleKeyId: process.env.APPLE_KEY_ID || '',
  applePrivateKey: process.env.APPLE_PRIVATE_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || '',
  mailProvider: process.env.EMAIL_PROVIDER || 'auto',
  cloudflareEmailAccountId: process.env.CF_EMAIL_ACCOUNT_ID || '',
  cloudflareEmailApiToken: process.env.CF_EMAIL_API_TOKEN || '',
  seed: process.env.SEED_DEMO === 'true' || (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO !== 'false'),
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
};
if (!Number.isFinite(config.usdToHkd) || config.usdToHkd <= 0) throw new Error('USD_TO_HKD must be positive.');
for (const sub of ['', 'objects', 'tmp']) mkdirSync(path.join(config.dataDir, sub), { recursive: true });
