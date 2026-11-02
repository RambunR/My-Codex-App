import crypto from 'node:crypto';
import {config} from './config.js';
import {one,run,transaction} from './db.js';

// This immutable owner identity comes only from trusted deployment configuration.
// Profile names and request bodies never establish administrator privileges.
export function ensurePlatformOwnerAccess(){
  const userId=config.platformOwnerUserId;
  if(!userId)return false;
  const owner=one<{role:string}>('SELECT role FROM users WHERE id=?',userId);
  if(!owner||owner.role==='admin')return false;
  return transaction(()=>{
    const current=one<{role:string}>('SELECT role FROM users WHERE id=?',userId);
    if(!current||current.role==='admin')return false;
    run("UPDATE users SET role='admin' WHERE id=?",userId);
    run('INSERT INTO platform_owner_access_events (id,user_id,previous_role) VALUES (?,?,?)',crypto.randomUUID(),userId,current.role);
    return true;
  });
}

interface AdminCandidate {id:string;email:string;role:string}
function configuredAdminCandidate(userId:string,expectedHash:string){
  const user=one<AdminCandidate>('SELECT id,email,role FROM users WHERE id=?',userId);
  if(!user||user.role==='admin')return undefined;
  const actual=crypto.createHash('sha256').update(user.email.trim().toLowerCase()).digest();
  if(!crypto.timingSafeEqual(actual,Buffer.from(expectedHash,'hex')))return undefined;
  const verified=one(`SELECT 1 FROM users u WHERE u.id=? AND (
    EXISTS(SELECT 1 FROM account_email_verifications v WHERE v.user_id=u.id AND v.verified_email=u.email COLLATE NOCASE)
    OR EXISTS(SELECT 1 FROM oauth_identities i WHERE i.user_id=u.id AND i.provider='google' AND i.email=u.email COLLATE NOCASE)
  )`,userId);
  return verified?user:undefined;
}

/** A trusted email selector is effective only after server-verified identity proof. */
export function ensureConfiguredAdminAccess(userId:string){
  const expectedHash=config.platformAdminEmailHash.trim();
  if(!/^[a-f\d]{64}$/i.test(expectedHash)||!configuredAdminCandidate(userId,expectedHash))return false;
  return transaction(()=>{
    // Repeat both checks inside the role/audit transaction; no profile field can
    // substitute for the current verified email or signed Google identity.
    const current=configuredAdminCandidate(userId,expectedHash);
    if(!current)return false;
    run("UPDATE users SET role='admin' WHERE id=?",userId);
    run('INSERT INTO platform_owner_access_events (id,user_id,previous_role) VALUES (?,?,?)',crypto.randomUUID(),userId,current.role);
    return true;
  });
}

export function creatorDisplayName(creatorId:string,fallbackName:string){
  return config.platformOwnerUserId&&creatorId===config.platformOwnerUserId
    ?config.officialCreatorName:fallbackName;
}
