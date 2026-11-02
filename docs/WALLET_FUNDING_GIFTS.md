# Wallet funding gifts

The quick amounts are **US$10, US$25, US$50 and US$100**, with US$10 selected initially. US$5 has been removed from the quick buttons; custom funding still starts at the existing US$5 minimum.

| Payment | Gift credit | Total wallet credit |
| --- | --- | --- |
| US$50 | US$5 | US$55 |
| US$100 | US$15 | US$115 |

Only these exact payment amounts qualify, including matching custom amounts. Other amounts receive their paid amount without a gift. Gift icons appear on qualifying quick buttons, and the selected payment, gift and total are shown before Checkout. The gift can unlock paid episodes; it does not activate publishing, become viewer earnings or authorize a withdrawal.

The existing Stripe integration charges the payment amount shown above. It uses a server-controlled inline description showing paid, gift and total credit, so no new Stripe product or coupon needs to be created. Local demo confirmation displays the same server quote. Production credit still requires a verified paid Checkout event or owner reconciliation; a successful browser redirect alone cannot add money.

Each new funding payment receives an immutable, versioned server quote bound to its payment, user, amount and live/test partition. Historical pending payments without a quote retain their original credit and receive no retroactive gift. Client fields and Stripe metadata cannot invent rewards. Settlement adds the payment and gift atomically and once; `funding` and `funding_bonus` ledger entries keep the paid and promotional amounts separate. Safe-integer balance checks include both amounts. Live/test wallets and entitlements remain isolated.

Refunds and disputes create the existing financial review hold without automatically debiting wallets or reversing creator earnings. A positive refund/dispute forfeits the original promotional gift. Administrators must explicitly recover the remaining cash and gift exposure or accept a recorded platform loss. Separate gift allocations prevent multiple partial or overlapping cases from recovering the same gift twice. A verified dispute-won reversal returns only recorded deductions and reopens any uncovered sibling review. Private review screens identify the original gift. These actions are audited and do not enable creator payouts.

The rules are implemented in `shared/funding-rewards.ts` and the immutable proof in `server/funding-rewards.ts`. Preserve historical offer versions and proof records when changing future offers. Do not add a promotion to old payments by looking only at their amount.
