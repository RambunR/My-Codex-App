# Enable Google sign-in for AIDramio

The integration supports both Google registration and returning-user sign-in. The operator's **Client ID has been configured** from the Google-generated credential filename. **The Client secret is still missing**, so Google sign-in stays hidden until it is saved on the Cloudflare Worker. Real Google authorization has not yet been verified with the operator's OAuth client.

## 1. Create the Google OAuth client

Open the [Google Auth Platform](https://console.cloud.google.com/auth/overview), then select or create a project you control. Use the same project for the settings below.

In **Branding**, enter:

| Setting | Value |
|---|---|
| App name | `AIDramio` |
| User support email | Your monitored support email |
| Developer contact email | Your monitored contact email |
| Application home page | `https://aidramio.jimmy-tsoi2001.workers.dev/` |
| Privacy policy | `https://aidramio.jimmy-tsoi2001.workers.dev/privacy` |
| Terms of service | `https://aidramio.jimmy-tsoi2001.workers.dev/terms` |

For an optional logo, download the square transparent PNG from [aidramio-logo.png](https://aidramio.jimmy-tsoi2001.workers.dev/aidramio-logo.png) and upload that file in Google's logo field. The logo is a 1254 × 1254 PNG, about 389 KiB. Google may require brand verification before displaying custom branding publicly; the logo is optional for initial testing.

In **Audience**, choose **External** so the app can welcome viewers outside your organization. Start with **Testing** and add the Google email addresses you will use under **Test users**, including your own account. Do not choose Internal for a platform intended for the general public.

The app requests only `openid`, `email`, and `profile`. If configuring **Data Access**, use the corresponding basic identity scopes. Gmail, Drive, contacts, and other Google API permissions are unnecessary.

In **Clients**, select **Create client** and choose **Web application**. A name such as `AIDramio production website` is sufficient. Enter these exact values:

**Authorized JavaScript origin**

```text
https://aidramio.jimmy-tsoi2001.workers.dev
```

**Authorized redirect URI**

```text
https://aidramio.jimmy-tsoi2001.workers.dev/api/auth/google/callback
```

The origin has no path. The redirect includes `/api/auth/google/callback`, with no trailing slash. Save the client and retain its **Client ID** and **Client secret** securely.

## 2. Add both credentials to Cloudflare

Open [Cloudflare Workers for the confirmed account](https://dash.cloudflare.com/95040c4f244233138195b80657887486/workers-and-pages), select the Worker **aidramio**, then open **Settings → Variables and Secrets**.

Add these two bindings, choosing **Secret** for both:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The Google Web application's Client ID |
| `GOOGLE_CLIENT_SECRET` | Its matching Client secret |

Use **Save/Deploy** to apply the settings. Although the Client ID is public identification, storing it as a Worker Secret also preserves it during Wrangler deployments. A dashboard plaintext variable omitted from the repository configuration can be removed by a later deployment.

If you downloaded Google's `client_secret_…apps.googleusercontent.com.json` file, open its `web` object: `client_id` and `client_secret` map to the two bindings above. The Mac-local Downloads path is not mounted into this cloud workspace. The Client ID was already set from the supplied filename; only the `web.client_secret` value remains to be entered securely on the Worker. Do not upload the JSON into the public website or repository.

Do not paste either credential into chat, commit downloaded Google client JSON files, or place the Client secret in frontend code. These values belong directly in the Worker's secure settings. They are different from the Cloudflare API token used to deploy the site.

Production `APP_URL` is pinned to `https://aidramio.jimmy-tsoi2001.workers.dev`. The backend derives the callback from this URL. Both Google bindings must be present before `/api/config` reports `auth.google: true` and the viewer interface shows **Continue with Google**.

## 3. Test registration and sign-in

1. Open [AIDramio sign-in](https://aidramio.jimmy-tsoi2001.workers.dev/auth?next=%2Fwallet) in a fresh browser session and choose **Continue with Google**.
2. Select a Google account you added as a test user and complete Google's consent screen.
3. A new Google identity creates an ordinary viewer account and returns to the requested page, such as the wallet. Sign out and use Google again to verify that the same account returns.

Google registration creates no wallet credit, administrator access, or publisher activation. The HK$88 publisher activation and all other payment rules remain unchanged; live payments require their separate Stripe configuration.

If the Google email already belongs to an AIDramio password account, the site will ask you to sign in with that existing password first. Then open **Account → Connect Google**, confirm your current AIDramio password, and choose your Google account. This explicitly links the identities while retaining the same wallet, purchases, publisher status, and account ID. Matching email addresses never automatically merge accounts or grant access to another wallet.

## 4. Prepare a public release

When ready, review Google's **Audience** publishing controls and complete any requested brand verification. Google's [brand verification guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) requires verification of the top-private authorized domains through Search Console. The exact workers.dev callback above can be configured for initial testing; this guide does not claim that workers.dev is categorically prohibited. For a public branded release, a custom domain you control is the reliable route for proving ownership.

If you change domains, connect the domain in Cloudflare, update `APP_URL`, and add the new exact origin and callback to the Google client before moving users. Keep the home page, privacy policy, and terms links consistent with the live domain. The privacy page already describes the Google identity data used for sign-in; replace remaining operator/business placeholders before public release.

## Troubleshooting

| Symptom | Check |
|---|---|
| No Google button | Both Worker Secrets exist with their exact names, settings were deployed, and the page was reloaded. |
| `redirect_uri_mismatch` | The Google client has the exact callback above, including HTTPS and the full path, without an extra trailing slash. |
| Google blocks the test account | Audience is External/Testing and the selected Google account is listed as a test user; also review any Google organization restrictions. |
| Existing-email message | Sign into the existing AIDramio account with its password, then explicitly connect Google from Account. |
| Expired or changed-session message | Start again from AIDramio in the same browser; do not reuse callback links or switch/login/logout accounts during the flow. |
| Generic Google failure | Check that the Client ID and secret come from the same Web application client and that `APP_URL` matches its authorized callback. Do not share credentials or callback authorization codes in logs or chat. |

## Local development and future updates

Local Node development can read `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the ignored `.env` file; see `.env.example`. An optional separate development OAuth client can authorize `http://localhost:3000` and `http://localhost:3000/api/auth/google/callback` when `APP_URL=http://localhost:3000`. Use the same browser hostname throughout the flow. Keep development credentials outside Git and separate from the production client when practical.

To update the deployed code from `/workspace/My-Codex-App`, select the confirmed Cloudflare account explicitly:

```bash
CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 npm run deploy:cloudflare
```

Preserve `.cloudflare/deployment.json`. The command uses the secure Cloudflare deployment token already configured in the environment. Google Worker Secrets remain on the Worker across code updates. See [CLOUDFLARE.md](CLOUDFLARE.md) for deployment details.

Official references: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server), and [brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).
