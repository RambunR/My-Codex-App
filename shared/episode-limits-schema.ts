import {MAX_EPISODE_SECONDS} from './config.js';

// Retain the historical 180/240-second tables and all referenced rows.
export const EPISODE_LIMITS_SCHEMA=`
CREATE TABLE IF NOT EXISTS episode_durations_extended (
 episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
 seconds REAL NOT NULL CHECK(seconds>0 AND seconds<=${MAX_EPISODE_SECONDS})
);
CREATE TABLE IF NOT EXISTS playback_session_times_extended (
 session_id TEXT PRIMARY KEY REFERENCES playback_sessions(id) ON DELETE CASCADE,
 watched_ms INTEGER NOT NULL CHECK(watched_ms>=0 AND watched_ms<=${MAX_EPISODE_SECONDS*1000}),
 reported_ms INTEGER NOT NULL CHECK(reported_ms>=0 AND reported_ms<=${MAX_EPISODE_SECONDS*1000})
);
CREATE TABLE IF NOT EXISTS episode_price_cap_events (
 id INTEGER PRIMARY KEY,series_id TEXT NOT NULL REFERENCES series(id),policy_key TEXT NOT NULL,
 before_price_cents INTEGER NOT NULL,after_price_cents INTEGER NOT NULL,
 actor_type TEXT NOT NULL DEFAULT 'SYSTEM' CHECK(actor_type='SYSTEM'),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS episode_price_cap_no_replace BEFORE INSERT ON episode_price_cap_events
WHEN EXISTS(SELECT 1 FROM episode_price_cap_events WHERE id=NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS episode_price_cap_no_update BEFORE UPDATE ON episode_price_cap_events
BEGIN SELECT RAISE(ABORT,'Episode price cap audit records are append-only.'); END;
CREATE TRIGGER IF NOT EXISTS episode_price_cap_no_delete BEFORE DELETE ON episode_price_cap_events
BEGIN SELECT RAISE(ABORT,'Episode price cap audit records are append-only.'); END;
`;
