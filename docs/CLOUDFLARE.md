# Cloudflare application deployment

The application is deployed at **https://aidramio.jimmy-tsoi2001.workers.dev** in the user-confirmed Jimmy Cloudflare account. See [the deployment record](DEPLOYMENT.md). To update this application with the current workspace's stale account variable, explicitly select the authorized account:

```bash
CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 \
XDG_CONFIG_HOME=/tmp/aidramio-cf-config \
WRANGLER_SEND_METRICS=false \
npx wrangler deploy --config wrangler.jsonc --keep-vars
```

The account ID is not a secret. The API token remains exclusively in secure environment/network settings. Use this explicit existing-Worker update command. The new-application helper can create a suffixed application if its ignored identity file is absent.

This application has a native Cloudflare deployment target. It does not publish only the frontend or run financial data on an ephemeral container filesystem.

| Component | Cloudflare service |
|---|---|
| Viewer, publisher UI, translations, artwork | Workers Static Assets |
| Existing Express API | Workers Node.js HTTP compatibility |
| Accounts, sessions, wallet ledger, entitlements, approvals | SQLite-backed Durable Object |
| Real publisher videos and covers | Private R2 bucket |

The financial and authorization routes are generated from the same source as the tested Node server. Their database adapter executes the existing synchronous transactions using Durable Object `transactionSync`, so balances, entitlements, and publisher revenue commit together. There is no external database account or always-running container requirement.

## Credentials

The Cloudflare dashboard login open in a desktop browser is separate from authentication available to this cloud workspace. `wrangler whoami` must be able to authenticate before publishing.

Provide `CLOUDFLARE_API_TOKEN` securely through the cloud environment settings. Do not paste the token into chat or commit it. Scope it to the intended account, with **Workers Scripts: Edit** and **Workers R2 Storage: Edit**. Account read access may also be needed by Wrangler to retrieve account settings. `CLOUDFLARE_ACCOUNT_ID` can override the account in `wrangler.jsonc`.

The deployment script preserves the configured HTTPS proxy, does not log the token, and only uses it against `api.cloudflare.com`. The R2 service must be enabled on the account. It will not upgrade a paid plan or add a billing method on your behalf.

## Build and validate

```bash
npm ci
npm run build:cloudflare
npm run test:cloudflare
XDG_CONFIG_HOME=/tmp/aidramio-cf-config WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run
```

For local Cloudflare development (accounts and R2 are emulated locally):

```bash
npm run dev:cloudflare -- --port 8787 \
  --var ENVIRONMENT:development \
  --var PAYMENTS_MODE:demo \
  --var APP_URL:http://127.0.0.1:8787
```

Development flags are command-line overrides and are not written into the production configuration.

`test:cloudflare` starts its own local Workers emulator on port 8789 with temporary SQLite/R2 state, exercises authentication, real uploads and limits, concurrent purchases, exact revenue splits, payouts and storage approvals, then restarts in production mode to verify persistence and disabled test payments. It stops its own process and removes only its temporary test data. No account token, real payment, or remote Cloudflare resource is used.

## Publish a new application

```bash
npm run deploy:cloudflare
```

The script verifies access, checks existing Worker and bucket names, creates a private R2 bucket, deploys the complete application, and checks the public API. If another application already uses `aidramio`, it chooses a new suffixed name rather than overwriting that application. It records non-secret deployment identity and the verified URL in `.cloudflare/deployment.json`, which is ignored by Git. Repeated runs target only resources recorded as belonging to this deployment.

The resulting default URL is `https://<application>.<account-subdomain>.workers.dev`. A custom domain can be connected afterward. The script reports a successful public deployment only after the deployed `/api/health` and `/api/config` checks pass.

The initial database is one SQLite-backed Durable Object, which serializes financial mutations and supports this initial application. High-volume traffic will require measuring its request/CPU limits and splitting workloads appropriately. Local emulation and a deployment dry run do not establish the live account's plan limits or R2 provisioning status; verify those during the authenticated deployment.

## Publisher videos on Cloudflare

The same **180-second, 75 MiB input, and 5 GiB publisher quota** limits apply. The Cloudflare adapter accepts browser-ready **H.264 MP4/MOV with AAC audio**, validates movie and video-track duration on the server using bounded R2 range reads, and stores the original accepted file. It does **not** run FFmpeg or native Sharp in Workers. HEVC/AV1/WebM videos must be exported as compatible MP4 before upload. Covers may be JPEG, PNG, or WebP up to 5 MiB and are retained without server-side conversion. UI upload hints and file selection adapt to the deployed runtime.

This avoids adding a paid video-transcoding service. The standalone Node target remains available and still converts its broader input formats automatically. Multipart uploads stream to R2 in bounded parts; active uploads are limited. Temporary objects are removed when processing completes. Configure an R2 lifecycle policy to delete leftover `tmp/` objects and incomplete multipart uploads after one day if desired for crash cleanup.

Sample catalogue entries are explicitly labelled previews, have no usable publisher login, and **all sample episodes are free**. The watermarked sample video is a public static asset, so it does not require R2 provisioning data. These examples never generate paid sales. Set `SEED_CATALOG=false` before first deployment for an empty real catalogue. Existing series are not deleted when that flag changes.

## Real payments and administrator setup

Google authentication has its own configuration: see [GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md). Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are read from server-side Worker Secrets and retained across code deployments. The fixed production `APP_URL` determines the exact OAuth callback; no Google secret is exposed in the frontend. Google login does not activate publishing or fund a wallet.

Apple uses `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` on the same Worker; [APPLE_SIGN_IN.md](APPLE_SIGN_IN.md) explains the Services ID, HTTPS callback and Apple Developer setup. Account email supports Cloudflare Email Sending (`EMAIL_PROVIDER=cloudflare`, `CF_EMAIL_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, `MAIL_FROM`) or Resend (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`), with an onboarded/verified sending domain; see [EMAIL_AUTH.md](EMAIL_AUTH.md). The Cloudflare option needs Workers Paid and a sending domain using Cloudflare DNS. `/api/config` reports `auth.apple` and `auth.email` separately from Google. Missing settings leave those services honestly unavailable rather than claiming a login or email succeeded. Code deployments retain the existing Google and Stripe secrets. The separate legacy sandbox does not inherit these credentials.

Recovery proofs are stored as hashes in additive account tables. Email links use fragments so proof values do not reach request URLs; the browser removes them before explicitly posting verification/reset. Authentication pages use `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Outbound email is attached to the Durable Object's `waitUntil` lifecycle so it can finish after a generic, privacy-preserving acknowledgement.

The main website intentionally selects `PAYMENTS_MODE=stripe` and **`STRIPE_TEST_MODE=true`**, as requested by the user. Wallet funding and publisher activation use test Checkout on the current site; Google sign-in, existing accounts, normal publisher uploads and private media storage are preserved. `/api/config` must report `sandbox: false`, `paymentsTestMode: true`, `uploadsEnabled: true` and `auth.google: true`, plus `paymentsReady: true` once the matching test credentials are configured. The existing namespace and bucket must remain unchanged.

Test financial state uses `test_accounts`, `test_payments`, `test_purchases` and `test_ledger` within the same Durable Object database. Real wallet balances and purchases are not overwritten by test transactions. Test Stripe Connect and withdrawals are blocked. The former separate sandbox is a legacy deployment, not a required second site.

Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as encrypted secrets on the existing **aidramio** Worker, with the test webhook at `https://aidramio.jimmy-tsoi2001.workers.dev/api/payments/webhook`. Subscribe to Checkout completed, asynchronous success/failure and expired events. Never put keys or signing secrets in public Wrangler `vars`. Optional `STRIPE_ACTIVATION_PRICE_ID` and `STRIPE_WALLET_PRODUCT_ID` must match the current Stripe mode. The activation price is HK$88 once; wallet Checkout uses the exact app-selected USD amount. See [STRIPE_SETUP.md](STRIPE_SETUP.md).

Later, accepting real money requires `STRIPE_TEST_MODE=false`, matching live keys/webhook, live catalog counterparts or no optional catalog IDs, and deliberate live payment validation. Do not promote or migrate test balances, activations or unlocks into real financial records. Preserve the separate test tables for audit. Configure approved Stripe Connect capabilities before real publisher payouts.

To create the first administrator, set a random `BOOTSTRAP_TOKEN` Worker secret of at least 32 characters, provide the same value plus `APP_URL`, `ADMIN_EMAIL`, and a password of at least 16 characters securely to the administration command, then run:

```bash
npm run admin:cloudflare
```

The bootstrap endpoint is unavailable without that secret and refuses to create another administrator after the first one exists. Remove the bootstrap Worker secret after setup. Business/support details and payment policies still need the operator's production values.

## Relevant Cloudflare documentation

- [Workers Node.js HTTP integration](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [R2 storage](https://developers.cloudflare.com/r2/)
- [Container disk persistence limitations](https://developers.cloudflare.com/containers/faq/#is-disk-persistent-what-happens-to-my-disk-when-my-container-sleeps)
