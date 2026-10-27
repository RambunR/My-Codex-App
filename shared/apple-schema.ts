export const APPLE_AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS apple_identities (
 subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS apple_oauth_attempts (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL,
 next_path TEXT NOT NULL, language TEXT NOT NULL, intent TEXT NOT NULL CHECK(intent IN ('signin','link')),
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS apple_oauth_attempts_expiry ON apple_oauth_attempts(expires_at);
`;
