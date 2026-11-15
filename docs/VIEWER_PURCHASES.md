# Viewing and episode purchases

The series page places **Unlock all episodes** beside **Watch now** whenever the series has paid episodes. The displayed estimate excludes free and already unlocked episodes. The confirmation dialog fetches an authenticated server quote, shows its remaining episode count, total and wallet balance, and explains that only currently available episodes are included. Future uploads require their own access; a paid bundle is not a permanent series-level grant.

An account with all available episodes unlocked sees a completed, disabled action. A wholly free series needs no purchase action. Guests sign in first and return to the series to review a fresh quote. An insufficient wallet balance leads to the existing wallet top-up flow; returning opens a fresh review, never an automatic charge.

## Server-authoritative purchases

`GET /api/series/:id/unlock-quote` returns the current remaining paid episode IDs/count, unit price, total in USD micros and a revision. The revision binds the authenticated account, financial partition, series/creator, effective price and current episode membership, order, free status and ownership. It does not create a financial record.

`POST /api/series/:id/unlock-all` accepts only `{revision}`. The server recomputes eligibility inside one transaction. A changed price, upload, reorder, free boundary, purchase or financial mode requires a fresh quote and explicit confirmation. Client-supplied amounts or episode lists cannot select what is charged. If nothing remains, a retry succeeds without another debit.

New single-episode confirmations also send the displayed `expected_price_cents`. A changed asking price returns `EPISODE_PRICE_CHANGED` without charging; the viewer must open and confirm the refreshed price. Existing clients that omit this optional field retain their prior request format.

The transaction validates the complete wallet debit and creator balance increase before any financial writes. Every purchased episode receives its ordinary purchase receipt, exact 70/30 revenue split and corresponding ledger entries. Failure rolls back the whole purchase. Existing purchases are preserved; concurrent individual or bundle requests cannot charge an episode twice. The existing US$1 episode cap, account review holds and public availability/moderation rules apply.

Live purchases and balances remain separate from test purchases and balances. Real ownership is recognised in either mode, while test-only ownership never becomes live access. A creator's own uploads and valid Lucky Draw awards need no payment. Lucky Draw remains a separate series-level access award, including covered future episodes, with no fabricated purchase receipt or creator revenue.

## Fullscreen and episode transitions

Fullscreen uses browser capabilities on desktop and phones, preserving the original media and the stable player container. Supporting browsers retain the website's player controls and overlays. iPhone native video fullscreen is a browser-owned presentation: website overlays cannot be guaranteed there. A paid gate exits native video fullscreen before presenting the website's confirmation controls. Browser security and autoplay policies can require another tap to continue playback.

Finishing an accessible episode continues to the next accessible episode where playback is permitted. A paid next episode stops at its unlock gate; neither ending a video nor navigating to another episode authorises a debit. The last available episode offers replay and a return to the series. Wallet returns and stale requests must stay bound to the intended account, series and episode.

Fullscreen and sharing do not duplicate, re-encode or modify saved media. Preserve the Safari delivery correction, byte ranges, owner long-episode support, actual-duration progress, analytics rules and Lucky Draw access checks.

## Sharing

Sharing creates one clean series link followed by a blank line and an invitation naming its translated primary genre. The invitation uses the currently selected website language. Native sharing and clipboard fallback receive the same complete message; cancelling the native share sheet does not copy it. Existing query parameters and fragments are excluded from the shared link.

## Checks

Run the unit/API suite, Cloudflare build and local Cloudflare integration. Relevant browser regressions cover bundle confirmations, balance changes, stale quotes, duplicate attempts, mobile/RTL dialogs, sharing, fullscreen and episode transitions. Run the Safari/WebKit suite for player changes. Local WebKit is not physical iPhone validation.

Production verification uses public reads and browser-only account/quote fixtures with real mutations blocked. It does not create a real account, purchase, payment, Lucky Draw award, view, upload or payout.
