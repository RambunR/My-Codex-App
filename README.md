# LingYing · 靈映

**LingYing** (靈映 / 灵映), formerly AIDramio, is a working short-drama platform for live-action, animated, AI-assisted, and AI-generated stories. It has a responsive viewer app, a publisher studio, persistent accounts and media, episode purchases, and an administrator console.

Primary application: **[lingyingdrama.com](https://lingyingdrama.com)**; `www.lingyingdrama.com` redirects to the canonical domain. See [deployment details](docs/DEPLOYMENT.md) for the Cloudflare application and update command. Live Stripe card Checkout is enabled on this existing website, with creator payouts independently paused. Public configuration and the live account/webhook readiness check passed on 31 October 2026. One unpaid live US$5 Checkout displayed the correct amount, was cancelled, and produced a verified signed expiration webhook without a card entry or charge. See [live Stripe setup](docs/STRIPE_LIVE_SETUP.md).

**Stripe mode switch:** save both live and dedicated test API/webhook Secret pairs, then choose testing or production with `STRIPE_TEST_MODE`. The same website and accounts remain; test balances and Passes stay separate. No credential overwriting or additional readiness-flag toggle is needed. See [the setup and switch guide](docs/STRIPE_MODE_SWITCH.md).

**Wallet funding gifts:** quick amounts are US$10, US$25, US$50 and US$100. New US$50 payments receive US$5 gift credit, and US$100 receives US$15, after verified payment. See [funding gifts and accounting](docs/WALLET_FUNDING_GIFTS.md).

**Dramio Pass promo codes:** administrators can create, edit, enable or disable fixed-HKD and percentage discounts with unlimited or capped usage in [Admin → Promo codes](https://lingyingdrama.com/admin?tab=promotions). Codes are shared externally and entered in a blank field; public pages do not advertise or prefill them. See [promotion controls](docs/CREATOR_LAUNCH_PROMOTION.md) and [registration email / Stripe receipt setup](docs/EMAIL_AUTH.md). Creator earnings depend on paid unlocks; withdrawals remain paused.

The website and its browser API use the purchased domain directly on the existing **`lingying`** Worker, retaining the original database, media and provider secrets. `APP_URL` and `PUBLIC_APP_URL` are both `https://lingyingdrama.com`. The previous `workers.dev` addresses and **`aidramio`** gateway remain temporary compatibility routes during provider/webhook and return-link retirement. The separate `STRIPE_SITE_ORIGIN` retains the old internal financial identity; it does not send customers to the old API.

The custom domain serves pages and its API directly. Existing email/password sign-in, account state and mobile navigation passed live browser checks. Google accepts its new callback URL; Apple still reports an invalid web redirect URL as of 31 October 2026 at 10:00 UTC. The live Stripe account, charge capability and required Snapshot endpoint subscriptions are verified by the server; actual signed live expiration delivery reached the custom domain at 19:40:49 Hong Kong time on 31 October 2026, without a charge. Follow [custom-domain provider setup](docs/CUSTOM_DOMAIN_MIGRATION.md) for current evidence and the exact provider settings. Existing users sign in once on the new domain.

Source repository: **[RambunR/My-Codex-App](https://github.com/RambunR/My-Codex-App)**, branch `main`. Commit and push source changes to keep the repository current; deploying with Wrangler alone does not upload source to GitHub. The running website is deployed separately to Cloudflare. Production accounts, wallet records and purchases are stored in the Durable Object database, publisher media in private R2, and credentials in Worker Secrets. Those runtime records and secrets are excluded from Git.

Production uses the real publisher catalogue. Automatic sample seeding is disabled, and a guarded one-time retirement removes only source-verified fictional samples while protecting **The Godfather's Caged Bird** by **DreamShortDrama** and other genuine uploads. Media and accounting history remain intact. See [catalogue retirement](docs/REAL_CATALOGUE.md).

Administrators select **Suggested by LingYing** series in **Admin → Content**. Two or more available selections rotate in the homepage hero with coordinated artwork/text fades and no slideshow controls, arrow bar, pagination dots or slide counter. Poster covers display a translucent LingYing icon while retaining the full original artwork. See [homepage suggestions and cover branding](docs/HOMEPAGE_SUGGESTIONS.md).

Media controls discourage casual image/video saving while retaining normal viewing and text interaction. These controls are not DRM; see [media saving controls and limits](docs/MEDIA_SAVING.md).

Publishers can declare multiple **Subtitle languages** directly below **Drama language** in the editor, then save details. Public metadata shows the selected languages already included in the videos; selection does not generate or translate subtitles. See [subtitle declarations](docs/SUBTITLE_LANGUAGES.md).

Agent shortcut: send **`/push`** in chat, optionally followed by a commit message, to check the changes, commit and push them to GitHub `main`, update the existing Cloudflare website, and verify the live site. **“Push and deploy”** is an equivalent plain-language request. This project convention is defined in [AGENTS.md](AGENTS.md); it does not add a built-in Codex slash-menu entry or a terminal command. Future agents working in this repository should follow those instructions.

Google registration/sign-in is implemented alongside email/password, with both OAuth credentials configured securely on the Worker. Google accepts the custom-domain callback URL; a completed real-account sign-in remains independently unverified. Credential presence alone does not establish that sign-in completes. Follow [the Google setup guide](docs/GOOGLE_SIGN_IN.md) for testing, credential rotation and release settings. Existing password accounts connect Google explicitly from Account settings, preserving their original wallet and purchases.

Apple registration/sign-in and account linking are implemented; activation requires the operator's Apple Developer Services ID and signing key. See [Apple setup](docs/APPLE_SIGN_IN.md). Forgot password, reset, verification and resend controls are also implemented, with [Cloudflare Email Sending or Resend sender setup](docs/EMAIL_AUTH.md) required for actual delivery. Until credentials are configured, the interface clearly marks those services unavailable. The older `aidramio-sandbox` has its own separate credentials and does not inherit the main site's Google login; use the main website for current features.

Previous brand PNG (historical wordmark): [transparent AIDramio logo](public/aidramio-logo.png), also served at `/aidramio-logo.png`.

LingYing’s current icon is the operator-selected purple–pink origami phoenix (concept 05): [download the full-resolution PNG](public/lingying-icon.png), also served at `/lingying-icon.png`. It supplies the header mark, browser favicon, Apple touch icon, and installed-app icons; Android has a separate padded maskable variant.

Upload test files: [download 10 numbered test episodes](https://lingyingdrama.com/downloads/dramio-test-episodes.zip). Unzip the archive and select its `Dramio_Test_Episodes` folder in the studio folder uploader. Each MP4 is 10 seconds, 720×1280, H.264 with silent AAC audio, and shows a white episode number on black. All ten were created with FFmpeg without an AI video model; each is approximately 21 KB.

Operator browser setup: [download the Mac Playwright MCP installer](https://lingyingdrama.com/downloads/aidramio-browser-mcp.zip), unzip it, and run `Setup-AIDramio-Browser.command` on the Mac. A [self-contained script download](https://lingyingdrama.com/downloads/setup-aidramio-browser.command) is also available. Installer v2 requires Node 20 or newer for its bundled Playwright; it skips Node 18 and installs a private Node 24 runtime when no compatible runtime is found. It prepares a separate Chromium browser and the local MCP connection, backs up existing configuration, and checks actual browser navigation, inspection and clicks. The MCP server passed those checks in the cloud; the Mac installer was syntax-checked and runs its own verification locally. Restart the desktop app and continue in a local computer session afterward. It does not attach the built-in side tab or resolve Apple's client registration by itself.

To enable episode uploads, first save the series details: a 2–120-character title, 10–4,000-character synopsis and 1–3 genres. The editor shows each requirement and focuses any invalid field while preserving entered text. **Save details to enable uploads** is also available directly in the upload panel. Cover artwork and at least one episode are required for publishing, rather than the initial draft save.

After successful publication, the studio opens **Explore → Newest** with the series' spoken language, first selected genre and production method already selected. Newest uses the first publication date so older drafts appear when they go live; editing or pressing Publish again does not reset that date. Existing published series retain their original creation-date ordering when a publication date was not recorded.

Creators can **hide a published series** and show it again from Studio, preserving its episodes, statistics and purchases. **Delete series** shows an impact summary, including paid viewers in both live and test modes, and requires the exact title plus an irreversible-deletion acknowledgement. Deleted content cannot be restored; financial and audit records remain, and deletion does not automatically refund purchases. See [series visibility and deletion](docs/SERIES_LIFECYCLE.md).

Studio also supports episode selection, batch rename with numeric suffixes, confirmed batch deletion, and drag or arrow reordering with an explicit save. See [episode batch tools](docs/EPISODE_BATCH_TOOLS.md).

Studio warns before leaving an active upload batch: in-site navigation uses a branded **Keep uploading / Leave and stop upload** dialog, while closing or refreshing uses the browser's native confirmation where supported. Completed episodes remain saved; there is no background transfer or automatic resume after closing the editor. See [upload navigation protection](docs/FOLDER_UPLOAD.md#leaving-during-an-upload).

Administrators can manage multiple public publisher profiles in **Admin → Publishers**, set their display names and public registration dates, and select a profile for their own series. Click a series' **By** credit to browse that publisher's public releases and engagement totals. Profiles share the administrator's existing login; ownership and earnings remain with the original account. See [publisher profiles](docs/PUBLISHER_PROFILES.md).

Cover artwork supports **vertical 1080 × 1920**, **square 1080 × 1080** and **landscape 1920 × 1080** display layouts. Images fit in full with black padding, and uploaded covers keep their original artwork without added title overlays. Choose **Cover layout** in the series editor and save details. See [cover artwork](docs/COVER_ARTWORK.md).

**Live Stripe card Checkout is enabled** on this same website with `STRIPE_TEST_MODE=false` and `STRIPE_AUTO_CONFIGURE_WEBHOOK=true`, inline **HK$88 Dramio Pass** and custom **USD wallet deposits from US$5**. Public health/configuration verification passed: payments are ready, the live account has charge capability, the required endpoint is verified, and the test-payment notice is no longer appropriate for this mode. The server verifies the existing live Stripe account and exactly one enabled custom-domain Snapshot endpoint, appends only missing required event subscriptions, and blocks new Checkout if readiness fails. It preserves the endpoint/signing secret and does not create destinations or move money. No-cost verification passed with exactly one unpaid live US$5 Checkout, owner cancellation and an actual signed expiration receipt. The test notice was absent on desktop/phone; the wallet remained US$0 with no funding ledger entry. No card was entered or payment submitted; completed paid settlement remains unverified. See [live Stripe setup](docs/STRIPE_LIVE_SETUP.md).

New Stripe Checkout pages use the header **LingYing · HK NovaXR Production**. Wallet top-ups describe the exact USD credit, explain the one-time payment and confirmation step, and show the support email. Custom messages follow the selected interface language across all 21 locales; Stripe's own controls use its supported languages. See [Checkout messages](docs/STRIPE_LIVE_SETUP.md#checkout-messages).

The owner administrator can separately test withdrawals in **Studio → Earnings & payouts** when `STRIPE_TEST_MODE=true` and `STRIPE_TEST_PAYOUTS_ENABLED=true`. **Unlimited test allowance** uses isolated simulated requests without changing real or test earnings. Each finite request has a US$10 minimum, no platform withdrawal fee and a separate transfer/bank-payout status. Completed sandbox payouts are labeled **Test payout completed** and disclose that no money is sent to a real bank. New US$20 requests have US$20 before provider fees and currency conversion; existing requests keep their saved terms. See [administrator sandbox withdrawals](docs/CREATOR_WITHDRAWALS.md).

Creator payouts are independently paused with **`PAYOUTS_ENABLED=false`**. Refund/dispute events create durable financial risk holds for administrator review; they do not automatically recover spent wallet credit or creator earnings. Existing test balances, passes, purchases and earnings stay in separate tables and never become real money or live entitlements. [Testing instructions](docs/STRIPE_SETUP.md) and [the mode-switch guide](docs/STRIPE_MODE_SWITCH.md) cover the owner-authorized temporary test mode on this same website. A switch affects all visitors; routine deployments must preserve the intended current mode.

Phone viewing uses readable two-column story cards, touch-sized controls, header search, fixed bottom navigation, native sharing when available, and portrait/landscape episode controls. Phone form inputs use 16px text. Creator/admin code downloads when those routes are opened. See [phone usability checks](docs/MOBILE_UX.md), including the rapid-filter and long-title regressions. The public operator is **HK NovaXR Production**, with contact **contactus@hknovaxrproduction.com** in the footer and Help, Terms and Privacy pages.

Viewer playback and Studio private previews display the existing LingYing phoenix icon at the top right with **40% transparency (60% opacity)**. This is a player overlay: existing and future videos use their original files, with no duplicate videos, transcoding or additional media storage. The player's fullscreen button includes the overlay where container fullscreen is supported. Browser-native video fullscreen, picture-in-picture and casting may use a separate video surface that cannot include website overlays.

Screenshots: [viewer on desktop](docs/screenshots/viewer.png) · [phone discovery](docs/screenshots/mobile-home.png) · [phone series details](docs/screenshots/mobile-series.png) · [publisher on mobile](docs/screenshots/publisher-mobile.png).

## Deploy to Cloudflare

The full application can run on Cloudflare Workers, with a SQLite-backed Durable Object for accounts and money transactions, and a private R2 bucket for publisher media. See [Cloudflare deployment instructions](docs/CLOUDFLARE.md). Run `npm run build:cloudflare`, validate locally with `npm run test:cloudflare`, and update the existing `lingying` Worker using [AGENTS.md](AGENTS.md) with the securely configured Cloudflare API token. Do not use the new-application deployment helper for this existing website. The deployed live-card configuration uses matching live API/webhook Secrets, `STRIPE_TEST_MODE=false`, cleared optional test catalogue IDs and `PAYOUTS_ENABLED=false`; public configuration and in-Worker account/endpoint readiness checks passed.

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

Owner uploads display **LingYingDrama Offical**. The [Content administration guide](docs/CONTENT_ADMIN.md) explains private episode review, audited takedown/restore, metadata corrections, and uploading your own series. [Free licensed starter films](docs/LICENSED_STARTER_FILMS.md) lists three complete short animations with official download and commercial-reuse permissions.

## Implemented workflows

- Browse, search, independent genre/story-theme/format/production-method and spoken-language filters, rankings based on recorded views, series pages, likes, saves, watch history, and a vertical player with next-episode navigation. Public series cards/details show views and likes; episode tiles show recorded views.
- Publisher **Statistics** for each series: 7/30/90-day, all-time and custom UTC date ranges; daily views, total and average watch time, unique paid users and paid unlocks, with a breakdown for every episode. Likes are shown as the current all-time total. Detailed playback tracking begins with this feature; earlier aggregate view counts are retained without inventing historical watch time. See [analytics definitions](docs/ANALYTICS.md).
- **21 complete interface dictionaries**: English, Traditional/Simplified Chinese, Japanese, Korean, Hindi, Indonesian, Brazilian Portuguese, Spanish, Arabic, Bengali, Urdu, Vietnamese, Thai, Filipino, Turkish, Russian, French, German, Malay, and Tamil. Arabic and Urdu use RTL layouts. Creator-written titles, synopses, and videos retain their uploaded language. Translation does not dub videos or automatically create subtitles. Starter legal documents are in English.
- Register, sign in/out, edit profile and language, persistent HTTP-only sessions, salted scrypt password hashes, origin checks, and rate limits.
- Google OpenID Connect registration/sign-in with PKCE, one-use browser-bound state, verified signed ID tokens and stable Google identity IDs. Existing accounts require password-confirmed linking rather than automatic email matching. No Google access or refresh tokens are stored.
- Sign in with Apple uses signed identity verification, one-use state/nonce and a dedicated browser cookie for Apple's cross-site callback. Password accounts can explicitly connect Apple while retaining their wallet and uploads. Apple credentials are required before enabling it publicly.
- Email verification, resend and password recovery use expiring, single-use random proofs stored as hashes. Links keep the proof in a fragment that is removed from the browser URL. Password reset revokes prior sessions and preserves account assets; sending requires a verified email provider. Existing users can continue signing in without a new verification gate.
- Guests can watch free episodes. Paid episodes require registration, wallet funding, and an explicit unlock confirmation. Unlocks remain attached to the purchasing account when a price changes. Paid video URLs are never listed publicly.
- Publishers purchase **Dramio Pass for HK$88 once**. The Account page displays its icon, active status and receipt date when available, with a clear label for test passes. Existing publisher activations already count as Dramio Pass; registration alone does not authorize uploads.
- Each regular publisher starts with **5 GiB** including processed episode files and uploaded cover artwork. Admin-reviewed storage requests can increase the quota. **Administrator-owned media has unlimited total upload storage** in the application, with actual usage still tracked. Admin uploads into another regular publisher's series remain subject to that owner's quota. Episode and cover limits still apply.
- **240-second** and **200 MiB input-file** limits per episode, checked on the server. The standalone Node server probes and converts videos to H.264/AAC MP4 with bounded resolution/bitrate, and strips input metadata. Conversion runs in a bounded queue. Covers are validated and compressed to WebP, maximum input 5 MiB. The Cloudflare target validates browser-ready H.264/AAC MP4/MOV files and JPEG/PNG/WebP covers, storing accepted originals without native transcoding.
- Upload one video, multiple videos, or a directory. Folder batches select MP4 files recursively, ignore companion files, and sort relative paths numerically. A summary reports selected/ignored counts; manual video selection retains other supported formats. See [folder uploads](docs/FOLDER_UPLOAD.md). The studio shows individual upload/processing results and lets a publisher edit episode titles and numbers. Publishers can edit series title, synopsis, cover, up to three of 29 standard genres, up to five of 15 optional story themes, format, spoken language, production method, price, and free-episode count. See [series classification](docs/SERIES_CLASSIFICATION.md) for the four independent categories and backward compatibility.
- Episode prices start at **US$0.10**. Publishers choose the first N free episodes. Paid unlocks split **70% to the publisher / 30% to the platform**.
- In the editor's **Pricing** panel, creators can additionally select **Make the last episode free**. It starts off and is recommended for a finale much shorter than a standard episode, to give viewers a better experience. The adjacent info icon explains the option on desktop and phones. It applies to the highest-numbered uploaded episode in the current order, alongside the first N free episodes. Adding, removing or reordering episodes can change which video is last. Existing purchases remain valid.
- Wallet funding starts at **US$5** per checkout, with a custom USD amount chosen by the viewer to two decimal places. The former US$200 cap is removed; this integration supports up to US$999,999.99 per deposit within its documented API amount range. Verified payment credits the full chosen amount once. The publisher activation checkout is charged separately as HK$88 once.
- New creator withdrawals have a **US$10 minimum**, **no platform withdrawal fee** (US$20 reserved → US$20 before provider fees and conversion), and **3–5 days of processing after submission**. Funds are reserved for administrator-approved Stripe Connect transfers. **`PAYOUTS_ENABLED=false`** continues to pause live onboarding, withdrawal requests and transfer approval. Automatic weekly payouts are not implemented.
- Administrator console for account overview, storage approvals, payout approvals, platform revenue, and activation revenue.
- Installable web-app manifest, local icons/fonts, mobile bottom navigation, safe-area support, and an offline information page. Paid media and private API data are not cached by the service worker.

## Financial integrity

All money calculations and ledger entries use integer **millionths of a USD**, not floating-point dollar balances. An US$0.11 purchase records exactly US$0.077 creator revenue and US$0.033 platform revenue. Wallet charges, entitlements, publisher revenue, and ledger entries commit in one database transaction. Replayed checkout notifications and concurrent unlock requests cannot credit or charge twice. Payout transfers use stable Stripe idempotency keys.

New withdrawal requests have a fixed US$10 minimum independent of `USD_TO_HKD`. Each new request reserves its gross amount and records an immutable zero platform fee and equal net transfer amount under `withdrawal-usd-v2-no-fee`. A US$20 request reserves US$20 and has a US$20 allocation before provider fees and conversion; rejection restores the entire US$20 once. Historical requests keep their original saved fees, net amounts and retry keys, including prior v1 US$1 fees. Processing is stated as 3–5 days after submission, rather than a guaranteed bank arrival date. See [withdrawal policy and sandbox handoff](docs/CREATOR_WITHDRAWALS.md). Stripe determines the final conversion and any payout charges. The owner’s latest policy allocates actual Stripe/transaction-provider costs within the creator’s 70% share while leaving the platform’s 30% share unchanged. Stripe fees vary by amount, destination, currency and payout method; no fixed percentage is collected by LingYing; amounts marked ~ are estimates before final provider and bank charges. The 70/30 sales ledger and existing immutable withdrawal quotes are unchanged. Actual provider-fee allocation/recovery still needs verified billing evidence before live payouts are enabled; never debit creators using the ~1% estimate as an invented fixed Stripe charge. Withdrawal requests operate on whole USD cents, leaving fractional-cent earnings available to accumulate.

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
STRIPE_AUTO_CONFIGURE_WEBHOOK=true
PAYOUTS_ENABLED=false
SEED_DEMO=false
USD_TO_HKD=7.8
```

**Use a new production data directory.** Startup refuses databases containing the known demo accounts. Keep the production directory on a persistent volume; ephemeral hosting disks will lose accounts and media. Use `PAYMENTS_MODE=disabled` when deploying without real payment credentials; checkout stays unavailable in that mode.

For real payments, use **`STRIPE_TEST_MODE=false`** and matching live **`STRIPE_SECRET_KEY`** and **`STRIPE_WEBHOOK_SECRET`** Secrets. Keep testing credentials separately in **`STRIPE_TEST_SECRET_KEY`** and **`STRIPE_TEST_WEBHOOK_SECRET`**; the mode switch selects the pair and its catalogue together. Follow [the live configuration guide](docs/STRIPE_LIVE_SETUP.md); deployment and public configuration verification passed; signed expiration delivery and paid settlement are separate checks. Use a live Snapshot webhook at **`https://lingyingdrama.com/api/payments/webhook`** subscribed to the four Checkout lifecycle events plus `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. Stripe receives the server-created amount/currency. Only verified paid settlement can credit an application wallet; raw webhook bodies remain intact for signature verification. `paymentSetup` reports safe readiness status/codes. Existing signed webhook handling, Session reconciliation and unpaid cancellation continue when new Checkout is paused; the readiness helper never sends a charge or payout.

Refunds/disputes create durable financial risk holds and require administrator review and manual compensation. The hold is not full automatic reversal of past wallet spending, episode unlocks or creator earnings. Keep **`PAYOUTS_ENABLED=false`** independently of card payment mode. Stripe Connect country/capability checks, creator onboarding, live transfer and bank-settlement verification remain prerequisites before separately enabling payouts; no automatic weekly transfer is configured.

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

The 31 October 2026 audit demonstrated hosted Stripe **test** funding and Dramio Pass purchases. Live card Checkout has since been deployed with payouts paused and refund/dispute risk holds. All 161 backend checks, 29 distinct browser journeys and the Cloudflare integration/persistence checks passed. Public payment configuration, live account/endpoint readiness, a single unpaid live US$5 Checkout/cancellation and actual signed expiration delivery all passed without a charge. This does **not** establish full commercial readiness: manual refund/dispute compensation, recovery-email delivery, real Google/Apple sign-in, completed paid live settlement and operator content controls remain unverified or incomplete. See [the production-readiness report](docs/PRODUCTION_READINESS.md).

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
wrangler.jsonc        Existing main Cloudflare bindings and payment/payout modes
shared/config.ts      Languages, limits, shared types
tests/                API/integrity tests and Playwright journeys
public/               Locally hosted artwork, fonts, icons, service worker
```

Brand-check scope and source links are recorded in [docs/BRAND.md](docs/BRAND.md). See [docs/ASSETS.md](docs/ASSETS.md) for asset attribution.

Dramio Pass benefit summaries and the activation page show **(excluding Stripe transaction fees)** next to the creator’s 70% share, with an explicit note that actual Stripe costs, including possible fixed charges, are paid within that share. Both withdrawal forms disclose variable provider, conversion and bank fees; estimated bank amounts carry `~`. The owner sandbox withdrawal form spans the same width as its earnings callout.
