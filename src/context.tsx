import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import { Check, AlertCircle, X, ShieldCheck } from 'lucide-react';
import { api,post } from './api';
import type { User } from '../shared/config';
import { useI18n } from './i18n';
import { Modal } from './ui';
interface AppConfig {brand:string;paymentsMode:string;paymentsReady?:boolean;sandbox?:boolean;paymentsTestMode?:boolean;uploadsEnabled?:boolean;usdToHkd:number;demo:boolean;limits:Record<string,number>;runtime?:string;videoFormats?:string[];auth?:{google:boolean;apple?:boolean;email?:boolean}}
interface Toast {id:number;message:string;error:boolean}
interface Checkout {demo?:boolean;paymentId?:string;amount_cents?:number;currency?:string;url?:string;alreadyPaid?:boolean}
const Context=createContext<{user:User|null;ready:boolean;config:AppConfig;setUser:(u:User|null)=>void;refreshUser:()=>Promise<void>;toast:(m:string,error?:boolean)=>void;checkout:(kind:'activation'|'funding',cents?:number)=>Promise<void>}>({user:null,ready:false,config:{brand:'AIDramio',paymentsMode:'disabled',usdToHkd:7.8,demo:false,limits:{}},setUser:()=>{},refreshUser:async()=>{},toast:()=>{},checkout:async()=>{}});
export function AppProvider({children}:{children:ReactNode}){
  const {t}=useI18n();const[user,setUser]=useState<User|null>(null);const[ready,setReady]=useState(false);
  const[config,setConfig]=useState<AppConfig>({brand:'AIDramio',paymentsMode:'disabled',usdToHkd:7.8,demo:false,limits:{}});
  const[toasts,setToasts]=useState<Toast[]>([]);const[payment,setPayment]=useState<Checkout|null>(null);const[busy,setBusy]=useState(false);
  const refreshUser=async()=>{const d=await api('/api/auth/me');setUser(d.user);};
  useEffect(()=>{Promise.all([api('/api/auth/me').then(d=>setUser(d.user)),api<AppConfig>('/api/config').then(setConfig)]).catch(()=>{}).finally(()=>setReady(true));},[]);
  useEffect(()=>{document.title=`${config.sandbox?'AIDramio Test':config.brand} — ${t('heroTitle').replace('\n',' ')}`;},[config.brand,config.sandbox,t('heroTitle')]);
  const toast=(message:string,error=false)=>{const id=Date.now()+Math.random();setToasts(v=>[...v.slice(-2),{id,message,error}]);window.setTimeout(()=>setToasts(v=>v.filter(x=>x.id!==id)),5500);};
  const checkout=async(kind:'activation'|'funding',cents=1000)=>{if(config.paymentsMode==='disabled'||config.paymentsReady===false)throw new Error(t('paymentUnavailable'));const result=await post<Checkout>('/api/payments/checkout',{kind,amount_cents:cents});if(result.url){window.location.assign(result.url);return;}if(result.alreadyPaid){await refreshUser();toast(t('paymentSuccess'));return;}setPayment(result);};
  const confirmDemo=async()=>{if(!payment?.paymentId)return;setBusy(true);try{const d=await post(`/api/payments/${payment.paymentId}/demo-confirm`);setUser(d.user);setPayment(null);toast(t('paymentSuccess'));}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}};
  return <Context.Provider value={{user,ready,config,setUser,refreshUser,toast,checkout}}>{children}
    <div className="toast-stack" aria-live="polite">{toasts.map(item=><div className={`toast ${item.error?'toast-error':''}`} key={item.id}>{item.error?<AlertCircle size={18}/>:<Check size={18}/>}<span>{item.message}</span><button className="icon-button" aria-label={t('close')} onClick={()=>setToasts(v=>v.filter(x=>x.id!==item.id))}><X size={15}/></button></div>)}</div>
    <Modal open={!!payment} onClose={()=>!busy&&setPayment(null)} title={t('testPayment')}><div className="payment-symbol"><ShieldCheck size={32}/></div><p className="muted">{t('testPaymentBody')}</p><div className="checkout-total"><span>{t('amount')}</span><strong>{payment?.currency==='hkd'?'HK$':'US$'}{((payment?.amount_cents||0)/100).toFixed(2)}</strong></div><button className="button primary wide" disabled={busy} onClick={confirmDemo}>{busy?t('loading'):t('confirmTest')}</button><button className="button ghost wide" disabled={busy} onClick={()=>setPayment(null)}>{t('cancel')}</button></Modal>
  </Context.Provider>;
}
export const useApp=()=>useContext(Context);
