export const WECHAT_AUTH_SCHEMA=`
CREATE TABLE IF NOT EXISTS wechat_identities (
 app_id TEXT NOT NULL, open_id TEXT NOT NULL, user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 union_id TEXT, nickname TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(app_id,open_id), UNIQUE(app_id,union_id)
);
CREATE TABLE IF NOT EXISTS wechat_oauth_attempts (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, app_id TEXT NOT NULL,
 next_path TEXT NOT NULL, language TEXT NOT NULL, intent TEXT NOT NULL CHECK(intent IN ('signin','link')),
 user_id TEXT, session_hash TEXT, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_oauth_attempts_expiry ON wechat_oauth_attempts(expires_at);
CREATE TABLE IF NOT EXISTS wechat_registrations (
 token_hash TEXT PRIMARY KEY, app_id TEXT NOT NULL, open_id TEXT NOT NULL, union_id TEXT,
 nickname TEXT NOT NULL, next_path TEXT NOT NULL, language TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_registration_expiry ON wechat_registrations(expires_at);
CREATE TABLE IF NOT EXISTS wechat_registration_codes (
 token_hash TEXT PRIMARY KEY REFERENCES wechat_registrations(token_hash) ON DELETE CASCADE,
 email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, sent_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0)
);
CREATE TABLE IF NOT EXISTS wechat_email_limits (
 email_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, sent_at INTEGER NOT NULL, sends INTEGER NOT NULL
);
`;
