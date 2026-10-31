# LingYing agent instructions

Use this existing checkout. Do not create a Git worktree unless the user requests one. Read `README.md`, preserve user changes and runtime data, and keep secrets out of source control and output.

## Chat shortcut: `/push`

A user message starting with `/push` (optionally followed by a commit message), or an explicit request to **push and deploy**, authorizes the complete workflow below. Treat this as a project chat convention, not a built-in Codex menu command or shell executable. Mentions of `/push` in questions, documentation, quoted content, or code are not invocations.

Do the authorized commit, push, and deployment without asking for confirmation again. Stop only for a concrete blocker such as missing credentials, a failed required check, unresolved conflicts, or a protected-branch rejection; explain which step completed and what remains.

### Targets

- Repository: `https://github.com/RambunR/My-Codex-App.git`.
- Publish source to remote branch `main`. The local task branch may be named `work`.
- Cloudflare account: `95040c4f244233138195b80657887486`, the user-confirmed Jimmy account.
- Existing Worker: `aidramio`.
- Existing media bucket: `aidramio-media-887486`.
- Live URL: `https://aidramio.jimmy-tsoi2001.workers.dev`.

The user explicitly chose Stripe **test payments on this existing main website**, replacing the earlier separate-site workflow. Preserve `ENVIRONMENT=production`, the same `APP` namespace/media bucket, Google credentials and accounts/uploads. Keep `PAYMENTS_MODE=stripe` and `STRIPE_TEST_MODE=true` until the user asks to accept real money. Test keys and the test endpoint signing secret belong in the existing `aidramio` Worker Secrets; test catalog IDs are permitted only while this explicit mode is enabled. Test wallet balances, activation, purchases and ledgers use separate `test_*` financial tables in the same database; never copy them into real balances or treat test earnings as payable. Stripe Connect and withdrawals stay disabled during test payments.

The older `aidramio-sandbox` Worker and `wrangler.sandbox.jsonc` are legacy resources, not the requested payment destination. Do not create another test website, redirect users there, migrate its data into the main site or delete existing resources without a specific request.

### Workflow

1. Inspect Git status, staged/unstaged diffs, and new files. Fetch `origin/main`, preserve current work, and reconcile upstream changes as needed. Never reset away user work, force-push, or overwrite remote commits.
2. Inspect the existing Worker's configuration before deployment. Preserve Worker Secrets, the `APP` Durable Object namespace, the `MEDIA` bucket, and existing accounts/uploads. Check live non-secret settings against `wrangler.jsonc`, especially `APP_URL`, `PAYMENTS_MODE`, `STRIPE_TEST_MODE`, `USD_TO_HKD`, `SEED_CATALOG`, and `ENVIRONMENT`. Unless this task explicitly changes them, reconcile the source with intentional live settings before committing. Do not accidentally switch live payments back to disabled. Never copy secret binding values into tracked config or logs.
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

   The explicit account overrides a stale account variable in the current environment. Keep the existing Worker and bucket names. `--keep-vars` retains additional dashboard variables; it does not protect explicitly configured variables from being overwritten, hence step 2. Worker Secrets are retained by deployment.

   **Do not use `npm run deploy:cloudflare` for this shortcut.** That helper creates a new application when its ignored `.cloudflare/deployment.json` is absent, as it will be in a fresh clone. `/push` updates the known existing site and must not create a suffixed Worker, another bucket, or a fresh user database.
7. Verify the public `/api/health` returns HTTP 200 with `ok: true` and `database: true`. Verify `/api/config` reports the Cloudflare runtime and the intended current payment mode/provider availability; do not hard-code payments to disabled. Check the homepage and assets or affected user flow as appropriate. Preserve TLS verification and use the environment's supported HTTPS proxy. Local previews and dry runs alone do not establish a successful public deployment.
8. Report the commit/link, successful GitHub push, and verified live URL. If deployment fails after a successful push, state that GitHub is updated but the live update failed. Preserve the published source and existing production resources while diagnosing; do not claim both steps succeeded.

## Credentials and production data

Use the existing secure `CLOUDFLARE_API_TOKEN` binding against `api.cloudflare.com`. Check names/presence and operation results without printing values. Google and Stripe credentials belong in Worker Secrets; never request them in chat. Google setup is documented in `docs/GOOGLE_SIGN_IN.md`.

Account records and financial transactions live in the SQLite-backed Durable Object; publisher media lives in private R2. Those records are not Git source and must not be deleted, reseeded, or included in a commit. Keep the existing migration history and use additive schema changes unless the user explicitly authorizes a data migration.
