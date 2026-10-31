import { useEffect,useState,type FormEvent } from 'react';
import { Link,useLocation,useNavigate,useSearchParams } from 'react-router-dom';
import { ArrowUpRight,ArrowRight,Eye,EyeOff,Mail,LockKeyhole,Sparkles,Wallet,Plus,ArrowDownLeft,ArrowUpRight as ArrowOut,Check,ShieldCheck,Clapperboard,Globe2,LogOut,Download,UserRound,ChevronDown,Film } from 'lucide-react';
import { api,apiUrl,post,useApi,ApiError } from '../api';
import { useApp } from '../context';
import { useI18n,type Key } from '../i18n';
import { AuthGate,Avatar,Brand,Button,Empty,ErrorState,Loading,PageTitle,Modal } from '../ui';
import { LANGUAGES,usd,MIN_WALLET_FUNDING_CENTS,MAX_WALLET_FUNDING_CENTS } from '../../shared/config';
import { parseUsdCents } from '../../shared/money';
import {DramioPassCard} from '../components/DramioPass';
import {PaymentReviewNotice} from '../components/PaymentReview';
import { COMPANY_NAME,CONTACT_EMAIL,CONTACT_HREF } from '../company';
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
function AuthArtwork(){const{t}=useI18n();return <aside className="auth-art"><img src="/images/blue-hour.jpg" alt=""/><div className="auth-art-shade"/><span className="auth-art-star">✳</span><div><span className="eyebrow">LingYing ORIGINALS</span><h2>{t('heroTitle')}</h2><p>{t('heroSubtitle')}</p><span className="auth-worlds">EN · 繁 · 日本語 · 한국어 · +17</span></div><span className="auth-art-caption">{t('worldTitle')}</span></aside>;}
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
  const{t}=useI18n();const{user,refreshUser,checkout,toast,config}=useApp();const[amount,setAmount]=useState('5');const[busy,setBusy]=useState(false);const[params,setParams]=useSearchParams();const{data,loading,error,refresh}=useApi<any>('/api/wallet');const returnTo=params.get('return');
  const minimum=Number.isFinite(config.limits.minWalletFundingUsd)?Math.round(config.limits.minWalletFundingUsd*100):MIN_WALLET_FUNDING_CENTS;
  const maximum=Number.isFinite(config.limits.maxWalletFundingUsd)?Math.min(Math.round(config.limits.maxWalletFundingUsd*100),MAX_WALLET_FUNDING_CENTS):MAX_WALLET_FUNDING_CENTS;
  const amountCents=parseUsdCents(amount);const validAmount=amountCents!==null&&amountCents>=minimum&&amountCents<=maximum;
  const paymentsAvailable=config.paymentsMode!=='disabled'&&config.paymentsReady!==false&&!user?.payment_review;
  const fundingMessage=(key:'walletFundingHint'|'walletFundingRange')=>t(key).replace('{minimum}',usd(minimum*10000)).replace('{maximum}',usd(maximum*10000));
  const amountError=!amount.trim()?'':amountCents===null?(Number(amount)>maximum/100?fundingMessage('walletFundingRange'):t('walletFundingInvalid')):!validAmount?fundingMessage('walletFundingRange'):'';
  useEffect(()=>{const session=params.get('session_id');if(params.get('checkout')==='cancelled'){toast(t('paymentCancelled'));setParams({}, {replace:true});}if(params.get('checkout')==='success'&&session){setBusy(true);post('/api/payments/reconcile',{session_id:session}).then(async d=>{await refreshUser();refresh();toast(t(d.paid?'paymentSuccess':'paymentProcessing'));}).catch(e=>toast(e.message,true)).finally(()=>{setBusy(false);setParams({}, {replace:true});});}},[params.get('session_id')]);
  useEffect(()=>refresh(),[user?.wallet_micros,user?.publisher_active]);
  const topUp=async()=>{if(!validAmount||!paymentsAvailable||busy)return;setBusy(true);try{await checkout('funding',amountCents!);}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}};
  const kind=(s:string):Key=>({funding:'addFunds',unlock:'unlock',earning:'earnings',activation:'dramioPass',withdrawal:'requestPayout',withdrawal_refund:'requestPayout'}[s] as Key)||'transactionHistory';
  return <div className="page wallet-page"><PageTitle eyebrow={t('account')} title={t('wallet')} description={t('walletBody')}/><PaymentReviewNotice/>{returnTo&&<Link to={safeNext(returnTo)} className="back-link"><ArrowRight size={16}/>{t('continueWatching')}</Link>}<div className="wallet-grid"><section className="balance-card"><div className="balance-card-header"><Wallet size={25}/><span>USD</span></div><span>{t('balance')}</span><strong>{usd(user?.wallet_micros||0)}</strong><p>{t('walletNote')}</p><div className="balance-card-bottom"><span><ShieldCheck size={14}/>{t('setYourPrice')}</span><span>LingYing</span></div><div className="balance-decoration"/></section><section className="panel topup-panel"><h2>{t('addFunds')}</h2><p id="wallet-amount-hint">{fundingMessage('walletFundingHint')}</p><div className="amount-options">{[5,10,25,50].map(n=><button className={amountCents===n*100?'active':''} aria-pressed={amountCents===n*100} key={n} onClick={()=>setAmount(n.toFixed(2))}>US${n}{amountCents===n*100&&<Check size={12}/>}</button>)}</div><label className="field">{t('amount')} (USD)<div className="money-input"><span>US$</span><input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={e=>setAmount(e.target.value)} aria-label={t('amount')} aria-describedby={amountError?'wallet-amount-hint wallet-amount-error':'wallet-amount-hint'} aria-invalid={!!amountError} placeholder="5.00" maxLength={20}/></div></label>{amountError&&<p id="wallet-amount-error" className="form-error" role="alert">{amountError}</p>}<Button className="button primary wide" busy={busy} disabled={!validAmount||!paymentsAvailable} onClick={topUp}><Plus size={17}/>{t('addFunds')}{amountCents!==null&&<> · {usd(amountCents*10000)}</>}</Button>{(config.paymentsMode==='demo'||config.paymentsTestMode)&&<p className="payment-disclosure"><ShieldCheck size={14}/>{t(config.paymentsTestMode?'stripeTestPaymentBody':'testPaymentBody')}</p>}{!paymentsAvailable&&!user?.payment_review&&<p className="form-error">{t('paymentUnavailable')}</p>}</section></div><section className="panel ledger-panel"><div className="panel-heading"><h2>{t('transactionHistory')}</h2><Wallet size={18}/></div>{loading?<Loading/>:error?<ErrorState error={error} retry={refresh}/>:data?.ledger.length?<div className="ledger-list">{data.ledger.map((item:any)=><div key={item.id} className="ledger-row"><span className={`ledger-icon ${item.amount_micros>0?'positive':''}`}>{item.amount_micros>0?<ArrowDownLeft size={19}/>:<ArrowOut size={19}/>}</span><div><strong>{t(kind(item.kind))}</strong><p>{item.kind==='activation'?t('activationBody'):item.kind==='funding'?t('walletNote'):item.description}</p></div><time>{new Date(item.created_at.replace(' ','T')+'Z').toLocaleDateString()}</time><strong className={item.amount_micros>0?'green-text':''}>{item.kind==='activation'?'HK$88':`${item.amount_micros>0?'+':''}${usd(item.amount_micros)}`}</strong></div>)}</div>:<Empty title={t('noTransactions')} icon="film"/>}</section></div>;
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
    <section className="panel"><div className="profile-intro"><Avatar name={user!.name}/><div><h2>{user!.name}</h2><p>{user!.email}</p></div></div><form onSubmit={save}><label className="field">{t('name')}<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={60} required/></label><label className="field">{t('language')}<select value={language} onChange={e=>setLanguage(e.target.value as any)}>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.name}</option>)}</select></label><Button className="button primary" busy={busy} type="submit">{t('saveProfile')}</Button></form></section>
    <EmailVerificationPanel/>
    {(googleEnabled||appleEnabled)&&<section className="panel sign-in-methods"><h2>{t('signInMethods')}</h2>{identities.loading?<Loading/>:identities.error?<ErrorState error={identities.error} retry={identities.refresh}/>:<>{googleEnabled&&<div className="account-provider-method">{identities.data?.google.linked?<div className="google-linked"><div className="google-linked-heading"><GoogleMark/><strong>{t('googleConnected')}</strong><Check size={17}/></div>{identities.data.google.email&&<p className="google-linked-email">{identities.data.google.email}</p>}<p className="muted">{t('googleLinkedNotice')}</p></div>:<><p className="muted">{t('googleLinkBody')}</p>{identities.data?.password&&<button className="button google-button" type="button" onClick={()=>{setLinkProvider('google');setLinkPassword('');setLinkError('');setLinkOpen(true);}}><GoogleMark/>{t('connectGoogle')}</button>}</>}</div>}{appleEnabled&&<div className="account-provider-method">{identities.data?.apple?.linked?<div className="google-linked"><div className="google-linked-heading"><strong>{t('appleConnected')}</strong><Check size={17}/></div>{identities.data.apple.email&&<p className="google-linked-email">{identities.data.apple.email}</p>}<p className="muted">{t('appleLinkedNotice')}</p></div>:<><p className="muted">{t('appleLinkBody')}</p>{identities.data?.password&&<button className="button apple-button" type="button" onClick={()=>{setLinkProvider('apple');setLinkPassword('');setLinkError('');setLinkOpen(true);}}>{t('connectApple')}</button>}</>}</div>}</>}</section>}
  </div><div><section className="panel account-links"><Link to="/wallet"><Wallet size={20}/><span>{t('wallet')}<small>{usd(user!.wallet_micros)}</small></span><ArrowUpRight size={18}/></Link><Link to="/studio"><Clapperboard size={20}/><span>{t('studio')}</span><ArrowUpRight size={18}/></Link><button onClick={install}><Download size={20}/><span>{t('installApp')}</span><ArrowUpRight size={18}/></button>{user!.role==='admin'&&<Link to="/admin"><ShieldCheck size={20}/><span>{t('admin')}</span><ArrowUpRight size={18}/></Link>}<button className="danger-text" onClick={logout}><LogOut size={20}/><span>{t('signOut')}</span></button></section><div className="account-note"><Sparkles size={22}/><h3>{t('aiWelcome')}</h3><p>{t('aiWelcomeBody')}</p></div></div></div>
    <Modal open={linkOpen} onClose={closeLink} title={t(linkProvider==='apple'?'connectApple':'connectGoogle')}><p className="muted google-link-intro">{t(linkProvider==='apple'?'appleLinkBody':'googleLinkBody')}</p><form onSubmit={connectProvider}><label className="field">{t(linkProvider==='apple'?'appleLinkPassword':'googleLinkPassword')}<input type="password" autoComplete="current-password" value={linkPassword} onChange={e=>setLinkPassword(e.target.value)} maxLength={128} required autoFocus/></label>{linkError&&<div className="form-error" role="alert">{linkError}</div>}<Button type="submit" className={`button ${linkProvider==='apple'?'apple-button':'google-button'} wide`} busy={linkBusy}>{linkProvider==='google'&&<GoogleMark/>}{t(linkProvider==='apple'?'appleLinkAction':'googleLinkAction')}</Button><button className="button ghost wide" type="button" disabled={linkBusy} onClick={closeLink}>{t('cancel')}</button></form></Modal>
  </div>;
}
export function InfoPage({type}:{type:'help'|'terms'|'privacy'}){
  const{t}=useI18n();
  const sections=type==='help'?[
    [t('watch'),t('freeAccess')+' '+t('guestBody')],
    [t('unlock'),t('walletNote')+' '+t('pricingBody')],
    [t('activate'),t('activationBody')+' '+t('storageIncluded')],
    [t('uploadEpisodes'),t('uploadRules')+' '+t('languageHint')],
    [t('requestPayout'),t('payoutBody')+' '+t('exchangeNote')],
    [t('aiStories'),t('aiWelcomeBody')],
    [t('requestStorage'),t('storageBody')],
  ]:type==='terms'?[
    ['Using LingYing',`LingYing is operated by ${COMPANY_NAME}. You may browse and watch episodes marked free without an account. An account is required for purchases, wallet funding, publishing, and payouts. Keep your credentials private and provide accurate information.`],
    ['Dramio Pass and storage','Dramio Pass costs HK$88 once and enables publisher uploads. Each publisher starts with 5 GB. Each uploaded episode must be no longer than 3 minutes and no larger than 75 MB before processing. Larger storage allowances require approval and a separate quote.'],
    ['Your content and rights','You retain ownership of your work. By publishing, you grant the platform permission to store, process, display, and stream it to viewers. Upload only material you are entitled to distribute, including any music, artwork, likenesses, and AI-generated assets. Accurately label the production method and language.'],
    ['Episode purchases','Publishers choose the number of initial free episodes and a paid episode price of at least US$0.10. A successful unlock is attached to the purchasing account. Changing a price does not remove earlier purchase entitlements. Wallet credit is denominated in USD and cannot be withdrawn as cash.'],
    ['Revenue and payouts','The publisher receives 70% of each episode unlock; the platform retains 30%. Fractional cents are recorded precisely. Payouts require at least HK$20 equivalent, sufficient available earnings, and approval. The payment provider may require identity verification and applies its own currency conversion and fees.'],
    ['Availability and disputes',`Do not publish unlawful material, impersonate others, or upload content without permission. Purchased content must not be removed through self-service tools. Contact ${COMPANY_NAME} at ${CONTACT_EMAIL} to resolve access, rights, refunds, chargebacks, or account disputes.`],
  ]:[
    ['Information we store',`${COMPANY_NAME} operates LingYing and stores your name, email, account preferences, uploaded content, purchases, watch progress, series likes and saves, wallet entries, and payout requests. Playback records measure views and active watch time; publishers receive aggregate statistics without individual viewer identities. When you register with a password, we store a salted password hash, never the plain password.`],
    ['Google sign-in','If you choose Google sign-in, Google verifies your identity and we store its account identifier, verified email and name to sign you in. Your wallet and purchases remain attached to your LingYing account. An existing password account must be signed into and explicitly linked before Google can access it. We do not request access to your Gmail messages, contacts or Google Drive.'],
    ['Apple sign-in','If you choose Apple sign-in, Apple verifies your identity and we store its account identifier and supplied account email, which can be an Apple private relay address. Existing accounts require explicit linking before Apple can access their wallet or purchases. We do not store your Apple password.'],
    ['Email verification and password resets','When you request an account email, we send the address and a limited account-security message to our email delivery provider. Reset and verification links contain random, expiring, single-use tokens; the database stores their hashes. A password reset signs out the affected account sessions while preserving the wallet, purchases and publisher status.'],
    ['Payments','Card details are entered on Stripe-hosted pages. LingYing stores payment identifiers and transaction amounts, not full card numbers. Publisher verification and banking details are handled by Stripe Connect when live payouts are configured.'],
    ['Cookies and local preferences','A secure, HTTP-only cookie identifies your session. When guests play an episode, another random HTTP-only cookie helps avoid counting repeated plays as extra views. Playback analytics store a hashed viewer identifier, not a raw IP address. Browser storage remembers your interface language. The app does not use advertising trackers. Media is served from the platform or its configured object storage provider.'],
    ['Access and retention','Publishers see the revenue and activity associated with their work; they do not receive viewers’ passwords or payment card details. Platform administrators can review accounts, storage requests, and payouts. Financial records may need to be retained after an account closure.'],
    ['Your choices',`You can change your name and language, remove saved stories, and sign out. For account deletion, data access, content complaints, or privacy requests, contact ${COMPANY_NAME} at ${CONTACT_EMAIL}.`],
  ];
  return <div className="page info-page"><PageTitle eyebrow="LingYing" title={t(type)} description={type==='help'?t('heroSubtitle'):undefined}/><section className="panel company-contact" aria-labelledby="company-contact-heading"><h2 id="company-contact-heading">{COMPANY_NAME}</h2><address><a href={CONTACT_HREF}><Mail size={18} aria-hidden="true"/>{CONTACT_EMAIL}</a></address></section><div className="info-sections">{sections.map(([title,body])=>type==='help'?<details className="faq-item" key={title}><summary>{title}<ChevronDown size={18}/></summary><p>{body}</p></details>:<section className="panel" key={title}><h2>{title}</h2><p>{body}</p></section>)}</div></div>;
}
