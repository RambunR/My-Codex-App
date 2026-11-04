// New requests have no platform withdrawal fee. Previously saved request terms
// keep their original amounts and provider retry keys.
export const WITHDRAWAL_POLICY = {
  version: 'withdrawal-usd-v2-no-fee',
  minimumCents: 1000,
  feeCents: 0,
  processingMinDays: 3,
  processingMaxDays: 5,
} as const;
