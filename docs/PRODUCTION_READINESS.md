# LingYing production readiness — 31 October 2026

31 October 2026 (Hong Kong time). Public site: https://lingying.jimmy-tsoi2001.workers.dev . Baseline source: `6a6bb43e9f7f51adfea41f0b34662f6fc3996247`.

**Verdict: not ready to accept real customer money or release the complete paid creator service.** The test application has working core flows, but enabling live credentials alone would not resolve the financial and operational gaps below.

## Verified baseline

- 113 backend checks passed after the media corrections (98 baseline checks plus 15 media regressions), covering authentication, authorization, exact monetary arithmetic, purchase races, signature/mode/amount validation, test/live separation, quotas, analytics, provider state/token fixtures, and origin compatibility.
- 25 browser journeys passed against isolated local data. Registration, email/password login, demo wallet funding/unlock, Dramio Pass, real folder uploads, publishing, likes/statistics, recovery UI and mobile layouts were exercised. These payment confirmations are local demonstrations, not Stripe card transactions.
- Nine actual two-origin TLS browser scenarios passed with 62 real local API requests. Existing host-only Secure/HttpOnly/Lax sessions, protected video and ranges, multipart upload, hostile-origin rejection and provider cancellation returns were exercised without contacting provider identity/token services.
- 72 live public route/layout cases passed across phone, desktop, Traditional Chinese and Arabic RTL, including guest gates, images/fonts, named links and genuine cross-origin API headers. This public audit deliberately did not log into real customer accounts or submit payments.
- Standalone production smoke and local Cloudflare SQL/R2 integration smoke passed, including production demo-credit rejection, persistence/restart, quotas, uploads, signed settlement and creator/admin authorization.
- Live health returns `ok:true,database:true`. The original Durable Object namespace and media bucket remain in use; eight encrypted provider bindings remain present. Stripe is explicitly in test mode; no live charges or payouts were enabled.
- Actual live-site email/password checks passed on the audit account: logout cleared authentication, a wrong password was rejected without a session, and the correct password restored the same wallet/pass/quota.
- A controlled Apple callback with an intentionally unredeemable code reached Apple's token endpoint and returned the expected `invalid_grant`; local private-key import/signing completed. This does not establish a successful real Apple sign-in. No provider identity or user session was created by the probe.

## Release blockers and unverified release dependencies

1. **Refund/dispute reconciliation is absent.** An isolated signed-event reproduction credited US$5, then full refund and dispute events returned HTTP 200 while the wallet retained US$5. Creator earnings and later payout eligibility can become inconsistent with returned funds. Implement and test reconciliation or a concrete safe operational compensation process before live money. The isolated audit evidence is retained outside source control; relevant implementation is `server/app.ts:65–84` and the omission is recorded in `docs/STRIPE_SETUP.md`.
2. **The deployed payment configuration is test-only.** Live merchant eligibility, live credentials/catalogue/webhook configuration, deliberate live payment verification and fees remain outside this audit. Switching mode is an operator action, not a test pass.
3. **Recovery and verification email cannot currently be delivered.** Live `auth.email:false`; delivery credentials are absent. Configure the selected verified sender/provider and verify actual delivery plus password-reset/session revocation end to end.
4. **Real creator payouts remain unverified and disabled in test mode.** Connect onboarding/country eligibility and bank settlement have not passed a live test. Admin approval currently records a transfer to a connected account as paid, not confirmed bank receipt. Automatic weekly payouts are not implemented.
5. **A public uploader service lacks an administrative content-takedown/report workflow.** The implemented admin console handles users/storage/withdrawals. Published paid content cannot simply be unpublished by its creator. Establish a controlled operator removal path before an unrestricted uploader launch.
6. **Successful real Google/Apple consent and returning-account sign-in remain unverified.** Local cryptographic/state tests and live authorization/cancellation/key-parsing probes pass their stated scope; they do not certify production provider publishing/approval or a complete real-account login.

## Media defects found during the audit

The baseline live sample preview returned cross-origin redirects without the required credentialed CORS headers and failed with Chromium media error 4. Separately, the Cloudflare validator omitted audio-track duration: a one-second video plus 181-second audio with a forged short movie header passed admission while Chromium still reported 181 seconds. Narrow fixes and targeted regressions accompany this report: stream sample bytes through the authorized API response while retaining credentialed CORS and byte ranges; check accepted audio and video durations with bounded AAC priming handling. The updated Cloudflare integration smoke also asserts direct sample GET/HEAD/range responses, credentialed CORS and exact bytes. Publication verification uses actual browser playback and direct credentialed GET/HEAD/range requests; the final evidence is retained with the audit.

The duration fix addresses the reproduced missing-audio check. Container-header validation is not a guarantee against every malicious sample-timeline/edit-list construction; the Cloudflare target does not decode/transcode media. Cover validation also checks signatures rather than fully decoding image dimensions/content.

## Other limits

- Unknown routes display a 404 interface with HTTP 200 (soft 404).
- The Arabic footer language control is about 42.47px wide versus the 44px touch-target recommendation.
- Legal document bodies remain English; interface dictionaries cover 21 languages.
- Physical-device Safari/Android behavior, sustained production load capacity and a complete backup/restore exercise were not established here. No load test was run against the production service.
- The old `aidramio` gateway is an active API/session/OAuth/webhook dependency. Deleting it without migration breaks the current application.
- Public Stripe test activation permits testing real uploads within the ordinary quota. Restrict the test audience while payments are fake; test funding does not cover real hosting/storage usage.

No existing customer balances, payouts, credentials, media, account records or payment mode were modified by the checks. Hosted Stripe testing uses one clearly identified audit account and fake funds, retaining its test transactions for audit. No live card, charge, payout or billing change was performed.

## Actual Stripe test Checkout

Using one isolated live-site audit account and the official Stripe 4242 test card, the Wallet Add funds flow opened a `cs_test_` Checkout session, completed a US$5 test payment, returned to the new public website and credited exactly US$5. Reload retained one funding payment and one funding ledger entry. This establishes hosted test Checkout plus application settlement/reconciliation; a success return alone is never treated as proof, and independently observing the provider webhook delivery is a separate check. The externally hosted wallet product still uses the earlier AIDramio name (cosmetic). The separate HK$88 Dramio Pass hosted test purchase also completed: Account displayed Active / Test pass, quota was 5 GiB, the USD wallet stayed at US$5, and reload did not create a duplicate activation. Independent provider webhook delivery remains unverified because the return page can reconcile Checkout. No real card or funds were used.
