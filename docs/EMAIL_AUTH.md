# Account email and Dramio Pass payment receipts

The main LingYing application at **https://lingyingdrama.com** includes **Forgot password**, **Reset password**, **Resend verification email**, and **Verify email**. A new password registration queues a verification message when email delivery is configured. Account displays whether its current email is verified. These controls do not force existing accounts to verify before they can sign in or remove their wallets, purchases, uploads or Dramio Pass.

The delivery integration supports [Cloudflare Email Service Sending](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/) and [Resend](https://resend.com/docs/api-reference/emails/send-email) from the existing Worker over HTTPS. It does not require another website or database. Delivery remains unavailable until a supported service has a real API token and verified sender configured; a visible button alone does not mean public emails can be delivered.

## Which email is being set up?

| Message | Implementation and setup |
|---|---|
| Registration verification and password recovery | Implemented in LingYing. Configure Cloudflare Email Sending or Resend below. The last inspected production configuration has no delivery token, so actual sending remains unavailable. |
| Dramio Pass payment receipt | Sent by Stripe after a successful payment when its **Successful payments** customer-email setting is enabled. Checkout is supplied with the authenticated account's email. This does not require the application's Cloudflare/Resend sending credential. |
| Branded “Your Dramio Pass is activated” welcome email | Not implemented. Enabling verification email or a Stripe receipt does not create this separate application message. |

Google and Apple sign-ins can already prove the account's matching provider email; they do not receive a redundant password-registration verification message. A paid Pass remains activated even if a later receipt cannot be delivered.

## Enable Stripe payment receipts

1. Open the intended **live** Stripe account and go to **Settings → Customer emails**. Depending on the dashboard layout, this appears under **Business**.
2. Enable **Successful payments**. Configure the business/support details and receipt branding as desired. See [Stripe's receipt documentation](https://docs.stripe.com/receipts).
3. LingYing supplies Checkout with the signed-in account's stored email. The receipt reflects the amount actually paid, including a valid Dramio Pass discount. A registration, unpaid Checkout, cancelled Checkout or failed payment does not prove a successful purchase and must not be described as one.
4. Confirm the setting and eventual delivery in Stripe's payment/customer-email logs. Do not charge a live card just to check the setting; receiving a real paid receipt remains unverified until an actual authorized payment occurs. Isolated test-mode email behavior can differ from live sending.

Stripe handles these payment receipts separately from account verification, password recovery and any future branded activation email. No additional Stripe coupon is required for LingYing's application-managed promo codes.

## Connect Cloudflare Email Sending

Cloudflare can send the application's recovery and verification emails. Its **Email Sending** service is different from inbound Email Routing forwarding and the earlier restricted `send_email` capability. Confirm the account's current Sending entitlement, plan and recipient restrictions in the Cloudflare dashboard and [Email Service documentation](https://developers.cloudflare.com/email-service/). Historical beta allowances and pricing have not been reverified for this setup; restricted verified-recipient sending alone does not establish support for arbitrary public users.

The operator selected **`hknovaxrproduction.com`**, with sender **`LingYing <accounts@hknovaxrproduction.com>`**. The tracked main configuration selects Cloudflare Email Sending and this sender. The application stays at **https://lingyingdrama.com** on the existing **`lingying`** Worker. Buying another domain or creating a mailbox is unnecessary for sending.

Domain selection is not delivery activation. Earlier deployment-credential reads of this zone's DNS, Email Sending onboarding and API-token management returned HTTP 403. The last inspected production secret-name list contains neither `CF_EMAIL_API_TOKEN` nor `RESEND_API_KEY`. Sender-domain onboarding and the scoped delivery credential must be completed before `auth.email` can become true. Existing DNS/mail records have not been changed, and no subscription has been upgraded. Previously observed Google mail MX records and DMARC settings must be preserved while onboarding outbound sending.

1. In **Email Service → Sending**, complete onboarding and the sender-domain verification/DNS steps for **hknovaxrproduction.com**. Add only the records requested for outbound verification; do not replace existing Google MX or unrelated mail records. A dedicated sending subdomain is an alternative, but `MAIL_FROM` must then use that verified subdomain.
2. Confirm the account has the required current plan and Sending entitlement, including sending to arbitrary registered users. Review the provider's current pricing and limits before accepting a paid plan. This implementation does not upgrade a subscription or verify this account's entitlement merely from a deployment token.
3. Create a narrowly scoped Cloudflare API token with **Account → Email Sending → Edit** for the intended account. This token is a separate delivery credential; do not reuse a broad deployment token merely because one is available.
4. In **Workers & Pages → lingying → Settings → Variables and Secrets**, add or confirm:

   | Setting | Type | Value |
   |---|---|---|
   | `EMAIL_PROVIDER` | Variable | `cloudflare` |
   | `CF_EMAIL_ACCOUNT_ID` | Variable | `95040c4f244233138195b80657887486` for the existing Jimmy account |
   | `CF_EMAIL_API_TOKEN` | Secret | The token with Email Sending Edit permission |
   | `MAIL_FROM` | Variable or Secret | `LingYing <accounts@hknovaxrproduction.com>` after onboarding that domain |

5. Save/deploy the configuration and follow the testing steps below. If Cloudflare reports that the account is not entitled or the sender is not verified, complete provider onboarding before expecting messages to arrive. A HTTP 200 response alone does not establish delivery: the app also requires Cloudflare's successful result to list the requested recipient as delivered or queued, and rejects permanent bounces.

## Connect Resend instead

1. Create or use a Resend account and [add a domain you control](https://resend.com/docs/dashboard/domains/introduction). Add the requested DNS records at that domain's DNS provider, then wait for Resend to verify the sending domain. A separate sending subdomain such as `mail.example.com` is useful, but use a domain you actually own.
2. Create a Resend API key with permission to send from that domain. The provider's default onboarding/test sender cannot send password recovery to arbitrary public users; verify your own sending domain before enabling the feature publicly.
3. In **Cloudflare → Workers & Pages → lingying → Settings → Variables and Secrets**, add:

   | Setting | Type | Value |
   |---|---|---|
   | `EMAIL_PROVIDER` | Variable | `resend` |
   | `RESEND_API_KEY` | Secret | Your real email-sending API key |
   | `MAIL_FROM` | Variable or Secret | For example, `LingYing <accounts@mail.your-domain.example>` using the verified sender domain |

4. Save/deploy the Worker configuration and follow the testing steps below. Check [Resend's current pricing](https://resend.com/pricing) and usage limits before selecting a plan. This integration does not claim a particular account has free delivery or unlimited messages.

## Select and test delivery

`EMAIL_PROVIDER=cloudflare` or `resend` explicitly selects one service and requires its complete configuration. `auto` (the default) selects Cloudflare when both Cloudflare email credentials are present, otherwise Resend. An invalid Cloudflare account ID keeps that selection unavailable; it is never interpolated into an unsafe API URL. `disabled` makes account-email sending unavailable. An attempted provider send is never automatically retried through the other provider, preventing duplicate messages and misleading acknowledgements.

Keep both **`APP_URL=https://lingyingdrama.com`** and **`PUBLIC_APP_URL=https://lingyingdrama.com`**. The sender domain and application domain do not need to match; changing email providers must not move the website to a `workers.dev` address. After configuring the chosen service:

1. Confirm `/api/config` reports `auth.email: true`. This means the required configuration is present; the provider's entitlement, verified sender and actual delivery still need an end-to-end check.
2. Register a controlled test account, open its verification email, and choose **Verify email**.
3. Request a password reset, choose a new password, and confirm that the old password and earlier sessions no longer work.
4. Check the chosen provider's delivery logs if mail is not received, including spam folders, entitlement and sender/DNS verification. The app's sanitized operational warning deliberately omits recipient data and provider response bodies.

Do not paste API keys into chat, Git, the browser frontend, or tracked Wrangler configuration. A Worker deployment preserves existing encrypted secrets. The legacy `aidramio-sandbox` is separate and is not automatically configured by changing the main Worker.

[Private relay delivery](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/) to Apple Hide My Email addresses requires Apple sender configuration as well.

## Behavior and limits

- Public email-request endpoints return the same acknowledgement for an eligible account, unknown email, provider-only account, already-verified account, request cooldown and a later delivery failure. The acknowledgement means the request was accepted, rather than proving that an account exists or a message was delivered. Email is queued outside the HTTP response path, with Cloudflare `waitUntil` keeping the provider request alive.
- Without the key and sender, requests return `MAIL_UNAVAILABLE` and the public configuration keeps the sending controls unavailable. Provider rejection produces a sanitized operational warning without logging the email, API key, token or provider response body. Failed delivery leaves no usable newly issued proof.
- Requests have a one-minute cooldown per normalized email and purpose and a maximum of five sends per hour for that target. These limits are stored durably, including unknown email requests. The normal API/IP rate limits also apply. A new resend replaces the earlier verification proof for that account.
- Reset links expire in **30 minutes**. Verification links expire in **24 hours**. Only random proof hashes are stored. Links place the proof in a URL fragment, such as `/auth?mode=reset#token=…`, so it does not reach HTTP access logs. The browser removes it promptly and submits it only when the user explicitly confirms; opening a link does not consume it through a GET request.
- Successful reset consumes its proof atomically, hashes the new password, verifies the proven account email, and invalidates all sessions and outstanding Google/Apple browser-bound attempts for that account. Concurrent/replayed proofs cannot reset twice. A changed email or password invalidates an older reset proof.
- An account originally created only through Google or Apple remains a provider account. Password recovery does not silently add a new password to it or merge accounts by email. Use its linked provider to sign in.
- A verified Google profile or Apple identity can verify the exact email attached to that same LingYing account. Linking a provider with a different email does not verify the application's existing email address. Previously stored matching Google identities retain their verified status.
- Transactional email copy is currently in English; the application forms and statuses use the supported interface translations. Messages include both plain text and escaped HTML, the trusted configured application origin, and no wallet or episode-purchase details.

## Validation

`tests/email-auth.test.ts` uses mocked Cloudflare/Resend HTTPS transports and a temporary SQLite database. It checks unavailable configuration, explicit/automatic provider selection without post-attempt fallback, Cloudflare queued/delivered results and rejected/bounced/mismatched results, generic acknowledgements and cooldowns, hashed proofs and fragment links, atomic concurrent reset, expiry, wrong-purpose and changed-email rejection, session invalidation, preserved account assets, provider-only safeguards, failed delivery, persistent target budgets, matching Google verification and registration resilience. No real email is sent by these tests.
