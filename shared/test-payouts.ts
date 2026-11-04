export const TEST_PAYOUT_MAX_CENTS=10_000_000;
export type TestPayoutStatus='pending'|'processing'|'transferred'|'payout_pending'|'paid'|'failed'|'rejected';
export interface TestPayoutRequest {
  id:string;gross_cents:number;fee_cents:number;net_cents:number;
  currency:string;provider_amount:number;exchange_rate:number;
  status:TestPayoutStatus;transfer_id:string|null;payout_id:string|null;
  error_code:string;created_at:string;updated_at:string;
}
export interface TestPayoutDashboard {
  unlimited:true;connectedAccount:string;platformAccount:string;ready:boolean;
  currency:string;exchangeRate:number;minimumCents:number;feeCents:number;maxCents:number;
  requests:TestPayoutRequest[];
}
