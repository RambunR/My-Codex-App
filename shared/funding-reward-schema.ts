export const FUNDING_REWARD_SCHEMA=`
CREATE TABLE IF NOT EXISTS wallet_funding_quotes (
 payment_id TEXT NOT NULL, financial_mode TEXT NOT NULL CHECK(financial_mode IN ('default','test')),
 user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 bonus_cents INTEGER NOT NULL CHECK(bonus_cents>=0 AND bonus_cents<=amount_cents),
 offer_version TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(payment_id,financial_mode)
);
CREATE INDEX IF NOT EXISTS wallet_funding_quotes_user ON wallet_funding_quotes(user_id,financial_mode,created_at);
`;
