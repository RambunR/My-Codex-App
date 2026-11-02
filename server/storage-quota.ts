import {one} from './db.js';
import type {StorageUsage,User} from '../shared/config.js';

/** Read the media owner's current persisted role without promoting accounts or
 * touching payment state inside upload transactions. Authentication performs
 * trusted, audited administrator promotion before an owner's own requests. */
export function getOwnerStorage(userId:string):StorageUsage {
  const user=one<Pick<User,'used_bytes'|'quota_bytes'|'role'>>('SELECT used_bytes,quota_bytes,role FROM users WHERE id=?',userId)!;
  return{used_bytes:user.used_bytes,quota_bytes:user.quota_bytes,storage_unlimited:user.role==='admin'};
}
export function withinStorageQuota(owner:StorageUsage,totalBytes:number){
  return owner.storage_unlimited===true||totalBytes<=owner.quota_bytes;
}
