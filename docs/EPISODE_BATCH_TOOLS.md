# Episode selection, naming and ordering

In Creator Studio, select episode checkboxes or **Select all episodes**. The selected count and batch actions appear above the list.

**Rename selected** accepts a common name and previews every resulting title. The server appends the current stored episode number, padded to at least three digits: `New name 001`, `New name 002`, `New name 003`. It uses the episode's number, not its position within the selection, and limits the common name to 115 characters. Original uploaded filenames and video bytes are retained.

Drag a handle to rearrange episodes. Touch dragging, up/down buttons and Alt+Up/Down on a handle are also supported. Choose **Save episode order** or cancel the proposed order. Reordering changes position numbers and retains existing titles. If it changes which videos fall within the first N free episodes, the creator must acknowledge the access change. Existing paid unlocks stay attached to the same video ID. A later batch rename uses the newly saved numbers.

**Delete selected** loads current statistics for the selected episodes, including views, viewing time, storage and real/test purchases. The creator must type the series title and acknowledge that deletion cannot be recovered. Cancel changes nothing. Episodes with purchases in either payment mode are protected from individual/batch deletion; the whole selection is rejected rather than partially deleting it. Whole-series deletion remains its separate existing flow.

Deleting all remaining episodes archives a published series while retaining its first-publication date. Private uploaded objects use a durable cleanup queue, and storage quota is released once removal succeeds. Failed cleanup leaves the deletion committed and reports cleanup pending. Shared samples and still-referenced objects are preserved. Historical aggregate series views remain, while the selected episodes' playback records and progress are removed.

All mutations require an authenticated creator or administrator and enforce series ownership, moderation, financial holds and pending-upload restrictions. Batch operations use a revision of the current list; destructive confirmations are actor-bound, selection-bound, expire after ten minutes and are stored only as hashes. New uploads or purchases invalidate stale confirmations. Reorders commit atomically without episode-number collisions. Renames, ordering and deletions are audited. Ordinary single-episode removal uses the same cleanup safeguards.
