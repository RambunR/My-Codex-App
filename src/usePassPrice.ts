import {useApi} from './api';
import {useI18n} from './i18n';
import {formatPassPrice,hkdDisplayQuote,validDisplayQuote,type DisplayCurrencyQuote} from '../shared/display-currency';

export function usePassPrice(){
  const{locale}=useI18n();const{data}=useApi<{quote:DisplayCurrencyQuote}>('/api/display-currency');
  const quote=validDisplayQuote(data?.quote)?data!.quote:hkdDisplayQuote();
  return(cents:number)=>formatPassPrice(cents,quote,locale);
}
