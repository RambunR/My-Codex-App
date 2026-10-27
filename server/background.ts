// Node keeps pending outbound requests alive; the Cloudflare adapter attaches
// the same promise to the Durable Object's waitUntil lifecycle.
export function finishInBackground<T>(promise:Promise<T>):Promise<T>{return promise;}
