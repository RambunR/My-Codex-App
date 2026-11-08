export const WECHAT_PAY_SCHEMA=`
CREATE TABLE IF NOT EXISTS payment_checkout_methods (
 payment_id TEXT NOT NULL, financial_mode TEXT NOT NULL CHECK(financial_mode IN ('default','test')),
 method TEXT NOT NULL CHECK(method IN ('card','wechat_pay')),
 PRIMARY KEY(payment_id,financial_mode)
);
CREATE TABLE IF NOT EXISTS wechat_funding_quotes (
 id TEXT PRIMARY KEY, financial_mode TEXT NOT NULL CHECK(financial_mode IN ('default','test')),
 user_id TEXT NOT NULL REFERENCES users(id), usd_cents INTEGER NOT NULL CHECK(usd_cents>=500),
 hkd_cents INTEGER NOT NULL CHECK(hkd_cents>0 AND hkd_cents<=99999999),
 rate_micros INTEGER NOT NULL CHECK(rate_micros>0), expires_at INTEGER NOT NULL,
 payment_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(payment_id,financial_mode)
);
CREATE INDEX IF NOT EXISTS wechat_funding_quote_owner ON wechat_funding_quotes(user_id,financial_mode,expires_at);
`;
