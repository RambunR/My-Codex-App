# Real publisher catalogue

The owner requested removal of the twenty fictional built-in story samples on 2 November 2026. **The Godfather's Caged Bird**, published as **DreamShortDrama**, must remain intact. Its public series ID is `284bc1d4-7bf3-48f8-a97b-f45abfb3bb44` and publisher profile ID is `publisher-887f66b6-6d6c-42b6-846f-2bbf175f7e5c`.

Production catalogue seeding is disabled. The existing Cloudflare Durable Object runs a one-time, fixed-manifest retirement only on the production `https://lingyingdrama.com` application. Local development keeps its separate sample fixtures.

The operation accepts only the original twenty IDs, owned by the original catalogue account, with their exact source metadata, bundled covers and eight known shared preview episodes. Modified or replaced content, uploads in progress, purchases in either payment mode and any private media cause a sample to be skipped. It never selects content by AI production type alone.

The protected title and DreamShortDrama attribution are checked independently, together with the pinned public IDs. A matching protected title/publisher anchor must exist before anything changes. The transaction verifies fingerprints of the existing records and the protected content before and after the operation.

Retirement archives the verified samples and records `retired_catalog_series` markers. Public discovery, playback, profiles, history, Studio and admin content listings exclude those markers, including if a stale process later changes a sample's status. Existing episodes, artwork references, statistics, accounts, balances, purchases, ledgers and prior audit history stay in place. Shared preview files are not deleted. There is no automatic refund or payout.

`catalog_retirement_runs` stores an immutable SYSTEM receipt with a null account actor, operation version, selected IDs, exclusions and preservation hashes. No login session, administrator impersonation or public maintenance endpoint is created. Failure of a safety check rolls back the transaction and leaves ordinary website startup available. An applied receipt prevents the operation from running again.

After `npm run build:cloudflare`, run `npm run test:catalog-retirement` to exercise the real local Cloudflare SQLite/R2 adapters. It creates an isolated protected upload, checks retirement and preserved bytes/account state, restarts for idempotency, and tests that an empty production application cannot re-seed samples even with a stale enable flag. No Cloudflare account resources or real payments are used.

Validation on 2 November 2026: 365 backend tests, 140 browser tests, the Cloudflare build, the standard Cloudflare integration suite and the dedicated retirement integration suite passed. The dedicated emulator run retired exactly 20 samples, preserved the protected upload's bytes/account/quota and matching database fingerprints, then returned `already_applied` after restart. The independent rollback tests cover unexpected wallet and protected-media drift. Browser validation includes multi-language subtitle selection, clearing, compatibility, keyboard interaction and phone/RTL presentation.
