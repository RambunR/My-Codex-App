import {AsyncLocalStorage} from 'node:async_hooks';

// Only a verified webhook can establish an event's financial partition. Keeping
// it request-local lets late live events settle while the viewer app is testing.
export interface VerifiedStripeEventContext {
  testState:boolean;
  livemode:boolean;
  configured:true;
}
const events=new AsyncLocalStorage<Readonly<VerifiedStripeEventContext>>();
export const verifiedStripeEventContext=()=>events.getStore();
export function runWithVerifiedStripeEventContext<T>(context:VerifiedStripeEventContext,work:()=>T):T{
  return events.run(Object.freeze({...context}),work);
}
