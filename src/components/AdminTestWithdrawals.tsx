import {useRef,useState,type FormEvent} from 'react';
import {useApp} from '../context';
import {useI18n,type Key} from '../i18n';
import {useApi,post} from '../api';
import {Button,Loading,ErrorState} from '../ui';
import {usd} from '../../shared/config';
import {parseUsdCents} from '../../shared/money';
import {WITHDRAWAL_POLICY} from '../../shared/withdrawals';
import {TEST_PAYOUT_MAX_CENTS,type TestPayoutDashboard,type TestPayoutStatus} from '../../shared/test-payouts';
import './admin-test-withdrawals.css';

const statusKey:Record<TestPayoutStatus,Key>={pending:'pending',processing:'paymentProcessing',transferred:'testWithdrawalTransferred',payout_pending:'testWithdrawalBankPending',paid:'paid',failed:'failed',rejected:'rejected'};
export function AdminTestWithdrawals(){
 const {t}=useI18n();const {toast}=useApp();const{data,loading,error,refresh}=useApi<TestPayoutDashboard>('/api/studio/test-withdrawals');
 const [amount,setAmount]=useState('10.00'),[busy,setBusy]=useState(''),[failure,setFailure]=useState('');
 const requestKey=useRef<string|null>(null),lastAmount=useRef('');
 const cents=parseUsdCents(amount),fee=data?.feeCents??WITHDRAWAL_POLICY.feeCents,minimum=data?.minimumCents??WITHDRAWAL_POLICY.minimumCents,maximum=data?.maxCents??TEST_PAYOUT_MAX_CENTS;
 const valid=cents!==null&&cents>=minimum&&cents<=maximum;
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(!valid||busy||!data?.ready)return;
  if(!requestKey.current||lastAmount.current!==amount){requestKey.current=crypto.randomUUID();lastAmount.current=amount;}
  setBusy('request');setFailure('');
  try{await post('/api/studio/test-withdrawals',{amount_cents:cents,request_key:requestKey.current});requestKey.current=null;toast(t('requestSent'));refresh();}
  catch(error){setFailure(error instanceof Error?error.message:t('failed'));}finally{setBusy('');}
 };
 const act=async(id:string,action:'process'|'sync'|'reject')=>{
  if(busy)return;setBusy(id);setFailure('');
  try{await post(`/api/studio/test-withdrawals/${encodeURIComponent(id)}/${action}`);refresh();}
  catch(error){setFailure(error instanceof Error?error.message:t('failed'));refresh();}finally{setBusy('');}
 };
 const net=Math.max(0,(cents??0)-fee);
 return <section className="admin-test-withdrawals" aria-label={t('testWithdrawalTitle')}>
  <div className="earnings-callout panel"><div><span className="eyebrow">{t('testWithdrawalTitle')}</span><h2 aria-label={t('testWithdrawalUnlimited')}>∞</h2><strong>{t('testWithdrawalUnlimited')}</strong><p>{t('testWithdrawalBody')}</p></div></div>
  {loading&&!data&&<Loading/>}{error&&<ErrorState error={error} retry={refresh}/>}
  {failure&&<p className="form-error" role="alert">{failure}</p>}
  {data&&<><form className="panel admin-test-withdrawal-form" onSubmit={submit}>
   <label className="field">{t('payoutAmount')}<div className="money-input"><span>US$</span><input type="number" inputMode="decimal" step="0.01" min={(minimum/100).toFixed(2)} max={(maximum/100).toFixed(2)} value={amount} onChange={event=>setAmount(event.target.value)} required/></div></label>
   <p className="field-hint">{usd(minimum*10000)}–{usd(maximum*10000)} {t('testPayment')}</p>
   <div className="balance-row"><span>{t('withdrawalGross')}</span><strong>{usd((cents??0)*10000)}</strong></div>
   <div className="balance-row"><span>{t('withdrawalFee')}</span><strong>{usd(fee*10000)}</strong></div>
   <div className="balance-row"><span>{t('withdrawalNet')}</span><strong>{usd(net*10000)}</strong></div>
   <div className="balance-row"><span>{t('testWithdrawalBankAmount')}</span><strong>{data.currency.toUpperCase()} {(Math.round(net*data.exchangeRate)/100).toFixed(2)}</strong></div>
   <Button className="button primary wide" busy={busy==='request'} disabled={!!busy||!valid||!data.ready} type="submit">{t('requestPayout')}</Button>
  </form><section className="panel"><h2>{t('payoutHistory')} · {t('testPayment')}</h2>
   {data.requests.length?<div className="test-withdrawal-history">{data.requests.map(request=><article key={request.id}>
    <div><strong>{usd(request.gross_cents*10000)}</strong><small>{t('withdrawalFee')}: {usd(request.fee_cents*10000)} · {t('withdrawalNet')}: {usd(request.net_cents*10000)}</small><small>{t('testWithdrawalBankAmount')}: {request.currency.toUpperCase()} {(request.provider_amount/100).toFixed(2)}</small><span className={`status ${request.status}`}>{t(statusKey[request.status])}</span>{request.error_code&&<small className="form-error">{request.error_code}</small>}</div>
    <div className="test-withdrawal-actions">{['pending','processing','transferred'].includes(request.status)&&<Button className="button primary small" busy={busy===request.id} disabled={!!busy} onClick={()=>act(request.id,'process')}>{t('testWithdrawalProcess')}</Button>}{request.status==='pending'&&<button className="button secondary small" disabled={!!busy} onClick={()=>act(request.id,'reject')}>{t('reject')}</button>}{request.transfer_id&&<button className="button secondary small" disabled={!!busy} onClick={()=>act(request.id,'sync')}>{t('testWithdrawalRefresh')}</button>}</div>
   </article>)}</div>:<p className="muted">{t('noPayouts')}</p>}
  </section></>}
 </section>;
}
