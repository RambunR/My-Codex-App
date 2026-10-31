# Accept real Stripe payments on LingYing

This guide configures live card Checkout on **https://lingyingdrama.com**, using the existing Cloudflare Worker **`lingying`** and the existing Stripe account. It does not create another website, charge a card, fund an application wallet, or send a creator payout. Keep API keys and webhook signing secrets out of chat, screenshots, Git and frontend code.

The test-payment notice reflects the server's payment configuration. Hiding the notice does not enable real payments: the live API key, live endpoint signing secret and application mode must agree.

## 1. Open the correct Stripe environment

1. Sign in to the Stripe account already used for LingYing. Select its **Live** environment, outside the testing Sandbox/Test environment. Test and live API keys, products, prices and webhook destinations are separate, even within the same account.
2. Complete Stripe's **Activate payments** requirements for the business, including its business details and verification. Use **HK NovaXR Production**, the actual registered business information, website **https://lingyingdrama.com** and support address **contactus@hknovaxrproduction.com** where appropriate. Enter accurate bank and business information yourself; this guide does not alter them.
3. Confirm the account can accept card payments in **HKD** for Dramio Pass and **USD** for wallet credit. Review [Stripe's Hong Kong pricing](https://stripe.com/hk/pricing) for processing, conversion and other applicable fees.

Wallet credit is used for content on LingYing. Accepting customer payments and paying independent creators are different capabilities; activating one does not establish that Stripe Connect transfers are available for every creator country.

## 2. Prepare the live webhook destination

The previously configured **test** destination cannot receive live events. In Stripe's **Live** environment:

1. Open **Workbench → Webhooks / Event destinations** ([Dashboard](https://dashboard.stripe.com/webhooks)). If a live LingYing destination already exists, edit it. Otherwise choose **Add destination**.
2. Choose events from **Your account** and the **Snapshot** payload format. The application reads `event.data.object`; a thin-event destination uses a different integration. Preserve an existing compatible API version, or use the version confirmed compatible with the deployed Stripe integration.
3. Set the endpoint URL exactly to:

   ```text
   https://lingyingdrama.com/api/payments/webhook
   ```

4. Include these four Checkout events:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   ```

5. Save the live destination. Open it and reveal its **Signing secret** only when ready to paste it directly into Cloudflare's encrypted Secret field in the next section. It begins with `whsec_`. Each destination has its own secret; the test destination's secret and a Stripe CLI listener's secret do not substitute for this live destination's secret.

### Refund and dispute events: release work in progress

The currently reviewed handler settles Checkout events but does not yet reconcile refunds or disputes. Merely subscribing to more events does not implement that accounting. The final live release must document and verify its additional refund/dispute event names and corresponding handlers before customer payments are enabled. Until that implementation is confirmed, keep `PAYMENTS_MODE=disabled` during live-credential setup. See [the production-readiness report](PRODUCTION_READINESS.md).

The endpoint must respond directly with HTTP 2xx after valid signed delivery. Stripe does not follow a website redirect as successful webhook delivery. Retain the test destination and historical financial records for test auditing; do not reuse their signing secrets for live payments.

## 3. Store live credentials on the existing Cloudflare Worker

Open **Cloudflare → Workers & Pages → `lingying` → Settings → Variables and Secrets**. Use the main application, not the temporary **`aidramio`** compatibility gateway or the old sandbox. Do not create another Worker or database.

1. First set the ordinary text variable **`PAYMENTS_MODE`** to **`disabled`**, and apply/deploy the setting. Checkout will be unavailable while the two credential bindings are replaced, avoiding a mixed test/live configuration.
2. In Stripe's **Live** environment, open **Developers → API keys**. Reveal or create the live server API key and copy it directly into Cloudflare as an encrypted **Secret** named **`STRIPE_SECRET_KEY`**. A standard live secret key begins with `sk_live_`; an appropriately permissioned restricted live key begins with `rk_live_`. A `pk_live_` publishable key is not the server key. Restricted keys must allow the operations this integration uses; an insufficiently permitted key can pass local presence checks yet fail when opening Checkout.
3. Copy the live destination's `whsec_...` value directly into an encrypted **Secret** named **`STRIPE_WEBHOOK_SECRET`** on the same Worker.
4. Save/apply the changes. Do not rename these bindings, put their values into ordinary text variables, paste them into chat, or enter them in shell-command arguments. Cloudflare will not display an existing Secret value after it is saved; verify the binding names and operation results instead.

No Stripe publishable key is required by this website's current hosted Checkout integration. Its server creates a Checkout Session and sends the browser to Stripe's hosted page. Do not expose the server key to fix a browser-side payment error.

## 4. Set the live application variables

While **`PAYMENTS_MODE=disabled`**, set the following ordinary text variables on **`lingying`** and keep the tracked **`wrangler.jsonc`** configuration in sync before the next code deployment. Explicit Wrangler variables can overwrite Dashboard changes even when deployment uses `--keep-vars`.

| Binding | Live value |
|---|---|
| `ENVIRONMENT` | `production` |
| `APP_URL` | `https://lingyingdrama.com` |
| `PUBLIC_APP_URL` | `https://lingyingdrama.com` |
| `STRIPE_TEST_MODE` | `false` |
| `STRIPE_ACTIVATION_PRICE_ID` | Empty string, unless a verified matching live price is configured |
| `STRIPE_WALLET_PRODUCT_ID` | Empty string, unless a verified matching live product is configured |

**Clear both optional test catalogue IDs.** The current IDs belong to test mode and cannot be used with a live key. Keeping these two variables as empty strings also overrides their previous configured values. No Stripe Dashboard product creation is required: without optional catalogue IDs, the server supplies a one-time **HK$88 Dramio Pass** line item and an exact **USD wallet-credit** line item for the amount the viewer selected, with a **US$5 minimum**. They are not subscriptions.

If you prefer saved live products, create them in the Live environment and use only their live IDs. The Dramio Pass price must be active, one-time, **HKD 8,800 cents**; the wallet uses its selected USD amount rather than a fixed US$5 price. Do not copy the test product/price IDs into these fields.

Preserve **`STRIPE_SITE_ORIGIN=https://aidramio.jimmy-tsoi2001.workers.dev`**. It is an internal Session metadata identifier used to match payments, not a customer-facing address. Also preserve the `APP` Durable Object namespace, `MEDIA` R2 bucket, Google/Apple credentials, user accounts and uploads. A payment-mode change does not require data migration or a new application.

## 5. Verify configuration before enabling customer Checkout

After the release's refund/dispute handling is implemented and checked, set **`PAYMENTS_MODE=stripe`** and apply the live configuration. This makes payment buttons available to customers; it does not submit a payment automatically.

1. Open **https://lingyingdrama.com/api/health**. It should return HTTP 200 with `ok: true` and `database: true`.
2. Open **https://lingyingdrama.com/api/config**. Confirm:

   ```json
   {
     "paymentsMode": "stripe",
     "paymentsReady": true,
     "paymentsTestMode": false,
     "sandbox": false,
     "uploadsEnabled": true
   }
   ```

   `paymentsReady` checks configured credential shape and mode; it does not prove that the live account is activated, key permissions work, or a signed event was delivered. If `paymentsTestMode` remains true, a test key or test setting remains active. Recheck the same Worker's bindings and the deployed source configuration.
3. Reload Wallet and Creator studio. The test-payment notice should be absent. Check Dramio Pass still displays **HK$88 once**, and Wallet accepts a custom USD amount of **at least US$5**.
4. If a live Checkout Session is opened for verification, check the amount, currency and merchant branding, then cancel it without submitting a card. This can check Session creation and the return URL but cannot prove settlement or webhook delivery. Do not use `4242` or other test cards in live Checkout.
5. A complete live payment test requires a deliberately authorized real purchase. It is a separate money action: this setup guide does not perform one. After such a purchase, verify the actual matching event is **Delivered** with HTTP 200 in the live destination, the application credited the exact amount once, and refreshing/replaying does not duplicate credit. A Checkout success page alone does not prove webhook delivery because the app can also reconcile a Session server-side.

If a live credential or delivery problem appears, set **`PAYMENTS_MODE=disabled`** while diagnosing. Preserve real payment records and balances. Do not switch customers back into test finances to make an error disappear.

## Test records and creator payouts

Test wallets, passes, purchases and earnings remain in separate `test_*` financial tables. **They must never be copied or converted into real balances, live Dramio Pass ownership or payable creator earnings.** After the live switch, users see their existing real financial state; test-only balances/pass status may therefore no longer appear active. Their accounts, profiles and uploaded media remain intact.

Creator payouts require a separate Stripe Connect setup and country/capability checks. The current workflow requires a creator request and administrator approval; enabling card Checkout does not execute a weekly transfer automatically. Do not approve a transfer or submit a real payment as a configuration check. Any new payout enablement flag and refund/dispute safeguards must be confirmed with the final deployed release before creators are offered live withdrawals.

## Official references

- [Activate a Stripe account](https://docs.stripe.com/get-started/account/activate)
- [Stripe API keys and restricted keys](https://docs.stripe.com/keys)
- [Manage event destinations](https://docs.stripe.com/workbench/event-destinations)
- [Webhook signatures and delivery](https://docs.stripe.com/webhooks)
- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?ui=full-page)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

Prepared 31 October 2026. Configuration instructions are not evidence that live credentials, signed delivery or real-money settlement have been verified.
