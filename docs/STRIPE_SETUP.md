# AIDramio payments: test first, then enable live payments

The isolated payment test site is configured with Stripe **test-mode** credentials. **Live payment credentials are not configured on the main site yet**, so it cannot accept real deposits or publisher activation payments. Selecting Stripe as the provider does not make payments ready without the matching key and webhook signing secret.

| Site | Purpose | Accounts and balances |
|---|---|---|
| [Main AIDramio](https://aidramio.jimmy-tsoi2001.workers.dev) | Real viewing and publishing; live payments await setup | Production Durable Object database and private media bucket |
| [Payment test site](https://aidramio-sandbox.jimmy-tsoi2001.workers.dev) | Stripe test Checkout and wallet purchases; clearly labelled **AIDramio Test** | Separate Durable Object database and separate media bucket; test money never enters the main site |

Register a separate email/password account on the payment test site. Production accounts, Google sign-in sessions, wallet balances and purchased episodes are not shared with it. Google sign-in is configured on the main site only. Uploads are disabled on the payment test site, including after test publisher activation.

## Payment rules

- **Publisher activation:** HK$88 once, charged separately from wallet funding. It is a one-time payment, not a subscription, and does not add USD wallet credit. Successful activation authorizes publishing on the main site; the payment test site still blocks uploads.
- **Viewer wallet:** at least US$5 per deposit. The viewer chooses a custom USD amount with no more than two decimal places. The old US$200 application cap is removed; the technical Checkout ceiling is US$999,999.99 per deposit, subject to Stripe/account limits.
- **Episode unlocks:** publishers set the price, at least US$0.10, and choose how many initial episodes are free. A successful paid unlock deducts the price from the viewer's wallet once and remains attached to that account. Reopening an unlocked episode does not charge again.
- **Revenue:** 70% of the unlock goes to the publisher and 30% to the platform. Integer USD millionths preserve fractional cents. Wallet credit buys content; viewer deposits cannot be withdrawn as cash.
- **Publisher withdrawals:** remain a separate, administrator-approved Stripe Connect flow with a minimum HK$20 equivalent. Connect onboarding and live payout capabilities must be configured before real payouts.

## Configured Stripe test catalog

The two products and their one-time prices are recorded in `stripe/catalog.test.json`. These identifiers are not secret credentials, but they belong to **test mode only**.

| Product | Test product ID | Test price ID | Base amount |
|---|---|---|---|
| Publisher activation | `prod_VWA3RFHkUr0TuM` | `price_1UV7jBJ6Er233b9cr0ahOada` | 8,800 HKD cents = HK$88, once |
| Wallet credit | `prod_VWA3U1So0O5Lqv` | `price_1UV7nXJ6Er233b9c4M2mAz87` | 500 USD cents = US$5, once |

The wallet's fixed US$5 catalog price is its base/default price, not a limit on the viewer's choice. AIDramio validates the chosen amount and creates Checkout with server-controlled `price_data.unit_amount` linked to the wallet product. Stripe's native `custom_unit_amount` feature was rejected for this Hong Kong account, so amount selection happens in AIDramio. This is a purchase of closed-loop content credit, not a donation.

The registered **test webhook** is `we_1UV7yhJ6Er233b9cacJqN4tx`:

```text
https://aidramio-sandbox.jimmy-tsoi2001.workers.dev/api/payments/webhook
```

It subscribes to these events from the Stripe account:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

The test API key and this endpoint's signing secret are stored as encrypted **Worker Secrets** named `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on **aidramio-sandbox only**. They are not stored in the catalog JSON or Git. Never copy them to the main Worker.

## Test the payment flow yourself

1. Open the [payment test site](https://aidramio-sandbox.jimmy-tsoi2001.workers.dev) and register a test email/password account. Confirm that the **AIDramio Test** banner is visible.
2. Open **Creator studio** and choose **Activate for HK$88**. On the Stripe-hosted **test** Checkout page, use test card **4242 4242 4242 4242**, any future expiry date, any three-digit CVC and a valid-format postal code if requested. Never enter a real card or use a Stripe test card on the main/live checkout. Return to the studio and confirm activation. Paying this test activation does not enable sandbox uploads.
3. Open **Wallet** and choose US$5 or enter a custom amount such as **US$234.56**. Complete its separate Stripe-hosted test Checkout. Return to the wallet and confirm that exact amount was credited. Do not count the HK$88 activation payment as wallet credit.
4. Open **After Midnight**, whose first episode is free in the payment test site. Episode 2 costs **US$0.10**. Unlock it and confirm that a US$5 balance becomes **US$4.90**. Its test revenue split is US$0.07 publisher / US$0.03 platform. Reopen the episode to confirm it stays unlocked without another deduction.

Only this sandbox sample series has paid test episodes; the main site's labelled sample previews remain free. The test site and Stripe test cards simulate money, not a real purchase or payout.

Setup verification already created and retrieved an unpaid US$234.56 test Checkout and an unpaid HK$88 activation Checkout, checked amount/currency/mode and activation reuse, then expired both sessions. Stripe-signed expiration events updated both application payment records to expired, while the verification wallet stayed at zero and publisher activation stayed off. **The agent did not submit a card, complete a paid transaction, charge real money or send a payout.** The interactive card/return/unlock steps above are still for the operator to perform.

## Enable real payments on the main site

1. Complete the Stripe account's business and bank setup, and confirm that it is enabled for real card payments in the supported currencies. Use **Live mode**, not the test catalog.
2. Create a **live** webhook endpoint for events from **Your account** at:

   ```text
   https://aidramio.jimmy-tsoi2001.workers.dev/api/payments/webhook
   ```

   Select the same four Checkout events listed above. Its live signing secret is different from the sandbox signing secret.
3. In Cloudflare, open the confirmed account, then **Workers & Pages → aidramio → Settings → Variables and Secrets**. Add both as **Secrets**, then Save/Deploy:

   | Name | Main-site value |
   |---|---|
   | `STRIPE_SECRET_KEY` | The intended Stripe account's live secret or restricted key, with the `sk_live_` or `rk_live_` prefix |
   | `STRIPE_WEBHOOK_SECRET` | The signing secret of the **live main-site endpoint**, with the `whsec_` prefix |

   Enter values directly in secure provider settings. Do not paste keys or signing secrets into chat, commit them, put them in frontend code or include them in command-line arguments. Rotate any API key previously shared in chat or another exposed location, then replace only the corresponding Worker Secret. Keep sandbox replacements in **aidramio-sandbox** and live replacements in **aidramio**.
4. Keep `PAYMENTS_MODE=stripe` and `APP_URL=https://aidramio.jimmy-tsoi2001.workers.dev` in the main tracked configuration. Verify `/api/config` reports `paymentsReady: true`, `sandbox: false` and `paymentsTestMode: false`. Test-mode credentials cannot make main-site real payments ready; the sandbox accepts test credentials only.
5. If using catalog objects in live mode, create their **live** counterparts first. Optionally set `STRIPE_ACTIVATION_PRICE_ID` to an active one-time **HK$88** live price, and `STRIPE_WALLET_PRODUCT_ID` to the live USD wallet-credit product. Keep these identifiers consistent in provider settings and the deployment configuration. Never use the test IDs above on the main site. Without those optional IDs, the backend can create the corresponding server-defined Checkout line items directly.
6. For a restricted live key, grant the Checkout Sessions read/write permissions and the Products/Prices access used by the chosen catalog configuration. Creating catalog objects also needs Products and Prices write permissions. Stripe Connect onboarding and payouts need the applicable account/account-link/transfer permissions and approved capabilities; they are not enabled merely by making wallet Checkout ready.
7. Check the live webhook delivery log and perform an intentional low-value real payment only when the operator is ready to accept its processing charges. Confirm the amount, currency, resulting wallet or activation state, and return flow. There is no client-side button that can mark an unpaid real payment paid.

Stripe charges its applicable processing, currency-conversion and payout fees. See [Stripe Hong Kong pricing](https://stripe.com/hk/pricing); this guide does not assume a particular account's negotiated rate. Cloudflare hosting/storage charges remain separate.

## Operational behavior and limits

The backend verifies webhook signatures, live/test mode, stored Checkout Session identity, amount, currency and paid status before settlement. Redirecting to a success URL alone does not credit a wallet. Replayed notifications settle once; wallet credit, purchase entitlement, wallet deductions and the 70/30 split use database transactions. The server rejects insufficient balances and checks supported integer ranges before adding funds or earnings.

Expired or failed Checkout events close only their matching pending payment. A publisher's still-open activation Checkout is reused, and a confirmed activation is not sold twice. Provider timeouts retain the pending activation and stable Stripe idempotency key for a safe retry.

**Automatic refund and dispute adjustments are not implemented.** Review Stripe refunds, chargebacks and disputes manually, reconcile affected wallet/earnings records, and resolve them before approving related publisher payouts. Do not assume a refunded deposit automatically removes application wallet credit.

## Maintenance commands

Work from `/workspace/My-Codex-App`. The catalog/connect helpers operate in test mode only and take a securely supplied `STRIPE_TEST_SECRET_KEY`, or the `--stdin-key` option when terminal echo has been disabled. Their help output contains no credentials:

```bash
node scripts/provision-stripe-test.mjs --help
node scripts/connect-stripe-sandbox.mjs --help
```

With the test key already supplied securely, the relevant operations are:

```bash
node scripts/provision-stripe-test.mjs --catalog-only
node scripts/connect-stripe-sandbox.mjs
node scripts/connect-stripe-sandbox.mjs --verify-only
```

Provisioning creates/reuses only the owned test products/prices. Connecting requires the already-deployed isolated sandbox and the secure Cloudflare deployment token; it configures the sandbox webhook and Worker Secrets. Verification creates and expires unpaid test sessions and checks signed webhook delivery. Restricted keys need the corresponding catalog, Checkout and webhook-endpoint permissions; Account read is optional. Helpers redact credentials and do not save their values to disk or the catalog.

Run the appropriate application checks with `npm test`, `npm run test:e2e`, `npm run build:cloudflare` and `npm run test:cloudflare`. Main-site deployment follows [AGENTS.md](../AGENTS.md). To update the sandbox, use its dedicated tracked configuration and preserve its resources and secrets:

```bash
CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 \
XDG_CONFIG_HOME=/tmp/aidramio-cf-config \
WRANGLER_SEND_METRICS=false \
npx wrangler deploy --config wrangler.sandbox.jsonc --keep-vars
```

Do not point the sandbox at the main database/bucket, change its fixed isolated HTTPS origin, or configure live Stripe keys there. Deployment preserves Worker Secrets; keep intentional non-secret configuration changes aligned with the tracked files before future updates.
