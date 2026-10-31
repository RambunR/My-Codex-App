# Stripe testing on LingYing's domain

Use **[LingYing](https://lingyingdrama.com)** for payment testing. Wallet **Add funds** and **Dramio Pass** open Stripe-hosted **test Checkout**, then return to LingYing. The same application runs on the existing **`lingying` Worker**, with its original accounts, SQLite namespace, private media bucket and encrypted credentials.

Keep **`PAYMENTS_MODE=stripe`** and **`STRIPE_TEST_MODE=true`**. Connecting a purchased domain does not enable live payments. Real charges, Stripe Connect and creator withdrawals remain unavailable in this mode.

On 31 October 2026 the owner reported saving the custom-domain webhook URL. The public endpoint is reachable directly and rejects unsigned requests. Its actual Dashboard configuration and signed delivery remain independently unverified because this workspace has no Stripe API read credential or connected Stripe tool. The old URL in the saved catalogue is historical metadata, not a fresh observation of Stripe's settings.

## Move the existing Stripe test webhook to the domain

This is the required Stripe Dashboard change for the domain migration. The application already has its test API key, products, prices and endpoint signing secret; those do not need recreating merely because its website address changed.

1. Open the same Stripe account and **Sandbox/Test** environment currently used by LingYing. Open **Workbench → Webhooks** ([Dashboard](https://dashboard.stripe.com/webhooks)).
2. Open the **existing main test destination** whose endpoint currently ends in `aidramio.jimmy-tsoi2001.workers.dev/api/payments/webhook`. Choose its settings/edit action and change **Endpoint URL** to:

   ```text
   https://lingyingdrama.com/api/payments/webhook
   ```

3. Keep this existing destination enabled. Preserve its endpoint identity, signing secret, API version and **snapshot** event payload format. This handler reads `event.data.object`; a thin-event destination is a different integration. Its event source is **Your account**, with these four subscriptions:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   ```

4. Save the URL change. Editing the existing endpoint keeps its signing secret; leave the encrypted **`STRIPE_WEBHOOK_SECRET`** on Worker **`lingying`** unchanged. Do not roll the secret, create another destination, paste a secret into chat, or switch to live mode as part of this URL update.
5. Complete a small test Checkout from LingYing using the test card below. In that destination's **Event deliveries** tab, confirm the actual matching Checkout event is **Delivered** with HTTP **200**. Also confirm the wallet or pass receipt settled exactly once. A credited return page alone is insufficient evidence of webhook delivery because the application can reconcile a Session server-side.

If there is no existing main destination, creating a replacement is a separate setup action: choose **Your account**, **Snapshot**, a tested-compatible API version, and the four events above. A newly created endpoint has its own `whsec_...` signing secret; it must be stored securely on **`lingying`** before delivery can verify. The old endpoint remains in service until the replacement is proven. A Stripe CLI listener's secret is not interchangeable with the Dashboard endpoint secret.

Keep the old API gateway until the registered old webhook URL has been moved and delivery verified. Stripe treats webhook redirects as delivery failures, so the endpoint must respond directly rather than returning 301/302/307/308. The old gateway's raw-body forwarding must remain compatible during the transition. Old Checkout Sessions can still contain workers.dev return URLs; preserve page redirects while those Sessions finish or expire.

## Website branding and payment-method domains

Optionally update Stripe's business/public website field to **`https://lingyingdrama.com`**, retaining accurate **HK NovaXR Production** business/support details. Existing product names/descriptions can also be changed to LingYing branding without replacing their IDs or prices. These are branding/profile changes, not prerequisites for the existing hosted card Checkout to use the new return URL.

The current integration redirects users to **`checkout.stripe.com`**. It does not embed a payment form on LingYing's domain. Stripe's payment-method-domain registration instructions apply to **Elements or embedded Checkout** displaying methods such as Apple Pay/Google Pay/Link. If the integration later embeds them on the website, register every domain/subdomain that displays the form, in the applicable testing/live context.

Stripe also offers a **paid custom Checkout-domain feature** for putting the Stripe-hosted payment page itself on a branded subdomain. That feature is optional and is not required to run LingYing on its purchased Cloudflare domain. This deployment does not enable or purchase it.

## Payment rules and financial separation

- Dramio Pass costs **HK$88 once**, separately from USD wallet funding. It is not a subscription and adds no wallet credit. Test activation permits publisher uploads under the normal **5 GiB**, **180-second** and **75 MiB** limits.
- Wallet deposits start at **US$5**, with custom amounts up to two decimal places. The technical ceiling is US$999,999.99, subject to Stripe/account acceptance limits.
- Episode prices start at **US$0.10**. Publishers choose initial free episodes. A paid test unlock deducts its server price once and records **70% publisher / 30% platform** earnings.
- Test balances, pass ownership, payments, purchases and ledgers use `test_accounts`, `test_payments`, `test_purchases` and `test_ledger` in the same database, linked to existing user IDs. Real financial records and entitlements remain separate and unchanged.
- Test funds/earnings/passes never become real-money records when live mode is enabled. Existing real entitlements remain honored during testing. Test earnings cannot be paid out.

## Try the payment flow

1. Open [LingYing](https://lingyingdrama.com), sign in with your existing account, and confirm the test-payment notice. Google/Apple registrations must also include their intended callback URLs for the current auth configuration; that is separate from Stripe.
2. Open **Wallet**, enter US$5 or a custom amount such as US$23.45, and press **Add funds**. Confirm Stripe displays its Sandbox/Test context before submitting payment.
3. Use **4242 4242 4242 4242**, a future expiry such as **12/30**, CVC **123**, and a valid-format postal code if requested. Use no real card. Return to Wallet and verify the exact test credit; reload and confirm it was not duplicated.
4. For Dramio Pass, open **Creator studio → Get Dramio Pass · HK$88** and complete its separate test Checkout. Account should show **Active / Test pass** with 5 GiB storage; the USD wallet balance must stay unchanged.
5. With a publisher test account, upload compatible episodes and set free episodes/pricing. Use another viewer test account for paid unlocks. A US$0.10 unlock from a US$5 wallet leaves US$4.90, with US$0.07 publisher and US$0.03 platform test earnings. Reopening must not charge again.
6. Separately inspect Stripe's **Event deliveries** for the matching successful Checkout event. Verify direct HTTP 200 delivery, not only an application success redirect or reconciliation response.

Labelled sample previews remain free; payment configuration does not change sample pricing or existing uploads. Existing real publisher activation remains recognized automatically; a test pass remains labelled as such.

## Test catalogue and deployment settings

The existing test products are recorded in `stripe/catalog.test.json`. Their identifiers are non-secret and belong to test mode only.

| Product | Test product | Test price | Amount |
|---|---|---|---|
| Dramio Pass | `prod_VWA3RFHkUr0TuM` | `price_1UV7jBJ6Er233b9cr0ahOada` | HK$88 once |
| Wallet credit | `prod_VWA3U1So0O5Lqv` | `price_1UV7nXJ6Er233b9c4M2mAz87` | US$5 base/default |

The wallet's default price does not limit custom amounts: the server validates the viewer's USD cents and supplies its own `price_data.unit_amount` linked to the existing product. This buys closed-loop content credit, not a donation.

The Stripe API key and main endpoint signing secret remain encrypted Worker Secrets **`STRIPE_SECRET_KEY`** and **`STRIPE_WEBHOOK_SECRET`** on **`lingying`**. No key or signing secret belongs in Git, catalogue JSON, frontend code or command-line arguments.

After domain cutover, `APP_URL` and `PUBLIC_APP_URL` use **`https://lingyingdrama.com`**. **`STRIPE_SITE_ORIGIN` intentionally stays pinned to `https://aidramio.jimmy-tsoi2001.workers.dev` as an internal financial identity**. It supplies and validates Session `metadata.site`, allowing pending Sessions created before the browser/API domain move to settle. It is not the new webhook destination and does not tell browsers to use the old hostname. Do not rewrite this tag or convert test records for branding cleanup.

Check `/api/config` for `paymentsMode: "stripe"`, `paymentsReady: true`, `paymentsTestMode: true`, `sandbox: false` and `uploadsEnabled: true`. Follow [AGENTS.md](../AGENTS.md) for updating the existing Worker while retaining its namespace, bucket and provider secrets.

**Do not rerun `scripts/connect-stripe-main-test.mjs` to migrate this domain.** That historical bootstrap helper still targets the pre-rename `aidramio` Worker and old webhook URL. The name now belongs to the compatibility gateway, not the main application. Use the Dashboard endpoint-edit workflow above; the helper/catalogue require a separately reviewed update before reuse. No new test website or Sandbox is needed.

## Later: accept real money

For the exact Dashboard and secure Worker Secret steps, see [live Stripe setup](STRIPE_LIVE_SETUP.md). The current test notice stays truthful until the deployed credentials and mode are switched together.

A domain change does not authorize this step. Keep test mode while finishing the separate release work:

1. Resolve the refund/dispute reconciliation and other release blockers in [the production-readiness report](PRODUCTION_READINESS.md). Complete Stripe's actual business/bank setup and confirm card/currency/country support.
2. Configure a separate **live-mode** snapshot webhook at the custom-domain path, with the same four Checkout events and its own matching live signing secret.
3. Only when explicitly authorized, change `STRIPE_TEST_MODE=false` and securely configure matching live API/webhook credentials on **`lingying`**. Preserve its database/bucket, HTTPS origins and stable financial identity.
4. Replace optional test product/price IDs with live counterparts, or remove the optional IDs to use server-defined line items. The live activation price must remain HK$88 once.
5. Verify `paymentsReady: true`, `paymentsTestMode: false`; real financial records remain in their original tables. Never copy test credit, earnings, passes or purchases into real balances or entitlements.
6. Verify a deliberately authorized low-value live payment and actual provider delivery. Configure and verify Stripe Connect before live publisher transfers/bank payouts. Real payments, currency conversion and payouts can incur [Stripe fees](https://stripe.com/hk/pricing).

## Operational limits

Settlement verifies Stripe signatures, mode, recorded Session identity, amount, currency and paid status. A success redirect alone does not credit a wallet. Replays settle once, and episode wallet deductions/entitlements/revenue shares are transactional. Expired/failed events close only their matching pending payments.

**Automatic refund and dispute reconciliation is not implemented.** A refunded deposit does not automatically remove application wallet credit. A safe reconciliation implementation or proven operator compensation workflow is required before accepting real customers and approving live payouts. Final business/payment policies must also be completed by the operator.

## Official references

Reviewed 31 October 2026:

- [Manage event destinations in Workbench](https://docs.stripe.com/workbench/event-destinations)
- [Receive and verify webhook events](https://docs.stripe.com/webhooks)
- [Update an existing webhook endpoint](https://docs.stripe.com/api/webhook_endpoints/update)
- [Checkout fulfillment and return-page limits](https://docs.stripe.com/checkout/fulfillment?ui=full-page)
- [Payment-method domain registration for embedded forms](https://docs.stripe.com/payments/payment-methods/pmd-registration?dashboard-or-api=dashboard)
- [Optional paid custom domain for the hosted Checkout page](https://docs.stripe.com/payments/checkout/custom-domains?payment-ui=stripe-hosted)
