# ClipWeave sealed exports

This integration follows the supplied **UPLOADER_INSTRUCTIONS.txt, Version 1, 15 November 2026**. That document describes the interchange format; account permissions and operational authorization remain those of the LingYing project and current user request. No new infrastructure, payment, publication, account impersonation or source deletion is introduced.

## Layout and readiness

Select the complete `ClipWeave_<run>` folder, or a parent containing those export folders. Do not select just `001_clips` and do not flatten the tree:

```text
ClipWeave_<run>/
  EXPORT_SUMMARY.txt
  upload_manifest.json
  EXPORT_FINALIZED.json
  batch.json
  001_clips/
    export.json
    01_<source_name>/
      <source_name>_001.mp4
      <source_name>_002.mp4
      ...caption sidecars when listed...
    editable_captions/...       # when listed by this export
  002_clips/...
  series_metadata/...          # optional feature; inventory is authoritative
  series_covers/...
  downloads/...                # backups, never extra episodes
```

The small finalization file can arrive before videos in Google Drive. It is **not** a sync-complete signal by itself. The importer requires all three root controls exactly once, verifies the exact raw manifest byte length and SHA-256 against the producer seal before parsing JSON, and checks that export IDs agree. Reformatting JSON, adding a BOM or changing newlines changes those bytes.

Only supported ClipWeave v1 `operation="process"` exports enter this episode workflow. Download-only output is not silently treated as episodes. A ready source must be listed in the seal, have `upload_ready=true`, no readiness reasons, a complete consecutive clip sequence, and valid source-time coverage. A finalized partial batch can contribute its independently ready sources while failed/pending siblings remain excluded. The whole batch is not reported ready unless its batch flag and every series are ready.

For each selected series the importer verifies every `required=true` inventory asset owned by that source **and every shared required asset**. This includes captions, batch/source support records, requested metadata/covers and required backups. Optional features absent from the export are not invented. Exact nested Unicode path components and parent IDs are used; every Drive listing page is read within explicit safety bounds. Duplicate/colliding paths or names, shortcuts, traversal, absolute paths and links outside the export are rejected. Excessively fragmented exports that exceed the bounded listing budget fail clearly rather than being declared intact.

Every required asset must match its positive exact byte size and SHA-256. A Drive-provided SHA-256 can prove source support-file integrity; otherwise bounded downloads and resumable SHA-256 checkpoints verify its actual bytes. MD5, previews, names, sizes and file counts alone are insufficient. Large required backups can be checked without becoming R2 episodes. Imported videos retain the **200 MiB** limit and covers the **5 MiB** limit. Normal owner-duration, role, hold, quota and media validators still apply.

Only source-owned `role="clip"` assets become episodes, ordered by `clips[].index`. Source-owned verified `series_cover` artwork may become the cover. Full-source downloads, references, receipts, manifests and logs never become episodes or public attachments. Source timing covers the supplied video from start to end without gaps; intentional overlap is preserved rather than counted as unique story length. Numeric overlap seconds and boolean overlap flags are checked against timing without coercing a boolean to seconds. Uploaded video bytes are preserved.

## Safe completion

The importer records `(owner, export_id, source_id)` as a stable identity. The manifest hash records the verified revision, not a new series. Jobs resume bounded checkpoints, stage media privately, verify destination hashes and all support files, then recheck the seal, manifest and asset identities/revisions before the atomic unpublished-draft transaction. A crash, missing file or corrupt sidecar cannot create a public half-series.

Completed source changes produce a review notification and preserve website edits. Deleted dramas are not re-created. Reruns with a new export ID are separate inputs; normalized title checks still prevent accidental duplicate drama names. Moving a completed source to another watched root does not duplicate it. An unfinished source cancelled by a root change may need operator review instead of automatic reattachment.

Metadata JSON's content schema is not specified by the handoff document. The files are verified privately; drafts use the supplied series name and a clearly marked synopsis/language/genre review placeholder rather than guessing undocumented metadata fields. Review details in Studio before publishing.

**Verified generated export is not verified original story.** `completeness_scope="generated_export"` proves the listed generated files arrived intact. Producer `original_series_complete` is retained as its own claim, including null. Neither counts nor timing can prove the supplied source contains all original drama episodes; that needs an independent authoritative original episode list.

## Read-only local checker

Download **ClipWeave verifier** in [Admin → Drive imports](https://lingyingdrama.com/admin?tab=drive-imports), or use the repository command:

```bash
npm run drive:verify -- "/path/to/ClipWeave_run"
```

A downloaded standalone copy needs Node 18 or newer. On Windows:

```powershell
node .\verify-clipweave-export.mjs "C:\Users\user\Videos\ClipWeave Exports\ClipWeave_20261102_005410_4b709e"
```

It reads files and reports `READY`, `PARTIAL`, `WAIT` or `REJECT`, per-series counts and errors. It never changes videos, uploads anything, writes a seal or repairs a producer manifest. A local `READY` result explicitly does **not** verify remote Drive sync. Drive verification happens separately through the connected importer after the complete folder syncs.

Do not generate `lingying-ready.json` as a substitute for missing ClipWeave controls. Old unsealed ClipWeave exports remain unverified; regenerate/finalize them with their producer. Genuine manually assembled flat series retain the separate legacy manifest workflow.

## Evidence and assumptions

Regression fixtures reproduce the documented layout and failures: seal first, missing last video/captions/cover, one-byte same-size corruption, duplicate Drive names, partial/cancelled batches, changed snapshots, malicious paths, incorrect ordering, database/storage interruptions and repeated identities. The local checker and cloud importer use the same contract validator.

The handoff text provides no actual JSON examples. Pending a producer sample, the validator requires `schema_version=1` and `app="ClipWeave"` in the seal-bound manifest; optional seal labels must agree when present. It checks non-active finalization status and numeric second-based source timings. Source-series order may start at zero; clip indices remain consecutive from one and determine ordering even when the JSON array is unsorted. Seal and manifest completion timestamps may differ. Unknown producer fields remain data; they are not executed or mapped into permissions. These documented-format tests do not establish compatibility with unseen producer field variants or prove that the owner's private Drive has finished syncing.
