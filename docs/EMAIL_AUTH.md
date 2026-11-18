# Account email and Dramio Pass payment receipts

The main LingYing application at **https://lingyingdrama.com** includes **Forgot password**, **Reset password**, **Resend verification email**, and **Verify email**. A new password registration queues a verification message when email delivery is configured. Account displays whether its current email is verified. These controls do not force existing accounts to verify before they can sign in or remove their wallets, purchases, uploads or Dramio Pass.

Account mail on the main LingYing Worker uses the [Cloudflare Email Sending binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) once its sender domain is verified. The application also supports Cloudflare REST and Resend for other deployments. The Worker binding sends without an API key and uses the existing website and database.

## Which email is being set up?

| Message | Implementation and setup |
|---|---|
| Registration verification and password recovery | Implemented in LingYing. Enable the Cloudflare binding after the sending domain is verified. |
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

The main Worker uses the sender **LingYing <accounts@contact.lingyingdrama.com>**. Its `ACCOUNT_EMAIL` binding is restricted to that sender address and can send to registered users on Workers Paid. [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) includes 3,000 outbound emails per account per month on this plan.

1. In [Cloudflare Email Service → Email Sending](https://dash.cloudflare.com/?to=/:account/email-service/sending), choose **Onboard Domain** and select **contact.lingyingdrama.com**. Review the outbound verification and bounce DNS records Cloudflare adds. Existing inbound mail uses its own DNS records.
2. Confirm the exact domain shows as enabled for sending and its DNS checks pass. While onboarding is pending, keep the main Worker's tracked `EMAIL_PROVIDER=disabled`. Resend is not selected for production.
3. Set the tracked `EMAIL_PROVIDER=cloudflare-binding` and deploy the existing Worker. Keep `MAIL_FROM=LingYing <accounts@contact.lingyingdrama.com>` and the sender restriction in `wrangler.jsonc` in sync. The binding accepts messages only when Cloudflare returns a message ID. A real inbox check may still be needed to verify delivery.

A separate installation that uses Cloudflare's REST transport can select `EMAIL_PROVIDER=cloudflare` and provide its account ID in `CF_EMAIL_ACCOUNT_ID` and an encrypted `CF_EMAIL_API_TOKEN` scoped to Email Sending. LingYing's main Worker uses the binding.

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

`EMAIL_PROVIDER=cloudflare-binding`, `cloudflare` or `resend` selects the Worker binding, Cloudflare REST or Resend respectively and requires its complete configuration. `auto` (the default) selects Cloudflare when both Cloudflare email credentials are present, otherwise Resend. An invalid Cloudflare account ID keeps that selection unavailable; it is never interpolated into an unsafe API URL. `disabled` makes account-email sending unavailable. An attempted provider send is never automatically retried through the other provider, preventing duplicate messages and misleading acknowledgements.

Keep both **`APP_URL=https://lingyingdrama.com`** and **`PUBLIC_APP_URL=https://lingyingdrama.com`**. The sender domain and application domain do not need to match; changing email providers must not move the website to a `workers.dev` address. After configuring the chosen service:

1. Confirm `/api/config` reports `auth.email: true`. This means the required configuration is present; the provider's entitlement, verified sender and actual delivery still need an end-to-end check.
2. Register a controlled test account, open its verification email, and choose **Verify email**.
3. Request a password reset, choose a new password, and confirm that the old password and earlier sessions no longer work.
4. Check the chosen provider's delivery logs if mail is not received, including spam folders, entitlement and sender/DNS verification. The app's sanitized operational warning deliberately omits recipient data and provider response bodies.

Do not paste API keys into chat, Git, the browser frontend, or tracked Wrangler configuration. A Worker deployment preserves existing encrypted secrets. The legacy `aidramio-sandbox` is separate and is not automatically configured by changing the main Worker.

[Private relay delivery](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/) to Apple Hide My Email addresses requires Apple sender configuration as well.

## Behavior and limits

- Public email-request endpoints return the same acknowledgement for an eligible account, unknown email, provider-only account, already-verified account, request cooldown and a later delivery failure. The acknowledgement means the request was accepted, rather than proving that an account exists or a message was delivered. Email is queued outside the HTTP response path, with Cloudflare `waitUntil` keeping the provider request alive.
- Without the selected transport and sender, requests return `MAIL_UNAVAILABLE` and the public configuration keeps the sending controls unavailable. Provider rejection produces a sanitized operational warning without logging the email, API key, token or provider response body. Failed delivery leaves no usable newly issued proof.
- Requests have a one-minute cooldown per normalized email and purpose and a maximum of five sends per hour for that target. These limits are stored durably, including unknown email requests. The normal API/IP rate limits also apply. A new resend replaces the earlier verification proof for that account.
- Reset links expire in **30 minutes**. Verification links expire in **24 hours**. Only random proof hashes are stored. Links place the proof in a URL fragment, such as `/auth?mode=reset#token=…`, so it does not reach HTTP access logs. The browser removes it promptly and submits it only when the user explicitly confirms; opening a link does not consume it through a GET request.
- Successful reset consumes its proof atomically, hashes the new password, verifies the proven account email, and invalidates all sessions and outstanding Google/Apple browser-bound attempts for that account. Concurrent/replayed proofs cannot reset twice. A changed email or password invalidates an older reset proof.
- An account originally created only through Google or Apple remains a provider account. Password recovery does not silently add a new password to it or merge accounts by email. Use its linked provider to sign in.
- A verified Google profile or Apple identity can verify the exact email attached to that same LingYing account. Linking a provider with a different email does not verify the application's existing email address. Previously stored matching Google identities retain their verified status.
- Transactional email copy is currently in English; the application forms and statuses use the supported interface translations. Messages include both plain text and escaped HTML, the trusted configured application origin, and no wallet or episode-purchase details.

## Validation

`tests/email-auth.test.ts` uses a mocked Cloudflare Worker binding and REST transports with a temporary SQLite database. It checks unavailable configuration, explicit/automatic provider selection without post-attempt fallback, Cloudflare queued/delivered results and rejected/bounced/mismatched results, generic acknowledgements and cooldowns, hashed proofs and fragment links, atomic concurrent reset, expiry, wrong-purpose and changed-email rejection, session invalidation, preserved account assets, provider-only safeguards, failed delivery, persistent target budgets, matching Google verification and registration resilience. No real email is sent by these tests.

WeChat website registration also uses this configured sending service for a six-digit inbox code before user/identity creation. It does not fall back to an unverified contact email when delivery is unavailable. Existing WeChat-linked sign-in remains independent of email delivery. See [WeChat sign-in](WECHAT_SIGN_IN.md).
