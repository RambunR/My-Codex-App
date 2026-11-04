# Creator withdrawals and administrator sandbox testing

## Withdrawal policy

New requests have a **US$10 minimum**, a **US$1 fee included in the requested amount**, and a **3–5 day processing window after submission**. A US$10 request reserves US$10 and transfers US$9. The fee is not an additional US$1 debit. Rejection returns the full reserved amount once. Historical requests retain their original amounts with no retroactive fee.

`shared/withdrawals.ts` is the policy source. The earnings callout and confirmation dialog disclose the policy in all 21 interface languages. Gross, fee and net amounts are saved with the request and displayed in creator/administrator history. The owner chose to absorb Stripe costs: keep the quoted creator net separate from platform expenses, with no extra Stripe fee deducted from the creator’s withdrawal. Live fee-payer settings and overseas bank-credit guarantees remain unverified. Live creator withdrawals remain independently disabled by `PAYOUTS_ENABLED=false`; a transfer is not proof of bank settlement.

## Unlimited administrator test allowance

On 4 November 2026, the owner explicitly requested website sandbox withdrawals with unlimited test earnings for their administrator account. This uses a separate administrator-only workflow:

- Available only to the current immutable `PLATFORM_OWNER_USER_ID`, with a server-resolved administrator role, `PAYMENTS_MODE=stripe`, `STRIPE_TEST_MODE=true` and `STRIPE_TEST_PAYOUTS_ENABLED=true`.
- Studio displays **Unlimited test allowance / 無限測試額度**, rather than inserting a large number or Infinity into a real or test earnings balance.
- Each request still needs a finite amount: **US$10–US$100,000**. Stripe's supported integer amount limits remain enforced after conversion and simulated funding.
- Requests, immutable quotes, provider IDs and audit events are stored in `admin_test_withdrawals`, `admin_test_withdrawal_events` and `admin_test_payout_receipts`, bound to the owner, platform and connected account. No withdrawal amount is deducted from `users`, `test_accounts`, `ledger` or `test_ledger`.
- The ordinary `/api/studio/withdrawals` and live payout controls retain their existing pause/test guards. Other administrators and creators do not receive the unlimited allowance.
- Selecting live mode hides and denies these test controls. Previously issued sandbox bank-payout notifications can still reconcile their isolated test records using the saved test key.

### Current verified Stripe target

| Item | Identifier |
|---|---|
| Test platform | `acct_1StBIYJ6Er233b9c` |
| Owner's connected test recipient | `acct_1UXy05J6ErvOVs1A` |
| Intended website identity | Existing owner administrator, identified by the owner as `jimmytsoi` |

Read-only Stripe verification established account-read access, active transfers, payouts enabled, submitted details and no outstanding verification requirements. The account's returned legacy type is `none`; this workflow does not assume an Express Dashboard or use Express login links. Its test bank receives **HKD**.

The older context `acct_1StBIlJZDi49uXDa` and recipient `acct_1UXwKKJZDi5L4iq3` remain untouched. Credentials, account IDs and balances from those two test contexts must not be combined. The current workflow pins the verified platform and rejects another platform before provider writes.

### How the administrator tests

1. Sign in on **https://lingyingdrama.com** with the existing owner administrator account. Select **Studio → Earnings & payouts / 收益與提款** while Stripe test mode is enabled.
2. Confirm **Unlimited test allowance / 無限測試額度**, enter a finite USD amount and inspect gross, US$1 fee, net and test bank amount. The form displays the receiving currency’s localized name, symbol and ISO code from the verified connected account (currently HKD for the owner). The receiving currency follows the bank account, independently of the interface language or browser location; USD input and the US$1 fee stay in USD. For a US$20 request, the saved 7.8 test rate displays US$19 net and HK$148.20 HKD. Each history row continues to use its original saved bank currency and amount if the receiving account changes later. Submit the request.
3. Click **Process test withdrawal / 處理測試提領** on that request. Test requests can process immediately; the real policy's 3–5 day processing window does not introduce an artificial sandbox delay.
4. The application verifies the sandbox platform and recipient. If provider test funds are insufficient, it creates a **sandbox-only** funding charge using Stripe's fixed `tok_bypassPending` fixture. This never funds a customer wallet or credits creator earnings.
5. It transfers the saved net amount to the sandbox recipient, then submits a separate test bank payout. HKD uses the saved indicative test rate (`USD_TO_HKD`, currently 7.8), frozen when requested. For US$10, the quote is US$1 fee, US$9 net and HK$70.20 for the test bank. This is not a live foreign-exchange quote.
6. **Transferred to test Stripe account** is distinct from **Test bank payout pending** and **Paid**. Paid is shown only when Stripe reports the simulated bank payout as paid. **Refresh payout status** retrieves the provider's current status; failed bank payouts remain failed, including when Stripe disables that recipient's payouts.

Request retries reuse the saved amounts and stable funding/transfer/payout idempotency keys. A processing lease prevents overlapping attempts. An attempt older than 23 hours requires provider reconciliation before further writes because the original Stripe idempotency entry may expire. Pending requests can be rejected; requests with provider attempts require reconciliation. Automatic bank batches are linked through their transfer payment's balance transaction, rather than guessing from payout amounts.

## Runtime configuration and permissions

Preserve the live pair, `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, as encrypted Secrets. Save the dedicated test pair as encrypted Secrets under `STRIPE_TEST_SECRET_KEY` / `STRIPE_TEST_WEBHOOK_SECRET`.

| Setting | Administrator sandbox testing |
|---|---|
| `STRIPE_TEST_MODE` | `true`, Dashboard-owned; applies to all visitors' new customer Checkouts |
| `STRIPE_TEST_PAYOUTS_ENABLED` | `true`; independently gates the owner-only test allowance |
| `STRIPE_TEST_PAYOUT_ACCOUNT_ID` | `acct_1UXy05J6ErvOVs1A` |
| `PAYOUTS_ENABLED` | `false`; live creator withdrawals stay paused |
| `ENVIRONMENT` | `production`; authentication and hosting security stay unchanged |
| `STRIPE_TEST_CONNECT_WEBHOOK_SECRET` | Dedicated encrypted test Connect destination secret |

Configure the restricted test key on `acct_1StBIYJ6Er233b9c` with these columns:

| Resource | Normal permissions | Connect permissions |
|---|---|---|
| Accounts | Read | Not required |
| Balance / balance transactions | Read | Read |
| Charges | Write | Not required |
| Transfers | Write | Not required |
| Payouts | Not required | Write, including Read |

Charges Write supports automatic simulated funding. Webhook endpoint write permission is needed only for provisioning the test destination, not for ordinary withdrawal processing. Leave live keys unchanged.

The initial remote application-flow check accepted simulated funding but returned HTTP 403 for the transfer. After the owner confirmed the required test-key permissions were saved, the same retained request completed on **4 November 2026 at 08:34 UTC**:

- Gross US$200; saved US$1 fee; net US$199; saved HKD test bank amount **HK$1,552.20**.
- Test request `8a2de270-6cae-4080-9c78-fc2b058d6ef2`, transfer `tr_1UXzeCJ6Er233b9cPnC5jwC4`, bank payout `po_1UXzeEJ6ErvOVs1A7USTOZMn`.
- The process response was `payout_pending`; a subsequent provider status retrieval returned **`paid`**, with `livemode:false`.
- Verification used the application backend with a separate local audit database/session. A short-lived Cloudflare edge preview used the encrypted test key internally and forwarded only the saved request's bounded sandbox operations. No credential was exported, no production login was created, and no production earnings or wallet balance was changed. The preview was closed afterward; production version `e84471ed-3113-45d2-bf19-70717cc924d1` remained deployed.

This establishes the transfer and simulated bank-payout path with the saved permissions. It does not establish live settlement or signed Connect delivery; the paid status was retrieved directly from Stripe. The local verification request is not a production website history entry.

### Connect notifications

Use a separate **Connected accounts** test destination at:

```text
https://lingyingdrama.com/api/test-payouts/webhook
```

The dedicated test destination `we_1UXyrVJ6Er233b9czxGlQSs2` was provisioned on 4 November 2026 with `connect:true`. Subscribe to `account.updated`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed` and `payout.canceled`. Store its signing secret as `STRIPE_TEST_CONNECT_WEBHOOK_SECRET`. Keep the existing payment Snapshot destination and both live secrets intact. Do not replace unrelated webhook destinations.

The handler verifies the dedicated signature, requires `livemode:false`, scopes events to recorded test recipients, ignores unrelated accounts and suppresses duplicate receipts. It reconciles with the provider's current state instead of trusting delivery order. Manual **Refresh payout status** remains available alongside notifications.

## Validation and operator diagnostics

The implementation includes ownership/mode guards, wrong-sandbox/live-key rejection, finite minimum/maximum amounts, immutable fees/conversion, no real/test earnings mutation, duplicate/lost-response retries, fee-safe rejection, funding simulation, bank status/failure reconciliation, automatic payout batch matching and late signed test events after switching the UI to live mode.

Validation on 4 November 2026: 418 unit/API tests and the full 228-test browser suite passed; the Cloudflare build and full local Cloudflare integration smoke passed. The four new administrator browser journeys also passed separately after the final phone-layout adjustment. The retained remote sandbox request subsequently passed after the owner saved the required permissions, including a directly retrieved `paid` bank-payout status as recorded above. The receiving-bank currency display update passed all 418 unit/API tests, 13 affected browser journeys and the Cloudflare build; its rendered English desktop, Traditional Chinese phone and Arabic phone forms were inspected with a US$20 input and HK$148.20 HKD test bank amount.

Run `npm test`, `npm run build:cloudflare`, the affected administrator/withdrawal browser journeys, and `npm run test:cloudflare`. On slow cold builds, `CLOUDFLARE_TEST_STARTUP_TIMEOUT_MS=180000` extends only the local smoke startup allowance.

`scripts/verify-admin-test-payout.mjs` is an explicit opt-in remote **sandbox** backend integration check using a separate local database and local fixture session. It never opens a production session or modifies production financial records. Its US$200 request exercises funding replenishment as well as the US$1 fee, transfer and test bank payout. It uses a securely injected `STRIPE_TEST_SECRET_KEY` when available; compatibility access to an already-existing plain-text Worker variable is permitted only before that variable is secured. Never turn an encrypted Secret into a plain-text variable for this helper. It retains a local audit directory and can resume with `LINGYING_SANDBOX_CHECK_DIR` so a permission fix does not create a duplicate request. Test credentials are never printed or written into that directory.

Local/mocked checks and simulated Stripe bank payouts do not establish live international payout eligibility or real bank settlement. See [Stripe Connect testing](https://docs.stripe.com/connect/testing) and [the mode-switch guide](STRIPE_MODE_SWITCH.md).
