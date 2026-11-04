import test from 'node:test';
import assert from 'node:assert/strict';
import {displayCurrencyResponse} from '../cloudflare/display-currency';
import {currencyForCountry,formatPassPrice,hkdDisplayQuote,validDisplayQuote} from '../shared/display-currency';
const now=Date.parse('2026-11-04T12:00:00Z');
function request(country?:string,init:RequestInit={},url='https://lingyingdrama.com/api/display-currency'){
  const r=new Request(url,init);if(country)Object.defineProperty(r,'cf',{value:{country}});return r;
}
const rate=(quote='TWD',value=4.169)=>({base:'HKD',quote,rate:value,date:'2026-11-04'});

test('Taiwan comes from trusted country metadata and rates receive no browser-supplied location or payment data',async()=>{
  let called=0;
  const fetcher:typeof fetch=async(url,init)=>{called++;assert.equal(String(url),'https://api.frankfurter.dev/v2/rate/HKD/TWD');assert.deepEqual(init?.headers,{Accept:'application/json'});assert.equal(init?.redirect,'manual');assert.ok(init?.signal);return Response.json(rate());};
  const response=await displayCurrencyResponse(request('TW',{headers:{'CF-IPCountry':'JP','Accept-Language':'fr',Cookie:'private-fixture'}}),{fetcher,now});
  assert.equal(called,1);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual((await response.json()).quote,{country:'TW',currency:'TWD',ratePerHkd:4.169,asOf:'2026-11-04'});
});
test('country mapping covers interface markets without using their shared language as a location',()=>{
  for(const [country,currency]of Object.entries({TW:'TWD',HK:'HKD',CN:'CNY',JP:'JPY',KR:'KRW',IN:'INR',LK:'LKR',PK:'PKR',BD:'BDT',ID:'IDR',MY:'MYR',SG:'SGD',TH:'THB',VN:'VND',PH:'PHP',TR:'TRY',DE:'EUR',FR:'EUR',BG:'EUR',BR:'BRL',GB:'GBP',US:'USD'}))assert.equal(currencyForCountry(country),currency);
  assert.equal(currencyForCountry('XX'),null);assert.equal(currencyForCountry(undefined),null);
  for(const [country,currency]of Object.entries({PA:'PAB',AW:'AWG',CW:'XCG',SX:'XCG',ZW:'ZWG',SL:'SLE'}))assert.equal(currencyForCountry(country),currency);
});
test('Hong Kong, unknown location, spoofed headers/queries and local development use exact HKD without a network lookup',async()=>{
  const fetcher:typeof fetch=async()=>{throw new Error('Must not fetch');};
  for(const r of [request('HK'),request(undefined,{headers:{'CF-IPCountry':'TW','X-Country':'TW','Accept-Language':'zh-TW'}}),request(undefined,{},'https://lingyingdrama.com/api/display-currency?country=TW'),request('TW',{},'http://127.0.0.1/api/display-currency'),request('XX')]){
    const response=await displayCurrencyResponse(r,{fetcher,now});const {quote}=await response.json();assert.equal(quote.currency,'HKD');assert.equal(quote.ratePerHkd,1);
  }
});
test('rate caches are keyed by currency and stale cached data cannot be presented as a current estimate',async()=>{
  const values=new Map<string,Response>();let calls=0;
  const cache={match:async(key:Request)=>values.get(key.url)?.clone(),put:async(key:Request,response:Response)=>{assert.match(response.headers.get('Cache-Control')!,/21600/);values.set(key.url,response.clone());}};
  const fetcher:typeof fetch=async url=>{calls++;return Response.json(String(url).endsWith('/JPY')?rate('JPY',20):rate());};
  await displayCurrencyResponse(request('TW'),{fetcher,cache,now});await displayCurrencyResponse(request('TW'),{fetcher,cache,now});assert.equal(calls,1);
  const japan=await displayCurrencyResponse(request('JP'),{fetcher,cache,now});assert.equal((await japan.json()).quote.currency,'JPY');assert.equal(calls,2);
  const expired=await displayCurrencyResponse(request('TW'),{fetcher:async()=>{throw new Error('Provider down');},cache,now:now+8*86400000});assert.equal((await expired.json()).quote.currency,'HKD');
});
test('provider errors, malformed/stale dates, wrong pairs and invalid rates fail back to HKD',async()=>{
  for(const payload of [{...rate(),base:'USD'},{...rate(),quote:'JPY'},{...rate(),rate:-1},{...rate(),rate:0},{...rate(),rate:Infinity},{...rate(),date:'2020-01-01'},{...rate(),date:'2030-01-01'},{...rate(),date:'2026-02-31'},null]){
    const response=await displayCurrencyResponse(request('TW'),{fetcher:async()=>Response.json(payload),now});assert.equal((await response.json()).quote.currency,'HKD');
  }
  for(const fetcher of [async()=>new Response('',{status:429}),async()=>new Response('not json'),async()=>{throw new Error('Timeout');}]){
    const response=await displayCurrencyResponse(request('TW'),{fetcher,now});assert.equal((await response.json()).quote.currency,'HKD');
  }
});
test('the display endpoint is read-only, and HEAD has no response body',async()=>{
  const write=await displayCurrencyResponse(request('TW',{method:'POST'}));assert.equal(write.status,405);assert.equal(write.headers.get('Allow'),'GET, HEAD');
  const head=await displayCurrencyResponse(request('HK',{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('provider redirects are rejected using the Workers-supported manual mode without following another host',async()=>{
  let calls=0;const fetcher:typeof fetch=async(_url,init)=>{calls++;assert.equal(init?.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://unexpected.example/rate'}});};
  const response=await displayCurrencyResponse(request('TW'),{fetcher,now});assert.equal((await response.json()).quote.currency,'HKD');assert.equal(calls,1);
});
test('localized labels use clear currencies, correct decimal precision and the same promotional amount without mutating billing cents',()=>{
  const tw={country:'TW',currency:'TWD',ratePerHkd:4.169,asOf:'2026-11-04'};
  assert.equal(formatPassPrice(8800,tw,'zh-TW').text,'≈ NT$366.87');assert.equal(formatPassPrice(5800,tw,'en').text,'≈ NT$241.80');
  assert.equal(formatPassPrice(8800,{...tw,currency:'JPY',ratePerHkd:20},'en').text,'≈ ¥1,760');
  assert.equal(formatPassPrice(8800,hkdDisplayQuote(),'en').text,'HK$88');assert.equal(formatPassPrice(8850,hkdDisplayQuote(),'en').text,'HK$88.50');
  assert.equal(validDisplayQuote({...tw,ratePerHkd:NaN}),false);assert.equal(validDisplayQuote({...tw,ratePerHkd:-1}),false);assert.equal(validDisplayQuote({...tw,currency:'HKD'}),false);
});
