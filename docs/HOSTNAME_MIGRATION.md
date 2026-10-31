# LingYing hostname and compatibility route

The public website is `https://lingying.jimmy-tsoi2001.workers.dev`. Its main Worker is renamed **in place**, retaining stable Worker ID `bab19a0d39cb45bab68f525e17a95603`, SQLite namespace `69f8c140ca6840ad8761ba5977fbde53`, existing `AIDramioApp` class/migration, private R2 bucket `aidramio-media-887486`, and encrypted provider credentials.

The previous `https://aidramio.jimmy-tsoi2001.workers.dev` origin remains the **API/OAuth compatibility endpoint**. Its small gateway has one service binding to `lingying`, forwards `/api/*` unchanged, and redirects old page GET/HEAD requests to the public site. It has no database, media bucket, payment secrets, or independent website. The legacy payment sandbox remains untouched.

## Origins and sessions

- `APP_URL` remains the old API origin. Google and Apple continue using their registered callback URLs there. Stripe site metadata, webhook registration and already-created checkout sessions retain that origin.
- `PUBLIC_APP_URL` is the new public origin. OAuth results/errors, email proofs and newly-created checkout return links land on the public site.
- The frontend uses credentialed requests only to the explicitly configured API origin. Exact-origin CORS allows that frontend with `Vary: Origin`; other origins receive no credentialed access. Host-only, HTTP-only session and OAuth cookies remain on the API host, with their existing Secure/SameSite attributes.
- Both hosts are same-site under `jimmy-tsoi2001.workers.dev` (`workers.dev` is a public suffix). This compatibility approach relies on that relationship. A later custom-domain migration requires its own session/auth review.
- Public `/api/*` requests redirect with HTTP 307 to the API origin before creating cookies. Uploaded video and protected cover URLs use the API host. Old signed webhook bodies pass through the gateway without parsing or re-serialization.

Local two-host browser checks can set `VITE_PUBLIC_SITE_ORIGIN` and `VITE_API_SITE_ORIGIN` at build/dev-server startup; production defaults are in `shared/site-origins.ts`. These are public deployment settings, never credentials or user-controlled URL parameters.

## Updating the deployed applications

Use the main `wrangler.jsonc` to update **lingying**, preserving live variables and secrets. Use `wrangler.legacy.jsonc` separately when compatibility gateway code changes. Never deploy the main app under `aidramio` again: that name now belongs to the gateway.

Renaming only a Wrangler configuration and deploying would create another Worker rather than rename the established one. The initial migration uses Cloudflare's [Edit Worker API](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/edit/), PATCHing the stable Worker ID and retaining existing mutable fields. The migration must verify unchanged namespace, bucket, secrets and catalogue before and after routing changes.

No provider billing, live payment mode, wallet balances, purchase records, payout schedule or existing uploads are changed by this migration.
