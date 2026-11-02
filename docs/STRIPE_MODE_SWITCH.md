# Switch Stripe testing and production with one variable

LingYing can keep both Stripe credential pairs saved on the existing **`lingying`** Cloudflare Worker. After the initial setup, **`STRIPE_TEST_MODE`** selects which pair opens new Checkouts. The website stays at **https://lingyingdrama.com**; no second application, domain, database or media bucket is needed.

The mode applies to everyone using this website. Test mode shows the test-payment notice and uses separate test wallet credit, Pass ownership, purchases and earnings. Switching back never converts those records to real money or live entitlements. Accounts, authentication, existing real entitlements, uploaded media and storage limits remain intact. Payment records are isolated; content uploads, publication and administrator settings still affect this same application. Keep creator payouts paused.

## Save four encrypted Secrets once

Open **Cloudflare → Workers & Pages → lingying → Settings → Variables and Secrets**. Keep values out of chat, screenshots, Git and browser code.

| Secret name | What to save |
|---|---|
| `STRIPE_SECRET_KEY` | The existing live server API key, beginning `sk_live_` or `rk_live_` |
| `STRIPE_WEBHOOK_SECRET` | The existing live Snapshot destination's `whsec_…` signing secret |
| `STRIPE_TEST_SECRET_KEY` | A server API key from the intended Stripe testing environment, beginning `sk_test_` or `rk_test_` |
| `STRIPE_TEST_WEBHOOK_SECRET` | That same testing environment's Snapshot destination signing secret, beginning `whsec_…` |

**Do not replace the live pair with test values.** Add the dedicated test pair alongside it. Each API key and webhook secret must belong to the same Stripe environment. Publishable `pk_` keys and Stripe CLI listener secrets do not substitute for these server credentials.

Selecting test mode with an absent or partial dedicated test pair cannot fall back to a live key or borrow a live webhook secret. A legacy isolated installation whose original `STRIPE_SECRET_KEY` already has a test prefix can still use its original pair for compatibility, but the four-Secret layout above is the supported setup for this website.

## Prepare the testing webhook

In Stripe, select the testing environment that issued `STRIPE_TEST_SECRET_KEY`. Create or edit its **Your account → Snapshot** destination with this exact URL:

```text
https://lingyingdrama.com/api/payments/webhook
```

Select these seven events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
charge.dispute.created
charge.dispute.closed
```

Save its signing secret as `STRIPE_TEST_WEBHOOK_SECRET`. Keep the separate live destination, live secret and existing deliveries intact. A test destination cannot deliver live events, even when both destinations use the same application URL.

Keep both saved pairs and both destinations enabled after a mode change. The webhook handler validates each configured pair separately and processes only a genuine signature whose event mode matches that pair. Late paid wallet funding or Pass activation, Session expiry/failure, refund/dispute notifications and delivery receipts remain in their original financial mode even when the website currently displays the other mode. A test event cannot credit a real wallet or create a real Pass. This routing does not change the selected website mode.

Interactive Checkout, reconciliation and cancellation use the **selected** mode. To manually reconcile or cancel an older payment from the other mode, select its matching mode first. The automatic signed webhook path can continue independently. Local tests cover this separation; actual delivery from an operator's dedicated test destination is not established until its real test credentials are installed and a matching signed event is observed.


## Change only the mode variable

| Variable | Testing | Production / real payments |
|---|---|---|
| `STRIPE_TEST_MODE` | `true` | `false` |

Save and deploy the variable change, then open a **new** Checkout from LingYing. A Checkout already open on Stripe retains the environment and amount in which it was created; changing a website setting cannot convert it into a test payment.

Keep these other values unchanged:

```dotenv
ENVIRONMENT=production
PAYMENTS_MODE=stripe
STRIPE_AUTO_CONFIGURE_WEBHOOK=true
PAYOUTS_ENABLED=false
APP_URL=https://lingyingdrama.com
PUBLIC_APP_URL=https://lingyingdrama.com
```

Testing Stripe does not require changing `ENVIRONMENT` to development or disabling production authentication/security controls. Preserve the pinned internal `STRIPE_SITE_ORIGIN` financial identity.

With the automatic readiness flag enabled, test mode validates that a test key, a webhook-secret value and the Stripe client are selected, then reports `paymentSetup.code: STRIPE_TEST_CONFIGURATION`. It does **not** run the live-only account/endpoint automation and does not prove the API key's remote permissions, matching webhook secret or actual delivery. Live mode still requires the existing full live account/endpoint readiness check. There is no need to toggle `STRIPE_AUTO_CONFIGURE_WEBHOOK` when switching modes.

`STRIPE_TEST_MODE` is intentionally omitted from tracked `wrangler.jsonc` variables. It is an operator-owned Dashboard setting. The supported existing-Worker deployment uses `--keep-vars`, preserving the selected value through future code updates. Do not add a hard-coded mode to the tracked file or use a deployment command that replaces Dashboard variables. Before publishing, inspect the actual current value and confirm it remains unchanged afterward. Other explicitly configured variables still need normal reconciliation. A missing mode defaults to production, so keep the explicit Dashboard value rather than deleting it.

## Optional saved products

No new Stripe product is required for the existing inline-pricing flow. If saved catalogue references are used, they are selected per mode:

| Production catalogue variable | Optional testing counterpart |
|---|---|
| `STRIPE_ACTIVATION_PRICE_ID` | `STRIPE_TEST_ACTIVATION_PRICE_ID` |
| `STRIPE_WALLET_PRODUCT_ID` | `STRIPE_TEST_WALLET_PRODUCT_ID` |

Leave the testing fields empty to use server-controlled inline test prices. Dedicated testing never reuses live product/price IDs. The regular Pass price is HK$88 once; managed promo codes still determine any valid discounted quote. Wallet deposits remain user-selected USD amounts from US$5. A test purchase grants only its test financial entitlement.

## Check the selected mode

1. Open `/api/config`. Testing should show `paymentsMode: "stripe"`, `paymentsReady: true`, `paymentsTestMode: true` and `payoutsEnabled: false`. If the required test pair is missing or uses a wrong-mode key/invalid secret format, new Checkout stays unavailable. Remote credential validity and permissions still need their own test.
2. Reload Wallet and Creator Studio and confirm the explicit test-payment notice. Open a new Checkout and confirm Stripe's testing context before using a test card. Never submit a test card on a `cs_live_` Checkout.
3. Only in testing, use **4242 4242 4242 4242**, a future expiry such as **12/30**, CVC **123**, and a valid-format postal code if requested. Confirm exact test wallet credit or a labelled test Pass and no duplicated settlement after refresh.
4. Inspect the matching Stripe test event delivery for direct HTTP 2xx and the corresponding single application settlement. A success return may reconcile a Session and is not independent webhook proof.
5. To launch real payments, set **`STRIPE_TEST_MODE=false`**, save/deploy, and verify `paymentsTestMode: false`, `paymentsReady: true` and the absence of the test notice. Both saved pairs stay in place. Do not submit a real payment just to verify configuration.

The operator supplies the testing credentials and destination; the mode switch does not create or rotate them. If no dedicated test Secrets have been supplied, the operator must add them before testing can become ready. The implementation update itself retains the intended current mode rather than automatically starting tests or making a real charge.
