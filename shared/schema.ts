import {APPLE_AUTH_SCHEMA} from './apple-schema.js';
import {ACCOUNT_EMAIL_SCHEMA} from './email-schema.js';

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
CREATE TABLE IF NOT EXISTS platform_owner_access_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), previous_role TEXT NOT NULL,
 promoted_at TEXT NOT NULL DEFAULT (datetime('now'))
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
 number INTEGER NOT NULL CHECK(number > 0), duration REAL NOT NULL CHECK(duration > 0 AND duration <= 240),
 bytes INTEGER NOT NULL CHECK(bytes > 0), storage_key TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(series_id, number)
);
CREATE TABLE IF NOT EXISTS series_classifications (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
 themes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(themes) AND json_type(themes)='array' AND json_array_length(themes)<=5),
 format TEXT CHECK(format IS NULL OR format IN ('live-action','animation','anime-donghua','motion-comic')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS series_classifications_format ON series_classifications(format,series_id);
CREATE TABLE IF NOT EXISTS series_publications (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE, published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS series_moderation (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
 taken_down INTEGER NOT NULL DEFAULT 0 CHECK(taken_down IN (0,1)), reason TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS series_moderation_events (
 id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('takedown','restore','metadata')), reason TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS series_moderation_visibility ON series_moderation(taken_down,series_id);
CREATE INDEX IF NOT EXISTS series_moderation_audit ON series_moderation_events(series_id,created_at);
CREATE TABLE IF NOT EXISTS series_deletions (
 series_id TEXT PRIMARY KEY REFERENCES series(id), creator_id TEXT NOT NULL REFERENCES users(id),
 actor_id TEXT NOT NULL REFERENCES users(id), summary_json TEXT NOT NULL,
 deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS series_deletion_confirmations (
 token_hash TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), actor_id TEXT NOT NULL REFERENCES users(id),
 content_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS series_deletion_confirmation_subject ON series_deletion_confirmations(series_id,actor_id);
CREATE TABLE IF NOT EXISTS series_media_deletions (
 series_id TEXT NOT NULL REFERENCES series(id), creator_id TEXT NOT NULL REFERENCES users(id), object_key TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>=0), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
 attempts INTEGER NOT NULL DEFAULT 0, attempted_at_ms INTEGER, completed_at TEXT,
 PRIMARY KEY(series_id,object_key)
);
CREATE INDEX IF NOT EXISTS series_media_deletions_pending ON series_media_deletions(status,attempted_at_ms);
CREATE TABLE IF NOT EXISTS episode_upload_sessions (
 id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id), actor_id TEXT NOT NULL REFERENCES users(id),
 creator_id TEXT NOT NULL REFERENCES users(id), object_key TEXT NOT NULL UNIQUE, upload_id TEXT,
 episode_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, number INTEGER NOT NULL,
 filename TEXT NOT NULL, total_bytes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'creating'
 CHECK(status IN ('creating','uploading','completing','complete','cancelled')),
 cleanup_pending INTEGER NOT NULL DEFAULT 0, created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
 completed_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS episode_durations (
 episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
 seconds REAL NOT NULL CHECK(seconds>0 AND seconds<=240)
);
CREATE TABLE IF NOT EXISTS playback_session_times (
 session_id TEXT PRIMARY KEY REFERENCES playback_sessions(id) ON DELETE CASCADE,
 watched_ms INTEGER NOT NULL CHECK(watched_ms>=0 AND watched_ms<=240000),
 reported_ms INTEGER NOT NULL CHECK(reported_ms>=0 AND reported_ms<=240000)
);
CREATE INDEX IF NOT EXISTS episode_upload_owner_active ON episode_upload_sessions(creator_id,status,expires_at_ms);
CREATE INDEX IF NOT EXISTS episode_upload_cleanup ON episode_upload_sessions(cleanup_pending,expires_at_ms);
CREATE TABLE IF NOT EXISTS episode_upload_parts (
 session_id TEXT NOT NULL REFERENCES episode_upload_sessions(id), part_number INTEGER NOT NULL,
 bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, etag TEXT NOT NULL,
 PRIMARY KEY(session_id,part_number)
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
CREATE TABLE IF NOT EXISTS test_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 wallet_micros INTEGER NOT NULL DEFAULT 0 CHECK(wallet_micros >= 0 AND wallet_micros <= 9007199254740991),
 earnings_micros INTEGER NOT NULL DEFAULT 0 CHECK(earnings_micros >= 0 AND earnings_micros <= 9007199254740991),
 publisher_active INTEGER NOT NULL DEFAULT 0 CHECK(publisher_active IN (0,1))
);
CREATE TABLE IF NOT EXISTS test_payments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('funding','activation')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 99999999),
 currency TEXT NOT NULL CHECK(currency IN ('usd','hkd')), provider TEXT NOT NULL CHECK(provider='stripe'), provider_session TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed')), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS test_purchases (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), episode_id TEXT NOT NULL REFERENCES episodes(id),
 price_micros INTEGER NOT NULL CHECK(price_micros >= 0), creator_micros INTEGER NOT NULL CHECK(creator_micros >= 0),
 platform_micros INTEGER NOT NULL CHECK(platform_micros >= 0),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id,episode_id), CHECK(price_micros=creator_micros+platform_micros)
);
CREATE TABLE IF NOT EXISTS activation_promotion_quotes (
 payment_id TEXT NOT NULL, financial_mode TEXT NOT NULL CHECK(financial_mode IN ('default','test')),
 code TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL CHECK(currency='hkd'),
 regular_amount_cents INTEGER NOT NULL CHECK(regular_amount_cents > amount_cents), created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(payment_id,financial_mode)
);
CREATE TABLE IF NOT EXISTS managed_pass_promotions (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 discount_type TEXT NOT NULL CHECK(discount_type IN ('amount','percent')), discount_value INTEGER NOT NULL CHECK(discount_value>0),
 max_redemptions INTEGER CHECK(max_redemptions IS NULL OR max_redemptions>0), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS managed_pass_promotion_init (id INTEGER PRIMARY KEY CHECK(id=1), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS managed_pass_promotion_quotes (
 payment_id TEXT NOT NULL, financial_mode TEXT NOT NULL CHECK(financial_mode IN ('default','test')),
 promotion_id TEXT NOT NULL REFERENCES managed_pass_promotions(id), code TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 discount_type TEXT NOT NULL CHECK(discount_type IN ('amount','percent')), discount_value INTEGER NOT NULL CHECK(discount_value>0),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), regular_amount_cents INTEGER NOT NULL CHECK(regular_amount_cents>amount_cents),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(payment_id,financial_mode)
);
CREATE INDEX IF NOT EXISTS managed_pass_quote_usage ON managed_pass_promotion_quotes(promotion_id,financial_mode);
CREATE TABLE IF NOT EXISTS managed_pass_promotion_events (
 id TEXT PRIMARY KEY, promotion_id TEXT NOT NULL REFERENCES managed_pass_promotions(id), actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('create','update')), before_json TEXT, after_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS test_ledger (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, amount_micros INTEGER NOT NULL,
 reference_id TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_micros INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','rejected')),
 transfer_id TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment_provider_links (
 table_group TEXT NOT NULL CHECK(table_group IN ('default','test')), livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
 payment_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), provider_session TEXT NOT NULL,
 payment_intent TEXT, charge_id TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(table_group,livemode,payment_id), UNIQUE(table_group,livemode,provider_session),
 UNIQUE(table_group,livemode,payment_intent), UNIQUE(table_group,livemode,charge_id)
);
CREATE TABLE IF NOT EXISTS stripe_webhook_receipts (
 event_id TEXT PRIMARY KEY, financial_mode TEXT NOT NULL CHECK(financial_mode IN ('test','live')),
 event_type TEXT NOT NULL, object_id TEXT NOT NULL, payment_id TEXT NOT NULL, endpoint_host TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stripe_webhook_receipt_payment ON stripe_webhook_receipts(financial_mode,payment_id);
CREATE TABLE IF NOT EXISTS payment_risk_cases (
 id TEXT PRIMARY KEY, table_group TEXT NOT NULL CHECK(table_group IN ('default','test')),
 livemode INTEGER NOT NULL CHECK(livemode IN (0,1)), kind TEXT NOT NULL CHECK(kind IN ('refund','dispute')),
 provider_object_id TEXT NOT NULL, payment_intent TEXT, charge_id TEXT,
 payment_id TEXT, user_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents >= 0), currency TEXT NOT NULL DEFAULT '',
 provider_status TEXT NOT NULL DEFAULT 'unknown', provider_updated_at INTEGER NOT NULL DEFAULT 0,
 wallet_debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(wallet_debit_cents >= 0),
 platform_loss_cents INTEGER NOT NULL DEFAULT 0 CHECK(platform_loss_cents >= 0),
 pass_revoked INTEGER NOT NULL DEFAULT 0 CHECK(pass_revoked IN (0,1)),
 decision TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT,
 UNIQUE(table_group,livemode,kind,provider_object_id)
);
CREATE TABLE IF NOT EXISTS payment_risk_events (
 table_group TEXT NOT NULL CHECK(table_group IN ('default','test')), livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
 event_id TEXT NOT NULL, event_type TEXT NOT NULL, case_id TEXT REFERENCES payment_risk_cases(id),
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(table_group,livemode,event_id)
);
CREATE TABLE IF NOT EXISTS payment_review_resolutions (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES payment_risk_cases(id), actor_id TEXT NOT NULL REFERENCES users(id),
 decision TEXT NOT NULL CHECK(decision IN ('reconciled','platform_loss','provider_reversed')),
 wallet_delta_micros INTEGER NOT NULL DEFAULT 0, platform_loss_delta_cents INTEGER NOT NULL DEFAULT 0,
 pass_delta INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS payment_risk_user ON payment_risk_cases(table_group,livemode,user_id,status);
CREATE INDEX IF NOT EXISTS payment_risk_unmapped ON payment_risk_cases(table_group,livemode,status,payment_id);
CREATE INDEX IF NOT EXISTS payment_risk_provider ON payment_risk_cases(table_group,livemode,payment_intent,charge_id);
CREATE TABLE IF NOT EXISTS storage_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), requested_gb INTEGER NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS saves (user_id TEXT NOT NULL REFERENCES users(id), series_id TEXT NOT NULL REFERENCES series(id), PRIMARY KEY(user_id,series_id));
CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL REFERENCES users(id), episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE, seconds REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,episode_id));
CREATE TABLE IF NOT EXISTS series_likes (
 user_id TEXT NOT NULL REFERENCES users(id), series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,series_id)
);
CREATE TABLE IF NOT EXISTS playback_sessions (
 id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE, viewer_key TEXT NOT NULL,
 started_at_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL,
 watched_ms INTEGER NOT NULL DEFAULT 0 CHECK(watched_ms >= 0 AND watched_ms <= 180000),
 reported_ms INTEGER NOT NULL DEFAULT 0 CHECK(reported_ms >= 0 AND reported_ms <= 180000),
 counted_view INTEGER NOT NULL DEFAULT 0 CHECK(counted_view IN (0,1)), qualified_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS episodes_series ON episodes(series_id,number);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,created_at);
CREATE INDEX IF NOT EXISTS test_ledger_user ON test_ledger(user_id,created_at);
CREATE INDEX IF NOT EXISTS test_payments_user ON test_payments(user_id,created_at);
CREATE INDEX IF NOT EXISTS series_catalog ON series(status,language);
CREATE INDEX IF NOT EXISTS series_likes_series ON series_likes(series_id);
CREATE INDEX IF NOT EXISTS playback_episode_viewer ON playback_sessions(episode_id,viewer_key,started_at_ms);
CREATE INDEX IF NOT EXISTS playback_episode_qualified ON playback_sessions(episode_id,qualified_at_ms);
CREATE INDEX IF NOT EXISTS purchases_episode_created ON purchases(episode_id,created_at,user_id);
CREATE INDEX IF NOT EXISTS test_purchases_episode_created ON test_purchases(episode_id,created_at,user_id);
${APPLE_AUTH_SCHEMA}
${ACCOUNT_EMAIL_SCHEMA}
`;
