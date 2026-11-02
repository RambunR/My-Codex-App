export const FUNDING_REWARD_OFFER_VERSION='wallet-funding-v1';
export const WALLET_FUNDING_OPTIONS={
  presetAmountsCents:[1000,2500,5000,10000],
  rewards:[{amountCents:5000,bonusCents:500},{amountCents:10000,bonusCents:1500}],
  offerVersion:FUNDING_REWARD_OFFER_VERSION,
} as const;

export interface FundingRewardQuote {
  amountCents:number;
  bonusCents:number;
  totalCreditCents:number;
  currency:'usd';
  offerVersion:string|null;
}

/** Historical versions stay explicit: editing the current advertised offer
 * must never reprice a saved Checkout proof or reward an older unpaid record. */
export function fundingRewardForVersion(version:string,amountCents:number):number|null {
  if(version!=='wallet-funding-v1')return null;
  if(!Number.isSafeInteger(amountCents)||amountCents<0)return null;
  return amountCents===5000?500:amountCents===10000?1500:0;
}

// Shared display arithmetic only. Settlement requires a server-stored proof.
export function fundingRewardQuote(amountCents:number):FundingRewardQuote {
  if(!Number.isSafeInteger(amountCents)||amountCents<0)throw new RangeError('Funding must be a nonnegative whole number of USD cents.');
  const bonusCents=fundingRewardForVersion(FUNDING_REWARD_OFFER_VERSION,amountCents);
  if(bonusCents===null)throw new RangeError('The funding reward version is unavailable.');
  const totalCreditCents=amountCents+bonusCents;
  if(!Number.isSafeInteger(totalCreditCents))throw new RangeError('Funding credit exceeds the supported range.');
  return{amountCents,bonusCents,totalCreditCents,currency:'usd',offerVersion:FUNDING_REWARD_OFFER_VERSION};
}
