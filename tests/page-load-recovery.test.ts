import test from 'node:test';
import assert from 'node:assert/strict';
import {PAGE_RECOVERY_KEY,PAGE_RECOVERY_TTL,isPageAssetError,isPageReloadBlocked,registerPageReloadBlocker,reservePageRecovery} from '../src/page-load-recovery';

function session(){const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}

test('one automatic recovery survives a new bootstrap and another route, then expires after ten minutes',()=>{
  const storage=session(),now=1_800_000_000_000;
  assert.equal(reservePageRecovery(storage,now),true);
  assert.equal(reservePageRecovery(storage,now+1),false);
  assert.equal(reservePageRecovery(storage,now+PAGE_RECOVERY_TTL-1),false);
  assert.equal(reservePageRecovery(storage,now+PAGE_RECOVERY_TTL),true);
  assert.deepEqual(JSON.parse(storage.getItem(PAGE_RECOVERY_KEY)!),{at:now+PAGE_RECOVERY_TTL});
});

test('unavailable, nonpersisting or corrupt storage falls back to manual recovery instead of a reload loop',()=>{
  assert.equal(reservePageRecovery({getItem:()=>{throw new Error('Storage disabled');},setItem:()=>{}}),false);
  assert.equal(reservePageRecovery({getItem:()=>null,setItem:()=>{throw new Error('Storage full');}}),false);
  assert.equal(reservePageRecovery({getItem:()=>null,setItem:()=>{}}),false);
  for(const value of ['invalid','null','{}','{"at":"yesterday"}']){
    const storage=session();storage.setItem(PAGE_RECOVERY_KEY,value);assert.equal(reservePageRecovery(storage),false);
  }
});

test('CSS and dynamic-import failures are recoverable while application exceptions are not auto-refreshed',()=>{
  for(const message of ['Unable to preload CSS for /assets/Studio-fnGXNfyS.css','Failed to fetch dynamically imported module: /assets/Studio-old.js','Importing a module script failed.','error loading dynamically imported module'])assert.equal(isPageAssetError(new Error(message)),true);
  for(const value of [undefined,null,42,new Error('Cannot read properties of undefined'),new Error('Payment declined'),new Error('Upload cancelled')])assert.equal(isPageAssetError(value),false);
});

test('synchronous upload guards block refresh until every active transfer has finished',()=>{
  let uploading=false;const release=registerPageReloadBlocker(()=>uploading),releaseOther=registerPageReloadBlocker(()=>false);
  try{
    assert.equal(isPageReloadBlocked(),false);uploading=true;assert.equal(isPageReloadBlocked(),true);
    releaseOther();assert.equal(isPageReloadBlocked(),true);uploading=false;assert.equal(isPageReloadBlocked(),false);
    const releaseFailed=registerPageReloadBlocker(()=>{throw new Error('Guard unavailable');});assert.equal(isPageReloadBlocked(),true);releaseFailed();assert.equal(isPageReloadBlocked(),false);
  }finally{release();releaseOther();}
});
