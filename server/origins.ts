import type {Request,Response,NextFunction} from 'express';
import {config} from './config.js';
import {assert} from './errors.js';

// Browser/API locations and the stable Stripe financial identity can move
// independently, preserving pending Checkout metadata during hostname changes.
export const apiOrigin=()=>new URL(config.appUrl).origin;
export const publicAppUrl=()=>new URL(config.publicUrl||config.appUrl).origin;
export const stripeSiteOrigin=()=>new URL(config.stripeSiteOrigin||config.appUrl).origin;
export function trustedOrigins(){return new Set([apiOrigin(),publicAppUrl()]);}

export function publicRedirect(path:string){
  // Only site-relative destinations are accepted, even if a future caller
  // accidentally passes an absolute or protocol-relative URL.
  const safe=path.startsWith('/')&&!path.startsWith('//')&&!/[\\\u0000-\u001f]/.test(path)?path:'/';
  return publicAppUrl()===apiOrigin()?safe:publicAppUrl()+safe;
}
export function apiUrl(path:string){
  return publicAppUrl()===apiOrigin()?path:apiOrigin()+path;
}

const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE']);
const headers=new Set(['content-type','range']);
export function credentialedCors(req:Request,res:Response,next:NextFunction){
  try{
    res.vary('Origin');
    const origin=req.headers.origin;
    const allowed=origin!==undefined&&trustedOrigins().has(origin);
    if(allowed){
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Access-Control-Allow-Credentials','true');
    }
    if(req.method==='OPTIONS'){
      res.vary('Access-Control-Request-Method');res.vary('Access-Control-Request-Headers');
      const method=req.headers['access-control-request-method'];
      const requested=String(req.headers['access-control-request-headers']||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
      assert(allowed&&typeof method==='string'&&methods.has(method)&&requested.every(value=>headers.has(value)),403,'INVALID_ORIGIN','This request origin or preflight is not allowed.');
      res.setHeader('Access-Control-Allow-Methods',[...methods].join(', '));
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Range');
      res.setHeader('Access-Control-Max-Age','300');
      res.status(204).end();return;
    }
    next();
  }catch(error){next(error);}
}
