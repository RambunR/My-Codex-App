import {test,expect,type Page} from '@playwright/test';
import {creatorConsent} from './helpers/creator-pass-consent';

const viewer={id:'consent-browser-viewer',name:'Prospective Creator',email:'consent@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false};
const checkbox=(page:Page)=>page.locator('input[name="creator_pass_consent"]');
const purchase=(page:Page)=>page.locator('.activation-card>button.primary');
async function fixture(page:Page,locale='en',reply:'success'|'changed'|'required'='success',policyMismatch=false){
  await page.addInitScript(language=>localStorage.setItem('drama-language',language),locale);
  const calls:Array<{path:string;body:any}>=[];
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='GET'){
      if(path==='/api/auth/me')return route.fulfill({json:{user:viewer}});
      if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,passPromotion:{enabled:true},creatorPassConsent:{policyVersion:policyMismatch?'2099-01-01':creatorConsent.policy_version,disclosureVersion:creatorConsent.disclosure_version},limits:{activationHkd:88}}});
      if(path==='/api/display-currency')return route.fulfill({json:{quote:null}});
      return route.fulfill({json:{}});
    }
    calls.push({path,body:request.postDataJSON()});
    if(path==='/api/payments/checkout')return route.fulfill(reply==='success'?{json:{demo:true,paymentId:'consent-browser-payment',amount_cents:8800,currency:'hkd'}}:{status:reply==='changed'?409:400,json:{error:{code:reply==='changed'?'CREATOR_POLICY_CHANGED':'CREATOR_CONSENT_REQUIRED',message:'Review the current policies.'}}});
    return route.fulfill({status:409,json:{error:{message:'Unexpected mutation in a consent journey.'}}});
  });
  return calls;
}

for(const locale of ['en','zh-TW','zh-CN','ar'])test(`${locale} creator must expressly agree before checkout; viewing policies never checks the box`,async({page})=>{
  await page.setViewportSize({width:320,height:844});const calls=await fixture(page,locale);await page.goto('/studio');
  const consent=page.locator('.creator-pass-consent');await expect(consent).toBeVisible({timeout:15000});await expect(checkbox(page)).toHaveAttribute('required','');await expect(checkbox(page)).not.toBeChecked();await expect(purchase(page)).toBeDisabled();
  const terms=consent.locator('a[href="/terms#creator-pass"]');await expect(terms).toHaveAttribute('target','_blank');await expect(terms).toHaveAttribute('rel',/noopener/);
  const popupPromise=page.waitForEvent('popup');await terms.click();const popup=await popupPromise;await expect(popup).toHaveURL('/terms#creator-pass');await expect(popup.locator('.legal-section#creator-pass h2')).toBeInViewport();await popup.close();await expect(checkbox(page)).not.toBeChecked();await expect(purchase(page)).toBeDisabled();expect(calls).toEqual([]);
  await checkbox(page).focus();await page.keyboard.press('Space');await expect(checkbox(page)).toBeChecked();await expect(purchase(page)).toBeEnabled();await page.keyboard.press('Space');await expect(purchase(page)).toBeDisabled();expect(calls).toEqual([]);
  await checkbox(page).check();await purchase(page).click();await expect(page.getByRole('dialog')).toContainText('HK$88.00');expect(calls).toEqual([{path:'/api/payments/checkout',body:{kind:'activation',amount_cents:8800,language:locale,creator_consent:creatorConsent}}]);
  await page.reload();await expect(checkbox(page)).not.toBeChecked();await expect(purchase(page)).toBeDisabled();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

for(const reply of ['changed','required'] as const)test(`${reply} server consent rejection clears agreement without retrying or opening payment`,async({page})=>{
  const calls=await fixture(page,'en',reply);await page.goto('/studio');await checkbox(page).check();await purchase(page).click();await expect(page.locator('.creator-pass-consent [role="alert"]')).toBeVisible();await expect(checkbox(page)).not.toBeChecked();await expect(purchase(page)).toBeDisabled();await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls).toHaveLength(1);
  if(reply==='changed'){await expect(checkbox(page)).toBeDisabled();await expect(page.locator('.creator-pass-consent-reload')).toBeVisible();await expect(page.locator('.creator-pass-consent-reload')).toBeFocused();}
  else await expect(checkbox(page)).toBeFocused();
});

test('an old application cannot silently accept a newer server policy',async({page})=>{
  const calls=await fixture(page,'en','success',true);await page.goto('/studio');await expect(page.locator('.creator-pass-consent [role="alert"]')).toContainText('policies have changed');await expect(checkbox(page)).toBeDisabled();await expect(checkbox(page)).not.toBeChecked();await expect(purchase(page)).toBeDisabled();expect(calls).toEqual([]);
});
