# Series likes and publisher statistics

Viewers can like or unlike a published series from its details page after signing in. A like is independent of saving a series to My list. Each account contributes at most one like; repeating the same request does not add another. Public cards, rankings and series details show the current like and view totals, and episode tiles show recorded episode views.

Publishers open **Creator studio → Statistics** beside a series, or the **Statistics** button in a saved series editor. Reports belong to the series owner and expose aggregate data without viewer names, email addresses, IP addresses or individual viewing histories.

## Report definitions

Choose **7 days**, **30 days**, **90 days**, **All time**, or an inclusive custom date range of up to 366 days. Dates and daily boundaries use UTC. Days without activity are shown as zero.

- **Views:** a public episode adds one view to both its episode count and series total as soon as visible playback starts, including when its publisher watches the published series. The player's native `playing` event starts the durable session; there is no three-second minimum. The same viewer and episode are counted at most once in a 30-minute session window, including retries, pauses/resumes and reloads. Another episode has its own count. Opening a series, loading a poster, preloading video metadata and HTTP HEAD/range requests do not count. Private Studio/admin previews and owner-only draft previews are excluded.
- **Watch time:** recorded active time for counted sessions, capped at the episode duration per session. A newly counted view has zero watch time until actual playback is measured. The player excludes pauses, buffering, seeks and hidden-page time. Average viewing time is counted-session watch time divided by counted views, not the video's seek position. The server also bounds heartbeat increments by elapsed time and a 15-second reporting interval, and rejects duplicate cumulative reports. Browser/network interruptions can conservatively undercount activity; this is application telemetry, not audited audience measurement. A zero-time or short heartbeat never removes or duplicates a view already counted at playback start.
- **Period attribution:** a view and its session watch time belong to the UTC date on which that view was first counted. The legacy `qualified_at_ms` field stores that timestamp without rebuilding historical records. Subsequent heartbeats can update its final watch time. An unfinished session can therefore update a recent day's average.
- **Paid users:** distinct accounts that purchased episode unlocks during the selected period. A buyer who unlocks two episodes contributes one paid user to the series total and one to each episode's paid-user count. Paying the publisher activation fee, funding a wallet or watching a free episode does not count as an episode purchase. Paid unlocks count the actual purchased episodes.
- **Likes:** the current all-time number of accounts liking the series. This total is labelled separately from the selected viewing and purchase period; unliking removes that account from the total.

The daily chart and accessible table summarize views; the episode table lists views, average watch time, paid users and paid unlocks for each episode, including zero-activity episodes.

## Existing data and Stripe test payments

Existing public series view totals remain intact. Historical stream requests had no dated watch-time records, so they cannot be reconstructed into episode watch-time or period reports. Detailed playback statistics start as the updated player records activity. The interface explains that older watch-time data is unavailable.

The immediate-playback rule does not bulk backfill old uncounted sessions. An existing uncounted session is counted once if playback is started again; an older active session can also count on its first positive measured heartbeat after the update. Inactive historical records remain unchanged.

Purchase statistics follow the selected payment mode: test purchases use the same `test_purchases` scope as the test wallet and are labelled accordingly. Real purchase records are not combined with test purchase records. Switching payment modes changes the purchase-statistics scope without converting credit, earnings or entitlements. Playback and likes belong to the shared content rather than a payment mode.

## Persistence and privacy

Likes and playback sessions are stored durably in the existing SQLite-backed Cloudflare Durable Object, alongside the existing accounts. No additional analytics service, media bucket or website is required. New tables and indexes are additive; existing accounts, Google sign-in credentials, payments and uploads are retained.

Signed-in playback uses a hash of the account identifier. Guests receive a random HTTP-only, SameSite cookie when they start playback; only a hash identifies their analytics sessions. This cookie expires after 30 days and uses Secure in production. Raw IP addresses are not stored in playback records. Heartbeats are bound to that viewer and recheck episode access. Browser reports are best effort and can be blocked or lost; counts do not represent verified unique people.

The application's privacy page describes likes, aggregate playback statistics and the guest cookie. Publisher endpoints require authentication, active publisher access and ownership of the requested series.

## Verification

Backend tests exercise immediate public-play counts with zero initial watch time, owner-public versus private-preview behavior, idempotent retries, legacy-session compatibility, likes, access controls, anonymous viewer binding, durable session reuse, seek/clock limits, delayed heartbeat replay, UTC period boundaries, zero-filled days, exact averages and distinct paid buyers with test/live isolation. Browser tests play actual video, verify the start counts before three seconds, measure subsequent watch time, reload/resume without adding a duplicate, watch another episode, open publisher episode statistics, and like/unlike through the real UI. The Cloudflare integration smoke verifies immediate counts, measured watch time and persistence across runtime restarts.
