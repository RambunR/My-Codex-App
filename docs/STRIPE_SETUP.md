# Stripe testing on the current AIDramio website

Use **[the existing AIDramio website](https://aidramio.jimmy-tsoi2001.workers.dev)** for payment testing. The user chose this single-site workflow: Wallet **Add funds** and publisher activation open Stripe-hosted **test Checkout**, then return to the same website. Google sign-in, email/password, existing accounts, series and publisher uploads remain available there.

The main Worker remains `aidramio`, with the existing Durable Object namespace and private media bucket. `PAYMENTS_MODE=stripe` and **`STRIPE_TEST_MODE=true`** explicitly select test payments. A visible notice identifies test money. Real payments and publisher withdrawals are unavailable in this mode.

## Payment rules and financial separation

- Publisher activation costs **HK$88 once**, separately from USD wallet funding. It is not a subscription and adds no wallet credit. Successful test activation permits testing publisher uploads under the normal 5 GiB, 180-second and 75 MiB limits.
- Wallet deposits start at **US$5**. Viewers can choose custom amounts with up to two decimal places. The old US$200 cap is removed; the technical ceiling is US$999,999.99, subject to Stripe/account limits.
- Publishers set episode prices of at least **US$0.10** and choose the initial free-episode count. A test unlock deducts the episode price once from the test wallet, records a permanent test entitlement and splits test earnings **70% publisher / 30% platform**.
- Test balances, publisher activation, payments, purchases and ledgers are stored in `test_accounts`, `test_payments`, `test_purchases` and `test_ledger` within the **same existing database**, linked to the same user IDs. Real wallet balances, activation and purchases remain unchanged. Existing real entitlements remain honored during testing.
- Test credit, earnings, activation and purchased entitlements never become real-money records when live mode is enabled. Test earnings cannot be paid out. Stripe Connect and withdrawal actions remain blocked during test payments.

## Try the payment flow

1. Open the [current website](https://aidramio.jimmy-tsoi2001.workers.dev) and sign in with Google or email/password. Confirm the test-payment notice is visible.
2. Open **Wallet**, choose US$5 or enter a custom amount such as US$23.45, then press **Add funds**. The button opens Stripe-hosted **test** Checkout.
3. Use test card **4242 4242 4242 4242**, any future expiry date and any three-digit CVC. Supply a valid-format postal code if requested. Do not enter a real card. Complete the test Checkout and return to Wallet; the exact selected amount should appear as test wallet credit.
4. To test publisher activation, open **Creator studio**, choose **Activate for HK$88**, complete its separate test Checkout and return to the studio. This does not add USD wallet credit. An account already activated for real publishing does not need another activation to keep uploading.
5. Use a publisher account to create a series, choose a price and free-episode count, and upload compatible episodes. Use another signed-in viewer to unlock a paid episode. A US$0.10 unlock reduces a US$5 test wallet to US$4.90, records US$0.07 test publisher earnings and US$0.03 test platform revenue. Reopening the episode does not deduct again.

The labelled sample previews on the main website remain free. Uploaded series supply the paid episodes for purchase testing; payment setup does not silently change sample prices or existing uploads.

The setup helper verifies unpaid Checkout creation, exact currencies/amounts and repeated activation reuse, then expires the sessions and checks Stripe-signed expiration notifications. It does not submit a card, complete a paid transaction or charge real money. Complete the interactive test-card/return/unlock steps above to verify the entire payment experience.

## Test catalog and webhook

The actual Stripe test products are recorded in `stripe/catalog.test.json`. Product and price identifiers are non-secret and belong to test mode only.

| Product | Test product | Test price | Amount |
|---|---|---|---|
| Publisher activation | `prod_VWA3RFHkUr0TuM` | `price_1UV7jBJ6Er233b9cr0ahOada` | HK$88 once |
| Wallet credit | `prod_VWA3U1So0O5Lqv` | `price_1UV7nXJ6Er233b9c4M2mAz87` | US$5 base/default |

The wallet product's US$5 default price does not limit custom amounts. AIDramio validates the viewer's amount and supplies server-controlled `price_data.unit_amount` linked to the wallet product. Stripe rejected its native `custom_unit_amount` price feature for this account's country, so amount selection happens in AIDramio. This buys closed-loop content credit; it is not a donation.

The main **test webhook** URL is:

```text
https://aidramio.jimmy-tsoi2001.workers.dev/api/payments/webhook
```

It subscribes to events from this Stripe account:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

Its non-secret identity is saved as `main_webhook` in the catalog. The Stripe test API key and main endpoint's signing secret are encrypted **Worker Secrets**, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, on the existing **aidramio** Worker. Google secrets are preserved. No key or signing secret is stored in Git, catalog JSON, frontend code or command-line arguments.

The older separate `aidramio-sandbox` deployment is no longer the requested workflow. Its owned Stripe test webhook is disabled after the main endpoint is connected and verified; its Worker, database and media bucket are retained. No new test website is created or required.

## Maintenance

Work from `/workspace/My-Codex-App`. The connection helper accepts only test keys through secure `STRIPE_TEST_SECRET_KEY` injection or `--stdin-key` with terminal echo disabled. `CLOUDFLARE_API_TOKEN` must be present securely. Never paste credentials into chat or commit them.

```bash
node scripts/connect-stripe-main-test.mjs --help
node scripts/connect-stripe-main-test.mjs
node scripts/connect-stripe-main-test.mjs --verify-only
```

The helper requires the existing main Worker to have explicit test mode deployed first, verifies the exact approved namespace/bucket and Google secret bindings, creates/reuses only its owned test webhook, and sets only the two payment secrets. It never changes authentication credentials, resource bindings or old-site user data. Restricted Stripe keys need Products/Prices access, Checkout Sessions read/write and Webhook Endpoints read/write as appropriate; Account read is optional. If an existing endpoint's signing secret was lost, enter that endpoint's secret directly in Cloudflare rather than trying to recover it from Stripe's API.

Check `/api/config` for `paymentsMode: "stripe"`, `paymentsReady: true`, `paymentsTestMode: true`, `sandbox: false`, `uploadsEnabled: true` and `auth.google: true`. Save intended non-secret settings in `wrangler.jsonc`; future updates must preserve the explicit test mode. Follow [AGENTS.md](../AGENTS.md) to update this same Worker and verify the public site.

Rotate any key previously exposed in chat or another shared location, then replace its corresponding encrypted secret directly in Cloudflare. Keep the existing webhook signing secret paired with its actual main endpoint.

## Later: accept real money on the same website

1. Complete Stripe's business/bank setup and confirm supported real card payments, currencies and countries.
2. Create a **live-mode** webhook for the same main-site URL and the four events above. Its signing secret differs from the test endpoint secret.
3. Change **`STRIPE_TEST_MODE=false`** in the tracked main configuration. Keep `ENVIRONMENT=production`, `PAYMENTS_MODE=stripe` and the same HTTPS `APP_URL`. Replace the main Worker's payment secrets with matching **live** credentials directly in Cloudflare. Test keys cannot enable live mode; live keys cannot enable explicit test mode.
4. Replace the optional activation price and wallet product IDs with live counterparts, or remove the optional IDs so server-defined line items are used. The live activation price must be HK$88 once. Never leave test IDs in live mode.
5. Verify `paymentsReady: true` and `paymentsTestMode: false`. Real wallet/earnings/activation and entitlements reappear from their original financial tables; test records remain separate for audit. Do not copy or convert test credit or purchases into real balances or entitlements.
6. Deliberately validate an intended low-value live payment only when ready to incur Stripe fees. Configure approved Stripe Connect onboarding/transfers before real publisher payouts, with the existing administrator approval and HK$20-equivalent minimum.

Stripe processing, conversion and payout fees apply to real payments; see [Stripe pricing](https://stripe.com/hk/pricing). Cloudflare hosting/storage charges remain separate. No real payment or payout is performed by the test setup helper.

## Operational limits

Settlement verifies Stripe signatures, mode, the recorded Session identity, amount, currency and paid status. A success redirect alone does not credit a wallet. Replayed notifications settle once; wallet deductions, entitlements and the revenue split use database transactions. Expired or failed events close only their matching pending payment. Stable activation idempotency keys preserve a safe retry after provider timeouts.

**Automatic refund and dispute adjustments are not implemented.** Before accepting real customers, handle Stripe refunds/chargebacks through operator review and reconcile affected real wallet/earnings records before approving payouts. A refunded deposit does not automatically remove application wallet credit. Final business/support details and payment policies still require the operator's values.
