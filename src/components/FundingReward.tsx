import {Gift} from 'lucide-react';
import {usd} from '../../shared/config';
import {useI18n} from '../i18n';
import '../funding-rewards.css';

export interface FundingCreditQuote {amountCents:number;bonusCents:number;totalCreditCents:number;currency:'usd'}
export function validFundingCreditQuote(quote:FundingCreditQuote|undefined):quote is FundingCreditQuote{
  return!!quote&&quote.currency==='usd'&&[quote.amountCents,quote.bonusCents,quote.totalCreditCents].every(value=>Number.isSafeInteger(value)&&value>=0)&&quote.amountCents>0&&quote.totalCreditCents===quote.amountCents+quote.bonusCents;
}

/** Display a quote, never a locally credited balance. Settlement is server-only. */
export function FundingReward({quote,noteId}:{quote:FundingCreditQuote;noteId?:string}){
  const{t}=useI18n();
  if(!validFundingCreditQuote(quote)||quote.bonusCents<=0)return null;
  return <section className="funding-reward-summary" role="status" aria-label={t('walletRewardTotal')}>
    <dl>
      <div><dt>{t('walletRewardPay')}</dt><dd>{usd(quote.amountCents*10000)}</dd></div>
      <div className="funding-reward-gift"><dt><Gift size={17} aria-hidden="true"/>{t('walletRewardBonus')}</dt><dd>+{usd(quote.bonusCents*10000)}</dd></div>
      <div className="funding-reward-total"><dt>{t('walletRewardTotal')}</dt><dd>{usd(quote.totalCreditCents*10000)}</dd></div>
    </dl>
    <p id={noteId}>{t('walletRewardNote')}</p>
  </section>;
}
