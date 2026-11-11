function serverDate(raw:string){
  const normalized=raw.trim().replace(' ','T');
  const value=new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)?normalized:normalized+'Z');
  return Number.isNaN(value.getTime())?null:value;
}
export function drawDate(raw:string,locale:string){const value=serverDate(raw);return value?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value):'';}
export function seriesDate(raw:string|undefined|null,locale:string){const value=raw?serverDate(raw):null;return value?new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(value):'';}
