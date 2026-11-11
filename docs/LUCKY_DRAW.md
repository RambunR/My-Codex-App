# Free Lucky Draw

The account promotion is available at **https://lingyingdrama.com/lucky-draw**. Guests may see the current public pool, but must register or sign in before drawing. Registration and sign-in preserve the return to this page. Each account, including existing accounts, starts with **one free welcome chance**; it is not a daily allowance. There is no payment endpoint for chances, no cash prize and no dependence on wallet funding or buying Dramio Pass.

The gift uses a generated pearl-and-plum 3D illustration, exported as a 121 KiB transparent WebP. CSS masks lift the lid while the actual saved winning cover rises from behind the front of the box. The reveal begins only after the server has confirmed the award; it does not pick a prize in the browser. Reduced-motion users receive the result immediately without the moving reveal. The supplied watermarked stock image is not embedded.

After the cover emerges, a focused result dialog shows the title, genres, episode count, drama language, public creator name, upload date, first publication date, synopsis and draw time. The upload date is the earliest valid upload timestamp among currently present episodes, normalised to UTC; it is not guessed from series creation. Older responses without that field omit it. **View it now** opens the awarded drama. **Close and watch later**, Escape and the close button dismiss the panel while preserving the server award. **View prize details** in the saved list reopens the panel without another draw. Unavailable content exposes only the existing minimal receipt, with no play action or removed metadata. No new storage or receipt migration is needed. The public pool header `X-LingYing-Lucky-Draw: gift-reveal-v2` supports read-only rollout verification.

## Administrator controls

Open **Administrator → Lucky Draw**, or **https://lingyingdrama.com/admin?tab=lucky-draw**.

1. Search the catalogue and add the paid series that should be prizes. Only published, available series containing at least one paid episode qualify, including the existing first-N and optional-final-episode free rules. Up to 200 series can be selected. No production series is added automatically on deployment. A selected series that is later archived, moderated, deleted or retired is excluded from public draws; the administrator can remove its selection. Restoring its availability makes an enabled selection eligible again.
2. Search for an account by name, email or ID and select it. The panel shows remaining and used chances, recent draw results with dates/times, and recent extra-chance grants.
3. Add **1–1,000 free chances** at a time and give a reason. The resulting balance cannot exceed 1,000,000. The original one welcome chance is included: adding two before the first draw gives three. Counts cannot be taken away through this interface. Grant records retain administrator, account, amount, reason and UTC server time. Requests use an exact-payload idempotency key, so a retry cannot grant twice.
4. Removing a series from the pool affects future draws and never revokes previous wins. Existing paid purchases, creator earnings, financial review holds and payment settings are not modified.

The initial production pool is deliberately empty until the operator selects the actual prizes. No chance is used by an empty eligible pool. Operator-facing administrative controls do not establish a third-party creator's authorisation to distribute their work; select only works the operator is entitled to offer in this promotion. This implementation does not create or retrospectively infer creator consent.

## Draw and access rules

The server chooses one eligible series with `crypto.randomInt`, uniformly among that account's current candidates. Previously won series, the creator's own uploads and series whose currently paid episodes all have **real** purchase receipts are excluded. A partial buyer can win access to remaining episodes; previous receipts and applicable refund rights are not rewritten. Every successful draw awards one distinct series. No eligible candidate or no remaining chance returns a clear error without consuming anything.

An award grants access to the series' current and future episodes while that content remains available. Stream, playback, heartbeat, progress, episode lists and no-charge unlock handling use the same account-bound entitlement. Publication, takedown, archive, retirement and deletion guards still apply. An unavailable win stays in private history with its original title/date, without exposing removed descriptions, covers or stream URLs. Returning the content to availability restores the saved access. Awards cannot transfer to another account, and are not cash or sale receipts.

A draw's account debit and result insert commit in one synchronous SQLite transaction. Unique `(user_id, request_id)` and `(user_id, series_id)` constraints prevent double spending and duplicate wins. A replay returns the original result even if the pool or balance later changes. Same-key requests by another account cannot read or claim that account's result. GET requests do not create chance balances or consume draws.

The browser keeps an account-scoped pending request reference in session storage before submitting. A retry uses that exact reference, and a reload can retrieve an already saved result without drawing again. Administrators similarly retain the pending grant form and its request reference until confirmed. These references are not authentication credentials; every account/admin endpoint still requires the real current session. Server errors never imply that a new attempt is safe to submit with a different key.

## Cloudflare storage and privacy

The existing `lingying` Worker uses the same SQLite-backed **APP Durable Object**, through the shared additive schema:

- `lucky_draw_accounts`: remaining/used/extra-chance counters.
- `lucky_draw_results`: immutable account/series award, original title, request reference and ISO UTC date/time.
- `lucky_draw_pool`: current administrative pool selections.
- `lucky_draw_grants`: append-only grant/account/administrator audit.
- `lucky_draw_pool_events`: append-only selection changes with dates and titles.

There is no new Worker, KV namespace, bucket, uploaded video copy or media transcode. Tables survive ordinary deploys and restarts. Free awards are deliberately independent of Stripe's selected financial mode; a real explicit promotional draw grants access in either UI mode. Test purchases never become free awards or suppress a real draw. No paid receipt, ledger entry, creator/platform revenue or wallet balance is created by drawing or granting chances. This does not enable payouts or switch payment modes.

Private history is paged in groups of 30. Admin searches return up to 30 matching accounts and the account detail shows its 30 most recent wins/grants. Public responses omit creator authentication IDs, account IDs, grant reasons and private identity/payment data. Lucky Draw responses use private/no-store caching. The page is a real HTTP 200 application route with `noindex`; account results are never search-indexed or put in the service worker cache. Displayed dates use the browser's locale/time zone, while stored timestamps remain UTC. Policy version `2026-11-12` describes the promotion, account records and request-recovery storage. Its creator-earnings section expressly states that whole-series awards and viewing under them, including covered future episodes, generate no creator payment or revenue share. Completed paid-purchase earnings and other users’ valid paid unlocks remain intact; past Pass acknowledgements keep their actual versions.

## Verification

Run `npm test`, `npm run build:cloudflare`, the Lucky Draw and existing auth/consent/search browser tests, and `npm run test:cloudflare`. API checks cover authorisation, empty pools, free-episode rules, duplicates, concurrent requests, exact-payload grant retries, paid-access preservation, both financial modes, protected current/future playback and unavailable/removed prizes. Cloudflare integration verifies actual local Durable Object transactions, R2 range access and persistence through runtime/payment-mode changes. Browser checks cover guests, signed-in drawing/recovery, reduced motion, account switching, admin controls and 320px/RTL layouts.

Production verification is read-only. Do not create a production login, fabricate an owner session, spend the owner's welcome chance, select real prizes or grant real accounts chances as a deployment check. The operator uses the existing administrator account to choose the actual pool and try the page deliberately.
