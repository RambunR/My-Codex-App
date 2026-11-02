# Dramio Pass promo management

Administrators manage codes at **[Admin → Promo codes](https://lingyingdrama.com/admin?tab=promotions)**. Codes are shared externally, such as on social media. The public website does not advertise a code, prefill a code from a URL, show the launch-offer hint, or expose its value in public configuration.

## Manage a code

1. Sign in with an administrator account and open **Promo codes**.
2. Choose **Create promo code**, or **Edit** an existing card. Codes use 3–32 letters, numbers, underscores or hyphens and are normalized to uppercase. A saved code cannot be renamed; disable it and create another when needed.
3. Choose **HKD amount off** or **Percentage off**. For example, HK$30 off the regular HK$88 Pass produces HK$58, approximately US$7.44 at HK$7.80/US$1. The actual Stripe charge is HKD; card conversion can differ. The editor previews both amounts.
4. Leave **Unlimited** selected for unlimited redemptions overall. Each account still buys the one-time Pass only once. Alternatively, set a finite redemption cap. Pending Checkouts reserve uses; each completed payment counts once. The limit cannot be reduced below paid plus pending uses.
5. Enable or disable a code with the card's control. Every creation and edit records an administrator audit event. Paid and pending counts are scoped to the current live/test financial mode.

**LINGYING58** is imported once from the earlier launch offer, with **HK$30 off, enabled, unlimited redemptions**, using the existing `PASS_PROMOTION_ENABLED=true` value for that initial import. After initialization, database settings are authoritative. Redeploying with the same flag never reverses an administrator's edit or re-enables a disabled code. The bootstrap flag is no longer the ongoing management control.

Stripe's documented HKD minimum charge is **HK$4.00**, checked at [supported currencies](https://docs.stripe.com/currencies) on 2 November 2026. Discounts must leave at least that amount: HKD discounts up to HK$84, or whole-number percentage discounts up to 95%. Free Pass codes and wallet-funding discounts are not supported by this flow.

Disabling or editing a code affects new quotes. Already issued valid Checkouts retain their recorded price and can still settle; existing paid Passes are not revoked or refunded. Closing an unpaid Checkout requires the owner's explicit confirmation. A completed or processing payment is never silently cancelled. After a provider timeout with an unknown Session, recover the original checkout before changing its price.

## Viewer redemption

A viewer enters the externally shared code in the blank **Promo code** field in Creator Studio and chooses **Apply code**. Sign-in is required for validation. A manually entered code can be retained in this browser tab for 30 minutes through registration; it is consumed once after sign-in and is never put into a registration URL or advertised automatically. Old `?promo=` links do not prefill or apply codes.

The server returns the current code, exact HKD amount and revision. It creates no payment or reservation during a quote. A changed code, disabled code, exhausted cap or stale revision requires reapplying before payment; the website never quietly charges a revised discounted price. Checkout reserves a capped use atomically and rejects a competing price for an already pending Pass purchase.

## Stripe and receipts

No separate Stripe coupon or promotion-code object is required. The existing integration validates the application code and creates an inline-priced Checkout with the exact HKD amount. The regular HK$88 Stripe product/price remains unchanged. The existing encrypted keys and webhook stay in place.

Checkout pre-fills the authenticated account's stored email. For successful payment receipts, enable **Stripe → Settings → Customer emails → Successful payments**. This is separate from account registration verification and does not require an application email-provider key. See [email and receipt setup](EMAIL_AUTH.md). A separate branded “Dramio Pass activated” welcome email has not been implemented; do not imply it is sent.

## Financial preservation

Promo definitions, immutable quote snapshots, initialization marker and audit events use additive tables. Legacy HK$88 and previously issued static HK$58 quotes remain valid. Server settlement validates the stored session, amount, currency and financial mode; provider metadata or a client amount alone cannot create a discount or activate uploads. Retries retain stable Stripe idempotency keys.

Test payments and entitlements stay separate from live balances and Passes. A Pass activation does not fund the viewer wallet, create earnings or increase the existing 5 GiB quota. The three-minute and 75 MiB episode limits, moderation/payment-review holds, administrator upload permission and 70/30 episode revenue split remain in force. **Creator withdrawals remain paused** by `PAYOUTS_ENABLED=false`.

The earlier [square social-media PNG](../public/promotions/lingying-creators-launch-square.png) and [caption](../public/promotions/instagram-caption.txt) remain available as external campaign files. They are not placed in public application pages. Update social-media artwork manually when changing the advertised code or discount; there is no Instagram posting or paid-ad automation.
