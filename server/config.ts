import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
export const config = {
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  sandbox: false,
  stripeTestMode: process.env.STRIPE_TEST_MODE === 'true',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  payments: process.env.PAYMENTS_MODE || (process.env.NODE_ENV === 'production' ? 'disabled' : 'demo'),
  usdToHkd: Number(process.env.USD_TO_HKD || 7.8),
  stripeKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhook: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeActivationPriceId:process.env.STRIPE_ACTIVATION_PRICE_ID||'',
  stripeWalletProductId:process.env.STRIPE_WALLET_PRODUCT_ID||'',
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
