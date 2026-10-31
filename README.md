# LingYing · 靈映

**LingYing** (靈映 / 灵映), formerly AIDramio, is a working short-drama platform for live-action, animated, AI-assisted, and AI-generated stories. It has a responsive viewer app, a publisher studio, persistent accounts and media, episode purchases, and an administrator console.

Primary application: **[lingyingdrama.com](https://lingyingdrama.com)**; `www.lingyingdrama.com` redirects to the canonical domain. See [deployment details](docs/DEPLOYMENT.md) for the Cloudflare application and update command. Stripe test Checkout is integrated into this existing website; real charges remain disabled while `STRIPE_TEST_MODE=true`.

The website and its browser API use the purchased domain directly on the existing **`lingying`** Worker, retaining the original database, media and provider secrets. `APP_URL` and `PUBLIC_APP_URL` are both `https://lingyingdrama.com`. The previous `workers.dev` addresses and **`aidramio`** gateway remain temporary compatibility routes during provider/webhook and return-link retirement. The separate `STRIPE_SITE_ORIGIN` retains the old internal financial identity; it does not send customers to the old API.

The custom domain serves pages and its API directly. Existing email/password sign-in, account state and mobile navigation passed live browser checks. Google accepts its new callback URL; Apple still reports an invalid web redirect URL as of 31 October 2026 at 10:00 UTC. The owner reports the Stripe URL updated, while independent endpoint configuration and signed delivery verification remain pending. Follow [custom-domain provider setup](docs/CUSTOM_DOMAIN_MIGRATION.md) for current evidence and the exact provider settings. Existing users sign in once on the new domain.

Source repository: **[RambunR/My-Codex-App](https://github.com/RambunR/My-Codex-App)**, branch `main`. Commit and push source changes to keep the repository current; deploying with Wrangler alone does not upload source to GitHub. The running website is deployed separately to Cloudflare. Production accounts, wallet records and purchases are stored in the Durable Object database, publisher media in private R2, and credentials in Worker Secrets. Those runtime records and secrets are excluded from Git.

Agent shortcut: send **`/push`** in chat, optionally followed by a commit message, to check the changes, commit and push them to GitHub `main`, update the existing Cloudflare website, and verify the live site. **“Push and deploy”** is an equivalent plain-language request. This project convention is defined in [AGENTS.md](AGENTS.md); it does not add a built-in Codex slash-menu entry or a terminal command. Future agents working in this repository should follow those instructions.

Google registration/sign-in is implemented alongside email/password, with both OAuth credentials configured securely on the Worker. The new custom-domain callback registration is still pending external provider setup; credential presence alone does not establish that sign-in currently completes. Follow [the Google setup guide](docs/GOOGLE_SIGN_IN.md) for testing, credential rotation and release settings. Existing password accounts connect Google explicitly from Account settings, preserving their original wallet and purchases.

Apple registration/sign-in and account linking are implemented; activation requires the operator's Apple Developer Services ID and signing key. See [Apple setup](docs/APPLE_SIGN_IN.md). Forgot password, reset, verification and resend controls are also implemented, with [Cloudflare Email Sending or Resend sender setup](docs/EMAIL_AUTH.md) required for actual delivery. Until credentials are configured, the interface clearly marks those services unavailable. The older `aidramio-sandbox` has its own separate credentials and does not inherit the main site's Google login; use the main website for current features.

Previous brand PNG (historical wordmark): [transparent AIDramio logo](public/aidramio-logo.png), also served at `/aidramio-logo.png`.

LingYing’s current icon is the operator-selected purple–pink origami phoenix (concept 05): [download the full-resolution PNG](public/lingying-icon.png), also served at `/lingying-icon.png`. It supplies the header mark, browser favicon, Apple touch icon, and installed-app icons; Android has a separate padded maskable variant.

Upload test files: [download 10 numbered test episodes](https://lingyingdrama.com/downloads/dramio-test-episodes.zip). Unzip the archive and select its `Dramio_Test_Episodes` folder in the studio folder uploader. Each MP4 is 10 seconds, 720×1280, H.264 with silent AAC audio, and shows a white episode number on black. All ten were created with FFmpeg without an AI video model; each is approximately 21 KB.

Operator browser setup: [download the Mac Playwright MCP installer](https://lingyingdrama.com/downloads/aidramio-browser-mcp.zip), unzip it, and run `Setup-AIDramio-Browser.command` on the Mac. A [self-contained script download](https://lingyingdrama.com/downloads/setup-aidramio-browser.command) is also available. Installer v2 requires Node 20 or newer for its bundled Playwright; it skips Node 18 and installs a private Node 24 runtime when no compatible runtime is found. It prepares a separate Chromium browser and the local MCP connection, backs up existing configuration, and checks actual browser navigation, inspection and clicks. The MCP server passed those checks in the cloud; the Mac installer was syntax-checked and runs its own verification locally. Restart the desktop app and continue in a local computer session afterward. It does not attach the built-in side tab or resolve Apple's client registration by itself.

To enable episode uploads, first save the series details: a 2–120-character title, 10–4,000-character synopsis and 1–3 genres. The editor shows each requirement and focuses any invalid field while preserving entered text. **Save details to enable uploads** is also available directly in the upload panel. Cover artwork and at least one episode are required for publishing, rather than the initial draft save.

After successful publication, the studio opens **Explore → Newest** with the series' spoken language, first selected genre and production method already selected. Newest uses the first publication date so older drafts appear when they go live; editing or pressing Publish again does not reset that date. Existing published series retain their original creation-date ordering when a publication date was not recorded.

Stripe payment testing uses **the same [main website](https://lingyingdrama.com)**, Google/email accounts, studio and uploads. Wallet **Add funds** and publisher activation open Stripe-hosted **test** Checkout, with a visible test-payment notice. Test balances, activation, paid unlocks and earnings are stored separately from real financial records; no test earnings can be withdrawn. See [Stripe setup and test instructions](docs/STRIPE_SETUP.md). The earlier separate sandbox is no longer the user-facing test workflow.

Phone viewing uses readable two-column story cards, touch-sized controls, header search, fixed bottom navigation, native sharing when available, and portrait/landscape episode controls. Phone form inputs use 16px text. Creator/admin code downloads when those routes are opened. See [phone usability checks](docs/MOBILE_UX.md), including the rapid-filter and long-title regressions. The public operator is **HK NovaXR Production**, with contact **contactus@hknovaxrproduction.com** in the footer and Help, Terms and Privacy pages.

Screenshots: [viewer on desktop](docs/screenshots/viewer.png) · [phone discovery](docs/screenshots/mobile-home.png) · [phone series details](docs/screenshots/mobile-series.png) · [publisher on mobile](docs/screenshots/publisher-mobile.png).

## Deploy to Cloudflare

The full application can run on Cloudflare Workers, with a SQLite-backed Durable Object for accounts and money transactions, and a private R2 bucket for publisher media. See [Cloudflare deployment instructions](docs/CLOUDFLARE.md). Run `npm run build:cloudflare`, validate locally with `npm run test:cloudflare`, and publish a new application using `npm run deploy:cloudflare` after adding the Cloudflare API token securely to environment settings. The tracked main configuration explicitly enables Stripe test mode; matching test credentials and webhook signing secret are required before Checkout is ready.

## Start locally

Requirements: **Node.js 24**, npm, **FFmpeg and FFprobe** on PATH. The supplied cloud environment already has them.

```bash
npm ci
npm run dev
```

The server listens on port **3000**. `GET /api/health` checks the API and database. Vite and the API share that port. The app uses the existing checkout; a separate Git worktree is unnecessary.

No credentials are needed for local development. Local development defaults to **clearly marked test payments** and a sample catalogue. These transactions never charge cards or send money. The sample videos are labelled previews; the fictional series are not licensed full dramas or real platform-usage figures.

Local demo accounts all use **`DemoPass123!`**:

| Account | Email |
|---|---|
| Viewer, with US$10 test credit | `viewer@demo.aidramio.test` |
| Activated publisher | `creator@demo.aidramio.test` |
| Administrator | `admin@demo.aidramio.test` |

You can also register a new account, activate publishing through the HK$88 test checkout, create a series, upload a real folder, and test purchases using another account. Demo accounts and demo payments are prohibited by the production startup checks.

## Implemented workflows

- Browse, search, genre and spoken-language filters, rankings based on recorded views, series pages, likes, saves, watch history, and a vertical player with next-episode navigation. Public series cards/details show views and likes; episode tiles show recorded views.
- Publisher **Statistics** for each series: 7/30/90-day, all-time and custom UTC date ranges; daily views, total and average watch time, unique paid users and paid unlocks, with a breakdown for every episode. Likes are shown as the current all-time total. Detailed playback tracking begins with this feature; earlier aggregate view counts are retained without inventing historical watch time. See [analytics definitions](docs/ANALYTICS.md).
- **21 complete interface dictionaries**: English, Traditional/Simplified Chinese, Japanese, Korean, Hindi, Indonesian, Brazilian Portuguese, Spanish, Arabic, Bengali, Urdu, Vietnamese, Thai, Filipino, Turkish, Russian, French, German, Malay, and Tamil. Arabic and Urdu use RTL layouts. Creator-written titles, synopses, and videos retain their uploaded language. Translation does not dub videos or automatically create subtitles. Starter legal documents are in English.
- Register, sign in/out, edit profile and language, persistent HTTP-only sessions, salted scrypt password hashes, origin checks, and rate limits.
- Google OpenID Connect registration/sign-in with PKCE, one-use browser-bound state, verified signed ID tokens and stable Google identity IDs. Existing accounts require password-confirmed linking rather than automatic email matching. No Google access or refresh tokens are stored.
- Sign in with Apple uses signed identity verification, one-use state/nonce and a dedicated browser cookie for Apple's cross-site callback. Password accounts can explicitly connect Apple while retaining their wallet and uploads. Apple credentials are required before enabling it publicly.
- Email verification, resend and password recovery use expiring, single-use random proofs stored as hashes. Links keep the proof in a fragment that is removed from the browser URL. Password reset revokes prior sessions and preserves account assets; sending requires a verified email provider. Existing users can continue signing in without a new verification gate.
- Guests can watch free episodes. Paid episodes require registration, wallet funding, and an explicit unlock confirmation. Unlocks remain attached to the purchasing account when a price changes. Paid video URLs are never listed publicly.
- Publishers purchase **Dramio Pass for HK$88 once**. The Account page displays its icon, active status and receipt date when available, with a clear label for test passes. Existing publisher activations already count as Dramio Pass; registration alone does not authorize uploads.
- Each publisher starts with **5 GiB** including processed episode files and uploaded cover artwork. Admin-reviewed storage requests can increase the quota.
- **180-second** and **75 MiB input-file** limits per episode, checked on the server. The standalone Node server probes and converts videos to H.264/AAC MP4 with bounded resolution/bitrate, and strips input metadata. Conversion runs in a bounded queue. Covers are validated and compressed to WebP, maximum input 5 MiB. The Cloudflare target validates browser-ready H.264/AAC MP4/MOV files and JPEG/PNG/WebP covers, storing accepted originals without native transcoding.
- Upload one video, multiple videos, or a directory. The studio sorts filenames numerically, shows individual upload/processing results, and lets a publisher edit episode titles and numbers. Publishers can edit series title, synopsis, cover, up to three genres, spoken language, production method, price, and free-episode count.
- Episode prices start at **US$0.10**. Publishers choose the first N free episodes. Paid unlocks split **70% to the publisher / 30% to the platform**.
- Wallet funding starts at **US$5** per checkout, with a custom USD amount chosen by the viewer to two decimal places. The former US$200 cap is removed; this integration supports up to US$999,999.99 per deposit within its documented API amount range. Verified payment credits the full chosen amount once. The publisher activation checkout is charged separately as HK$88 once.
- Payout requests start at **HK$20 equivalent** using the configured indicative exchange rate. Funds are reserved on request, refunded on rejection, and paid through Stripe Connect after administrator approval in live mode.
- Administrator console for account overview, storage approvals, payout approvals, platform revenue, and activation revenue.
- Installable web-app manifest, local icons/fonts, mobile bottom navigation, safe-area support, and an offline information page. Paid media and private API data are not cached by the service worker.

## Financial integrity

All money calculations and ledger entries use integer **millionths of a USD**, not floating-point dollar balances. An US$0.11 purchase records exactly US$0.077 creator revenue and US$0.033 platform revenue. Wallet charges, entitlements, publisher revenue, and ledger entries commit in one database transaction. Replayed checkout notifications and concurrent unlock requests cannot credit or charge twice. Payout transfers use stable Stripe idempotency keys.

The minimum payout is checked against the indicative `USD_TO_HKD` rate before provider fees. Stripe determines the final conversion and any payout charges. Card-processing costs are not secretly deducted from the publisher's stated 70% episode share; budget those as platform operating costs. Withdrawal requests operate on whole USD cents, leaving fractional-cent earnings available to accumulate.

## Production configuration

```bash
npm run build
npm start
```

Set production environment variables securely through the hosting provider:

```dotenv
NODE_ENV=production
PORT=3000
APP_URL=https://your-domain.example
DATA_DIR=/persistent/aidramio
PAYMENTS_MODE=stripe
STRIPE_TEST_MODE=false
SEED_DEMO=false
USD_TO_HKD=7.8
```

**Use a new production data directory.** Startup refuses databases containing the known demo accounts. Keep the production directory on a persistent volume; ephemeral hosting disks will lose accounts and media. Use `PAYMENTS_MODE=disabled` when deploying without real payment credentials; checkout stays unavailable in that mode.

For real payments, set **`STRIPE_TEST_MODE=false`** and provide matching live **`STRIPE_SECRET_KEY`** and **`STRIPE_WEBHOOK_SECRET`**. The currently deployed main website intentionally uses `STRIPE_TEST_MODE=true` with test credentials. Configure a Stripe webhook at **`/api/payments/webhook`** for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. Stripe Checkout receives the exact server-created amount/currency. Only a verified paid webhook or server-side Checkout reconciliation can settle a payment. The raw webhook body is preserved for signature verification.

Enable **Stripe Connect Express** and transfers for publisher payouts. Publishers onboard through the studio, complete Stripe verification, and request a payout. The administrator's approval creates an idempotent USD transfer to the connected account. Availability, cross-border transfer support, and payout schedules depend on the platform's Stripe account and publisher countries. These integrations are implemented but have not been exercised against a live merchant account in this workspace.

Provide `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 16 characters), and optional `ADMIN_NAME` through secure environment injection, then run:

```bash
npm run admin:create
```

The command creates a new administrator without logging the password or overwriting an existing account. Remove the bootstrap password from the running environment afterward.

The included terms/privacy documents describe the application, but the operator still needs to supply their real business/support details and finalize their refund, rights-complaint, and retention policies before accepting live payments. Password recovery and email verification require the sender setup above; Google and email/password registration remain available independently.

### Object storage

Local private media works immediately. For a private S3-compatible bucket such as R2, set all of:

`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Grant only object read/write/delete access to that bucket. Keep credentials in secure runtime configuration; S3 signing keys and webhook-verification secrets must be real process secrets, not proxy-only placeholders. After authorization the server issues a short-lived signed playback URL, keeping video delivery off the application server. Cover artwork also uses signed URLs. Keep the bucket private. Configure bucket CORS for the site's origin if required by the chosen browser delivery setup.

Changing the storage backend does not migrate existing local uploads. Start with the chosen backend or migrate the objects and database references together. The database remains SQLite on the persistent volume.

### Operations

Run one application instance for the initial SQLite/local-media deployment. Multiple instances need a shared transactional database, shared job queue, and appropriate object-storage configuration. Each process limits active transcodes to two and queues at most eight waiting jobs. Request limits bound individual input size, but configure equivalent upload limits/timeouts on your reverse proxy.

Back up both the SQLite database and media. Use SQLite's backup API while the service is running rather than copying just the main `.sqlite` file and ignoring its WAL. A simple consistent backup can be made with Python's `sqlite3.Connection.backup`. Test restoration separately. Use HTTPS and set `APP_URL` correctly; production session cookies require HTTPS. Set `TRUST_PROXY=true` only behind one trusted reverse proxy.

## Production readiness

The 31 October 2026 audit confirms hosted Stripe **test** wallet funding and Dramio Pass purchases, with isolated account/session/upload/browser coverage. The site is **not ready for real-money launch**: refund/dispute reconciliation, recovery-email delivery, live creator payout verification and final provider checks remain. See [the production-readiness report](docs/PRODUCTION_READINESS.md) for evidence, media corrections and validation limits.

## Validation

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:production
```

Browser tests use system Chromium (`CHROMIUM_PATH` can override `/usr/bin/chromium`) and launch a separate server on port **3001** with separate temporary data. They cover guest viewing, paywalls, registration, funding, persistent unlocks, publisher activation, a real two-file folder upload, publication, language switching, RTL, and phone navigation. Backend tests use a fresh temporary SQLite database and include actual FFmpeg processing, long/oversized-video rejection, quota enforcement, exact revenue splits, concurrent/replayed purchases, payout thresholds/refunds, and administrator authorization.

## Project structure

```text
src/                  React viewer, publisher studio, admin UI, and locale dictionaries
server/app.ts         HTTP routes and server-side authorization
server/finance.ts     Checkout settlement, wallet ledger, unlocks, payouts
server/storage.ts     Video validation, processing, local/S3 media delivery
server/db.ts          SQLite schema and transactions
server/seed.ts        Development-only sample catalogue
cloudflare/           Workers entry point, durable SQLite and R2 adapters
wrangler.jsonc        Existing main Cloudflare bindings, explicit Stripe test mode
shared/config.ts      Languages, limits, shared types
tests/                API/integrity tests and Playwright journeys
public/               Locally hosted artwork, fonts, icons, service worker
```

Brand-check scope and source links are recorded in [docs/BRAND.md](docs/BRAND.md). See [docs/ASSETS.md](docs/ASSETS.md) for asset attribution.
