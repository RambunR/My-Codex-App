import { ShieldCheck } from 'lucide-react';
import { useApp } from '../context';
import { useI18n } from '../i18n';
import { CONTACT_HREF } from '../company';
import '../payment-review.css';

export function PaymentReviewNotice({held}:{held?:boolean}){
  const {user}=useApp();const {t}=useI18n();
  if(!(held??user?.payment_review))return null;
  return <section className="panel payment-review-notice" role="status">
    <h2><ShieldCheck size={19} aria-hidden="true"/> {t('paymentReviewTitle')}</h2>
    <p>{t('paymentReviewBody')}</p>
    <a className="button secondary small" href={CONTACT_HREF}>{t('help')}</a>
  </section>;
}

export function PayoutPauseNotice(){
  const {config}=useApp();const {t}=useI18n();
  if(config.payoutsEnabled!==false)return null;
  return <section className="panel payout-pause-notice" role="status">
    <h2>{t('payoutsPaused')}</h2><p>{t('payoutsPausedBody')}</p>
  </section>;
}
