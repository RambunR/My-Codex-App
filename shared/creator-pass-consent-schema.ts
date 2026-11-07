export const CREATOR_PASS_CONSENT_SCHEMA=`
CREATE TABLE IF NOT EXISTS creator_pass_consents (
 payment_id TEXT NOT NULL,
 financial_mode TEXT NOT NULL CHECK(financial_mode IN ('default','test')),
 user_id TEXT NOT NULL REFERENCES users(id),
 policy_version TEXT NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 64),
 disclosure_version TEXT NOT NULL CHECK(length(disclosure_version) BETWEEN 1 AND 64),
 language TEXT NOT NULL CHECK(length(language) BETWEEN 2 AND 10),
 accepted INTEGER NOT NULL DEFAULT 1 CHECK(accepted=1),
 accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(payment_id,financial_mode,policy_version,disclosure_version)
);
CREATE INDEX IF NOT EXISTS creator_pass_consents_user ON creator_pass_consents(user_id,financial_mode,accepted_at);
CREATE TRIGGER IF NOT EXISTS creator_pass_consents_no_replace BEFORE INSERT ON creator_pass_consents
WHEN EXISTS(SELECT 1 FROM creator_pass_consents WHERE payment_id=NEW.payment_id AND financial_mode=NEW.financial_mode AND policy_version=NEW.policy_version AND disclosure_version=NEW.disclosure_version)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS creator_pass_consents_no_update BEFORE UPDATE ON creator_pass_consents
BEGIN SELECT RAISE(ABORT,'Creator Pass consent records are append-only.'); END;
CREATE TRIGGER IF NOT EXISTS creator_pass_consents_no_delete BEFORE DELETE ON creator_pass_consents
BEGIN SELECT RAISE(ABORT,'Creator Pass consent records are append-only.'); END;
`;
