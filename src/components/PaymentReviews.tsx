import {useState,type FormEvent} from 'react';
import {Button,ErrorState,Loading,Modal} from '../ui';
import {post,useApi} from '../api';
import {useApp} from '../context';
import {useI18n} from '../i18n';
import {parseUsdCents} from '../../shared/money';
import '../payment-review.css';

interface PaymentReview {
  id:string;status:'open'|'resolved';mode:'test'|'live';
  user_id:string|null;payment_id:string|null;user_name?:string;user_email?:string;email?:string;
  payment_kind:'funding'|'activation';kind:'refund'|'dispute';
  amount_cents:number;currency:string;remaining_cents:number;
  wallet_debit_cents:number;platform_loss_cents:number;
  provider_status:string;charge_id?:string;payment_intent?:string;
  created_at:string;updated_at:string;resolved_at?:string;note?:string;decision?:string;
}
type Decision='reconciled'|'platform_loss'|'provider_reversed';
const amount=(cents:number,currency:string)=>`${currency.toUpperCase()} ${(cents/100).toFixed(2)}`;

export function PaymentReviews(){
  const {t}=useI18n();const {toast}=useApp();
  const {data,loading,error,refresh}=useApi<{reviews:PaymentReview[]}>('/api/admin/payment-reviews');
  const [selected,setSelected]=useState<PaymentReview|null>(null);
  const [decision,setDecision]=useState<Decision>('reconciled');const [debit,setDebit]=useState('0.00');
  const [note,setNote]=useState('');const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [failure,setFailure]=useState('');
  const funding=selected?.payment_kind==='funding'&&selected.currency==='usd';
  const debitCents=decision==='provider_reversed'||!funding?0:decision==='reconciled'?selected!.remaining_cents:parseUsdCents(debit);
  const validDebit=debitCents!==null&&debitCents>=0&&debitCents<=(selected?.remaining_cents??0);
  const mapped=!!(selected?.user_id&&selected.payment_id);
  const canReverse=selected?.kind==='dispute'&&selected.provider_status==='won';
  const conflicting=selected?.provider_status==='conflicting';
  const canResolve=mapped&&!conflicting&&selected?.status==='open'&&note.trim().length>=10&&validDebit&&confirmed&&(canReverse?decision==='provider_reversed':decision!=='provider_reversed');
  const select=(review:PaymentReview)=>{const reversed=review.kind==='dispute'&&review.provider_status==='won';setSelected(review);setDecision(reversed?'provider_reversed':'reconciled');setDebit(reversed?'0.00':(review.remaining_cents/100).toFixed(2));setNote('');setConfirmed(false);setFailure('');};
  const changeDecision=(value:Decision)=>{setDecision(value);setConfirmed(false);setFailure('');if(value==='platform_loss')setDebit('0.00');};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!canResolve||busy||!selected){setFailure(t('reviewValidation'));return;}
    setBusy(true);setFailure('');
    try{await post(`/api/admin/payment-reviews/${encodeURIComponent(selected.id)}/resolve`,{decision,note:note.trim(),wallet_debit_cents:debitCents});setSelected(null);refresh();toast(t('savedSuccess'));}
    catch(error){setFailure((error as Error).message);}finally{setBusy(false);}
  };
  if(loading&&!data)return <Loading/>;
  if(error)return <ErrorState error={error} retry={refresh}/>;
  return <section className="panel payment-reviews-panel"><h2>{t('paymentReviews')}</h2>
    {data?.reviews.length?<div className="request-list">{data.reviews.map(review=><div className="payment-review-row" key={review.id}>
      <div><strong>{review.user_name||review.user_id||review.id}</strong>{(review.user_email||review.email)&&<small>{review.user_email||review.email}</small>}<p>{t(review.kind==='refund'?'reviewRefund':'reviewDispute')} · {review.mode.toUpperCase()} · {amount(review.amount_cents,review.currency)}</p><small>{t('reviewRemaining')}: {amount(review.remaining_cents,review.currency)}</small>{!review.user_id&&<p className="form-error">{t('reviewUnmapped')}</p>}</div>
      <div><span className="status">{t(review.status==='open'?'reviewOpen':'reviewResolved')}</span><p>{review.provider_status}</p>{review.status==='open'&&<button className="button secondary small" onClick={()=>select(review)}>{t('paymentReviews')}</button>}{review.status==='resolved'&&review.note&&<p>{review.note}</p>}</div>
    </div>)}</div>:<p className="muted">{t('noPaymentReviews')}</p>}
    <Modal open={!!selected} onClose={()=>!busy&&setSelected(null)} title={t('resolvePaymentReview')}>
      {selected&&<><p>{t('reviewResolutionBody')}</p><p><strong>{selected.user_name||selected.user_id||selected.id}</strong> · {selected.mode.toUpperCase()}</p><div className="balance-row"><span>{t('reviewRemaining')}</span><strong>{amount(selected.remaining_cents,selected.currency)}</strong></div>
      {!mapped?<p className="form-error" role="alert">{t('reviewUnmapped')}</p>:conflicting?<p className="form-error" role="alert">{t('reviewAwaitingProvider')}</p>:<form onSubmit={submit}>
        <label className="field" htmlFor="payment-review-decision">{t('reviewDecision')}<select id="payment-review-decision" aria-label={t('reviewDecision')} value={decision} onChange={event=>changeDecision(event.target.value as Decision)} disabled={busy}>{canReverse?<option value="provider_reversed">{t('reviewProviderReversed')}</option>:<><option value="reconciled">{t('reviewRecover')}</option><option value="platform_loss">{t('reviewPlatformLoss')}</option></>}</select></label>
        {funding&&decision!=='provider_reversed'&&<label className="field">{t('reviewDebit')}<div className="money-input"><span>US$</span><input type="text" inputMode="decimal" autoComplete="off" aria-label={t('reviewDebit')} value={decision==='reconciled'?(selected.remaining_cents/100).toFixed(2):debit} onChange={event=>{setDebit(event.target.value);setConfirmed(false);}} disabled={busy||decision==='reconciled'} required aria-invalid={!validDebit} maxLength={20}/></div></label>}
        {decision==='platform_loss'&&<p className="field-hint">{t('reviewPlatformLossHint')}</p>}
        {selected.payment_kind==='activation'&&decision!=='provider_reversed'&&<p className="field-hint">{t('reviewPassHint')}</p>}
        {decision==='provider_reversed'&&<p className="field-hint">{t('reviewProviderReversedHint')}</p>}
        <label className="field">{t('reviewNotes')}<textarea value={note} onChange={event=>{setNote(event.target.value);setConfirmed(false);}} aria-label={t('reviewNotes')} rows={4} minLength={10} maxLength={2000} required disabled={busy}/></label>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy} required/><span>{t('reviewAccountingConfirm')}</span></label>
        {failure&&<p className="form-error" role="alert">{failure}</p>}
        <Button className="button primary wide" busy={busy} disabled={!canResolve} type="submit">{t('resolvePaymentReview')}</Button>
      </form>}</>}
    </Modal>
  </section>;
}
