// Node keeps pending outbound requests alive; the Cloudflare adapter attaches
// the same promise to the Durable Object's waitUntil lifecycle.
export function finishInBackground<T>(promise:Promise<T>):Promise<T>{return promise;}
let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
/** Restart-safe work is in SQLite; this unref timer only wakes the worker. */
export async function scheduleMediaCleanup(delayMs=60_000){
  if(cleanupTimer)return;
  cleanupTimer=setTimeout(async()=>{cleanupTimer=undefined;try{const{cleanupSeriesMedia}=await import('./series-lifecycle.js');await cleanupSeriesMedia(undefined,40);}catch{void scheduleMediaCleanup();}},Math.max(0,delayMs));
  cleanupTimer.unref?.();
}
