export const TEST_PAYOUT_SCHEMA=`
CREATE TABLE IF NOT EXISTS admin_test_withdrawals (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),platform_id TEXT NOT NULL,connected_account_id TEXT NOT NULL,
 request_key TEXT NOT NULL,gross_cents INTEGER NOT NULL CHECK(gross_cents>=1000),fee_cents INTEGER NOT NULL CHECK(fee_cents>=0),
 net_cents INTEGER NOT NULL CHECK(net_cents>0),currency TEXT NOT NULL CHECK(currency IN ('usd','hkd')),
 provider_amount INTEGER NOT NULL CHECK(provider_amount>0 AND provider_amount<=99999999),exchange_rate REAL NOT NULL CHECK(exchange_rate>0),
 policy_version TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','processing','transferred','payout_pending','paid','failed','rejected')),
 funding_amount INTEGER NOT NULL,funding_charge_id TEXT,transfer_id TEXT UNIQUE,destination_payment TEXT,payout_id TEXT,
 first_attempt_ms INTEGER,lease_token TEXT,lease_until_ms INTEGER NOT NULL DEFAULT 0,error_code TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(user_id,platform_id,request_key),CHECK(gross_cents=fee_cents+net_cents)
);
CREATE INDEX IF NOT EXISTS admin_test_withdrawal_owner ON admin_test_withdrawals(user_id,platform_id,created_at);
CREATE TABLE IF NOT EXISTS admin_test_withdrawal_events (
 id TEXT PRIMARY KEY,withdrawal_id TEXT NOT NULL REFERENCES admin_test_withdrawals(id),kind TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_test_payout_receipts (
 event_id TEXT PRIMARY KEY,connected_account_id TEXT NOT NULL,event_type TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT(datetime('now'))
);
`;
