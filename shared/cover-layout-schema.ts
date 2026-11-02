export const COVER_LAYOUT_SCHEMA=`
CREATE TABLE IF NOT EXISTS series_cover_layouts (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
 aspect_ratio TEXT NOT NULL CHECK(aspect_ratio IN ('9:16','1:1','16:9')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
