export const LUCKY_DRAW_SCHEMA=`
CREATE TABLE IF NOT EXISTS lucky_draw_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id), remaining INTEGER NOT NULL DEFAULT 1 CHECK(remaining>=0 AND remaining<=1000000),
 used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0), added INTEGER NOT NULL DEFAULT 0 CHECK(added>=0)
);
CREATE TABLE IF NOT EXISTS lucky_draw_pool (
 series_id TEXT PRIMARY KEY REFERENCES series(id), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 actor_id TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lucky_draw_results (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), series_id TEXT NOT NULL REFERENCES series(id),
 request_id TEXT NOT NULL, title TEXT NOT NULL, drawn_at TEXT NOT NULL,
 UNIQUE(user_id,request_id), UNIQUE(user_id,series_id)
);
CREATE INDEX IF NOT EXISTS lucky_draw_history ON lucky_draw_results(user_id,drawn_at DESC);
CREATE TABLE IF NOT EXISTS lucky_draw_grants (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000), reason TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(actor_id,request_id)
);
CREATE TABLE IF NOT EXISTS lucky_draw_pool_events (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), series_id TEXT NOT NULL REFERENCES series(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), title TEXT NOT NULL, created_at TEXT NOT NULL
);
`;
