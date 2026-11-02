export const PUBLISHER_PROFILE_SCHEMA=`
CREATE TABLE IF NOT EXISTS publisher_profiles (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, registered_at TEXT NOT NULL,
 is_official INTEGER NOT NULL DEFAULT 0 CHECK(is_official IN (0,1)), legacy_owner_id TEXT,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS publisher_one_official ON publisher_profiles(is_official) WHERE is_official=1;
CREATE TABLE IF NOT EXISTS account_public_publishers (
 user_id TEXT PRIMARY KEY REFERENCES users(id), public_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS series_publisher_profiles (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
 publisher_id TEXT NOT NULL REFERENCES publisher_profiles(id),
 assigned_by TEXT NOT NULL REFERENCES users(id), assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS series_public_publisher ON series_publisher_profiles(publisher_id,series_id);
CREATE TABLE IF NOT EXISTS publisher_profile_events (
 id TEXT PRIMARY KEY, publisher_id TEXT REFERENCES publisher_profiles(id), series_id TEXT REFERENCES series(id),
 actor_id TEXT REFERENCES users(id), action TEXT NOT NULL CHECK(action IN ('bootstrap','create','update','assign','clear')),
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS publisher_profile_audit ON publisher_profile_events(publisher_id,created_at);
`;
