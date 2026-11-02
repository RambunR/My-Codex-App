// Cash recovery stays in the original risk rows. Gift allocations are separate
// so overlapping partial refunds/disputes cannot recover the same gift twice.
export const FUNDING_RISK_SCHEMA=`
CREATE TABLE IF NOT EXISTS funding_bonus_review_allocations (
 case_id TEXT PRIMARY KEY REFERENCES payment_risk_cases(id),
 bonus_debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(bonus_debit_cents>=0),
 bonus_loss_cents INTEGER NOT NULL DEFAULT 0 CHECK(bonus_loss_cents>=0)
);
`;
