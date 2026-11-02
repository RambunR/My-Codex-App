export const CATALOG_RETIREMENT_SCHEMA=`
CREATE TABLE IF NOT EXISTS retired_catalog_series (
 series_id TEXT PRIMARY KEY REFERENCES series(id), operation_key TEXT NOT NULL,
 retired_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS retired_catalog_operation ON retired_catalog_series(operation_key,series_id);
CREATE TABLE IF NOT EXISTS catalog_retirement_runs (
 id TEXT PRIMARY KEY, operation_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('blocked','applied')),
 actor_type TEXT NOT NULL DEFAULT 'SYSTEM' CHECK(actor_type='SYSTEM'),
 actor_id TEXT REFERENCES users(id) CHECK(actor_id IS NULL),
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_retirement_applied ON catalog_retirement_runs(operation_key) WHERE status='applied';
`;
