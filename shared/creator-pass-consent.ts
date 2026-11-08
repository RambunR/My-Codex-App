/** Versions identify the terms and acknowledgement actually presented at checkout. */
export const LEGAL_POLICY_VERSION='2026-11-08.1';
export const LEGAL_POLICY_EFFECTIVE_DATE='2026-11-08';
export const CREATOR_PASS_DISCLOSURE_VERSION='creator-pass-ack-v2';

export interface CreatorPassConsent{
  accepted:boolean;
  policy_version:string;
  disclosure_version:string;
}
