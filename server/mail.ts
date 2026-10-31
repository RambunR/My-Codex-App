import {config} from './config.js';
import {publicAppUrl} from './origins.js';
import {z} from 'zod';

type MailKind='reset'|'verify';
type MailProvider='cloudflare'|'resend';
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

function sender(){
  const value=config.mailFrom.trim();
  if(!value||value.length>400||/[\u0000-\u001f\u007f]/.test(value))return null;
  const named=/^([^<>]+)<([^<>]+)>$/.exec(value);
  const address=(named?.[2]||value).trim();
  if(!z.email().max(254).safeParse(address).success)return null;
  const name=named?.[1].trim().replace(/^"(.*)"$/,'$1');
  return name?{address,name}:{address};
}

function provider():MailProvider|null{
  const selected=config.mailProvider||'auto';
  if(selected==='cloudflare'||selected==='resend')return selected;
  if(selected!=='auto')return null;
  return config.cloudflareEmailAccountId&&config.cloudflareEmailApiToken?'cloudflare':'resend';
}

export function mailEnabled(){
  if(!sender())return false;
  switch(provider()){
    case'cloudflare':return /^[a-f\d]{32}$/i.test(config.cloudflareEmailAccountId)&&!!config.cloudflareEmailApiToken&&!/[\r\n]/.test(config.cloudflareEmailApiToken);
    case'resend':return Boolean(config.resendApiKey&&!/[\r\n]/.test(config.resendApiKey));
    default:return false;
  }
}

export async function sendAccountEmail(email:string,kind:MailKind,token:string,requestId:string){
  if(!mailEnabled())throw new Error('Account email delivery is unavailable.');
  // The deployment's trusted origin determines every link, never a request Host.
  const url=new URL('/auth',publicAppUrl());
  url.search=new URLSearchParams({mode:kind==='reset'?'reset':'verify'}).toString();
  // Fragments never reach Worker access logs or HTTP Referer headers.
  url.hash=new URLSearchParams({token}).toString();
  const title=kind==='reset'?'Reset your LingYing password':'Verify your LingYing email';
  const instruction=kind==='reset'?'Use this secure link to choose a new password for your LingYing account.':'Confirm that this email address belongs to you to verify your LingYing account.';
  const expiry=kind==='reset'?'This link expires in 30 minutes and can be used once.':'This link expires in 24 hours and can be used once.';
  const ignore=kind==='reset'?'If you did not request a password reset, you can ignore this email. Your password has not changed.':'If you did not request this email, you can ignore it.';
  const text=`${title}\n\n${instruction}\n\n${url.href}\n\n${expiry}\n\n${ignore}\n\nLingYing`;
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f7;padding:24px;color:#202024"><main style="max-width:560px;margin:auto;background:#fff;padding:32px;border-radius:20px"><p style="font-weight:bold;color:#ff684d">LingYing</p><h1 style="font-size:25px">${escapeHtml(title)}</h1><p>${escapeHtml(instruction)}</p><p style="margin:28px 0"><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:14px 20px;background:#ff684d;color:#111;text-decoration:none;border-radius:10px;font-weight:bold">${escapeHtml(title)}</a></p><p>${escapeHtml(expiry)}</p><p style="color:#666">${escapeHtml(ignore)}</p><p style="font-size:12px;overflow-wrap:anywhere">If the button does not work, open this link:<br>${escapeHtml(url.href)}</p></main></body></html>`;
  const selected=provider();
  const cloudflare=selected==='cloudflare';
  const endpoint=cloudflare?`https://api.cloudflare.com/client/v4/accounts/${config.cloudflareEmailAccountId}/email/sending/send`:'https://api.resend.com/emails';
  const headers:Record<string,string>={Authorization:`Bearer ${cloudflare?config.cloudflareEmailApiToken:config.resendApiKey}`,'Content-Type':'application/json'};
  if(!cloudflare)headers['Idempotency-Key']=requestId;
  const response=await fetch(endpoint,{
    method:'POST',signal:AbortSignal.timeout(10_000),
    headers,
    body:JSON.stringify({from:cloudflare?sender():config.mailFrom,to:cloudflare?email:[email],subject:title,text,html}),
  });
  // Never include provider response bodies, recipient addresses, or tokens in errors.
  if(!response.ok){await response.body?.cancel();throw new Error('Account email delivery failed.');}
  if(cloudflare){
    const receipt=await response.json().catch(()=>null) as {success?:unknown;result?:{delivered?:unknown;queued?:unknown;permanent_bounces?:unknown}}|null;
    const includesRecipient=(addresses:unknown)=>Array.isArray(addresses)&&addresses.some(address=>typeof address==='string'&&address.toLowerCase()===email.toLowerCase());
    const accepted=includesRecipient(receipt?.result?.delivered)||includesRecipient(receipt?.result?.queued);
    if(receipt?.success!==true||!accepted||includesRecipient(receipt?.result?.permanent_bounces))throw new Error('Account email delivery failed.');
    return;
  }
  await response.body?.cancel();
}
