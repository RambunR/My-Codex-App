export const EPISODE_BATCH_SCHEMA=`
CREATE TABLE IF NOT EXISTS episode_batch_confirmations (
 token_hash TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), actor_id TEXT NOT NULL REFERENCES users(id),
 revision TEXT NOT NULL, selection_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS episode_batch_confirmation_subject ON episode_batch_confirmations(series_id,actor_id);
CREATE INDEX IF NOT EXISTS episode_batch_confirmation_expiry ON episode_batch_confirmations(expires_at_ms);
CREATE TABLE IF NOT EXISTS episode_batch_events (
 id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('rename','reorder','delete')), snapshot_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS episode_batch_audit_subject ON episode_batch_events(series_id,created_at);
`;
