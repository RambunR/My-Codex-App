# LingYing custom domain

The configured primary website and browser API are **https://lingyingdrama.com**. `https://www.lingyingdrama.com` is an alias that redirects to the canonical domain. Cloudflare zone: `ae6b34326f28faf55a6c7179d57bcba7`.

The custom domain serves the website directly. Main version `4113e958-d73c-455c-97c5-6579e373306a` and compatibility gateway version `1c55b37d-33dc-428b-b461-c5799308d438` deployed successfully. Live HTTP and browser checks confirmed that the apex, its API and application navigation stay on `lingyingdrama.com`; `www` and old addresses redirect toward it. Provider configuration and completed consent/payment delivery are verified separately.

Both domain routes attach to the existing `lingying` Worker, preserving stable Worker ID `bab19a0d39cb45bab68f525e17a95603`, SQLite namespace `69f8c140ca6840ad8761ba5977fbde53`, private bucket `aidramio-media-887486`, the existing Durable Object class/migration, and encrypted provider credentials. No additional application or Pages project is required.

## Website and API configuration

`APP_URL` and `PUBLIC_APP_URL` are both `https://lingyingdrama.com`. The frontend `PUBLIC_SITE_ORIGIN` and `API_SITE_ORIGIN` defaults use the custom domain too. The website and browser API share one origin: host-only Secure/HttpOnly/SameSite cookies remain secure without relying on cross-site cookie access to `workers.dev`. Existing users sign in once on the new domain; the same account IDs, wallets, purchases, publisher state, media and analytics remain in the original database.

`STRIPE_SITE_ORIGIN` stays pinned to `https://aidramio.jimmy-tsoi2001.workers.dev` as an **internal logical financial identity**. It is not a customer-facing API endpoint and does not need to remain a browsable website after retirement. Keeping that value preserves existing and pending Checkout metadata while success/cancellation links and customer API calls use the custom domain.

Cloudflare assets use `run_worker_first: true` so canonical routing applies to homepages, SPA routes and existing files. Signed POST deliveries to `/api/payments/webhook` reach signature verification directly without an HTTP redirect. Stripe test mode, test catalogue IDs and encrypted credentials remain unchanged by this hostname move.

## Google and Apple verification

After the owner reported saving all three provider settings, public checks at 10:00 UTC on 31 October 2026 found that **Google accepts the new callback and reaches its login page**; its old callback now reports `redirect_uri_mismatch`. **Apple still rejects the new callback with `invalid_request` and an invalid web redirect URL reason**, while its old callback remains accepted. Both actual app-issued callback URLs and cancellation return locations use `lingyingdrama.com`. No real consent or identity creation was performed; successful URL acceptance is not proof of completed sign-in.

Keep the same OAuth client IDs, Apple Services ID and signing key to preserve existing identity/account associations. Add the new entries alongside old ones:

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), select the existing website project and Web application client, and add `https://lingyingdrama.com/api/auth/google/callback` under **Authorized redirect URIs**. If configuring JavaScript origins, add `https://lingyingdrama.com` without a path. Save.
2. Open the [existing Apple Services ID](https://developer.apple.com/account/resources/identifiers/serviceId/edit/XSTKUY7NAY), confirm identifier `com.hknovaxrproduction.aidramio.web`, then **Sign in with Apple → Configure**. Keep primary App ID `com.hknovaxrproduction.aidramio`. Add `lingyingdrama.com` to **Domains and Subdomains** and `https://lingyingdrama.com/api/auth/apple/callback` to **Return URLs**, alongside the old entries, using commas between entries. Choose **Next/Done → Continue → Save** as shown by Apple's current form.
3. Recheck public callback acceptance, then complete a real sign-in and returning-account check for each provider. Credential presence is not a completed sign-in test.

Use only the domain in Apple's domain field and a full HTTPS URL in its return-URL field. Existing provider client IDs, signing key and Worker secrets do not need replacement for these registration updates.

## Move the existing Stripe test webhook to this domain

The current integration remains **Stripe test mode**. This domain change does not enable live charges or creator payouts.

The owner reports the existing Stripe destination updated to the custom domain. The public handler is reachable directly and rejects unsigned requests with HTTP 400 `INVALID_SIGNATURE`, as expected. There is no Stripe API read credential or connected Stripe tool available here, so the Dashboard endpoint URL, selected events, enabled status and signed delivery history have not been independently inspected. The catalogue's saved old URL is historical, not evidence that the owner's Dashboard change failed.

1. Open [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), using the **same test environment/Sandbox currently connected to LingYing**.
2. In **Workbench → Webhooks / Event destinations**, open the existing active destination whose endpoint URL is `https://aidramio.jimmy-tsoi2001.workers.dev/api/payments/webhook`.
3. Choose **Edit destination/endpoint** and change its endpoint URL to:

   ```text
   https://lingyingdrama.com/api/payments/webhook
   ```

4. Keep **Snapshot** payloads, events on the existing Stripe account, and the existing API version. Preserve these four event selections:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   ```

5. Save the same destination so its endpoint identity and signing secret remain unchanged. The existing `STRIPE_WEBHOOK_SECRET` on the **lingying** Worker continues to match it. Existing API keys, products/prices and client credentials do not need replacement for this URL edit.
6. Inspect a test delivery in Stripe Workbench and confirm a direct HTTP 2xx response at the new URL. A website Checkout return may reconcile payment server-side, so that return alone does not independently prove webhook delivery. A synthetic or unrelated event must not create arbitrary wallet credit.

Preserve `STRIPE_SITE_ORIGIN`, `STRIPE_TEST_MODE=true` and the current test keys/catalogue during this move. Keep signing secrets in Cloudflare Secrets. Live-mode setup is a separate release decision after the production-readiness blockers are addressed.

## Temporary compatibility and old-address cleanup

Old `lingying.jimmy-tsoi2001.workers.dev` and `aidramio.jimmy-tsoi2001.workers.dev` addresses are temporary compatibility routes, not the primary customer website or API. Old page redirects preserve path and query for existing bookmarks and in-flight Checkout returns; the gateway also continues forwarding signed legacy webhook deliveries while the destination is moved.

Stripe Sessions created before migration retain their original return URLs and normally expire within 24 hours. Old-host browser sessions and OAuth binding cookies do not transfer to the new domain. Users sign in once on the custom domain; an OAuth attempt started on the old host may need restarting. Old callback addresses now redirect to the custom origin, and retaining the gateway does not supply a cross-host OAuth handoff or make an unregistered new callback work. The gateway remains for old links, raw webhook deliveries and old Checkout return URLs while those dependencies are retired.

The `lingying` Worker is the application serving the purchased domain: deleting it would delete the running website. Retire its old `workers.dev` and preview aliases after domain, provider and in-flight-flow checks. Delete the `aidramio` gateway only after its callback/webhook/return-link dependencies are gone. Internal financial metadata, bucket names and the existing class name are data identifiers, not duplicate websites requiring deletion.

Other applications, purchased domains, email DNS and storage must remain untouched. Old sandbox removal remains a separate retirement decision because that Worker owns an isolated test database.

## Validation status

The direct-domain change passed 122 backend tests, 25 browser journeys, the Cloudflare integration/persistence suite and 27 live HTTP routing checks. Public sample media returned a direct 206 response with the exact custom-domain CORS origin. Namespace, bucket, eight secret bindings, unrelated settings and the 21-series catalogue were preserved.

Six live browser checks verified an existing audit account's sign-in, Secure/HttpOnly/SameSite=Lax custom-domain cookie, unchanged test wallet/pass/quota, reload, logout and mobile navigation. All 34 observed API requests used the custom domain. A follow-up fresh guest-browser trace after a report of old-host navigation observed 29 custom-domain requests, no `workers.dev` requests, and no hostname changes through Explore, Wallet, Sign-in and reload. The reported jump remains unreproduced; cached/restored user-browser navigation is a hypothesis rather than a proven cause. Native service-worker activation and automatic `www` browser redirect follow were limited by Chromium's execution-proxy CA trust; server redirect targets and deployed worker/manifest source were inspected without bypassing TLS. No new payments, uploads or creator payouts were performed by these domain checks.
