# Series title availability

New series and renamed series must have a title that is not already reserved by another series on LingYing. Matching uses Unicode NFKC normalization, case-insensitive comparison, and collapsed/trimmed whitespace. The creator's saved spelling and punctuation are preserved; the check does not translate titles or remove punctuation and word boundaries.

Draft, published, archived and moderated series reserve their names across all creators. Permanently deleted and source-retired examples do not. Existing uploads are never renamed or removed by this feature. An existing series can retain its own normalized title when editing metadata, including legacy series that already shared a name before the rule was introduced. A new create or a rename into that same reserved name is rejected.

Creator Studio checks new or changed valid titles after a short debounce. Every Save/Publish makes a fresh authenticated availability check before saving details or uploading a selected cover. A duplicate or a failed check shows translated inline feedback and retains the form and selected files. A slow response for an older title cannot approve or reject the current input. Creators can correct the title and retry Save.

The final create/PATCH transaction checks availability again before writing, so a successful preflight does not bypass concurrent-save protection. A conflict returns HTTP 409 with `SERIES_TITLE_EXISTS`. Availability reads use `GET /api/studio/title-availability?title=...&exclude=...`, require publisher access and are limited to 30 checks per minute. Excluding an existing series requires ownership or administrator access. The response contains only `{available:boolean}`, with no existing series IDs, owner details, publication state or private titles.

The server reads current source titles inside the existing write transaction. No unique-index backfill, database rebuild, automatic historical renaming or financial/media migration is performed. This is an application naming rule, not proof of copyright ownership or a duplicate-video detector.

Backend tests cover normalization, access/privacy, concurrent creation, rename rollback, own-title/legacy edits, deleted/retired reuse and restart persistence. Browser cases cover input/file preservation, correction, stale responses, network retry and a conflict that occurs after successful preflight. The Cloudflare integration smoke verifies the same rule through the deployed runtime adapters using disposable local data.
