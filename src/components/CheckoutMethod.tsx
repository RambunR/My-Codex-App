import type {CheckoutMethod as Method} from '../../shared/wechat-pay';
import {useI18n} from '../i18n';
import './checkout-method.css';
export function CheckoutMethod({value,onChange,disabled=false}:{value:Method;onChange:(method:Method)=>void;disabled?:boolean}){
  const{t}=useI18n();
  return <fieldset className="checkout-method" disabled={disabled}><legend>{t('paymentMethod')}</legend>
    <label><input type="radio" name="checkout-method" value="card" checked={value==='card'} onChange={()=>onChange('card')}/><span>{t('paymentCard')}</span></label>
    <label><input type="radio" name="checkout-method" value="wechat_pay" checked={value==='wechat_pay'} onChange={()=>onChange('wechat_pay')}/><span>WeChat Pay · 微信支付</span></label>
  </fieldset>;
}
