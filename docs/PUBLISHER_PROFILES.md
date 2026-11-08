# Publisher profiles

Administrators can publish under several public identities using the same administrator login. Open **Admin → Publishers**, create a profile with its display name and public registration date, then select it in the series editor before saving and publishing. The initial official profile is **LingYingDrama Offical**. Profiles can be renamed and their public dates edited later.

These are publishing profiles, not additional sign-in accounts. Creating one does not create a password, session, paid Pass, storage allowance or wallet. The displayed registration date belongs to the public profile; it does not change the administrator's actual account registration date. Creation, edits and series assignments retain their real audit timestamps.

Only an administrator editing a series owned by their own account can select a managed publisher profile. Ordinary publishers retain their own account display name. Selecting a profile changes public attribution; the series' underlying creator, storage accounting, purchases and 70% creator earnings remain attached to the original account.

Click **By [publisher name]** on a series or episode page to open the publisher's public profile. It shows the public registration date, published series and totals for series, episodes, views, likes and received viewing time. Series cards open their corresponding drama pages. The series list is paginated.

Public totals include only currently published series that are available to viewers. Drafts, hidden series, administrator takedowns and deleted series are excluded, including when an administrator visits the public page. Viewing time uses recorded, qualified playback sessions, including the extended five-minute playback records. Historical view counts remain visible without inventing viewing-time history. Average viewing time uses tracked qualified plays as its denominator. Individual viewers, emails, wallet balances and payment records are not public.

Managed profiles can be public before their first release. An ordinary account's public profile is available only while it has publicly available series. Public profile identifiers are separate from sign-in account identifiers. Existing owner uploads use the official profile by default; an existing upload's actual ownership is never reassigned by this feature.

Profile creation and editing use administrator-only, origin-protected API requests. Series attribution is checked again on the server, and audit records preserve the acting administrator. Names render as text, dates use validated calendar values, and public queries apply the same visibility restrictions as Explore.

Validation on 2 November 2026: 338 backend tests and 123 browser tests passed, along with the Cloudflare build and local Cloudflare integration suite. The checks cover profile permissions, unchanged ownership and purchases, date and name validation, public privacy, four-minute viewing totals, phone/RTL layouts and restart persistence. Local tests use isolated data and demo payments; they do not charge a card, fund a production wallet or release payouts. A phone-sized public profile was also visually inspected with no horizontal overflow.
