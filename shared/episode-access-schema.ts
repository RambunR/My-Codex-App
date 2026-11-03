/** Additive metadata keeps existing episode/purchase references untouched. */
export const EPISODE_ACCESS_SCHEMA=`
CREATE TABLE IF NOT EXISTS series_episode_access_settings (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
 last_episode_free INTEGER NOT NULL DEFAULT 0 CHECK(last_episode_free IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
