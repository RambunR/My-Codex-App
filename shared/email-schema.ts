// Additive account-recovery state, shared by Node SQLite and Durable Object SQL.
export const ACCOUNT_EMAIL_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_email_verifications (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 verified_email TEXT NOT NULL, verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_email_tokens (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('reset','verify')), email TEXT NOT NULL,
 password_hash_snapshot TEXT, expires_at INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
 UNIQUE(user_id,kind)
);
CREATE INDEX IF NOT EXISTS account_email_tokens_expiry ON account_email_tokens(expires_at);
CREATE TABLE IF NOT EXISTS account_email_requests (
 subject_hash TEXT PRIMARY KEY, last_sent_at_ms INTEGER NOT NULL,
 window_start_ms INTEGER NOT NULL, attempts INTEGER NOT NULL
);
`;
