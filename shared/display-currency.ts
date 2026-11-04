/** Display estimates only. Checkout amounts, wallets and ledgers never use these rates. */
export interface DisplayCurrencyQuote {country:string|null;currency:string;ratePerHkd:number;asOf:string|null}
const regions:Record<string,string>={
  HKD:'HK',TWD:'TW',MOP:'MO',CNY:'CN',JPY:'JP',KRW:'KR',USD:'US AS BQ EC FM GU IO MH MP PR PW SV TC TL UM VG VI',
  EUR:'AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA XK YT',
  GBP:'GB GG IM JE GS',CHF:'CH LI',AUD:'AU CC CX HM KI NF NR TV',NZD:'NZ CK NU PN TK',CAD:'CA',
  INR:'IN',LKR:'LK',PKR:'PK',BDT:'BD',NPR:'NP',BTN:'BT',IDR:'ID',MYR:'MY',SGD:'SG',THB:'TH',VND:'VN',PHP:'PH',BND:'BN',KHR:'KH',LAK:'LA',MMK:'MM',MVR:'MV',
  BRL:'BR',MXN:'MX',ARS:'AR',CLP:'CL',COP:'CO',PEN:'PE',UYU:'UY',PYG:'PY',BOB:'BO',CRC:'CR',GTQ:'GT',HNL:'HN',NIO:'NI',DOP:'DO',JMD:'JM',TTD:'TT',BSD:'BS',BBD:'BB',BZD:'BZ',XCD:'AG AI DM GD KN LC MS VC',
  AED:'AE',SAR:'SA',QAR:'QA',KWD:'KW',BHD:'BH',OMR:'OM',ILS:'IL PS',JOD:'JO',TRY:'TR',EGP:'EG',MAD:'MA EH',TND:'TN',DZD:'DZ',
  SEK:'SE',NOK:'NO SJ BV',DKK:'DK FO GL',ISK:'IS',PLN:'PL',CZK:'CZ',HUF:'HU',RON:'RO',RSD:'RS',BAM:'BA',ALL:'AL',MKD:'MK',MDL:'MD',UAH:'UA',RUB:'RU',GEL:'GE',AMD:'AM',AZN:'AZ',KZT:'KZ',UZS:'UZ',KGS:'KG',TJS:'TJ',
  ZAR:'ZA',NGN:'NG',GHS:'GH',KES:'KE',TZS:'TZ',UGX:'UG',RWF:'RW',ETB:'ET',MUR:'MU',SCR:'SC',BWP:'BW',NAD:'NA',ZMW:'ZM',
  XOF:'BJ BF CI GW ML NE SN TG',XAF:'CM CF TD CG GQ GA',XPF:'NC PF WF',FJD:'FJ',PGK:'PG',WST:'WS',TOP:'TO',VUV:'VU',SBD:'SB',
  AFN:'AF',AOA:'AO',AWG:'AW',BYN:'BY',BMD:'BM',BIF:'BI',CVE:'CV',KYD:'KY',KMF:'KM',CDF:'CD',CUP:'CU',XCG:'CW SX',DJF:'DJ',ERN:'ER',SZL:'SZ',FKP:'FK',GMD:'GM',GIP:'GI',GNF:'GN',GYD:'GY',HTG:'HT',IRR:'IR',IQD:'IQ',KPW:'KP',LBP:'LB',LSL:'LS',LRD:'LR',LYD:'LY',MGA:'MG',MWK:'MW',MRU:'MR',MNT:'MN',MZN:'MZ',PAB:'PA',SHP:'SH',STN:'ST',SLE:'SL',SOS:'SO',SSP:'SS',SDG:'SD',SRD:'SR',SYP:'SY',TMT:'TM',VES:'VE',YER:'YE',ZWG:'ZW',
};
const currencies=new Map(Object.entries(regions).flatMap(([currency,countries])=>countries.split(' ').map(country=>[country,currency] as const)));
export function currencyForCountry(country:unknown):string|null{return typeof country==='string'?currencies.get(country.toUpperCase())||null:null;}
export function hkdDisplayQuote(country:string|null=null):DisplayCurrencyQuote{return{country,currency:'HKD',ratePerHkd:1,asOf:null};}
export function validDisplayQuote(value:unknown):value is DisplayCurrencyQuote{
  if(!value||typeof value!=='object')return false;const q=value as DisplayCurrencyQuote;
  return(q.country===null||typeof q.country==='string'&&/^[A-Z]{2}$/.test(q.country))&&typeof q.currency==='string'&&/^[A-Z]{3}$/.test(q.currency)&&typeof q.ratePerHkd==='number'&&Number.isFinite(q.ratePerHkd)&&q.ratePerHkd>0&&q.ratePerHkd<1e7&&(q.asOf===null||typeof q.asOf==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(q.asOf))&&(q.currency!=='HKD'||q.ratePerHkd===1);
}
const symbols:Record<string,string>={HKD:'HK$',TWD:'NT$',USD:'US$',AUD:'A$',CAD:'CA$',NZD:'NZ$',SGD:'S$',CNY:'CN¥',JPY:'¥',KRW:'₩',EUR:'€',GBP:'£',INR:'₹'};
export function formatPassPrice(hkdCents:number,quote:DisplayCurrencyQuote,locale:string){
  const q=validDisplayQuote(quote)?quote:hkdDisplayQuote();
  const value=hkdCents/100*q.ratePerHkd;
  let digits=2;try{digits=new Intl.NumberFormat(locale,{style:'currency',currency:q.currency}).resolvedOptions().maximumFractionDigits??2;}catch{}
  if(q.currency==='HKD'&&Number.isInteger(value))digits=0;
  const amount=new Intl.NumberFormat(locale,{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
  const symbol=symbols[q.currency]||q.currency+' ';
  return{symbol,amount,text:`${q.currency==='HKD'?'':'≈ '}${symbol}${amount}`,currency:q.currency,approximate:q.currency!=='HKD'};
}
