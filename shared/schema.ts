export const DATABASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer','publisher','admin')),
 publisher_active INTEGER NOT NULL DEFAULT 0, language TEXT NOT NULL DEFAULT 'en',
 wallet_micros INTEGER NOT NULL DEFAULT 0 CHECK(wallet_micros >= 0),
 earnings_micros INTEGER NOT NULL DEFAULT 0 CHECK(earnings_micros >= 0),
 quota_bytes INTEGER NOT NULL DEFAULT 5368709120 CHECK(quota_bytes >= 0), used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
 stripe_account_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_identities (
 provider TEXT NOT NULL CHECK(provider='google'), subject TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(provider,subject), UNIQUE(user_id,provider)
);
CREATE TABLE IF NOT EXISTS oauth_attempts (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL,
 next_path TEXT NOT NULL, language TEXT NOT NULL, intent TEXT NOT NULL CHECK(intent IN ('signin','link')),
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_attempts_expiry ON oauth_attempts(expires_at);
CREATE TABLE IF NOT EXISTS series (
 id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL,
 language TEXT NOT NULL, genres TEXT NOT NULL, creation_type TEXT NOT NULL DEFAULT 'human',
 price_cents INTEGER NOT NULL DEFAULT 30 CHECK(price_cents >= 10), free_episodes INTEGER NOT NULL DEFAULT 2 CHECK(free_episodes >= 0),
 cover_key TEXT NOT NULL DEFAULT '', cover_bytes INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 views INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS episodes (
 id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE, title TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number > 0), duration REAL NOT NULL CHECK(duration > 0 AND duration <= 180),
 bytes INTEGER NOT NULL CHECK(bytes > 0), storage_key TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(series_id, number)
);
CREATE TABLE IF NOT EXISTS purchases (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), episode_id TEXT NOT NULL REFERENCES episodes(id),
 price_micros INTEGER NOT NULL, creator_micros INTEGER NOT NULL, platform_micros INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id,episode_id)
);
CREATE TABLE IF NOT EXISTS ledger (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, amount_micros INTEGER NOT NULL,
 reference_id TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('funding','activation')),
 amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, provider TEXT NOT NULL, provider_session TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_micros INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','rejected')),
 transfer_id TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS storage_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), requested_gb INTEGER NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS saves (user_id TEXT NOT NULL REFERENCES users(id), series_id TEXT NOT NULL REFERENCES series(id), PRIMARY KEY(user_id,series_id));
CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL REFERENCES users(id), episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE, seconds REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,episode_id));
CREATE INDEX IF NOT EXISTS episodes_series ON episodes(series_id,number);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,created_at);
CREATE INDEX IF NOT EXISTS series_catalog ON series(status,language);
`;
