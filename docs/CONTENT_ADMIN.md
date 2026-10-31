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

Only trusted deployment configuration can establish the platform owner: `PLATFORM_OWNER_USER_ID`. On startup, an existing matching account receives an audited database admin role. Names, email addresses, client requests and registration fields never grant this privilege. `OFFICIAL_CREATOR_NAME` sets the public alias. These settings are on the existing main Worker; the sandbox is unchanged. Existing sessions pick up the role on their next authenticated request. No new credentials or impersonation session is created.

See [free licensed starter films](LICENSED_STARTER_FILMS.md) before importing third-party content. Free viewing alone does not authorize republishing.
