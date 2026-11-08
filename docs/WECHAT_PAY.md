# WeChat Pay through Stripe

The owner enabled mainland WeChat Pay in Stripe and approved it for both Dramio Pass and wallet funding on 8 November 2026. `STRIPE_WECHAT_PAY_ENABLED=true` enables a payment-method choice on the existing site. It does not select test/live mode, enable Alipay, change creator payouts or change card billing. The existing Dashboard-owned `STRIPE_TEST_MODE` continues to select encrypted credentials and financial tables.

For this Hong Kong Stripe merchant, WeChat Checkout charges **HKD**, not USD. Dramio Pass retains its HK$88 regular price, immutable promotional prices and required creator consent. Card funding continues charging USD. WeChat funding uses the explicitly approved configured `USD_TO_HKD=7.8`: **HK$78 buys US$10 credit**, and HK$390/780 buy US$50/100 before their existing US$5/15 wallet gifts. WeChat presents the customer's CNY conversion and terms; the website does not promise an exact CNY amount. Location-based display estimates are never used to calculate these charges.

## Quotes and settlement

The authenticated, same-origin `POST /api/payments/wechat/quote` accepts the requested USD cents. It returns a 15-minute quote containing the HKD charge, USD principal, integer rate and opaque ID. The form displays these terms before opening Checkout. The server snapshots the actor and financial mode; it never accepts a client exchange rate or HKD charge. Charges round half up to HKD cents using integer arithmetic and must fit Stripe's eight-digit amount limit. Expired unbound quotes require a fresh quote and a second confirmation.

`payment_checkout_methods` records each new payment's method. `wechat_funding_quotes` binds the original FX quote to one payment atomically with its existing immutable funding-gift proof. Once bound, the original quote remains authoritative for retry and settlement even after expiry or a configured-rate change. Retries reuse the payment ID and Stripe idempotency key. An expired, cancelled, failed or previously paid funding checkout needs a new quote before another purchase. Legacy rows without a recorded method retain card behavior.

WeChat Sessions explicitly use `payment_method_types: ['wechat_pay']` and `payment_method_options.wechat_pay.client: 'web'`. Card Sessions retain `['card']`, including eligible Apple Pay and Google Pay. Changing an unpaid Pass checkout's method uses the existing explicit cancellation/replacement flow; it never silently expires a known unpaid purchase.

Payment records and provider links store the actual HKD charge. Wallet principal, gifts, purchases and the 70/30 ledger remain USD. Only verified paid settlement grants credit. Settlement verifies Session ID, original amount and currency, selected method and metadata, owner, FX quote and gift proof. Repeated deliveries cannot credit twice; late signed events use their originating financial partition. Unpaid, failed and expired events grant no credit.

## Refund and dispute review

Signed refund events retain their actual HKD amount and create a manual review hold. They do not automatically debit a wallet. For validated WeChat funding, review amounts and wallet inputs are explicitly **USD** using the original quote's charge-to-credit ratio. Partial refunds round down to USD cents; a cumulative full refund reaches the exact original principal. Gift allocations remain separate and globally capped across cases. Existing explicit administrator notes, confirmation, available-balance checks, platform-loss decisions and verified provider-reversal safeguards still apply. Pass reviews remain HKD and cannot debit a USD wallet.

## Validation and operation

Run `npm test`, `npm run build:cloudflare`, the relevant Playwright suites and `npm run test:cloudflare`. The local suites cover quoted conversion, ownership, expiry, mode separation, immutable terms, retries, signed settlement, replay, gifts, manual HKD-to-USD refund reconciliation, existing cards and creator consent. Cloudflare smoke checks exercise quote creation in Durable Object SQL without creating a real payment or wallet credit.

During setup, bounded temporary Cloudflare previews verified mainland WeChat Pay as available/on in both saved Stripe modes on the existing merchant. Actual sandbox hosted Sessions displayed HK$78 funding and HK$88 Pass with WeChat Pay. A separate bounded test PaymentIntent returned `requires_action` with `wechat_pay_display_qr_code` and a QR image, then was cancelled successfully. Automated hosted-browser inspection remained at the provider Processing step, so a completed hosted authorization was not claimed. Probe Sessions use foreign metadata, no website login or database, and are expired after inspection. This establishes sandbox integration, not a completed real customer payment or bank settlement. Preserve the live/test keys, legacy financial identity, APP namespace, media bucket, current mode and paused live payouts when deploying with `--keep-vars`.
