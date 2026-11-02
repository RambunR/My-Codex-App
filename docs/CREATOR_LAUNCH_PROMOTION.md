# Creator launch promotion

The creator launch code **LINGYING58** changes the one-time Dramio Pass charge from **HK$88 to HK$58**. At the configured HK$7.80 per US$1 indicative rate, the interface and promotion show approximately **US$11.28 → US$7.44**. Stripe still charges HKD; the card issuer determines any conversion and related fees.

Open [the creator offer](https://lingyingdrama.com/studio?promo=LINGYING58), register or sign in, confirm the displayed price, and continue to Stripe Checkout. The code can also be entered and applied in Creator Studio before opening Checkout. Registration from the offer preserves it. It is an application promotion code, not a separately created Stripe dashboard coupon or a code entered on Stripe's hosted page.

The offer is enabled on the existing production Worker through `PASS_PROMOTION_ENABLED=true`. No expiration date or redemption cap is configured. It applies to a new one-time Pass purchase, once per account, with no stacking, retrospective refund, wallet deposit discount or change to episode prices. Disable new discounted quotes by setting the variable to `false` and keeping the tracked configuration consistent. Already issued valid discounted Checkouts remain payable at their recorded price after the offer is disabled.

## Payment behavior

The server validates and normalizes the code, selects the exact 5,800 HKD-cent amount, and atomically stores an activation promotion quote. It uses the existing encrypted Stripe credentials and server-controlled inline pricing. The regular HK$88 Stripe product/price remains unchanged. Existing HK$88 Checkouts and receipts remain valid.

Signed settlement must match the recorded payment session, amount, currency and financial mode. A client-supplied discount or provider metadata alone cannot activate uploading. Retries use the existing payment and stable Stripe idempotency key. Competing requests at different prices cannot open a second activation Checkout. The interface asks the owner explicitly before closing a known unpaid older Checkout; completed or processing payments cannot be silently cancelled. After a provider timeout with an unknown Session, retry the original price/code to recover it before changing offers.

Test finance stays in separate tables. A successful Pass payment activates publishing; it does not add wallet credit, earnings or quota beyond the existing 5 GiB allowance. Wallet history reads the actual recorded activation amount, including older receipts beyond the latest 30 payments.

The existing three-minute and 75 MiB episode limits, content rules, 70% creator / 30% platform split, review holds and administrator access remain. Creator withdrawals remain independently paused by `PAYOUTS_ENABLED=false`. Earnings depend on paid audience purchases and are not guaranteed passive income or immediately withdrawable money.

## Instagram asset

- [Square PNG, 1254 × 1254](https://lingyingdrama.com/promotions/lingying-creators-launch-square.png)
- [Ready-to-copy caption](../public/promotions/instagram-caption.txt)

The PNG was generated for this campaign using the existing LingYing phoenix as a reference. The illustrated drama scenes are promotional artwork. It contains no fabricated platform engagement figures. The offer, indicative exchange rate, variable earnings and currently paused withdrawals are disclosed. Creating this file does not post to Instagram or purchase advertising.

Backend checks cover promo rejection, exact amounts, signed mismatch/replay, disabled-offer settlement, historical prices, timeout/concurrent retries, owner-scoped cancellation and test isolation. Browser checks cover registration continuity, apply/remove, exact receipts, disabled/stale offers, payment holds and phone layouts across English, Chinese and Arabic. The local Cloudflare smoke verifies the discounted quote, one activation, actual receipt and persistence after restart without a real payment.
