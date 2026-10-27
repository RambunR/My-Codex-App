# Series likes and publisher statistics

Viewers can like or unlike a published series from its details page after signing in. A like is independent of saving a series to My list. Each account contributes at most one like; repeating the same request does not add another. Public cards, rankings and series details show the current like and view totals, and episode tiles show recorded episode views.

Publishers open **Creator studio → Statistics** beside a series, or the **Statistics** button in a saved series editor. Reports belong to the series owner and expose aggregate data without viewer names, email addresses, IP addresses or individual viewing histories.

## Report definitions

Choose **7 days**, **30 days**, **90 days**, **All time**, or an inclusive custom date range of up to 366 days. Dates and daily boundaries use UTC. Days without activity are shown as zero.

- **Views:** qualified playback sessions. An episode counts after at least three seconds of measured playback, or its complete duration for clips shorter than three seconds. The same viewer and episode are counted at most once in a 30-minute session window. Publisher previews are excluded. Loading a poster, preloading video metadata, HTTP HEAD/range requests and seeking to the end do not count as views.
- **Watch time:** recorded active time for qualified sessions, capped at the episode duration per session. The player excludes pauses, buffering, seeks and hidden-page time. Average viewing time is qualified-session watch time divided by qualified views, not the video's seek position. The server also bounds heartbeat increments by elapsed time and a 15-second reporting interval, and rejects duplicate cumulative reports. Browser/network interruptions can conservatively undercount activity; this is application telemetry, not audited audience measurement.
- **Period attribution:** a view and its session watch time belong to the UTC date on which that session first qualifies. Subsequent heartbeats can update its final watch time. An unfinished session can therefore update a recent day's average.
- **Paid users:** distinct accounts that purchased episode unlocks during the selected period. A buyer who unlocks two episodes contributes one paid user to the series total and one to each episode's paid-user count. Paying the publisher activation fee, funding a wallet or watching a free episode does not count as an episode purchase. Paid unlocks count the actual purchased episodes.
- **Likes:** the current all-time number of accounts liking the series. This total is labelled separately from the selected viewing and purchase period; unliking removes that account from the total.

The daily chart and accessible table summarize views; the episode table lists views, average watch time, paid users and paid unlocks for each episode, including zero-activity episodes.

## Existing data and Stripe test payments

Existing public series view totals remain intact. Historical stream requests had no dated watch-time records, so they cannot be reconstructed into episode watch-time or period reports. Detailed playback statistics start as the updated player records activity. The interface explains that older watch-time data is unavailable.

The existing website still uses the explicitly requested Stripe test mode. Purchase statistics read the same `test_purchases` scope as the test wallet and are labelled accordingly. Real purchase records are not combined with test purchase records. Switching to live payments changes the purchase-statistics scope without converting test credit, earnings or entitlements. Playback and likes belong to the shared content rather than a payment mode.

## Persistence and privacy

Likes and playback sessions are stored durably in the existing SQLite-backed Cloudflare Durable Object, alongside the existing accounts. No additional analytics service, media bucket or website is required. New tables and indexes are additive; existing accounts, Google sign-in credentials, payments and uploads are retained.

Signed-in playback uses a hash of the account identifier. Guests receive a random HTTP-only, SameSite cookie when they start playback; only a hash identifies their analytics sessions. This cookie expires after 30 days and uses Secure in production. Raw IP addresses are not stored in playback records. Heartbeats are bound to that viewer and recheck episode access. Browser reports are best effort and can be blocked or lost; counts do not represent verified unique people.

The application's privacy page describes likes, aggregate playback statistics and the guest cookie. Publisher endpoints require authentication, active publisher access and ownership of the requested series.

## Verification

Backend tests exercise idempotent likes, access controls, public aggregate counts, anonymous viewer binding, durable session reuse, qualification thresholds, seek/clock limits, delayed heartbeat replay, UTC period boundaries, zero-filled days, exact averages and distinct paid buyers with test/live isolation. Browser tests play an actual video, verify one qualified view and watch time, reload without adding a view, open publisher episode statistics, and like/unlike through the real UI. The Cloudflare integration smoke verifies SQL/R2 behavior and persistence across runtime restarts.
