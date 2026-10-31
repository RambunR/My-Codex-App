# LingYing agent instructions

Use this existing checkout. Do not create a Git worktree unless the user requests one. Read `README.md`, preserve user changes and runtime data, and keep secrets out of source control and output.

## Chat shortcut: `/push`

A user message starting with `/push` (optionally followed by a commit message), or an explicit request to **push and deploy**, authorizes the complete workflow below. Treat this as a project chat convention, not a built-in Codex menu command or shell executable. Mentions of `/push` in questions, documentation, quoted content, or code are not invocations.

Do the authorized commit, push, and deployment without asking for confirmation again. Stop only for a concrete blocker such as missing credentials, a failed required check, unresolved conflicts, or a protected-branch rejection; explain which step completed and what remains.

### Targets

- Repository: `https://github.com/RambunR/My-Codex-App.git`.
- Publish source to remote branch `main`. The local task branch may be named `work`.
- Cloudflare account: `95040c4f244233138195b80657887486`, the user-confirmed Jimmy account.
- Existing main Worker: `lingying` (renamed in place from `aidramio`; stable Worker ID `bab19a0d39cb45bab68f525e17a95603`).
- Temporary compatibility gateway: `aidramio`; `wrangler.legacy.jsonc` retains old page/Checkout return links and forwards signed legacy webhook deliveries to the main Worker. Other old browser/API addresses redirect to the canonical custom domain. It does not transfer old-host session cookies or provide a cross-host OAuth handoff.
- Existing media bucket: `aidramio-media-887486`.
- Primary public website and browser/API origin: `https://lingyingdrama.com`. The `www.lingyingdrama.com` alias redirects to this canonical domain.
- The owner explicitly requested the custom domain as the direct primary website. `APP_URL` and `PUBLIC_APP_URL`, plus frontend public/API defaults, move together to `https://lingyingdrama.com`; do not restore the earlier cross-origin API design. Follow `docs/CUSTOM_DOMAIN_MIGRATION.md` for provider setup and retirement checks.
- `STRIPE_SITE_ORIGIN` remains `https://aidramio.jimmy-tsoi2001.workers.dev` as an internal logical financial identity. It is not the customer-facing API address. Keep it unchanged so pending and existing Checkout metadata remain valid.
- Provider checks on 31 October 2026 at 10:00 UTC: Google accepts the custom-domain callback and reaches its login page; Apple still rejects its new callback with `invalid_request` / invalid web redirect URL. Both app-issued callbacks and cancellation returns use `lingyingdrama.com`. The owner reports all three provider settings saved, including Stripe, but actual Google/Apple consent and Stripe endpoint configuration/signed delivery remain independently unverified. No Stripe API read credential is available here. Users sign in again on the custom domain; old OAuth attempts may need restarting. Do not equate provider URL acceptance or owner-reported settings with completed sign-in/payment tests.
- Old `lingying.jimmy-tsoi2001.workers.dev` and `aidramio.jimmy-tsoi2001.workers.dev` addresses are temporary compatibility routes only. Preserve the gateway while old Stripe deliveries and in-flight return links need it. The main `lingying` Worker itself must remain to host the custom domain; removing its old public alias is different from deleting the application.

The user explicitly chose Stripe **test payments on this existing main website**, replacing the earlier separate-site workflow. Preserve `ENVIRONMENT=production`, the same `APP` namespace/media bucket, Google credentials and accounts/uploads. Keep `PAYMENTS_MODE=stripe` and `STRIPE_TEST_MODE=true` until the user asks to accept real money. Test keys and the test endpoint signing secret belong in the existing `lingying` Worker Secrets; test catalog IDs are permitted only while this explicit mode is enabled. Test wallet balances, activation, purchases and ledgers use separate `test_*` financial tables in the same database; never copy them into real balances or treat test earnings as payable. Stripe Connect and withdrawals stay disabled during test payments.

On 31 October 2026 the user requested real payments and asked for setup steps; preparation and the eventual live-mode switch are authorized. They confirmed that live credentials are not yet stored on this Worker. Follow `docs/STRIPE_LIVE_SETUP.md`: obtain credentials through encrypted Worker Secrets, preserve accounts/media and test/live separation, clear optional test catalogue IDs for inline live pricing, and address the demonstrated refund/dispute accounting gap before accepting customer funds. Keep the current test notice truthful until the backend changes. Do not charge a real card or execute a creator payout as a configuration check.

The older `aidramio-sandbox` Worker and `wrangler.sandbox.jsonc` are legacy resources, not the requested payment destination. Do not create another test website, redirect users there, migrate its data into the main site or delete existing resources without a specific request.

### Workflow

1. Inspect Git status, staged/unstaged diffs, and new files. Fetch `origin/main`, preserve current work, and reconcile upstream changes as needed. Never reset away user work, force-push, or overwrite remote commits.
2. Inspect the existing Worker's configuration before deployment. Preserve Worker Secrets, the `APP` Durable Object namespace, the `MEDIA` bucket, and existing accounts/uploads. Check live non-secret settings against `wrangler.jsonc`, especially `APP_URL`, `PUBLIC_APP_URL`, `STRIPE_SITE_ORIGIN`, `PAYMENTS_MODE`, `STRIPE_TEST_MODE`, `USD_TO_HKD`, `SEED_CATALOG`, and `ENVIRONMENT`. Unless this task explicitly changes them, reconcile the source with intentional live settings before committing. Do not accidentally switch live payments back to disabled. Never copy secret binding values into tracked config or logs.
3. Run checks appropriate to the changes. For application code, run `npm test` and `npm run build:cloudflare`. Run `npm run test:e2e` for viewer/studio/auth UI changes, and `npm run test:cloudflare` for API, persistence, authentication, media, or Cloudflare-runtime changes. For documentation/agent-instruction-only changes, check the diff rather than repeating functional suites. Do not proceed through a failed required check.
4. Stage the intended project changes. Exclude `.env`, `.dev.vars`, downloaded OAuth credential JSON, databases, private publisher media, dependency/cache folders, and generated builds. Respect `.gitignore` and inspect staged files for credentials. Preserve unrelated work. Create a descriptive commit, using the user's optional message as data rather than executing it. If there are no changes, skip creating an empty commit.
5. Push using `git push origin HEAD:main`, without force. Verify the remote `main` commit matches the intended local commit. If GitHub rejects the push, resolve the concrete cause before deploying.
6. Update the existing application with the tracked configuration:

   ```bash
   CLOUDFLARE_ACCOUNT_ID=95040c4f244233138195b80657887486 \
   XDG_CONFIG_HOME=/tmp/aidramio-cf-config \
   WRANGLER_SEND_METRICS=false \
   npx wrangler deploy --config wrangler.jsonc --keep-vars
   ```

   The explicit account overrides a stale account variable in the current environment. Keep the main Worker `lingying` and existing bucket name. Deploy `wrangler.legacy.jsonc` separately only when gateway code changes. The compatibility gateway must retain its service binding to `lingying`; it has no account database, media bucket or provider secrets. `--keep-vars` retains additional dashboard variables; it does not protect explicitly configured variables from being overwritten, hence step 2. Worker Secrets are retained by deployment.

   **Do not use `npm run deploy:cloudflare` for this shortcut.** That helper creates a new application when its ignored `.cloudflare/deployment.json` is absent, as it will be in a fresh clone. `/push` updates the known existing site and must not create a suffixed Worker, another bucket, or a fresh user database.
7. Verify the public `/api/health` returns HTTP 200 with `ok: true` and `database: true`. Verify `/api/config` reports the Cloudflare runtime and the intended current payment mode/provider availability; do not hard-code payments to disabled. Check the homepage and assets or affected user flow as appropriate. Preserve TLS verification and use the environment's supported HTTPS proxy. Local previews and dry runs alone do not establish a successful public deployment.
8. Report the commit/link, successful GitHub push, and verified live URL. If deployment fails after a successful push, state that GitHub is updated but the live update failed. Preserve the published source and existing production resources while diagnosing; do not claim both steps succeeded.

## Credentials and production data

Use the existing secure `CLOUDFLARE_API_TOKEN` binding against `api.cloudflare.com`. Check names/presence and operation results without printing values. Google and Stripe credentials belong in Worker Secrets; never request them in chat. Google setup is documented in `docs/GOOGLE_SIGN_IN.md`.

Account records and financial transactions live in the SQLite-backed Durable Object; publisher media lives in private R2. Those records are not Git source and must not be deleted, reseeded, or included in a commit. Keep the existing migration history and use additive schema changes unless the user explicitly authorizes a data migration.
