import crypto from 'node:crypto';
import {config} from './config.js';
import {one,run,transaction} from './db.js';

// This identity comes only from trusted deployment configuration. Profile names,
// emails and request bodies must never establish administrator privileges.
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

export function creatorDisplayName(creatorId:string,fallbackName:string){
  return config.platformOwnerUserId&&creatorId===config.platformOwnerUserId
    ?config.officialCreatorName:fallbackName;
}
