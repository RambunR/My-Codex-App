import type {CheckoutMethod as Method} from '../../shared/wechat-pay';
import {CreditCard} from 'lucide-react';
import {useI18n} from '../i18n';
import './checkout-method.css';
function WechatPayMark(){
  return <svg className="checkout-method-icon wechat-pay-icon" width="24" height="24" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path fill="#09B83E" d="M16 3C7.7 3 1 8.3 1 14.8c0 3.9 2.4 7.4 6.1 9.6L5.8 29l5.5-2.8c1.5.4 3.1.6 4.7.6 8.3 0 15-5.4 15-12S24.3 3 16 3Z"/><path fill="#fff" d="m8.1 13.5 5.1 2.9 11-7.3-10 13.1a1.1 1.1 0 0 1-1.8-.1l-4.9-7.5a.8.8 0 0 1 .6-1.1Z"/></svg>;
}
export function CheckoutMethod({value,onChange,disabled=false}:{value:Method;onChange:(method:Method)=>void;disabled?:boolean}){
  const{t}=useI18n();
  return <fieldset className="checkout-method" disabled={disabled}><legend>{t('paymentMethod')}</legend>
    <label><input type="radio" name="checkout-method" value="card" checked={value==='card'} onChange={()=>onChange('card')}/><span className="checkout-method-label"><CreditCard className="checkout-method-icon" size={24} aria-hidden="true"/><span>{t('paymentCard')}</span></span></label>
    <label><input type="radio" name="checkout-method" value="wechat_pay" checked={value==='wechat_pay'} onChange={()=>onChange('wechat_pay')}/><span className="checkout-method-label"><WechatPayMark/><span>WeChat Pay · 微信支付</span></span></label>
  </fieldset>;
}
