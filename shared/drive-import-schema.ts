// Import provenance intentionally keeps destination IDs as plain text. Deleting
// a drama must not delete its source mapping and cause automatic re-creation.
export const DRIVE_IMPORT_SCHEMA=`
CREATE TABLE IF NOT EXISTS drive_import_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 folder_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
 verified_at INTEGER,verified_folder_id TEXT NOT NULL DEFAULT '',verified_credential_hash TEXT NOT NULL DEFAULT '',verified_owner_id TEXT NOT NULL DEFAULT '',
 scan_token TEXT NOT NULL DEFAULT '',scan_requested INTEGER NOT NULL DEFAULT 0 CHECK(scan_requested IN(0,1)),updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS drive_import_jobs (
 id TEXT PRIMARY KEY,root_folder_id TEXT NOT NULL,folder_id TEXT NOT NULL,folder_name TEXT NOT NULL,
 owner_id TEXT NOT NULL,config_revision INTEGER NOT NULL DEFAULT 1,
 manifest_hash TEXT NOT NULL DEFAULT '',manifest_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(manifest_json)),
 source_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_snapshot_json)),
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN('waiting','downloading','validating','complete','error','cancelled','review')),
 series_id TEXT,message TEXT NOT NULL DEFAULT '',error_code TEXT NOT NULL DEFAULT '',
 next_check_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease_token TEXT NOT NULL DEFAULT '',retry_count INTEGER NOT NULL DEFAULT 0,
 cleanup_needed INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_needed IN(0,1)),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(root_folder_id,folder_id)
);
CREATE INDEX IF NOT EXISTS drive_import_jobs_due ON drive_import_jobs(status,next_check_at,lease_until);
CREATE TABLE IF NOT EXISTS drive_import_files (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES drive_import_jobs(id) ON DELETE CASCADE,
 drive_file_id TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('video','cover')),
 number INTEGER NOT NULL DEFAULT 0 CHECK((kind='cover' AND number=0) OR(kind='video' AND number BETWEEN 1 AND 1000)),
 bytes INTEGER NOT NULL CHECK(bytes>0),sha256 TEXT NOT NULL,drive_version TEXT NOT NULL,
 drive_md5 TEXT NOT NULL DEFAULT '',object_key TEXT NOT NULL DEFAULT '',upload_id TEXT,
 next_part INTEGER NOT NULL DEFAULT 1 CHECK(next_part>=1),parts_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(parts_json)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','uploading','assembled','validated')),
 duration REAL,cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_pending IN(0,1)),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(job_id,drive_file_id),UNIQUE(job_id,name),UNIQUE(job_id,kind,number)
);
CREATE UNIQUE INDEX IF NOT EXISTS drive_import_object_key ON drive_import_files(object_key) WHERE object_key<>'';
CREATE INDEX IF NOT EXISTS drive_import_files_job ON drive_import_files(job_id,status);
CREATE TABLE IF NOT EXISTS drive_import_clipweave_schedule (id INTEGER PRIMARY KEY CHECK(id=1),next_discovery_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS drive_import_clipweave_exports (
 id TEXT PRIMARY KEY,root_folder_id TEXT NOT NULL,export_folder_id TEXT NOT NULL,owner_id TEXT NOT NULL,
 config_revision INTEGER NOT NULL,next_check_at INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',
 UNIQUE(root_folder_id,export_folder_id)
);
CREATE TABLE IF NOT EXISTS drive_import_clipweave_jobs (
 job_id TEXT PRIMARY KEY REFERENCES drive_import_jobs(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,
 export_folder_id TEXT NOT NULL,export_id TEXT NOT NULL,source_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(snapshot_json)),
 original_series_complete INTEGER,UNIQUE(owner_id,export_id,source_id)
);
CREATE TABLE IF NOT EXISTS drive_import_clipweave_assets (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES drive_import_jobs(id) ON DELETE CASCADE,
 path TEXT NOT NULL,role TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('media','support')),
 drive_file_id TEXT NOT NULL,parent_id TEXT NOT NULL,drive_version TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0),sha256 TEXT NOT NULL,drive_sha256 TEXT NOT NULL DEFAULT '',
 media_file_id TEXT,expected_duration REAL,verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN(0,1)),
 offset INTEGER NOT NULL DEFAULT 0,hash_state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(hash_state_json)),
 UNIQUE(job_id,path),UNIQUE(job_id,drive_file_id)
);
CREATE INDEX IF NOT EXISTS drive_import_clipweave_assets_pending ON drive_import_clipweave_assets(job_id,kind,verified);
CREATE TABLE IF NOT EXISTS drive_import_notifications (
 id TEXT PRIMARY KEY,job_id TEXT REFERENCES drive_import_jobs(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN('complete','error','attention')),title TEXT NOT NULL,message TEXT NOT NULL,
 series_id TEXT,read_at TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS drive_import_notification_unread ON drive_import_notifications(read_at,created_at);
CREATE TABLE IF NOT EXISTS drive_import_events (
 id TEXT PRIMARY KEY,actor_id TEXT,actor_type TEXT NOT NULL CHECK(actor_type IN('SYSTEM','owner')),
 action TEXT NOT NULL,job_id TEXT,summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS drive_import_event_no_replace BEFORE INSERT ON drive_import_events
WHEN EXISTS(SELECT 1 FROM drive_import_events WHERE id=NEW.id) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS drive_import_event_no_update BEFORE UPDATE ON drive_import_events
BEGIN SELECT RAISE(ABORT,'Drive import audit records are append-only.'); END;
CREATE TRIGGER IF NOT EXISTS drive_import_event_no_delete BEFORE DELETE ON drive_import_events
BEGIN SELECT RAISE(ABORT,'Drive import audit records are append-only.'); END;
`;
