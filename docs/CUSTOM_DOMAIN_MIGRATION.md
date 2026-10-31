# LingYing custom domain

Target domain: **https://lingyingdrama.com**, Cloudflare zone `ae6b34326f28faf55a6c7179d57bcba7`. `www.lingyingdrama.com` is an alias. Both attach to the existing `lingying` Worker, preserving stable Worker ID `bab19a0d39cb45bab68f525e17a95603`, SQLite namespace, private media bucket and encrypted provider credentials.

## Staged connection

The domain routes are attached while `APP_URL` and `PUBLIC_APP_URL` retain the working `workers.dev` origins. Canonical page routing forwards the new domain to the working public site during provider setup; it does not expose a cross-site cookie dependency as a broken login form. The current API/session/callback endpoints stay functional.

`STRIPE_SITE_ORIGIN` is explicitly pinned to the original `https://aidramio.jimmy-tsoi2001.workers.dev` logical financial identity. This value does not need to be a browsable website after retirement. Pending Checkout metadata remains valid. Signed POST deliveries to `/api/payments/webhook` reach the handler without an HTTP redirect on either host.

Cloudflare assets must use `run_worker_first: true`: otherwise the asset service bypasses canonical routing for the homepage, SPA routes and existing files. The runtime smoke checks GET and HEAD redirects for those paths before testing the primary site's normal flows.

## Provider updates

Keep the same OAuth client IDs, Apple Services ID and signing key to preserve existing external identity/account associations. Add the new entries before removing old ones:

- Google: `https://lingyingdrama.com/api/auth/google/callback`.
- Apple domain: `lingyingdrama.com`; return URL: `https://lingyingdrama.com/api/auth/apple/callback`.
- Stripe: after custom-domain HTTPS and its webhook handler are reachable, edit the existing **test** webhook endpoint URL to `https://lingyingdrama.com/api/payments/webhook`; preserve its signing secret and Snapshot event selections. This migration does not enable live payments.

### Owner setup steps

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), select the existing website project and Web application client, and add `https://lingyingdrama.com/api/auth/google/callback` under **Authorized redirect URIs**. If configuring JavaScript origins, add `https://lingyingdrama.com` without a path. Save. Keep the existing credentials and old callback entries.
2. Open the [existing Apple Services ID](https://developer.apple.com/account/resources/identifiers/serviceId/edit/XSTKUY7NAY), confirm identifier `com.hknovaxrproduction.aidramio.web`, then **Sign in with Apple → Configure**. Keep primary App ID `com.hknovaxrproduction.aidramio`. Add `lingyingdrama.com` to **Domains and Subdomains** and `https://lingyingdrama.com/api/auth/apple/callback` to **Return URLs**, alongside the old entries, using commas between entries. Choose **Next/Done → Continue → Save** as shown by Apple's current form. Do not put an app name or bundle ID into the URL fields, or replace the signing key.
3. Open [Stripe Webhooks](https://dashboard.stripe.com/webhooks) in the same test environment used by the website. In the existing webhook endpoint (or **Workbench → Webhooks → Event destinations**), choose **Edit destination/endpoint** and change only its endpoint URL to `https://lingyingdrama.com/api/payments/webhook`. Preserve its events, API version, payload type and signing secret. Save. Do not create a new endpoint or enable live payments for this move.

After these settings are saved, confirm completion so the website's primary origins can move together. Callback registration can be checked without completing a real sign-in; full sign-in and signed webhook delivery still need their own verification.

## Final primary-origin switch

After new provider registrations are confirmed, change `APP_URL` and `PUBLIC_APP_URL` together to `https://lingyingdrama.com`. Set the frontend `PUBLIC_SITE_ORIGIN` and `API_SITE_ORIGIN` defaults to `CUSTOM_SITE_ORIGIN`; retain the separate legacy constants for compatibility routing. Leave `STRIPE_SITE_ORIGIN` pinned to its current value. Deploy both the main Worker and compatibility gateway before retiring any alias, so old page redirects target the current domain.

The `.com` UI and API must share one origin. Reusing the old API through cross-site requests would withhold SameSite=Lax cookies and fail mutation protection. Existing users sign in once on the new domain; account IDs, wallets, purchases, publisher state, media and analytics remain in the same database. Cookies are not widened across registrable domains.

Old page redirects preserve path and query for existing bookmarks and in-flight Checkout returns. Stripe Sessions created before migration cannot have their return URLs updated by this integration and normally expire within 24 hours. Keep compatibility routes while those flows complete.

## Address cleanup

The `lingying` Worker is the application serving the purchased domain, so deleting it would delete the running website. Retire its `workers.dev` and preview addresses only after the domain and in-flight flows are validated. Delete the `aidramio` gateway only after Google/Apple callbacks and Stripe webhook delivery have moved successfully. Its legacy metadata label and the media bucket/class names do not require customer-data migrations or deletion.

Other existing Workers, purchased domains, email DNS and storage must remain untouched. Old sandbox removal is a separate retirement decision because its Worker owns an isolated test database.

## Validation

The staged change passed 120 backend tests, eight focused routing tests, 25 browser journeys, ten secure same-origin browser scenarios and three separately labelled development-demo payment scenarios. It preserves the distinction between local demo confirmations and real provider verification. The local Cloudflare integration suite additionally checks persisted sessions, uploads, ranges and financial separation. Actual custom-domain TLS and provider acceptance are checked after provisioning and owner registration updates.
