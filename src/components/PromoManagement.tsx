import {useState,type FormEvent} from 'react';
import {Plus,Pencil,Ticket,History,Check,Power} from 'lucide-react';
import {api,post,useApi} from '../api';
import {useApp} from '../context';
import {useI18n,type Key} from '../i18n';
import {Button,Empty,ErrorState,Loading,Modal} from '../ui';
import {parseUsdCents} from '../../shared/money';
import '../promo-admin.css';

interface ManagedPromotion {
  id:string;code:string;enabled:boolean;discount_type:'amount'|'percent';discount_value:number;
  max_redemptions:number|null;amount_hkd_cents:number;regular_amount_hkd_cents:number;revision:number;
  paid_redemptions:number;pending_redemptions:number;created_at:string;updated_at:string;
}
interface PromotionEvent {id:string;promotion_id:string;actor_id:string;action:string;created_at:string}
interface PromotionList {promotions:ManagedPromotion[];events:PromotionEvent[]}
interface PromotionForm {code:string;enabled:boolean;type:'amount'|'percent';value:string;unlimited:boolean;limit:string}
const blank=():PromotionForm=>({code:'',enabled:true,type:'amount',value:'30.00',unlimited:true,limit:'100'});

export function PromoManagement(){
  const {user,toast,config}=useApp();const{t,locale}=useI18n();const label=(key:Key)=>t(key);
  const list=useApi<PromotionList>(user?.role==='admin'?'/api/admin/promotions':undefined);
  const[editor,setEditor]=useState<ManagedPromotion|'new'|null>(null);const[form,setForm]=useState<PromotionForm>(blank);
  const[busy,setBusy]=useState('');const[failure,setFailure]=useState('');
  const rate=Number.isFinite(config.usdToHkd)&&config.usdToHkd>0?config.usdToHkd:7.8;
  const price=(cents:number)=>`HK$${(cents/100).toFixed(2)}`;
  const approx=(cents:number)=>`≈ US$${(cents/100/rate).toFixed(2)}`;
  const discount=form.type==='amount'?parseUsdCents(form.value):/^\d+$/.test(form.value)?Number(form.value):null;
  const limit=form.unlimited?null:/^\d+$/.test(form.limit)?Number(form.limit):NaN;
  const validCode=/^[A-Z0-9_-]{3,32}$/i.test(form.code.trim());
  const validDiscount=discount!==null&&Number.isSafeInteger(discount)&&discount>0&&discount<=(form.type==='amount'?8400:95);
  const validLimit=form.unlimited||limit!==null&&Number.isSafeInteger(limit)&&limit>0&&limit<=1_000_000;
  const valid=validCode&&validDiscount&&validLimit;
  const finalPrice=validDiscount?form.type==='amount'?8800-discount!:Math.round(8800*(100-discount!)/100):null;
  const choose=(promotion:ManagedPromotion|'new')=>{setEditor(promotion);setFailure('');setForm(promotion==='new'?blank():{code:promotion.code,enabled:promotion.enabled,type:promotion.discount_type,value:promotion.discount_type==='amount'?(promotion.discount_value/100).toFixed(2):String(promotion.discount_value),unlimited:promotion.max_redemptions===null,limit:String(promotion.max_redemptions??100)});};
  const close=()=>{if(!busy)setEditor(null);};
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!editor||busy)return;if(!valid){setFailure(label('promoValidation'));return;}
    const body={enabled:form.enabled,discount_type:form.type,discount_value:discount!,max_redemptions:limit};
    setBusy('editor');setFailure('');
    try{if(editor==='new')await post('/api/admin/promotions',{...body,code:form.code.trim().toUpperCase()});else await api(`/api/admin/promotions/${encodeURIComponent(editor.id)}`,{method:'PATCH',body:JSON.stringify(body)});setEditor(null);list.refresh();toast(label('promoSaved'));}
    catch(error){setFailure(error instanceof Error?error.message:t('failed'));}finally{setBusy('');}
  };
  const toggle=async(promotion:ManagedPromotion)=>{
    if(busy)return;setBusy(promotion.id);setFailure('');
    try{await api(`/api/admin/promotions/${encodeURIComponent(promotion.id)}`,{method:'PATCH',body:JSON.stringify({enabled:!promotion.enabled})});list.refresh();toast(label('promoSaved'));}
    catch(error){setFailure(error instanceof Error?error.message:t('failed'));}finally{setBusy('');}
  };
  const date=(raw:string)=>{const value=new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?raw:raw.replace(' ','T')+'Z');return Number.isNaN(value.getTime())?'':new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value);};
  if(user?.role!=='admin')return <Empty title="403"/>;
  if(list.loading&&!list.data)return <Loading/>;
  if(list.error)return <ErrorState error={list.error} retry={list.refresh}/>;
  return <section className="panel promo-management" aria-labelledby="promo-management-title">
    <div className="promo-management-heading"><div><h2 id="promo-management-title"><Ticket size={20}/>{label('promoManagementTitle')}</h2><p>{label('promoManagementBody')}</p></div><button className="button primary" onClick={()=>choose('new')} disabled={!!busy}><Plus size={16}/>{label('promoCreate')}</button></div>
    <p className="field-hint">{label('promoUsageHint')}</p>
    {failure&&!editor&&<p className="form-error" role="alert">{failure}</p>}
    {list.data?.promotions.length?<div className="promo-management-list">{list.data.promotions.map(promotion=><article className="promo-management-card" key={promotion.id} data-promo-code={promotion.code}>
      <div className="promo-card-heading"><strong dir="ltr">{promotion.code}</strong><span className={`status ${promotion.enabled?'published':'draft'}`}>{promotion.enabled&&<Check size={12}/>} {label(promotion.enabled?'promoEnabled':'promoDisabled')}</span></div>
      <dl><div><dt>{label('promoDiscountValue')}</dt><dd>{promotion.discount_type==='amount'?price(promotion.discount_value):`${promotion.discount_value}%`} <small>{label(promotion.discount_type==='amount'?'promoFixedDiscount':'promoPercentDiscount')}</small></dd></div><div><dt>{label('promoFinalPrice')}</dt><dd>{price(promotion.amount_hkd_cents)} <small>{approx(promotion.amount_hkd_cents)}</small></dd></div><div><dt>{label('promoRedemptionLimit')}</dt><dd>{promotion.max_redemptions===null?label('promoUnlimited'):promotion.max_redemptions.toLocaleString(locale)}</dd></div><div><dt>{label('promoPaidRedemptions')}</dt><dd>{promotion.paid_redemptions.toLocaleString(locale)}</dd></div><div><dt>{label('promoPendingRedemptions')}</dt><dd>{promotion.pending_redemptions.toLocaleString(locale)}</dd></div></dl>
      <div className="promo-card-actions"><button className="button secondary small" disabled={!!busy} onClick={()=>choose(promotion)} aria-label={`${label('promoEdit')}: ${promotion.code}`}><Pencil size={14}/>{t('edit')}</button><Button className="button secondary small" busy={busy===promotion.id} disabled={!!busy} onClick={()=>toggle(promotion)} aria-label={`${label(promotion.enabled?'promoDisableAction':'promoEnableAction')}: ${promotion.code}`}><Power size={14}/>{label(promotion.enabled?'promoDisableAction':'promoEnableAction')}</Button></div>
    </article>)}</div>:<Empty title={label('promoNoCodes')} icon="film"/>}
    {!!list.data?.events.length&&<div className="promo-audit"><h3><History size={16}/>{label('promoAudit')}</h3>{list.data.events.slice(0,20).map(event=><div key={event.id}><span><strong dir="ltr">{list.data?.promotions.find(p=>p.id===event.promotion_id)?.code||'—'}</strong> · {label(event.action==='create'?'promoCreate':'promoEdit')}</span><time>{date(event.created_at)}</time></div>)}</div>}
    <Modal open={!!editor} onClose={close} title={label(editor==='new'?'promoCreate':'promoEdit')}>
      <form className="promo-editor-form" noValidate onSubmit={save}>
        <label className="field" htmlFor="managed-promo-code">{t('passPromoCode')}<input id="managed-promo-code" aria-label={t('passPromoCode')} value={form.code} onChange={event=>setForm(current=>({...current,code:event.target.value.toUpperCase()}))} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={!!busy||editor!=='new'} required aria-describedby="managed-promo-code-hint"/><small id="managed-promo-code-hint">{label('promoCodeFormat')}</small></label>
        <label className="field" htmlFor="managed-promo-type">{label('promoDiscountType')}<select id="managed-promo-type" aria-label={label('promoDiscountType')} value={form.type} disabled={!!busy} onChange={event=>setForm(current=>({...current,type:event.target.value as PromotionForm['type'],value:event.target.value==='amount'?'30.00':'20'}))}><option value="amount">{label('promoFixedDiscount')}</option><option value="percent">{label('promoPercentDiscount')}</option></select></label>
        <label className="field" htmlFor="managed-promo-value">{label('promoDiscountValue')}<div className="money-input"><span>{form.type==='amount'?'HK$':'%'}</span><input id="managed-promo-value" aria-label={label('promoDiscountValue')} type="text" inputMode={form.type==='amount'?'decimal':'numeric'} autoComplete="off" value={form.value} onChange={event=>setForm(current=>({...current,value:event.target.value}))} maxLength={10} disabled={!!busy} required aria-invalid={!validDiscount} aria-describedby="managed-promo-minimum"/></div><small id="managed-promo-minimum">{label('promoMinimumCharge').replace('{amount}',price(400))}</small></label>
        {finalPrice!==null&&<div className="promo-editor-preview" role="status"><span>{label('promoFinalPrice')}</span><strong>{price(finalPrice)}</strong><small>{approx(finalPrice)}</small></div>}
        <label className="checkbox-label"><input type="checkbox" checked={form.unlimited} onChange={event=>setForm(current=>({...current,unlimited:event.target.checked}))} disabled={!!busy}/><span>{label('promoUnlimited')}</span></label>
        {!form.unlimited&&<label className="field" htmlFor="managed-promo-limit">{label('promoLimitCount')}<input id="managed-promo-limit" aria-label={label('promoLimitCount')} type="text" inputMode="numeric" value={form.limit} onChange={event=>setForm(current=>({...current,limit:event.target.value}))} required maxLength={10} disabled={!!busy} aria-invalid={!validLimit}/></label>}
        <label className="checkbox-label"><input type="checkbox" checked={form.enabled} onChange={event=>setForm(current=>({...current,enabled:event.target.checked}))} disabled={!!busy}/><span>{label('promoEnabled')}</span></label>
        {failure&&<p className="form-error" role="alert">{failure}</p>}
        <Button type="submit" className="button primary wide" busy={busy==='editor'} disabled={!valid}>{t('saveDraft')}</Button><button type="button" className="button ghost wide" onClick={close} disabled={!!busy}>{t('cancel')}</button>
      </form>
    </Modal>
  </section>;
}
