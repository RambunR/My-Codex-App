# Stripe testing on the existing LingYing website

**Live card Checkout is enabled on [LingYing](https://lingyingdrama.com)** with `PAYMENTS_MODE=stripe`, `STRIPE_TEST_MODE=false`, `STRIPE_AUTO_CONFIGURE_WEBHOOK=true`, optional test catalogue IDs cleared, and `PAYOUTS_ENABLED=false`. Deployment, public health/configuration and the live account/endpoint readiness check passed on 31 October 2026 at 19:39 Hong Kong time. Exactly one live US$5 Checkout displayed US$5.00, was cancelled without card entry/payment submission, and produced an actual signed expiration receipt at the custom domain at 19:40:49 Hong Kong time. The wallet remained zero with no funding ledger entry. Completed paid settlement remains unverified. Follow [STRIPE_LIVE_SETUP.md](STRIPE_LIVE_SETUP.md) for the current setup, seven Snapshot events and unpaid Checkout cancellation checks. Do not submit a test card to the live website.

The owner now authorizes a single mode switch on this same website. Follow [the current mode-switch guide](STRIPE_MODE_SWITCH.md): keep the live pair saved, add the dedicated test pair, and select `STRIPE_TEST_MODE=true` only for an intended testing period. This changes new Checkout for all visitors; do not create another public test website. The historical details below remain useful for test events and catalogue references but do not require overwriting the live credentials.

Test balances, passes, purchases and earnings stay in separate financial tables and never become live credit, real Dramio Pass ownership or payable creator revenue. Live payment mode does not alter account profiles, uploads, media or the original database namespace.

## Historical test webhook domain migration

During the test phase, the existing main test destination was moved from `https://aidramio.jimmy-tsoi2001.workers.dev/api/payments/webhook` to `https://lingyingdrama.com/api/payments/webhook`, preserving the destination identity and test signing secret. The owner reported saving that update; independent signed test delivery remained unverified. This describes the earlier migration, not an instruction to replace the current live Worker's credentials.

A test integration uses a destination in the **same Stripe testing environment as its test API key**, **Your account**, **Snapshot** payloads, a compatible API version and its own `whsec_...` signing secret. The Checkout lifecycle events are:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

The current risk-hold implementation also requires `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` when testing financial-risk handling. A thin-event destination, live destination secret and Stripe CLI listener secret are not interchangeable with the test Snapshot destination. On the existing `lingying` Worker, save test values as `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_WEBHOOK_SECRET`, retaining `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for live payments.

For an actual test event, inspect Stripe's **Event deliveries** and confirm direct HTTP 2xx, then confirm one application settlement. A success return can also reconcile the Session and does not independently establish webhook delivery. Keep legacy raw-body forwarding until the old registered destinations and old Checkout return links are retired; redirects alone do not satisfy webhook delivery.

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

## Try the payment flow after selecting test mode

1. On the existing website, select `STRIPE_TEST_MODE=true` using the saved dedicated test pair, reload, sign in, and confirm the test-payment notice. Open a fresh Checkout; an old live Checkout remains live. Google/Apple callback configuration is independent and does not change for this switch.
2. Open **Wallet**, enter US$5 or a custom amount such as US$23.45, and press **Add funds**. Confirm Stripe displays its Sandbox/Test context before submitting payment.
3. Use **4242 4242 4242 4242**, a future expiry such as **12/30**, CVC **123**, and a valid-format postal code if requested. Use no real card. Return to Wallet and verify the exact test credit; reload and confirm it was not duplicated.
4. For Dramio Pass, open **Creator studio → Get Dramio Pass · HK$88** and complete its separate test Checkout. Account should show **Active / Test pass** with 5 GiB storage; the USD wallet balance must stay unchanged.
5. With a publisher test account, upload compatible episodes and set free episodes/pricing. Use another viewer test account for paid unlocks. A US$0.10 unlock from a US$5 wallet leaves US$4.90, with US$0.07 publisher and US$0.03 platform test earnings. Reopening must not charge again.
6. Separately inspect Stripe's **Event deliveries** for the matching successful Checkout event. Verify direct HTTP 200 delivery, not only an application success redirect or reconciliation response.

Labelled sample previews remain free; payment configuration does not change sample pricing or existing uploads. Existing real publisher activation remains recognized automatically; a test pass remains labelled as such.

## Test catalogue and deployment settings

The historical test products are recorded in `stripe/catalog.test.json`. Their identifiers are non-secret and belong to test mode only.

| Product | Test product | Test price | Amount |
|---|---|---|---|
| Dramio Pass | `prod_VWA3RFHkUr0TuM` | `price_1UV7jBJ6Er233b9cr0ahOada` | HK$88 once |
| Wallet credit | `prod_VWA3U1So0O5Lqv` | `price_1UV7nXJ6Er233b9c4M2mAz87` | US$5 base/default |

The wallet's default price does not limit custom amounts: the server validates the viewer's USD cents and supplies its own `price_data.unit_amount` linked to the existing product. This buys closed-loop content credit, not a donation.

The existing encrypted **`STRIPE_SECRET_KEY`** and **`STRIPE_WEBHOOK_SECRET`** remain the live pair. Save test values separately as **`STRIPE_TEST_SECRET_KEY`** and **`STRIPE_TEST_WEBHOOK_SECRET`**. Keep `STRIPE_AUTO_CONFIGURE_WEBHOOK=true`: the application handles test readiness without running the live-only account/endpoint automation. No key or signing secret belongs in Git, catalogue JSON, frontend code or command-line arguments. Optional test products use `STRIPE_TEST_ACTIVATION_PRICE_ID` / `STRIPE_TEST_WALLET_PRODUCT_ID`, or leave these empty for inline pricing.

After domain cutover, `APP_URL` and `PUBLIC_APP_URL` use **`https://lingyingdrama.com`**. **`STRIPE_SITE_ORIGIN` intentionally stays pinned to `https://aidramio.jimmy-tsoi2001.workers.dev` as an internal financial identity**. It supplies and validates Session `metadata.site`, allowing pending Sessions created before the browser/API domain move to settle. It is not the new webhook destination and does not tell browsers to use the old hostname. Do not rewrite this tag or convert test records for branding cleanup.

After selecting test mode, check `/api/config` for `paymentsMode: "stripe"`, `paymentsReady: true` and `paymentsTestMode: true`. Production mode instead requires `paymentsTestMode: false` and `payoutsEnabled: false`. Follow [AGENTS.md](../AGENTS.md) for updating the existing Worker while retaining its namespace, bucket and provider secrets.

**Do not rerun `scripts/connect-stripe-main-test.mjs` to migrate this domain.** That historical bootstrap helper still targets the pre-rename `aidramio` Worker and old webhook URL. The name now belongs to the compatibility gateway, not the main application. Use the Dashboard endpoint-edit workflow above; the helper/catalogue require a separately reviewed update before reuse. No new test website or Sandbox is needed.

## Current live-card release

Live card Checkout is deployed with verified public configuration and in-Worker live account/endpoint readiness. Follow [the live setup guide](STRIPE_LIVE_SETUP.md) for the completed deployment and no-cost unpaid-Session/signed-delivery evidence. No card, payment submission, charge, funding or payout was performed. The live server verifies the existing account and one matching Snapshot endpoint, automatically appending only missing required events if key permissions allow. It preserves endpoint identity, signing secret and other settings. `paymentSetup` reports a safe status/code and blocks new Checkout until ready; see the live guide for restricted-key permission and manual fallback steps. No-cost verification opens and cancels unpaid live Checkout Sessions without submitting a card. Session creation/expiration alone does not prove delivery, but an actual signed expiration receipt in the owner-only payment-status response can verify custom-domain delivery without a charge. It does not prove paid settlement.

The live destination requires the four Checkout events above plus `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. The release's durable risk holds require administrator review and manual financial compensation; they do not automatically recover spent credit or creator earnings. Keep `PAYOUTS_ENABLED=false` while accepting card payments. Test balances/pass activation are never promoted to live records.

## Operational limits

Settlement verifies Stripe signatures, mode, recorded Session identity, amount, currency and paid status. A success redirect alone does not credit a wallet. Replays settle once, and episode wallet deductions/entitlements/revenue shares are transactional. Expired/failed events close only their matching pending payments.

**Full automatic refund/dispute compensation remains incomplete.** The live release adds durable risk holds and administrator review rather than silently accepting refund/dispute events. A hold does not automatically remove spent wallet credit, reverse creator earnings or reclaim earlier transfers; operators must perform and verify compensation before resolving affected holds. Creator payouts remain independently paused. Final business/payment policies and operational readiness still require work.

## Official references

Reviewed 31 October 2026:

- [Manage event destinations in Workbench](https://docs.stripe.com/workbench/event-destinations)
- [Receive and verify webhook events](https://docs.stripe.com/webhooks)
- [Update an existing webhook endpoint](https://docs.stripe.com/api/webhook_endpoints/update)
- [Checkout fulfillment and return-page limits](https://docs.stripe.com/checkout/fulfillment?ui=full-page)
- [Payment-method domain registration for embedded forms](https://docs.stripe.com/payments/payment-methods/pmd-registration?dashboard-or-api=dashboard)
- [Optional paid custom domain for the hosted Checkout page](https://docs.stripe.com/payments/checkout/custom-domains?payment-ui=stripe-hosted)
