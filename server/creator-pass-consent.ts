import {one,run} from './db.js';
import {assert,AppError} from './errors.js';
import {paymentTable,usingTestPaymentState} from './payment-state.js';
import {LANGUAGES} from '../shared/config.js';
import {LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION,type CreatorPassConsent} from '../shared/creator-pass-consent.js';

/** Validate again at the service boundary: API validation alone is not consent. */
export function requireCreatorPassConsent(value:unknown):CreatorPassConsent{
  const consent=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
  assert(consent&&Object.keys(consent).length===3&&Object.keys(consent).every(key=>['accepted','policy_version','disclosure_version'].includes(key))&&
    consent.accepted===true&&typeof consent.policy_version==='string'&&consent.policy_version.length>0&&consent.policy_version.length<=64&&
    typeof consent.disclosure_version==='string'&&consent.disclosure_version.length>0&&consent.disclosure_version.length<=64,
  400,'CREATOR_CONSENT_REQUIRED','Review the creator terms and confirm your agreement before buying Dramio Pass.');
  if(consent.policy_version!==LEGAL_POLICY_VERSION||consent.disclosure_version!==CREATOR_PASS_DISCLOSURE_VERSION)
    throw new AppError(409,'CREATOR_POLICY_CHANGED','The creator terms changed. Review the current terms and confirm your agreement again.');
  return{accepted:true,policy_version:LEGAL_POLICY_VERSION,disclosure_version:CREATOR_PASS_DISCLOSURE_VERSION};
}

/** Called inside the payment transaction for new Checkouts, or after verifying
 * a matching unpaid resume. Never infer acknowledgements from paid history. */
export function recordCreatorPassConsent(paymentId:string,userId:string,value:CreatorPassConsent,language:string){
  const consent=requireCreatorPassConsent(value);
  assert(LANGUAGES.some(item=>item.code===language),400,'CREATOR_CONSENT_REQUIRED','The acknowledgement language is not supported.');
  const payment=one(`SELECT user_id,kind,status FROM ${paymentTable()} WHERE id=?`,paymentId);
  assert(payment&&payment.user_id===userId&&payment.kind==='activation'&&payment.status==='pending',409,'CREATOR_CONSENT_PAYMENT_MISMATCH','The acknowledgement does not match an unpaid Dramio Pass checkout.');
  const financialMode=usingTestPaymentState()?'test':'default';
  // A replay preserves the first acknowledgement time and displayed language.
  run(`INSERT OR IGNORE INTO creator_pass_consents (payment_id,financial_mode,user_id,policy_version,disclosure_version,language)
    VALUES (?,?,?,?,?,?)`,paymentId,financialMode,userId,consent.policy_version,consent.disclosure_version,language);
  const saved=one('SELECT user_id FROM creator_pass_consents WHERE payment_id=? AND financial_mode=? AND policy_version=? AND disclosure_version=?',paymentId,financialMode,consent.policy_version,consent.disclosure_version);
  assert(saved?.user_id===userId,409,'CREATOR_CONSENT_PAYMENT_MISMATCH','The acknowledgement owner does not match the checkout.');
}
