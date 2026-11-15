// This path is reachable only through an internal Durable Object stub. The
// outer Worker must reject it before canonical redirects or API forwarding.
export const DRIVE_IMPORT_INTERNAL_PATH='/_lingying_internal/drive_tick';
export const DRIVE_IMPORT_INTERNAL_URL=`https://internal.lingying.invalid${DRIVE_IMPORT_INTERNAL_PATH}`;
export function blocksPublicDriveTick(request:Request){
  return new URL(request.url).pathname===DRIVE_IMPORT_INTERNAL_PATH;
}
export function isInternalDriveTick(request:Request){
  return request.method==='POST'&&request.url===DRIVE_IMPORT_INTERNAL_URL;
}
export async function dispatchDriveTick(stub:{fetch:(request:Request)=>Promise<unknown>}){
  await stub.fetch(new Request(DRIVE_IMPORT_INTERNAL_URL,{method:'POST'}));
}
