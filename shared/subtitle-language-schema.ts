export const SUBTITLE_LANGUAGE_SCHEMA=`
CREATE TABLE IF NOT EXISTS series_subtitle_languages (
 series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
 languages TEXT NOT NULL CHECK(json_valid(languages) AND json_type(languages)='array' AND json_array_length(languages)<=21),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
