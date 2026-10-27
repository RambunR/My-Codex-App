# Sign in with Apple

The application supports Apple registration and returning-user sign-in alongside Google and email/password. Apple remains unavailable until the operator configures all four Apple credential bindings; deploying the code alone does not register the application with Apple. No real Apple account or consent flow has been completed by the agent.

## Configure the Apple service

1. Sign into [Apple Developer](https://developer.apple.com/account/) as the Account Holder or an administrator. A suitable Apple Developer Program membership is required. Apple's [enrollment page](https://developer.apple.com/programs/enroll/) lists **US$99 per membership year**, with regional prices and eligible fee waivers. This is Apple's membership charge, not a Cloudflare login fee.
2. In **Certificates, Identifiers & Profiles → Identifiers**, create or select the primary App ID related to AIDramio and enable **Sign in with Apple** as a primary capability. Apple requires the web Services ID to be associated with an existing primary iOS, macOS, tvOS or watchOS App ID that has this capability enabled.
3. Create a **Services ID** for the website, using a unique identifier such as `com.yourcompany.aidramio.web`. This is the website's client ID; use the identifier actually registered to your Apple team.
4. Enable **Sign in with Apple** for that Services ID, choose **Configure**, and associate it with the primary App ID.
5. Register the website domain/subdomain and exact return URL:

   | Setting | Current main website |
   |---|---|
   | Domain/subdomain | `aidramio.jimmy-tsoi2001.workers.dev` |
   | Return URL | `https://aidramio.jimmy-tsoi2001.workers.dev/api/auth/apple/callback` |

   Use HTTPS and the exact callback path, without a trailing slash. Register a future custom domain and its corresponding return URL before changing `APP_URL`. Apple's current [web configuration guide](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/) says that no domain verification file upload is required; this guide does not claim that `workers.dev` is categorically prohibited. The old `aidramio-sandbox` is a separate application and is not the main site's callback.
6. Under **Keys**, create a key with **Sign in with Apple** enabled and associate the primary App ID. Download the `.p8` private key once and keep it securely. Retain its **Key ID** and your team's **Team ID**. See [Apple's private-key instructions](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/).

## Add the Worker credentials

Open **Cloudflare → Workers & Pages → aidramio → Settings → Variables and Secrets**. Add the following as encrypted **Secrets** on the existing main Worker:

| Binding | Value |
|---|---|
| `APPLE_CLIENT_ID` | The website Services ID |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_KEY_ID` | Key ID for the enabled Sign in with Apple key |
| `APPLE_PRIVATE_KEY` | The complete PKCS#8 `.p8` private key, including its BEGIN/END lines |

Real newlines or literal `\n` sequences in the private-key binding are supported. Never put the key in Git, a public asset, a screenshot or chat. The server generates a five-minute ES256 client-secret JWT for the authorization-code exchange, so an operator does not need to paste or periodically replace a pre-generated client-secret JWT.

After saving the bindings, `/api/config` should report `auth.apple: true`. Incomplete configuration keeps Apple unavailable. The normal application origin must remain HTTPS. A credential's presence does not prove that Apple has accepted the Services ID/domain/key combination; complete the interactive test below before advertising the option publicly.

## Verify sign-in and registration

1. Open the [main sign-in page](https://aidramio.jimmy-tsoi2001.workers.dev/auth?mode=login) and choose **Continue with Apple**.
2. Complete Apple's account selection and consent, testing **Share My Email** and **Hide My Email** when offered. A new Apple identity should create an ordinary viewer and return to the selected application page.
3. Sign out and use Apple again. The same Apple identity must return to the same AIDramio account, wallet and purchases, even when Apple no longer supplies the first-consent name.
4. Cancel Apple's flow and confirm the app displays cancellation without signing in. Reloading a consumed callback must not create another account or session.
5. If the Apple email already belongs to an email/password account, sign into that original account first and explicitly connect Apple with the current password. Email matches alone never merge or claim accounts.

An Apple relay address is stored as the account's email when chosen by the viewer; the app does not infer or request their hidden personal address. To send mail to `@privaterelay.appleid.com` recipients, separately register and authenticate the sending domain/address in **Sign in with Apple for Email Communication**. Apple's [private relay guide](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/) covers source registration and SPF/DKIM requirements. Configuring Cloudflare Email Sending or Resend alone does not configure Apple's relay allowlist.

## Implementation and validation

Apple's authorization response uses an HTTPS **POST** with `response_mode=form_post`. A separate short-lived, HTTP-only, Secure, `SameSite=None` cookie binds that cross-site callback to the browser. The normal AIDramio session stays `SameSite=Lax`; for explicit linking the server checks that the original bound session still exists rather than assuming that Lax cookie will accompany Apple's cross-site POST. Logout, password reset or session rotation invalidates pending authenticated attempts.

Only the exact Apple callback POST is exempt from the ordinary application-origin rule. Its one-use hashed state, browser binding, nonce, authorization-code exchange and signed ID-token verification still apply. Signed tokens are restricted to Apple's issuer, the configured Services ID, RS256, the current nonce, an unexpired issue/expiry window, a stable subject and a verified email. First-consent `user.name` is display data only; its unsigned email field never establishes identity. Provider access, refresh and ID tokens are not stored. Ordinary viewer sessions retain the existing private cookie policy.

Apple identities and OAuth attempts use additive tables alongside the existing Google identities. Existing user records, financial records and media are not migrated or merged. Automated checks mock Apple's HTTPS token/JWKS endpoints but create and verify real RSA/ES256 signatures. They cover registration, stable identities, email collisions, invalid claims/signatures, browser binding, expiration/replay, cross-site POST behavior, explicit linking and session revocation. These checks do not replace the operator's real Apple consent test.

Official references: [Configure Sign in with Apple for the web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/), [About Sign in with Apple](https://developer.apple.com/help/account/capabilities/about-sign-in-with-apple/), [Token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), [OpenID configuration](https://appleid.apple.com/.well-known/openid-configuration), and [Private email relay](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/).
