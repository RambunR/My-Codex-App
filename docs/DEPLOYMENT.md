# Live Cloudflare application

First published and verified on **26 October 2026, Hong Kong time**. Updated on **28 October 2026** with Apple authentication and email-recovery controls prepared for provider configuration, retaining Google registration/sign-in, the brand icons and explicit Stripe test payments on this same website.

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

Apple registration/sign-in/linking and email password reset/verification/resend are implemented with translated controls. Apple credentials and email delivery credentials are not configured yet: `auth.apple` and `auth.email` stay false, with explicit unavailable notices. Follow [APPLE_SIGN_IN.md](APPLE_SIGN_IN.md) to register the Services ID and configure four Apple secrets, and [EMAIL_AUTH.md](EMAIL_AUTH.md) to onboard the selected Cloudflare Email Sending domain and configure its scoped token, or use Resend instead. Existing accounts retain their sign-in, wallet, purchases and media; email verification is not a new access gate.

The operator selected `hknovaxrproduction.com` for application email, using `LingYing <accounts@hknovaxrproduction.com>`. The main Worker configuration selects that sender and Cloudflare delivery. Sending remains unavailable until domain onboarding and `CF_EMAIL_API_TOKEN` are completed; the current deployment token cannot read zone DNS or manage user API tokens. Existing DNS, subscriptions and the website URL are preserved.

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
