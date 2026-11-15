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

## Mark each series complete

An unchanged folder is not proof of completion: uploading may pause. Every numbered series folder therefore needs a `lingying-ready.json` manifest containing exact filenames, byte lengths and SHA-256 checksums. Upload the manifest after the final export is ready. Direct child series folders such as `001_clip`, `002_clips` and `003_clip` are independent series. Episode files belong directly inside each series folder; shortcuts and nested episode paths are not followed.

Download the [manifest utility](https://lingyingdrama.com/downloads/create-lingying-drive-manifests.mjs), or use `scripts/create-drive-manifests.mjs` from the repository, to generate manifests on the computer holding the completed exports:

```bash
node scripts/create-drive-manifests.mjs "/path/to/ClipWeave Exports"
```

On Windows, for example:

```powershell
node .\create-lingying-drive-manifests.mjs "C:\Users\user\Videos\ClipWeave Exports\ClipWeave_20261102_005410_4b709e"
```

The utility requires Node 18 or newer and accepts a parent folder or one numbered series folder. Existing manifests stay intact unless `--overwrite` is specified. Run `node create-lingying-drive-manifests.mjs --help` for metadata options. Avoid `--title` across a multi-series root because titles must remain unique.

Run it only once those local files have finished exporting; allow Drive to sync the files and manifests afterward. The command hashes local files without altering videos. Review the generated title, description, language, genres and production method before importing, or edit those details later in Studio.

Each listed episode must be an MP4, no larger than **200 MiB**. An optional JPEG, PNG or WebP cover must be no larger than **5 MiB**. Episode numbers must be unique; their original numbers and ordering are preserved. The manifest must list the complete intended episode set. Standard creators retain their five-minute limit; only the configured owner administrator has no duration limit. Existing media parsing, quotas, upload-disable and financial-review restrictions still apply.

The manifest format is:

```json
{
  "version": 1,
  "series": {
    "title": "A completed export",
    "description": "Replace this with the actual series description before publishing.",
    "language": "en",
    "genres": ["drama"],
    "creation_type": "ai-generated"
  },
  "episodes": [
    {"number": 1, "name": "001_title_001.mp4", "bytes": 123456, "sha256": "replace-with-the-actual-64-character-sha256"}
  ]
}
```

The displayed byte length and hash are examples, not valid values for an actual file. The generator supplies real values. File names are literal, case-sensitive names; do not use local paths or download URLs. A complete manifest describes the entire episode set, not just newly added files.

## What happens automatically

The watcher discovers eligible folders, validates the manifest and current source versions, and stages files privately in bounded resumable parts. It checks the staged SHA-256 hashes and media before a single database transaction creates the draft and all its episodes. Until validation finishes, no partial destination series is created. A successful import produces one admin notification with a link to its editable Studio draft.

Drafts start with all episodes free (`free_episodes=1000`), no featured selection and the normal minimum paid-price placeholder. Review pricing, details, subtitle languages, publisher attribution and rights before publishing. The importing owner remains the actual account owner; managed publisher profiles only affect public attribution. Importing does not create accounts, purchase a Pass, alter a wallet, generate earnings or call Stripe.

Source folders map to their destination once. Subsequent scans preserve edits made on LingYing. Changes to an already imported source are flagged for review instead of overwriting the destination. Deleting a destination does not erase its provenance or cause automatic re-creation. Removing a Drive folder does not delete a LingYing drama.

Use **Scan now** to request discovery, **Cancel** to stop an unfinished job, and **Retry** after correcting a failed source. Staging cleanup is durable and continues when imports are disabled. Root discovery happens every five minutes; transfer continuation uses the existing Durable Object alarm without replacing media-cleanup work. The background entry point is internal to the Durable Object; the public Worker rejects that reserved path.

## Verification and current limitations

Local unit, API, browser and Cloudflare checks use disposable fixtures. They do not prove access to the owner's private Drive. Real connection verification and enabling require the encrypted service-account key and Viewer share described above. The deployed watcher must remain disabled until those are configured and verified; a public Drive sign-in page cannot establish whether syncing has completed.

The service reads only configured source metadata and file contents with the Drive read-only scope. It stores provenance, progress, manifest/checksum data, admin audit records and notification states in the existing private database. This owner-operated import is separate from ordinary users' Google sign-in; Google login does not request Drive scope or persist a login Drive token.
