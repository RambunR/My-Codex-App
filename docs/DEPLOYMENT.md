# Live Cloudflare application

First published and verified on **26 October 2026, Hong Kong time**. Updated on **27 October 2026** with Google registration/sign-in, the downloadable PNG logo, matching website/app icons derived from its coral play symbol, and explicit Stripe test payments on this same website.

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
CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 \
XDG_CONFIG_HOME=/tmp/aidramio-cf-config \
WRANGLER_SEND_METRICS=false \
npx wrangler deploy --config wrangler.jsonc --keep-vars
```

The workspace's saved account variable still points to the earlier account. The explicit override above selects the user-confirmed account and does not change or expose the API token. `wrangler.jsonc` also records the correct account. Use the explicit tracked update command above, preserving this Worker's namespace, bucket and secrets. Do not use the new-application helper for updates; a fresh checkout without its ignored identity file can create a suffixed application. Do not reuse unrelated applications or the former account.

The tracked Wrangler build publishes the frontend and Worker. Verify public `/api/health` and `/api/config` after publishing as described in `AGENTS.md`. The API token stays in secure environment/network settings; no token is stored in this document, the generated deployment configuration, or repository files.

## Remaining operator configuration

The user chose Stripe test payments on this existing main website. `PAYMENTS_MODE=stripe` and `STRIPE_TEST_MODE=true` let Wallet **Add funds** and HK$88 publisher activation open Stripe-hosted test Checkout. Google sign-in, email/password, existing accounts and upload storage remain on the same site. Test wallet balances, test activation, paid unlocks and earnings use separate financial tables within the existing database; test money cannot become real money or be withdrawn. See [STRIPE_SETUP.md](STRIPE_SETUP.md) for test cards, webhook configuration and the later live-mode switch.

The earlier `aidramio-sandbox` deployment is a retained legacy resource and is no longer the requested user workflow. No new test website is needed. Create the first administrator with the secret-protected bootstrap procedure; there is no default administrator password.

The default workers.dev URL is active. Custom-domain routing, live payment-provider credentials, payout onboarding, and final business/support details have not been configured. Existing local development accounts or uploads were not migrated into production.
