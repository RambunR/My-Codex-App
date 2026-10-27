# Live Cloudflare application

First published and verified on **26 October 2026, Hong Kong time**. Updated on **27 October 2026** with Google registration/sign-in, the downloadable PNG logo, and matching website/app icons derived from its coral play symbol.

- Site: https://aidramio.jimmy-tsoi2001.workers.dev
- Dashboard: https://dash.cloudflare.com/95040c4f244233138195b80657887486/workers/services/view/aidramio/production
- Account: Jimmy.tsoi2001@gmail.com's Account (`95040c4f244233138195b80657887486`), explicitly confirmed by the user.
- New Worker: `aidramio`.
- New private R2 media bucket: `aidramio-media-887486`; managed public access verified disabled.
- Database: SQLite-backed `AIDramioApp` Durable Object, bound as `APP`.
- Google authentication code release: `8363714d-c672-4685-9950-f3aeb6731fb1` (historical; see the Cloudflare dashboard for the latest branding deployment).
- Brand logo: https://aidramio.jimmy-tsoi2001.workers.dev/aidramio-logo.png (transparent PNG, 1254 × 1254, 389 KiB).

The Worker serves the complete frontend and API. The production database starts with free, labelled sample previews and no default administrator login or development wallet credits. Existing Cloudflare applications and buckets were preserved. No account plan was upgraded.

Google OAuth code is deployed, both Google credentials are configured as Worker Secrets, and the public configuration reports `auth.google: true`. The Google button is available alongside email/password; its start endpoint returns a valid Google authorization redirect. The live Google account service and the cancellation return were checked without creating a real user or entering Google passwords. Complete an interactive registration/sign-in using your own Google account to verify consent; see [GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md).

## Update this application

From `/workspace/My-Codex-App`, use the same authorized account explicitly:

```bash
CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 npm run deploy:cloudflare
```

The workspace's saved account variable still points to the earlier account. The explicit override above selects the user-confirmed account and does not change or expose the API token. `wrangler.jsonc` also records the correct account. Preserve the ignored `.cloudflare/deployment.json` resource identity so updates reuse this application's resources. Do not reuse unrelated applications or the former account.

The deployment script builds the frontend/Worker, publishes, and checks the public health/config endpoints before reporting success. The API token stays in secure environment/network settings; no token is stored in this document, the generated deployment configuration, or repository files.

## Remaining operator configuration

Production `PAYMENTS_MODE` is `disabled`. Browsing and free viewing are available. Paid publisher activation, wallet funding, episode purchases and payouts require the real Stripe setup described in [CLOUDFLARE.md](CLOUDFLARE.md#real-payments-and-administrator-setup). Create the first administrator with that document's secret-protected bootstrap procedure; there is no default production administrator password.

The default workers.dev URL is active. Custom-domain routing, live payment-provider credentials, payout onboarding, and final business/support details have not been configured. Existing local development accounts or uploads were not migrated into production.
