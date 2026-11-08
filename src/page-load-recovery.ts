export const PAGE_RECOVERY_KEY='lingying-page-recovery-v1';
export const PAGE_RECOVERY_TTL=10*60_000;

const blockers=new Set<()=>boolean>();
const listeners=new Set<()=>void>();
let uploadNotice=false;
let lastPreloadError:unknown;
let preloadSequence=0;
let installed=false;

export function isPageAssetError(error:unknown):boolean{
  const message=error&&typeof error==='object'&&'message' in error?String(error.message):typeof error==='string'?error:'';
  return /Unable to preload CSS|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|Loading (?:CSS )?chunk .+ failed/i.test(message);
}
export function isPageReloadBlocked(){
  for(const blocked of blockers){try{if(blocked())return true;}catch{return true;}}
  return false;
}
export function notifyPageReloadSafety(){for(const listener of listeners)listener();}
export function registerPageReloadBlocker(blocked:()=>boolean){
  blockers.add(blocked);notifyPageReloadSafety();
  return()=>{blockers.delete(blocked);notifyPageReloadSafety();};
}
export function subscribePageRecovery(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function getPageRecoveryNotice(){return uploadNotice;}

/** Reserve one automatic refresh before navigating. The marker deliberately
 * survives bootstrap and successful Home loads so a broken release cannot loop. */
export function reservePageRecovery(storage:Pick<Storage,'getItem'|'setItem'>,now=Date.now()){
  try{
    const saved=storage.getItem(PAGE_RECOVERY_KEY);
    if(saved){const record=JSON.parse(saved);if(!Number.isFinite(record?.at)||now<record.at+PAGE_RECOVERY_TTL)return false;}
    const value=JSON.stringify({at:now});storage.setItem(PAGE_RECOVERY_KEY,value);
    return storage.getItem(PAGE_RECOVERY_KEY)===value;
  }catch{return false;}
}
function automaticRefresh(){
  if(isPageReloadBlocked()||navigator.onLine===false)return false;
  let reserved=false;try{reserved=reservePageRecovery(window.sessionStorage);}catch{/* Manual recovery remains available. */}
  if(!reserved)return false;
  window.location.reload();return true;
}
export function refreshPage(){
  if(isPageReloadBlocked())return false;
  // A manual retry does not clear the automatic-attempt marker.
  window.location.reload();return true;
}

export function installPageLoadRecovery(){
  if(installed)return;installed=true;
  window.addEventListener('vite:preloadError',((event:Event&{payload?:unknown})=>{
    if(!isPageAssetError(event.payload))return;
    lastPreloadError=event.payload;preloadSequence++;
    // Never turn a background preload failure into an upload interruption.
    // Vite may continue after preventDefault; the wrapper checks this sequence.
    if(isPageReloadBlocked()){event.preventDefault();uploadNotice=true;notifyPageReloadSafety();}
  }) as EventListener);
}

/** Every lazy page goes through the same bounded recovery path, including
 * CSS preload errors raised before its JavaScript import is evaluated. */
export async function loadPageModule<T>(load:()=>Promise<T>):Promise<T>{
  const sequence=preloadSequence;
  try{
    const module=await load();
    if(sequence!==preloadSequence&&uploadNotice)throw lastPreloadError;
    return module;
  }catch(error){
    if(!isPageAssetError(error))throw error;
    if(isPageReloadBlocked()){
      uploadNotice=true;notifyPageReloadSafety();
      // Route navigation is independently blocked by the upload guard. Do not
      // replace a mounted editor with an error screen while it is transferring.
      return new Promise<T>(()=>{});
    }
    if(automaticRefresh())return new Promise<T>(()=>{});
    throw error;
  }
}
