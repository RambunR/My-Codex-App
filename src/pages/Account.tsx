import { useEffect,useState,type FormEvent } from 'react';
import { Link,useLocation,useNavigate,useSearchParams } from 'react-router-dom';
import { ArrowUpRight,ArrowRight,Eye,EyeOff,Mail,LockKeyhole,Sparkles,Wallet,Plus,ArrowDownLeft,ArrowUpRight as ArrowOut,Check,ShieldCheck,Clapperboard,Globe2,LogOut,Download,UserRound,ChevronDown,Film,Gift } from 'lucide-react';
import { api,apiUrl,post,useApi,ApiError } from '../api';
import { useApp } from '../context';
import { useI18n,type Key } from '../i18n';
import { AuthGate,Avatar,Brand,Button,Empty,ErrorState,Loading,PageTitle,Modal } from '../ui';
import { LANGUAGES,usd,MIN_WALLET_FUNDING_CENTS,MAX_WALLET_FUNDING_CENTS } from '../../shared/config';
import { parseUsdCents } from '../../shared/money';
import {DramioPassCard} from '../components/DramioPass';
import {FundingReward,type FundingCreditQuote} from '../components/FundingReward';
import {PaymentReviewNotice} from '../components/PaymentReview';
import { COMPANY_NAME,CONTACT_EMAIL,CONTACT_HREF } from '../company';
import {LegalPolicy} from '../components/LegalPolicy';
import '../account-auth.css';

const safeNext=(value:string|null)=>{
  if(!value?.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return '/';
  try{const url=new URL(value,window.location.origin);if(url.origin!==window.location.origin||url.pathname.startsWith('//')||url.pathname==='/auth'||url.pathname==='/api'||url.pathname.startsWith('/api/'))return '/';return url.pathname+url.search+url.hash;}catch{return '/';}
};
const googleErrorKeys:Record<string,Key>={
  google_cancelled:'googleCancelled',google_failed:'googleFailed',google_expired:'googleExpired',
  google_email_exists:'googleEmailExists',google_identity_conflict:'googleIdentityConflict',google_account_changed:'googleAccountChanged',
  apple_cancelled:'appleCancelled',apple_failed:'appleFailed',apple_expired:'appleExpired',
  apple_email_exists:'appleEmailExists',apple_identity_conflict:'appleIdentityConflict',apple_account_changed:'appleAccountChanged',
};
function GoogleMark(){return <svg className="google-mark" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.91a6 6 0 0 1 0-3.82V7.5H3.04a10 10 0 0 0 0 9l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.5l3.35 2.59A5.96 5.96 0 0 1 12 5.96Z"/></svg>;}
export function Auth(){
  const[params]=useSearchParams();const mode=params.get('mode');
  if(mode==='forgot'||mode==='reset'||mode==='verify'||mode==='resend')return <EmailAccountAction mode={mode} key={mode}/>;
  return <SignInAuth/>;
}
type EmailActionMode='forgot'|'reset'|'verify'|'resend';
const emailErrorKey=(error:unknown):Key=>error instanceof ApiError&&error.code==='MAIL_UNAVAILABLE'?'emailUnavailable':error instanceof ApiError&&error.code==='EMAIL_TOKEN_INVALID'?'emailTokenInvalid':error instanceof ApiError&&error.code==='RATE_LIMIT'?'emailRequestRateLimited':'emailRequestFailed';
function AuthArtwork(){return <aside className="auth-art auth-art-phoenix" lang="en"><img src="/images/auth-phoenix-background.webp" width={1024} height={1536} alt="" decoding="async"/><div className="auth-phoenix-copy"><h2>Fall into a<br/>new world.</h2><p>Discover extraordinary short dramas from creators everywhere.</p><span>EN · 繁 · 日本語 · 한국어 · +17</span></div></aside>;}
function EmailAccountAction({mode}:{mode:EmailActionMode}){
  const{t,locale}=useI18n();const{user,setUser,refreshUser,config}=useApp();const[params]=useSearchParams();const location=useLocation();const navigate=useNavigate();
  const[token,setToken]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('token')??params.get('token')??'');const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[confirmation,setConfirmation]=useState('');
  const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[result,setResult]=useState<Key|null>(null);
  const next=safeNext(params.get('next'));const sendsEmail=mode==='forgot'||mode==='resend';const tokenMissing=!sendsEmail&&!token;
  const emailEnabled=!!config.auth?.email;const canSubmit=!busy&&(!sendsEmail||emailEnabled)&&!tokenMissing;
  // Keep the bearer token only in component memory, not in navigation history or links.
  useEffect(()=>{const fragment=new URLSearchParams(location.hash.slice(1));const incoming=fragment.get('token')??params.get('token');if(incoming!==null){setToken(incoming);setError('');setResult(null);const clean=new URLSearchParams(params);clean.delete('token');fragment.delete('token');navigate({pathname:location.pathname,search:clean.size?'?'+clean.toString():'',hash:fragment.size?'#'+fragment.toString():''},{replace:true});}},[params.get('token'),location.hash]);
  const actionLink=(action:string)=>'/auth?'+new URLSearchParams({mode:action,next}).toString();
  const titles:Record<EmailActionMode,Key>={forgot:'forgotPasswordTitle',reset:'resetPasswordTitle',verify:'verifyEmailTitle',resend:'resendVerification'};
  const bodies:Record<EmailActionMode,Key>={forgot:'forgotPasswordBody',reset:'resetPasswordBody',verify:'verifyEmailBody',resend:'resendVerificationBody'};
  const actions:Record<EmailActionMode,Key>={forgot:'sendResetLink',reset:'updatePassword',verify:'verifyEmailAction',resend:'resendVerification'};
  const completed=(mode==='reset'||mode==='verify')&&!!result;
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!canSubmit||completed)return;setError('');setResult(null);
    if(mode==='reset'&&password!==confirmation){setError(t('passwordMismatch'));return;}
    setBusy(true);
    try{
      if(sendsEmail){await post(`/api/auth/${mode==='forgot'?'forgot-password':'resend-verification'}`,{email,language:locale});setResult('emailRequestReceived');}
      else if(mode==='reset'){await post('/api/auth/reset-password',{token,password});setPassword('');setConfirmation('');setToken('');setUser(null);setResult('passwordResetSuccess');}
      else{await post('/api/auth/verify-email',{token});setToken('');setResult('emailVerifiedSuccess');if(user)await refreshUser().catch(()=>{});}
    }catch(caught){setError(t(emailErrorKey(caught)));}finally{setBusy(false);}
  };
  return <div className="auth-page"><section className="auth-form-panel auth-recovery-panel">
    <span className="eyebrow"><Mail size={15} aria-hidden="true"/> LingYing</span><h1>{t(titles[mode])}</h1><p>{t(bodies[mode])}</p>
    {result&&<div className="auth-email-status" role="status"><Check size={18} aria-hidden="true"/><span>{t(result)}</span></div>}
    {!completed&&<form onSubmit={submit}>
      {sendsEmail&&<label className="field">{t('email')}<div className="input-icon"><Mail size={17} aria-hidden="true"/><input name="email" aria-label={t('email')} type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required maxLength={254} placeholder="you@example.com"/></div></label>}
      {mode==='reset'&&!tokenMissing&&<><label className="field">{t('newPassword')}<input aria-label={t('newPassword')} name="password" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} required minLength={10} maxLength={128} placeholder={t('passwordHint')}/></label><label className="field">{t('confirmNewPassword')}<input aria-label={t('confirmNewPassword')} name="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} required minLength={10} maxLength={128}/></label></>}
      {sendsEmail&&!emailEnabled&&<p className="auth-availability" role="status">{t('emailUnavailable')}</p>}
      {tokenMissing&&<p className="form-error" role="alert">{t('emailTokenInvalid')}</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <Button className="button primary wide" busy={busy} type="submit" disabled={!canSubmit}>{t(actions[mode])}<ArrowRight size={16}/></Button>
    </form>}
    <div className="auth-recovery-links"><Link to={actionLink('login')}>{t('backToSignIn')}</Link>{mode==='reset'&&<Link to={actionLink('forgot')}>{t('requestNewLink')}</Link>}{mode==='verify'&&<Link to={actionLink('resend')}>{t('resendVerification')}</Link>}{mode==='verify'&&result&&user&&<Link to="/account">{t('returnToAccount')}</Link>}</div>
  </section><AuthArtwork/></div>;
}
function SignInAuth(){
  const{t,locale}=useI18n();const{user,setUser,toast,config}=useApp();const[params,setParams]=useSearchParams();const navigate=useNavigate();
  const register=params.get('mode')==='register';const[show,setShow]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const[name,setName]=useState('');const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[terms,setTerms]=useState(false);const next=safeNext(params.get('next'));
  const callbackError=params.get('error');const oauthError=callbackError?t(googleErrorKeys[callbackError]||'googleFailed'):'';
  const googleUrl=apiUrl('/api/auth/google/start?'+new URLSearchParams({next,language:locale}).toString());
  const appleUrl=apiUrl('/api/auth/apple/start?'+new URLSearchParams({next,language:locale}).toString());
  const recoveryLink=(mode:string)=>'/auth?'+new URLSearchParams({mode,next}).toString();
  useEffect(()=>{if(user){if(callbackError)toast(t(googleErrorKeys[callbackError]||'googleFailed'),true);navigate(next,{replace:true});}},[user]);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(register&&!terms){setError(t('termsRequired'));return;}setBusy(true);setError('');if(callbackError){const p=new URLSearchParams(params);p.delete('error');setParams(p,{replace:true});}try{const d=await post(`/api/auth/${register?'register':'login'}`,{name,email,password,language:locale});setUser(d.user);toast(`${t('welcome')}, ${d.user.name}`);navigate(next,{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const toggle=()=>{const p=new URLSearchParams(params);p.set('mode',register?'login':'register');p.delete('error');setParams(p);setError('');};
  return <div className="auth-page"><section className="auth-form-panel">
    <span className="eyebrow"><span className="tiny-dot"/> {t('originals')}</span><h1>{register?t('joinTitle'):t('welcomeBack')}</h1><p>{t('authSubtitle')}</p>
    <div className="auth-tabs"><button className={!register?'active':''} onClick={()=>register&&toggle()}>{t('signIn')}</button><button className={register?'active':''} onClick={()=>!register&&toggle()}>{t('signUp')}</button></div>
    {oauthError&&<div className="form-error google-callback-error" role="alert">{oauthError}{(callbackError==='google_email_exists'||callbackError==='apple_email_exists')&&<button type="button" onClick={()=>{const p=new URLSearchParams(params);p.set('mode','login');setParams(p);}}>{t('signIn')}<ArrowRight size={14}/></button>}</div>}
    <div className="google-auth-options auth-provider-options">{config.auth?.google&&<a className="button google-button wide" href={googleUrl}><GoogleMark/>{t('continueGoogle')}</a>}{config.auth?.apple?<a className="button apple-button wide" href={appleUrl}>{t('continueApple')}</a>:<><button className="button apple-button wide" type="button" disabled aria-describedby="apple-availability">{t('continueApple')}</button><p id="apple-availability" className="auth-availability">{t('appleUnavailable')}</p></>}<p className="google-legal">{t('googleLegalIntro')} <Link to="/terms" target="_blank" rel="noopener noreferrer">{t('terms')}</Link> {t('googleLegalJoin')} <Link to="/privacy" target="_blank" rel="noopener noreferrer">{t('privacy')}</Link>.</p><div className="auth-divider"><span>{t('orEmail')}</span></div></div>
    <form onSubmit={submit}>
      {register&&<label className="field">{t('name')}<div className="input-icon"><UserRound size={17}/><input name="name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={60} placeholder={t('name')}/></div></label>}
      <label className="field">{t('email')}<div className="input-icon"><Mail size={17}/><input name="email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com" maxLength={254}/></div></label>
      <label className="field">{t('password')}<div className="input-icon"><LockKeyhole size={17}/><input id="auth-password" aria-label={t('password')} name="password" type={show?'text':'password'} autoComplete={register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={register?10:1} maxLength={128} placeholder={register?t('passwordHint'):'••••••••••'}/><button type="button" className="icon-button" onClick={()=>setShow(x=>!x)} aria-label={t(show?'hidePassword':'showPassword')}>{show?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
      {register&&<label className="checkbox-label"><input type="checkbox" checked={terms} onChange={e=>setTerms(e.target.checked)} required/><span>{t('agreeTerms')} <Link to="/terms" target="_blank">↗</Link></span></label>}
      {error&&<div className="form-error" role="alert">{error}</div>}
      <Button className="button primary wide auth-submit" busy={busy} type="submit">{t(register?'signUp':'signIn')}<ArrowRight size={17}/></Button>
    </form>
    <div className="auth-recovery-links"><Link to={recoveryLink('forgot')}>{t('forgotPassword')}</Link><Link to={recoveryLink('resend')}>{t('resendVerification')}</Link></div>
    {register&&config.auth?.email&&<p className="auth-availability">{t('registrationVerificationHint')}</p>}
    <p className="auth-switch">{t(register?'haveAccount':'noAccount')} <button onClick={toggle}>{t(register?'signIn':'signUp')}</button></p>
    <div className="auth-guest"><Link to="/browse">{t('browseStories')}<ArrowUpRight size={14}/></Link><span>{t('freeAccess')}</span></div>
  </section><AuthArtwork/></div>;
}
export function WalletPage(){return <AuthGate><WalletContent/></AuthGate>;}
function WalletContent(){
  const{t}=useI18n();const{user,refreshUser,checkout,toast,config}=useApp();const[amount,setAmount]=useState('10');const[busy,setBusy]=useState(false);const[params,setParams]=useSearchParams();const{data,loading,error,refresh}=useApi<any>('/api/wallet');const returnTo=params.get('return');
  const minimum=Number.isFinite(config.limits.minWalletFundingUsd)?Math.round(config.limits.minWalletFundingUsd*100):MIN_WALLET_FUNDING_CENTS;
  const maximum=Number.isFinite(config.limits.maxWalletFundingUsd)?Math.min(Math.round(config.limits.maxWalletFundingUsd*100),MAX_WALLET_FUNDING_CENTS):MAX_WALLET_FUNDING_CENTS;
  const amountCents=parseUsdCents(amount);const validAmount=amountCents!==null&&amountCents>=minimum&&amountCents<=maximum;
  const paymentsAvailable=config.paymentsMode!=='disabled'&&config.paymentsReady!==false&&!user?.payment_review;
  const fundingMessage=(key:'walletFundingHint'|'walletFundingRange')=>t(key).replace('{minimum}',usd(minimum*10000)).replace('{maximum}',usd(maximum*10000));
  const amountError=!amount.trim()?'':amountCents===null?(Number(amount)>maximum/100?fundingMessage('walletFundingRange'):t('walletFundingInvalid')):!validAmount?fundingMessage('walletFundingRange'):'';
  const presets=[...new Set(config.walletFunding?.presetAmountsCents||[1000,2500,5000,10000])].filter(value=>Number.isSafeInteger(value)&&value>=1000&&value>=minimum&&value<=maximum);
  const bonusFor=(cents:number)=>{const bonus=config.walletFunding?.rewards?.find(reward=>reward.amountCents===cents)?.bonusCents;return typeof bonus==='number'&&Number.isSafeInteger(bonus)&&bonus>0&&Number.isSafeInteger(cents+bonus)?bonus:0;};
  const selectedBonus=validAmount?bonusFor(amountCents!):0;
  const selectedQuote:FundingCreditQuote|undefined=validAmount&&selectedBonus>0?{amountCents:amountCents!,bonusCents:selectedBonus,totalCreditCents:amountCents!+selectedBonus,currency:'usd'}:undefined;
  const presetLabel=(cents:number,bonus:number)=>bonus?t('walletRewardPresetLabel').replace('{amount}',usd(cents*10000)).replace('{bonus}',usd(bonus*10000)).replace('{total}',usd((cents+bonus)*10000)):`US$${cents/100}`;
  const amountDescription=['wallet-amount-hint',amountError?'wallet-amount-error':'',selectedQuote?'wallet-reward-note':''].filter(Boolean).join(' ');
  useEffect(()=>{const session=params.get('session_id');if(params.get('checkout')==='cancelled'){toast(t('paymentCancelled'));setParams({}, {replace:true});}if(params.get('checkout')==='success'&&session){setBusy(true);post('/api/payments/reconcile',{session_id:session}).then(async d=>{await refreshUser();refresh();toast(t(d.paid?'paymentSuccess':'paymentProcessing'));}).catch(e=>toast(e.message,true)).finally(()=>{setBusy(false);setParams({}, {replace:true});});}},[params.get('session_id')]);
  useEffect(()=>refresh(),[user?.wallet_micros,user?.publisher_active]);
  const topUp=async()=>{if(!validAmount||!paymentsAvailable||busy)return;setBusy(true);try{await checkout('funding',amountCents!);}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}};
  const kind=(s:string):Key=>({funding:'addFunds',funding_bonus:'walletRewardLedgerTitle',unlock:'unlock',earning:'earnings',activation:'dramioPass',withdrawal:'requestPayout',withdrawal_refund:'requestPayout'}[s] as Key)||'transactionHistory';
  return <div className="page wallet-page">
    <PageTitle eyebrow={t('account')} title={t('wallet')} description={t('walletBody')}/><PaymentReviewNotice/>
    {returnTo&&<Link to={safeNext(returnTo)} className="back-link"><ArrowRight size={16}/>{t('continueWatching')}</Link>}
    <div className="wallet-grid">
      <section className="balance-card"><div className="balance-card-header"><Wallet size={25}/><span>USD</span></div><span>{t('balance')}</span><strong>{usd(user?.wallet_micros||0)}</strong><p>{t('walletNote')}</p><div className="balance-card-bottom"><span><ShieldCheck size={14}/>{t('setYourPrice')}</span><span>LingYing</span></div><div className="balance-decoration"/></section>
      <section className="panel topup-panel">
        <h2>{t('addFunds')}</h2><p id="wallet-amount-hint">{fundingMessage('walletFundingHint')}</p>
        <div className="amount-options wallet-funding-options">{presets.map(cents=>{const bonus=bonusFor(cents);return <button type="button" className={amountCents===cents?'active':''} aria-pressed={amountCents===cents} aria-label={presetLabel(cents,bonus)} key={cents} onClick={()=>setAmount((cents/100).toFixed(2))}>
          <span className="funding-option-amount">US${cents/100}{amountCents===cents&&<Check size={12} aria-hidden="true"/>}</span>
          {bonus>0&&<small className="funding-option-gift"><Gift size={14} aria-hidden="true"/>{t('walletRewardGift').replace('{bonus}',usd(bonus*10000))}</small>}
        </button>;})}</div>
        <label className="field">{t('amount')} (USD)<div className="money-input"><span>US$</span><input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={e=>setAmount(e.target.value)} aria-label={t('amount')} aria-describedby={amountDescription} aria-invalid={!!amountError} placeholder="10.00" maxLength={20}/></div></label>
        {amountError&&<p id="wallet-amount-error" className="form-error" role="alert">{amountError}</p>}
        {selectedQuote&&<FundingReward quote={selectedQuote} noteId="wallet-reward-note"/>}
        <Button className="button primary wide" busy={busy} disabled={!validAmount||!paymentsAvailable} onClick={topUp}><Plus size={17}/>{t('addFunds')}{amountCents!==null&&<> · {usd(amountCents*10000)}</>}</Button>
        {(config.paymentsMode==='demo'||config.paymentsTestMode)&&<p className="payment-disclosure"><ShieldCheck size={14}/>{t(config.paymentsTestMode?'stripeTestPaymentBody':'testPaymentBody')}</p>}
        {!paymentsAvailable&&!user?.payment_review&&<p className="form-error">{t('paymentUnavailable')}</p>}
      </section>
    </div>
    <section className="panel ledger-panel"><div className="panel-heading"><h2>{t('transactionHistory')}</h2><Wallet size={18}/></div>{loading?<Loading/>:error?<ErrorState error={error} retry={refresh}/>:data?.ledger.length?<div className="ledger-list">{data.ledger.map((item:any)=><div key={item.id} className="ledger-row">
      <span className={`ledger-icon ${item.kind==='funding_bonus'?'funding-bonus':item.amount_micros>0?'positive':''}`}>{item.kind==='funding_bonus'?<Gift size={19} aria-hidden="true"/>:item.amount_micros>0?<ArrowDownLeft size={19}/>:<ArrowOut size={19}/>}</span>
      <div><strong>{t(kind(item.kind))}</strong><p>{item.kind==='activation'?t('passNoMonthly'):item.kind==='funding'?t('walletNote'):item.kind==='funding_bonus'?t('walletRewardLedgerBody'):item.description}</p></div>
      <time>{new Date(item.created_at.replace(' ','T')+'Z').toLocaleDateString()}</time><strong className={item.amount_micros>0?'green-text':''}>{item.kind==='activation'?(Number.isSafeInteger(item.payment_amount_cents)&&item.payment_currency==='hkd'?`HK$${(item.payment_amount_cents/100).toFixed(2)}`:t('dramioPass')):`${item.amount_micros>0?'+':''}${usd(item.amount_micros)}`}</strong>
    </div>)}</div>:<Empty title={t('noTransactions')} icon="film"/>}</section>
  </div>;
}
export function Account(){return <AuthGate><AccountContent/></AuthGate>;}
function EmailVerificationPanel(){
  const{user,config}=useApp();const{t,locale}=useI18n();const[busy,setBusy]=useState(false);const[requested,setRequested]=useState(false);const[error,setError]=useState('');
  const verified=!!user?.email_verified;const enabled=!!config.auth?.email;
  const resend=async()=>{if(!user||verified||!enabled||busy)return;setBusy(true);setError('');try{await post('/api/auth/resend-verification',{email:user.email,language:locale});setRequested(true);}catch(caught){setError(t(emailErrorKey(caught)));}finally{setBusy(false);}};
  return <section className="panel email-verification-panel" data-state={verified?'verified':'unverified'}><div className="email-verification-heading"><Mail size={19} aria-hidden="true"/><h2>{t('verifyEmailTitle')}</h2><span className="email-verification-badge">{verified&&<Check size={12} aria-hidden="true"/>}{t(verified?'emailVerified':'emailNotVerified')}</span></div><p>{t('emailVerificationBody')}</p>{!verified&&<><Button className="button secondary" busy={busy} disabled={!enabled} onClick={resend}>{t('resendVerification')}</Button>{!enabled&&<p className="auth-availability">{t('emailUnavailable')}</p>}{requested&&<div className="auth-email-status" role="status"><Check size={18} aria-hidden="true"/><span>{t('emailRequestReceived')}</span></div>}{error&&<p className="form-error" role="alert">{error}</p>}</>}</section>;
}
interface AccountIdentities {google:{linked:boolean;email?:string};apple?:{linked:boolean;email?:string};password:boolean}
function AccountContent(){
  const{user,setUser,toast,config}=useApp();const{locale,setLocale,t}=useI18n();const[name,setName]=useState(user?.name||'');const[language,setLanguage]=useState(locale);const[busy,setBusy]=useState(false);const navigate=useNavigate();const[params,setParams]=useSearchParams();
  const googleEnabled=!!config.auth?.google;const appleEnabled=!!config.auth?.apple;const identities=useApi<AccountIdentities>(googleEnabled||appleEnabled?'/api/account/identities':undefined);
  const[linkOpen,setLinkOpen]=useState(false);const[linkProvider,setLinkProvider]=useState<'google'|'apple'>('google');const[linkPassword,setLinkPassword]=useState('');const[linkBusy,setLinkBusy]=useState(false);const[linkError,setLinkError]=useState('');
  useEffect(()=>{const error=params.get('error');if(error||params.get('google')==='linked'||params.get('apple')==='linked'){toast(error?t(googleErrorKeys[error]||'googleFailed'):t(params.get('apple')==='linked'?'appleLinkedSuccess':'googleLinkedSuccess'),!!error);const clean=new URLSearchParams(params);clean.delete('error');clean.delete('google');clean.delete('apple');setParams(clean,{replace:true});}},[params.get('error'),params.get('google'),params.get('apple')]);
  const save=async(e:FormEvent)=>{e.preventDefault();setBusy(true);try{const d=await api('/api/account',{method:'PATCH',body:JSON.stringify({name,language})});setUser(d.user);setLocale(language);toast(t('savedSuccess'));}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}};
  const logout=async()=>{await post('/api/auth/logout');setUser(null);navigate('/');};
  const install=async()=>{const event=(window as any).aidramioInstallEvent;if(event){await event.prompt();const result=await event.userChoice;(window as any).aidramioInstallEvent=null;if(result.outcome==='accepted')toast(t('done'));}else toast(t('installHint'));};
  const connectProvider=async(e:FormEvent)=>{e.preventDefault();setLinkBusy(true);setLinkError('');try{const result=await post<{url:string}>(`/api/auth/${linkProvider}/link`,{password:linkPassword,next:'/account',language:locale});setLinkPassword('');window.location.assign(result.url);}catch(error){setLinkError(error instanceof ApiError&&['INVALID_LOGIN','INVALID_PASSWORD'].includes(error.code)?t('googleLinkInvalidPassword'):t(linkProvider==='apple'?'appleFailed':'googleFailed'));setLinkBusy(false);}};
  const closeLink=()=>{if(!linkBusy){setLinkOpen(false);setLinkPassword('');setLinkError('');}};
  return <div className="page account-page"><PageTitle title={t('account')} description={t('preferences')}/><PaymentReviewNotice/><DramioPassCard/><div className="account-grid"><div>
    <section className="panel"><div className="profile-intro"><Avatar name={user!.name}/><div><div className="account-profile-heading"><h2>{user!.name}</h2>{user!.role==='admin'&&<span className="account-admin-role"><ShieldCheck size={13} aria-hidden="true"/>{t('adminAccountRole' as Key)}</span>}</div><p>{user!.email}</p></div></div><form onSubmit={save}><label className="field">{t('name')}<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={60} required/></label><label className="field">{t('language')}<select value={language} onChange={e=>setLanguage(e.target.value as any)}>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.name}</option>)}</select></label><Button className="button primary" busy={busy} type="submit">{t('saveProfile')}</Button></form></section>
    <EmailVerificationPanel/>
    {(googleEnabled||appleEnabled)&&<section className="panel sign-in-methods"><h2>{t('signInMethods')}</h2>{identities.loading?<Loading/>:identities.error?<ErrorState error={identities.error} retry={identities.refresh}/>:<>{googleEnabled&&<div className="account-provider-method">{identities.data?.google.linked?<div className="google-linked"><div className="google-linked-heading"><GoogleMark/><strong>{t('googleConnected')}</strong><Check size={17}/></div>{identities.data.google.email&&<p className="google-linked-email">{identities.data.google.email}</p>}<p className="muted">{t('googleLinkedNotice')}</p></div>:<><p className="muted">{t('googleLinkBody')}</p>{identities.data?.password&&<button className="button google-button" type="button" onClick={()=>{setLinkProvider('google');setLinkPassword('');setLinkError('');setLinkOpen(true);}}><GoogleMark/>{t('connectGoogle')}</button>}</>}</div>}{appleEnabled&&<div className="account-provider-method">{identities.data?.apple?.linked?<div className="google-linked"><div className="google-linked-heading"><strong>{t('appleConnected')}</strong><Check size={17}/></div>{identities.data.apple.email&&<p className="google-linked-email">{identities.data.apple.email}</p>}<p className="muted">{t('appleLinkedNotice')}</p></div>:<><p className="muted">{t('appleLinkBody')}</p>{identities.data?.password&&<button className="button apple-button" type="button" onClick={()=>{setLinkProvider('apple');setLinkPassword('');setLinkError('');setLinkOpen(true);}}>{t('connectApple')}</button>}</>}</div>}</>}</section>}
  </div><div><section className="panel account-links"><Link to="/wallet"><Wallet size={20}/><span>{t('wallet')}<small>{usd(user!.wallet_micros)}</small></span><ArrowUpRight size={18}/></Link><Link to="/studio"><Clapperboard size={20}/><span>{t('studio')}</span><ArrowUpRight size={18}/></Link><button onClick={install}><Download size={20}/><span>{t('installApp')}</span><ArrowUpRight size={18}/></button>{user!.role==='admin'&&<Link to="/admin"><ShieldCheck size={20}/><span>{t('admin')}</span><ArrowUpRight size={18}/></Link>}<button className="danger-text" onClick={logout}><LogOut size={20}/><span>{t('signOut')}</span></button></section><div className="account-note"><Sparkles size={22}/><h3>{t('aiWelcome')}</h3><p>{t('aiWelcomeBody')}</p></div></div></div>
    <Modal open={linkOpen} onClose={closeLink} title={t(linkProvider==='apple'?'connectApple':'connectGoogle')}><p className="muted google-link-intro">{t(linkProvider==='apple'?'appleLinkBody':'googleLinkBody')}</p><form onSubmit={connectProvider}><label className="field">{t(linkProvider==='apple'?'appleLinkPassword':'googleLinkPassword')}<input type="password" autoComplete="current-password" value={linkPassword} onChange={e=>setLinkPassword(e.target.value)} maxLength={128} required autoFocus/></label>{linkError&&<div className="form-error" role="alert">{linkError}</div>}<Button type="submit" className={`button ${linkProvider==='apple'?'apple-button':'google-button'} wide`} busy={linkBusy}>{linkProvider==='google'&&<GoogleMark/>}{t(linkProvider==='apple'?'appleLinkAction':'googleLinkAction')}</Button><button className="button ghost wide" type="button" disabled={linkBusy} onClick={closeLink}>{t('cancel')}</button></form></Modal>
  </div>;
}
export function InfoPage({type}:{type:'help'|'terms'|'privacy'}){
  const{t}=useI18n();
  if(type!=='help')return <LegalPolicy type={type}/>;
  const sections=[
    [t('watch'),t('freeAccess')+' '+t('guestBody')],
    [t('unlock'),t('walletNote')+' '+t('pricingBody')],
    [t('activate'),t('activationBody')+' '+t('storageIncluded')],
    [t('uploadEpisodes'),t('uploadRules')+' '+t('languageHint')],
    [t('requestPayout'),t('payoutBody')+' '+t('exchangeNote')],
    [t('aiStories'),t('aiWelcomeBody')],
    [t('requestStorage'),t('storageBody')],
  ];
  return <div className="page info-page"><PageTitle eyebrow="LingYing" title={t('help')} description={t('heroSubtitle')}/><section className="panel company-contact" aria-labelledby="company-contact-heading"><h2 id="company-contact-heading">{COMPANY_NAME}</h2><address><a href={CONTACT_HREF}><Mail size={18} aria-hidden="true"/>{CONTACT_EMAIL}</a></address></section><div className="info-sections">{sections.map(([title,body])=><details className="faq-item" key={title}><summary>{title}<ChevronDown size={18}/></summary><p>{body}</p></details>)}</div></div>;
}
