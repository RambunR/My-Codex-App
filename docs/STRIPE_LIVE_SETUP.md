# Accept real Stripe payments on LingYing

This guide configures live card Checkout on **https://lingyingdrama.com**, using the existing Cloudflare Worker **`lingying`** and the existing Stripe account. It does not create another website, charge a card, fund an application wallet, or send a creator payout. Keep API keys and webhook signing secrets out of chat, screenshots, Git and frontend code.

The owner has requested activation and confirmed that live API/webhook Secrets were saved. The current release target is live card Checkout with creator payouts paused; deployment and independent live verification are pending. No card charge, real wallet credit or creator transfer is authorized as a configuration check.

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

4. The destination must include these seven Snapshot events:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   charge.refunded
   charge.dispute.created
   charge.dispute.closed
   ```

5. The readiness helper below can append missing required event selections to one existing matching destination; you do not need to add those selections manually if it succeeds. It will not create a missing destination or resolve duplicate matches. Save any necessary Dashboard changes. Open the live destination and reveal its **Signing secret** only when ready to paste it directly into Cloudflare's encrypted Secret field in the next section. It begins with `whsec_`. Each destination has its own secret; the test destination's secret and a Stripe CLI listener's secret do not substitute for this live destination's secret.

### Automatic account and subscription verification

The release enables **`STRIPE_AUTO_CONFIGURE_WEBHOOK=true`**. Using the live key already encrypted in the Worker, the server verifies:

- The key belongs to the existing account **`acct_1StBIYJ6Er233b9c`**, with `charges_enabled=true`.
- Exactly one enabled, live **Snapshot** webhook endpoint has the exact URL above.
- That endpoint includes the seven required events, or all events via `*`.

If selections are missing, the helper appends **only** the missing required events and re-fetches the endpoint. It preserves existing selections, endpoint ID, URL, enabled status, API version and signing secret. It never creates/deletes an endpoint, rotates a secret, submits a payment, enables Connect or sends a payout. No private key needs to leave the Worker.

A restricted key needs permission to read its account and read/list/retrieve **Webhook Endpoints**; appending events also requires **Webhook Endpoints write** permission. Checkout still needs its separate Session creation/read/expiration permissions and the product/price operations used by the chosen line items. If the saved restricted key cannot perform these operations, adjust it securely in Stripe or make the required endpoint changes manually; keep the server key out of chat.

New Checkout stays unavailable until readiness succeeds. Public **`/api/config`** exposes only `paymentSetup.status` (`unchecked`, `pending`, `ready` or `error`) and a fixed safe error code. Examples:

| Code | Next step |
|---|---|
| `STRIPE_PERMISSION_DENIED` | Give the server key the required account/webhook permissions, or correct the subscriptions manually and retain read access. |
| `STRIPE_AUTHENTICATION_FAILED` | Correct the live server key in the encrypted Worker Secret. |
| `STRIPE_ACCOUNT_MISMATCH` | Use a live key from the existing LingYing Stripe account; do not migrate accounts implicitly. |
| `STRIPE_CHARGES_DISABLED` | Complete Stripe's merchant activation requirements. |
| `STRIPE_WEBHOOK_NOT_FOUND` | In Stripe Live, create/enable the correct Snapshot endpoint yourself and store its matching signing secret securely. |
| `STRIPE_WEBHOOK_AMBIGUOUS` | Resolve duplicate matching enabled endpoints in Stripe; the helper will not guess which secret is configured. |
| Other readiness errors | Inspect the existing endpoint/configuration and retry after correcting it; do not bypass the gate. |

Failures are cached briefly before retry; a corrected setting is not proof of readiness until the server reports `ready`. If all required events are already present, webhook write permission is unnecessary for that read-only verification. Account/subscription verification still cannot read back the signing secret or prove it matches the configured `STRIPE_WEBHOOK_SECRET`. The no-cost signed-delivery check below provides that separate evidence.

### Refund/dispute risk holds and operator resolution

The release adds durable financial risk holds for signed `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` events associated with this application's payments. Relevant activity remains restricted pending administrator review. A closed dispute is not permission to release funds automatically.

A hold **does not automatically reverse** spent wallet credit, paid episode access, creator earnings or earlier transfers. An administrator must reconcile the original payment, refund/dispute amount, spending and creator exposure, perform the necessary financial compensation, and record a verified resolution. Duplicate events must not create duplicate adjustments. These are containment controls, not a claim that complete automatic refund/dispute accounting is solved. See [the production-readiness report](PRODUCTION_READINESS.md).

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
| `STRIPE_AUTO_CONFIGURE_WEBHOOK` | `true` |
| `PAYOUTS_ENABLED` | `false` — keep creator disbursements paused |
| `STRIPE_ACTIVATION_PRICE_ID` | Empty string, unless a verified matching live price is configured |
| `STRIPE_WALLET_PRODUCT_ID` | Empty string, unless a verified matching live product is configured |

**Clear both optional test catalogue IDs.** The current IDs belong to test mode and cannot be used with a live key. Keeping these two variables as empty strings also overrides their previous configured values. No Stripe Dashboard product creation is required: without optional catalogue IDs, the server supplies a one-time **HK$88 Dramio Pass** line item and an exact **USD wallet-credit** line item for the amount the viewer selected, with a **US$5 minimum**. They are not subscriptions.

If you prefer saved live products, create them in the Live environment and use only their live IDs. The Dramio Pass price must be active, one-time, **HKD 8,800 cents**; the wallet uses its selected USD amount rather than a fixed US$5 price. Do not copy the test product/price IDs into these fields.

Preserve **`STRIPE_SITE_ORIGIN=https://aidramio.jimmy-tsoi2001.workers.dev`**. It is an internal Session metadata identifier used to match payments, not a customer-facing address. Also preserve the `APP` Durable Object namespace, `MEDIA` R2 bucket, Google/Apple credentials, user accounts and uploads. A payment-mode change does not require data migration or a new application.

## 5. Verify configuration before enabling customer Checkout

After the release's risk-hold handling and payout pause are implemented and checked, set **`PAYMENTS_MODE=stripe`** and apply the live configuration. This makes payment buttons available to customers; it does not submit a payment automatically.

1. Open **https://lingyingdrama.com/api/health**. It should return HTTP 200 with `ok: true` and `database: true`.
2. Open **https://lingyingdrama.com/api/config**. Confirm:

   ```json
   {
     "paymentsMode": "stripe",
     "paymentsReady": true,
     "paymentSetup": { "status": "ready" },
     "paymentsTestMode": false,
     "payoutsEnabled": false,
     "sandbox": false,
     "uploadsEnabled": true
   }
   ```

   With the automatic readiness helper enabled, `paymentsReady` requires matching configured credentials and a successful live account/endpoint check. It does not prove a matching signing secret, signed delivery or paid settlement. If `paymentSetup.status` is `error`, use its safe code above. If `paymentsTestMode` remains true, a test key or test setting remains active. Recheck the same Worker's bindings and the deployed source configuration.
3. Reload Wallet and Creator studio. The test-payment notice should be absent. Check Dramio Pass still displays **HK$88 once**, and Wallet accepts a custom USD amount of **at least US$5**.
4. If a live Checkout Session is opened for verification, check the amount, currency and merchant branding, then cancel it without submitting a card. The authenticated owner-only `POST /api/payments/:id/cancel` endpoint expires its own unpaid Stripe Session; it rejects another user's payment and must never expire a paid Session. Cancellation does not fund the wallet or create a funding ledger entry. After expiration, the owner-only `GET /api/payments/:id/status` can show the recorded payment status and verified webhook receipts. Wait for an actual Stripe-signed `checkout.session.expired` receipt with `endpoint_host: "lingyingdrama.com"`; that demonstrates live signed delivery to the custom domain without a charge. An expired status alone could have been set by the cancellation API and is not webhook proof. No-cost checks still cannot establish paid settlement or full refund behavior. Do not use `4242` or other test cards in live Checkout.
5. A complete live payment test requires a deliberately authorized real purchase. It is a separate money action: this setup guide does not perform one. After such a purchase, verify the actual matching event is **Delivered** with HTTP 200 in the live destination, the application credited the exact amount once, and refreshing/replaying does not duplicate credit. A Checkout success page alone does not prove webhook delivery because the app can also reconcile a Session server-side.

If a live credential or delivery problem appears, pause new Checkout with **`PAYMENTS_MODE=disabled`** while diagnosing. Properly configured signed webhook processing, existing-Session reconciliation and owner unpaid cancellation remain available while new Checkout is paused, so pending transactions and risk events are not discarded. Preserve real payment records/balances and valid credentials. Do not switch customers back into test finances to make an error disappear.

## Test records and creator payouts

Test wallets, passes, purchases and earnings remain in separate `test_*` financial tables. **They must never be copied or converted into real balances, live Dramio Pass ownership or payable creator earnings.** After the live switch, users see their existing real financial state; test-only balances/pass status may therefore no longer appear active. Their accounts, profiles and uploaded media remain intact.

Creator payouts are deliberately paused by **`PAYOUTS_ENABLED=false`**, independently of live card Checkout. The pause blocks creator onboarding, new withdrawal requests and administrator transfer approval; it does not erase earnings or existing withdrawal records. Payouts require separate Stripe Connect setup, country/capability checks and verified live transfer/bank-settlement behavior before this flag is changed. The implemented workflow requires a creator request and administrator approval; enabling card Checkout does not execute a weekly transfer automatically. Do not approve a transfer or submit a real payment as a configuration check.

## Official references

- [Activate a Stripe account](https://docs.stripe.com/get-started/account/activate)
- [Stripe API keys and restricted keys](https://docs.stripe.com/keys)
- [Manage event destinations](https://docs.stripe.com/workbench/event-destinations)
- [Webhook signatures and delivery](https://docs.stripe.com/webhooks)
- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?ui=full-page)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

Prepared 31 October 2026. Configuration instructions are not evidence that live credentials, signed delivery or real-money settlement have been verified.
