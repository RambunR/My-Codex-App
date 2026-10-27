import crypto from 'node:crypto';
import {z} from 'zod';
import {one,run,db} from './db.js';
import {hashPassword} from './auth.js';

const email=z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password=z.string().min(16).max(128).parse(process.env.ADMIN_PASSWORD);
if(one('SELECT id FROM users WHERE email=?',email))throw new Error('An account already uses this email. Use a different address; existing accounts are not overwritten.');
run("INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,?, 'admin')",crypto.randomUUID(),email,process.env.ADMIN_NAME||'Platform administrator',await hashPassword(password));
console.log('Administrator created. No password was logged.');db.close();
