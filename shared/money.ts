import {MAX_WALLET_FUNDING_CENTS} from './config.js';

/** Parse a plain USD decimal without silently rounding a user's payment. */
export function parseUsdCents(value:string):number|null{
  if(typeof value!=='string')return null;
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if(!match)return null;
  const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  return Number.isSafeInteger(cents)&&cents>=0&&cents<=MAX_WALLET_FUNDING_CENTS?cents:null;
}
