# Content administration and official uploads

The owner signs in to the existing account used for the uploaded `test` series. Open [Account](https://lingyingdrama.com/account) → **Admin** → **Content**, or [open Content directly](https://lingyingdrama.com/admin?tab=content).

## Publish your own drama

Choose **Upload own drama** in Content, or open [New series](https://lingyingdrama.com/studio/new). Save the title, synopsis, spoken language, genres, production method, episode price and free-episode count. Add a cover and choose the episode folder; filename order determines the episode order. Review and publish. The existing post-publication flow opens Explore → Newest with matching filters.

Owner uploads display **LingYingDrama Offical**, exactly as requested. The display alias applies only to the configured owner UUID, including previous and future uploads. It does not replace original author/licence credits, alter the personal profile, transfer series ownership, or rename other publishers. Admins can publish without buying a Pass; this grants no paid Pass, credit or earnings. All episode duration, file size, storage quota and financial review rules remain in force: at most 180 seconds and 75 MiB per episode, with the existing account storage allowance.

## Review or remove a violation

Search by title or creator and filter by published, draft, archived or taken-down status. **Edit details** opens the private series editor, including unpublished or offline work. Admin **Private preview** plays an episode without buying an unlock or increasing viewer analytics.

Choose **Take down**, enter a reason of 10–2,000 characters and confirm. This immediately removes the series from discovery, saved lists and history, and blocks its public cover, playback, new unlocks and watch-time updates. Owners, administrators and previous purchasers cannot bypass this through public endpoints. An admin retains private review access. The creator cannot modify or republish the series until it is restored.

Takedown is reversible: it retains media, publication state, existing purchases, balances and financial records. It does not automatically issue refunds, claw back revenue, or delete stored files. If paid viewers are affected, handle that review separately. **Restore** requires a reason and returns the previous publication state; restoring a draft does not publish it. **History** shows the operator, action, reason and timestamp. Admin series-detail corrections are also audited.

Admin uploads while editing another creator's series count against that series owner's storage, not the logged-in admin's quota. Purchased episodes cannot be deleted through the editor. Prefer takedown for violations so payment evidence is preserved.

## Access configuration

Trusted deployment configuration establishes the platform owner through `PLATFORM_OWNER_USER_ID`. On startup, an existing matching account receives an audited database admin role. An additional `PLATFORM_ADMIN_EMAIL_SHA256` selector can authorize the specifically configured email after server-verified identity proof. The selector is the SHA-256 hash of the trimmed, lowercased email; the personal address is not published in source. On the authenticated account read, both the current stored address hash and a current email-verification record or matching verified Google identity must match. Names, an unverified claimed email, client requests and registration fields never grant this privilege. `OFFICIAL_CREATOR_NAME` sets the public alias. These settings are on the existing main Worker; the sandbox is unchanged. Existing sessions pick up the role on their next authenticated request. An unverified email candidate must first prove ownership through the normal account verification or Google linking flow. No new credentials or impersonation session is created.

See [free licensed starter films](LICENSED_STARTER_FILMS.md) before importing third-party content. Free viewing alone does not authorize republishing.

## Verified release

Application source `c866df64019d75e9c7ec005a23c6d8f38971dda7` was pushed to GitHub main and deployed to the existing `lingying` Worker as version `0c8da029-2a6c-4778-aaa3-aad9fe4c55d3`. Live checks passed on 31 October 2026 at 18:33 UTC (1 November at 02:33 Hong Kong time): the owner alias and its search match appeared on the original ten-episode upload, all 21 catalogue entries and other creator names remained, original media served a byte range, and unauthenticated private/admin routes rejected access. The existing APP namespace, media bucket, eight secret bindings, live Stripe readiness and paused payouts were retained.

Validation passed: 188 backend tests, all 38 browser tests, Cloudflare build and the local Cloudflare integration smoke including moderation/restore and audit persistence across runtime restart. An independent live browser check at 390px showed the alias without overflow, required sign-in for guests, and denied an existing ordinary viewer all admin/private-owner access while keeping its role, zero wallet, inactive live Pass and storage unchanged. Only that audit viewer's login/logout was performed; no owner impersonation, live content moderation/import, payment or payout occurred. Owner administration was validated using isolated local accounts; the owner's live sign-in was not impersonated.

## Account page status

Administrators see an **Administrator** badge beside their profile and an **Administrator access** card with **Uploads enabled**, plus links to Manage content, Open Creator Studio and Upload drama. This publishing permission comes from their administrator role. An administrator without a paid Pass is not shown an inactive-Pass purchase prompt, and the interface does not invent a Pass purchase or receipt. Administrators who actually own a Pass retain their real Pass information separately.

A financial review hold or disabled uploads pauses the new-upload action and changes its status to Uploads paused. Admin management and read-only studio navigation remain available. Existing storage, duration and file-size limits still apply. Viewer and regular publisher Pass behavior is unchanged. All status and action messages are translated in the existing 21 interface languages.
