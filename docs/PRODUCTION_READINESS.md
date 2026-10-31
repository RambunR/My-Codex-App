# LingYing production readiness — 31 October 2026

31 October 2026 (Hong Kong time). Current public site: https://lingyingdrama.com . Historical audit baseline source: `6a6bb43e9f7f51adfea41f0b34662f6fc3996247`.

**Status: owner-authorized live card Checkout activation is underway; deployment and live verification are pending. The complete paid creator service is not release-ready.** The requested live-card mode keeps creator payouts independently paused and adds refund/dispute risk holds. Credential presence and a successful unpaid Checkout do not prove live settlement, provider delivery or full operational readiness.

## Current live-card release scope

The owner confirmed saving live API/webhook Secrets and requested actual activation on the same custom-domain website. The target is `PAYMENTS_MODE=stripe`, `STRIPE_TEST_MODE=false`, `STRIPE_AUTO_CONFIGURE_WEBHOOK=true`, optional test catalogue IDs cleared for inline HK$88 Dramio Pass / custom USD wallet pricing, and **`PAYOUTS_ENABLED=false`**. See [the live setup guide](STRIPE_LIVE_SETUP.md). The existing account database and private media remain in place. Test balances, pass ownership, purchases and earnings stay separate and are never converted to live money or entitlements.

The release adds durable holds for `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`, with administrator review and manual financial compensation. These holds contain affected activity; they do not automatically claw back spent credit, creator earnings or previous transfers. A closed dispute must not silently release a hold. The deployed behavior and regression results remain pending verification in this section.

The bounded server helper checks the existing live Stripe account, charge capability and exactly one matching enabled Snapshot endpoint. It appends only missing required subscriptions and preserves all other endpoint settings; live verification is pending. New Checkout stays gated until it reports ready. Restricted-key permission failures and account/endpoint mismatches are surfaced as safe `paymentSetup` codes. The helper neither creates endpoints nor submits charges or payouts.

No-cost verification may open an unpaid live Checkout and cancel/expire that owned Session without submitting a card. It must leave real wallet funds and funding ledgers unchanged. An actual signed `checkout.session.expired` receipt recorded for that owner at `lingyingdrama.com` can prove signing-secret pairing/direct webhook delivery without a charge; expired status alone cannot. It does **not** establish a completed charge, paid settlement or live refund behavior. No live charge, wallet funding, creator transfer or bank payout is authorized by this configuration check.

## Verified historical test-mode baseline

- 113 backend checks passed after the media corrections (98 baseline checks plus 15 media regressions), covering authentication, authorization, exact monetary arithmetic, purchase races, signature/mode/amount validation, test/live separation, quotas, analytics, provider state/token fixtures, and origin compatibility.
- 25 browser journeys passed against isolated local data. Registration, email/password login, demo wallet funding/unlock, Dramio Pass, real folder uploads, publishing, likes/statistics, recovery UI and mobile layouts were exercised. These payment confirmations are local demonstrations, not Stripe card transactions.
- Nine actual two-origin TLS browser scenarios passed with 62 real local API requests. Existing host-only Secure/HttpOnly/Lax sessions, protected video and ranges, multipart upload, hostile-origin rejection and provider cancellation returns were exercised without contacting provider identity/token services.
- 72 live public route/layout cases passed across phone, desktop, Traditional Chinese and Arabic RTL, including guest gates, images/fonts, named links and genuine cross-origin API headers. This public audit deliberately did not log into real customer accounts or submit payments.
- Standalone production smoke and local Cloudflare SQL/R2 integration smoke passed, including production demo-credit rejection, persistence/restart, quotas, uploads, signed settlement and creator/admin authorization.
- Live health returns `ok:true,database:true`. The original Durable Object namespace and media bucket remain in use; eight encrypted provider bindings remain present. Stripe is explicitly in test mode; no live charges or payouts were enabled.
- Actual live-site email/password checks passed on the audit account: logout cleared authentication, a wrong password was rejected without a session, and the correct password restored the same wallet/pass/quota.
- A controlled Apple callback with an intentionally unredeemable code reached Apple's token endpoint and returned the expected `invalid_grant`; local private-key import/signing completed. This does not establish a successful real Apple sign-in. No provider identity or user session was created by the probe.

## Release blockers and unverified release dependencies

1. **Refund/dispute compensation remains an operator responsibility.** The new release adds durable risk holds and administrator review, with validation pending. Full automatic reversal of spent wallet credit, episode entitlements, creator earnings and prior transfers is not implemented. Operators must reconcile and compensate affected records before resolving a hold. Payouts stay paused to contain onward transfers; this does not erase existing platform/customer exposure.
2. **Live configuration and completed settlement require independent verification.** The owner reports live Secrets saved and authorized activation. Deploying live mode, the bounded account/endpoint readiness check, signing-secret pairing, completed paid settlement and refund/dispute behavior are distinct checks. The no-cost unpaid Checkout/cancellation plus signed expiration receipt can establish account/Session compatibility and live webhook delivery, but not a completed payment or paid-wallet settlement.
3. **Recovery and verification email cannot currently be delivered.** Last observed live `auth.email:false`; delivery credentials were absent. Configure the selected verified sender/provider and verify actual delivery plus password-reset/session revocation end to end.
4. **Real creator payouts remain deliberately paused.** `PAYOUTS_ENABLED=false` blocks Connect onboarding, withdrawal requests and administrator transfer approval independently of card Checkout. Connect country eligibility, live transfers and bank settlement remain unverified. A transfer recorded as paid does not confirm receipt in a creator's bank. Automatic weekly payouts are not implemented.
5. **A public uploader service lacks an administrative content-takedown/report workflow.** The implemented admin console handles users/storage/withdrawals. Published paid content cannot simply be unpublished by its creator. Establish a controlled operator removal path before an unrestricted uploader launch.
6. **Successful real Google/Apple consent and returning-account sign-in remain unverified.** Google accepts the custom-domain callback; Apple still rejected it as of the latest 10:00 UTC public check. Local cryptographic/state tests and authorization/cancellation/key-parsing probes establish only their stated scope. They do not certify a complete real-account login.

## Media defects found during the audit

The baseline live sample preview returned cross-origin redirects without the required credentialed CORS headers and failed with Chromium media error 4. Separately, the Cloudflare validator omitted audio-track duration: a one-second video plus 181-second audio with a forged short movie header passed admission while Chromium still reported 181 seconds. Narrow fixes and targeted regressions accompany this report: stream sample bytes through the authorized API response while retaining credentialed CORS and byte ranges; check accepted audio and video durations with bounded AAC priming handling. The updated Cloudflare integration smoke also asserts direct sample GET/HEAD/range responses, credentialed CORS and exact bytes. Publication verification uses actual browser playback and direct credentialed GET/HEAD/range requests; the final evidence is retained with the audit.

The duration fix addresses the reproduced missing-audio check. Container-header validation is not a guarantee against every malicious sample-timeline/edit-list construction; the Cloudflare target does not decode/transcode media. Cover validation also checks signatures rather than fully decoding image dimensions/content.

## Other limits

- Unknown routes display a 404 interface with HTTP 200 (soft 404).
- The Arabic footer language control is about 42.47px wide versus the 44px touch-target recommendation.
- Legal document bodies remain English; interface dictionaries cover 21 languages.
- Physical-device Safari/Android behavior, sustained production load capacity and a complete backup/restore exercise were not established here. No load test was run against the production service.
- The main website and browser API now use the custom domain. The old `aidramio` gateway remains temporary compatibility for legacy links, raw webhook delivery and existing Checkout return URLs; it does not transfer old session/OAuth cookies. Retire it only after those dependencies are verified gone.
- The previous public Stripe test activation permitted real uploads within the ordinary quota. Its test passes are not live entitlements and must not be converted during the payment switch. Preserve media/account records and communicate the live pass status clearly.

The historical audit checks did not modify existing customer balances, payouts, credentials, media, account records or payment mode. The separately authorized live-card release changes configuration and adds financial risk records, with verification pending. Hosted Stripe testing uses one clearly identified audit account and fake funds, retaining its test transactions for audit. No live card, charge, payout or billing change was performed.

## Actual Stripe test Checkout

Using one isolated live-site audit account and the official Stripe 4242 test card, the Wallet Add funds flow opened a `cs_test_` Checkout session, completed a US$5 test payment, returned to the new public website and credited exactly US$5. Reload retained one funding payment and one funding ledger entry. This establishes hosted test Checkout plus application settlement/reconciliation; a success return alone is never treated as proof, and independently observing the provider webhook delivery is a separate check. The externally hosted wallet product still uses the earlier AIDramio name (cosmetic). The separate HK$88 Dramio Pass hosted test purchase also completed: Account displayed Active / Test pass, quota was 5 GiB, the USD wallet stayed at US$5, and reload did not create a duplicate activation. Independent provider webhook delivery remains unverified because the return page can reconcile Checkout. No real card or funds were used.

## Published corrections and final verification

The media corrections were committed as `e2323395f6456df875d1367b1bf5a1c50b84b62a` and deployed to the existing `lingying` Worker as version `db4b7f85-7680-46f4-a227-dbbacef8bbe9` on 31 October 2026.

- The final suite passed **113 backend checks**, including **15 Cloudflare media regressions**, both TypeScript builds, and the enhanced local Cloudflare persistence/upload/payment/media smoke.
- A real Chromium video using credentialed CORS on the live public origin loaded 12-second, 720×1280 sample metadata and played beyond 1.77 seconds without errors. Its media response was a direct API 206 with the exact permitted public origin, credentials and Content-Range; there were no redirects.
- Live full GET returned 1,037,034 bytes; HEAD returned the expected length without a body; partial Range returned 206 with exactly 1,024 bytes; invalid range returned 416. Private/no-store and CORS were retained. These checks did not generate analytics writes or touch customer accounts.
- Post-deployment database health passed. Worker variables, all eight encrypted secret names, the original SQLite namespace and media bucket were unchanged. Stripe remains in test mode, and recovery-email availability remains false.
- The production-dependency npm audit reported **zero known advisories** at audit time. The scan covers npm advisories, rather than every infrastructure or application risk.

The fixed playback and demonstrated audio-duration defects are no longer unresolved blockers. The later live-card release adds financial risk containment with payouts paused; it does not complete manual compensation procedures, email delivery, real creator disbursement, provider sign-in/live settlement verification or operator content controls. These limits must remain visible when describing commercial readiness.
