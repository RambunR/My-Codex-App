// The requested amount is the total reserved from available earnings. The fee
// is included in that amount, so a US$10 request transfers US$9 to the creator.
export const WITHDRAWAL_POLICY = {
  version: 'withdrawal-usd-v1',
  minimumCents: 1000,
  feeCents: 100,
  processingMinDays: 3,
  processingMaxDays: 5,
} as const;
