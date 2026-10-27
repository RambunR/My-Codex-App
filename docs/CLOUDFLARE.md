# Cloudflare application deployment

The application is deployed at **https://aidramio.jimmy-tsoi2001.workers.dev** in the user-confirmed Jimmy Cloudflare account. See [the deployment record](DEPLOYMENT.md). To update this application with the current workspace's stale account variable, explicitly select the authorized account:

```bash
CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 npm run deploy:cloudflare
```

The account ID is not a secret. The API token remains exclusively in secure environment/network settings. Preserve `.cloudflare/deployment.json` when updating this deployment.

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

Production selects `PAYMENTS_MODE=stripe`, with `paymentsReady: false` until its live Stripe key and webhook signing secret are configured. No test credits or default administrator credentials are published. Register/sign-in and free viewing work; real publisher activation and wallet funding stay unavailable until matching live credentials are supplied. The isolated `aidramio-sandbox` Worker accepts only test keys and has its own database/media bucket; see [STRIPE_SETUP.md](STRIPE_SETUP.md).

After deployment, use Worker secrets for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Keep `PAYMENTS_MODE=stripe` and HTTPS `APP_URL`, configure the webhook at `/api/payments/webhook`, and enable the appropriate Stripe Connect capabilities for publisher payouts. Subscribe to Checkout completed, asynchronous success/failure and expired events. Never put Stripe signing secrets in public Wrangler `vars`. Production rejects test keys and test-mode events; the sandbox rejects live keys. Optional `STRIPE_ACTIVATION_PRICE_ID` and `STRIPE_WALLET_PRODUCT_ID` must belong to the same Stripe mode as the key. The fixed activation price is validated as HK$88 once before Checkout; wallet Checkout uses the exact app-selected USD amount with the persistent wallet product.

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
