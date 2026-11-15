# Private Google Drive imports

The existing `lingying` Worker has a five-minute scheduled importer. It starts **disabled**, uses the existing APP database and private MEDIA bucket, and sends completion/error messages to **Admin → Drive imports** and the owner's notification bell. It never publishes a series or sends email.

## Connect the source folder

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and enable **Google Drive API** under APIs & Services → Library.
2. Open IAM & Admin → Service Accounts → Create service account. Name it `lingying-drive-import`. Skip project roles and domain-wide delegation: neither is needed.
3. Open that service account → Keys → Add key → Create new key → **JSON**. Keep this downloaded file private; do not paste it into chat or commit it.
4. In Google Drive, share only the import root folder with the JSON file's `client_email`, with **Viewer** access. Keep general access Restricted. The current root ID is `1zEO-UFQpVMu7GnYNB4mM-M_3__IwhPHo`.
5. In Cloudflare → Workers & Pages → **lingying** → Settings → Variables and Secrets → Add, choose **Secret**, name it `GOOGLE_DRIVE_IMPORT_CREDENTIALS`, and paste the complete JSON file as its value. Save/deploy the settings. Existing Google sign-in credentials are separate and do not grant Drive access.
6. Sign in as the configured platform owner. Open [Admin → Drive imports](https://lingyingdrama.com/admin?tab=drive-imports), confirm the root folder ID and service account email, then **Verify connection**. Once verification succeeds, enable automatic imports.

Only the pinned owner with a current administrator role can configure or operate this feature. Verification is bound to that owner, the folder and the credential fingerprint. A folder change disables the watcher. Credential changes require another verification before work resumes. The UI exposes no private key and no key-entry field.

## Verify ClipWeave exports

For ClipWeave output, select the whole `ClipWeave_<run>` export or its parent. Its producer must provide `EXPORT_SUMMARY.txt`, `upload_manifest.json` and `EXPORT_FINALIZED.json`. Keep the nested folders intact. The seal arriving in Drive does not prove the videos finished syncing.

Use the panel's **Download ClipWeave verifier** button, or `npm run drive:verify -- "/path/to/ClipWeave_run"`, for a read-only local integrity check. Do not generate a replacement seal or convert this export to `lingying-ready.json`. The importer follows the producer inventory, verifies all required clips, captions and support assets, and rechecks source revisions before creating a draft. [Full ClipWeave layout, rules and checker usage](CLIPWEAVE_EXPORTS.md).

A successful local check proves local generated-export integrity. Only a successful connected Drive verification proves the remote listed files arrived intact. Neither proves that the supplied source contains the complete original drama; that requires an independent original episode list.

## Manual flat-series format

For genuine manually assembled folders, direct child series folders such as `001_clip` and `002_clips` remain supported with `lingying-ready.json`. Their episode files must be directly inside the series folder. This separate format must not replace or bypass ClipWeave's producer seal.

The legacy [manual manifest utility](https://lingyingdrama.com/downloads/create-lingying-drive-manifests.mjs) runs with Node 18+:

```bash
node create-lingying-drive-manifests.mjs "/path/to/manual-series-parent"
```

It calculates exact file sizes and SHA-256 without changing videos. Run it only after the intended local exports are complete, then upload/sync its manifests and files. Existing manual manifests are retained unless `--overwrite` is supplied. Source filenames and unique episode numbers are preserved. Each imported episode must be at most **200 MiB**, and covers at most **5 MiB**. Normal creators retain their five-minute limit; the configured owner administrator has no duration limit.

## What happens automatically

The watcher discovers eligible folders, validates the manifest and current source versions, and stages files privately in bounded resumable parts. It checks the staged SHA-256 hashes and media before a single database transaction creates the draft and all its episodes. Until validation finishes, no partial destination series is created. A successful import produces one admin notification with a link to its editable Studio draft.

Drafts start with all episodes free (`free_episodes=1000`), no featured selection and the normal minimum paid-price placeholder. Review pricing, details, subtitle languages, publisher attribution and rights before publishing. The importing owner remains the actual account owner; managed publisher profiles only affect public attribution. Importing does not create accounts, purchase a Pass, alter a wallet, generate earnings or call Stripe.

Manual source folders map to their destination once; sealed ClipWeave sources use export/source identity. Subsequent scans preserve edits made on LingYing. Changes to an already imported source are flagged for review instead of overwriting the destination. Deleting a destination does not erase its provenance or cause automatic re-creation. Removing a Drive folder does not delete a LingYing drama.

Use **Scan now** to request discovery, **Cancel** to stop an unfinished job, and **Retry** after correcting a failed source. Staging cleanup is durable and continues when imports are disabled. Root discovery happens every five minutes; transfer continuation uses the existing Durable Object alarm without replacing media-cleanup work. The background entry point is internal to the Durable Object; the public Worker rejects that reserved path.

## Verification and current limitations

Local unit, API, browser and Cloudflare checks use disposable fixtures. They do not prove access to the owner's private Drive. Real connection verification and enabling require the encrypted service-account key and Viewer share described above. The deployed watcher must remain disabled until those are configured and verified; a public Drive sign-in page cannot establish whether syncing has completed.

The service reads only configured source metadata and file contents with the Drive read-only scope. It stores provenance, progress, manifest/checksum data, resumable support-file verification state, admin audit records and notification states in the existing private database. This owner-operated import is separate from ordinary users' Google sign-in; Google login does not request Drive scope or persist a login Drive token.
