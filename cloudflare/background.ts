import {getRuntime} from './runtime';
export {finishInBackground} from './runtime';
/** Durable alarms survive request completion and isolate eviction. */
export async function scheduleMediaCleanup(delayMs=60_000){
  const storage=getRuntime().storage,at=Date.now()+Math.max(1000,delayMs),existing=await storage.getAlarm();
  if(existing===null||existing>at)await storage.setAlarm(at);
}
