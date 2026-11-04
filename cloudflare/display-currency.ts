import {currencyForCountry,hkdDisplayQuote,type DisplayCurrencyQuote} from '../shared/display-currency';
import {responseSecurityHeaders} from '../shared/security-headers';
interface RateCache {match(key:Request):Promise<Response|undefined>;put(key:Request,response:Response):Promise<void>}
interface Dependencies {fetcher?:typeof fetch;cache?:RateCache;now?:number}
function validRate(value:any,currency:string,now:number):boolean{
  if(!value||value.base!=='HKD'||value.quote!==currency||typeof value.rate!=='number'||!Number.isFinite(value.rate)||value.rate<=0||value.rate>=1e7||typeof value.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.date))return false;
  const date=Date.parse(value.date+'T00:00:00Z');return Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===value.date&&date>=now-7*86400000&&date<=now+86400000;
}
export async function displayCurrencyResponse(request:Request,dependencies:Dependencies={}):Promise<Response>{
  const headers={'Cache-Control':'private, no-store','Content-Type':'application/json; charset=utf-8',...responseSecurityHeaders('/api/display-currency')};
  if(!['GET','HEAD'].includes(request.method))return new Response(JSON.stringify({error:{code:'METHOD_NOT_ALLOWED'}}),{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  // Only Cloudflare's trusted metadata supplies location. Never trust client
  // country headers, query parameters, interface language or GPS permissions.
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
  const detected=local?undefined:(request as Request&{cf?:{country?:unknown}}).cf?.country;
  const country=typeof detected==='string'&&/^[A-Z]{2}$/.test(detected)?detected:null;
  const currency=currencyForCountry(country);let quote:DisplayCurrencyQuote=hkdDisplayQuote(country);
  if(currency&&currency!=='HKD')try{
    const now=dependencies.now??Date.now();
    const key=new Request('https://api.frankfurter.dev/v2/rate/HKD/'+currency);
    const cache=dependencies.cache||(globalThis as unknown as {caches?:{default?:RateCache}}).caches?.default;
    let rate:any;try{const cached=await cache?.match(key);if(cached)rate=await cached.json();}catch{}
    if(!validRate(rate,currency,now)){
      // Workers supports manual/follow, but rejects Fetch's "error" mode.
      // Treat redirects as unavailable rather than following another URL.
      const response=await(dependencies.fetcher||fetch)(key.url,{signal:AbortSignal.timeout(3500),redirect:'manual',headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('Rate unavailable');
      const body=await response.text();if(body.length>16384)throw new Error('Rate response too large');
      rate=JSON.parse(body);if(!validRate(rate,currency,now))throw new Error('Invalid or stale rate');
      try{await cache?.put(key,new Response(JSON.stringify(rate),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=21600'}}));}catch{}
    }
    quote={country,currency,ratePerHkd:rate.rate,asOf:rate.date};
  }catch{/* The exact HKD charge remains available when an estimate is unavailable. */}
  return new Response(request.method==='HEAD'?null:JSON.stringify({quote}),{headers});
}
