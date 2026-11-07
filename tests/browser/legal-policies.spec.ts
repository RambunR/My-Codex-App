import {test,expect,type Page} from '@playwright/test';

import {LEGAL_POLICY_VERSION} from '../../shared/creator-pass-consent';
const version=LEGAL_POLICY_VERSION;
const contact='contactus@hknovaxrproduction.com';
const passRisk='Dramio Pass provides publishing access. Buying a pass does not guarantee content approval, promotion, views, sales, revenue or income. Earnings may be zero.';
const inactiveCreator={id:'legal-pass-browser',name:'Prospective creator',email:'legal-pass@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',payment_review:false,dramio_pass:{active:false,test:false,purchased_at:null}};
const termsIds=['using-lingying','creator-pass','content-rights','acceptable-use','content-removal','copyright-reports','purchases-refunds','creator-earnings','disputes','availability-liability','changes-law'];
const privacyIds=['data-controller','data-collected','purposes','cookies','providers-transfers','public-information','retention','security','privacy-rights','children','privacy-changes'];
const names={en:{terms:'Terms of Use',privacy:'Privacy Policy'},'zh-TW':{terms:'使用條款',privacy:'私隱政策'},'zh-CN':{terms:'使用条款',privacy:'隐私政策'}};

async function fixture(page:Page,locale='en',authenticated=false){
  await page.setViewportSize({width:320,height:740});
  await page.addInitScript(language=>localStorage.setItem('drama-language',language),locale);
  const writes:string[]=[];
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(!['GET','HEAD'].includes(request.method())){writes.push(path);return route.fulfill({status:409,json:{error:{code:'READ_ONLY_FIXTURE',message:'No state changes in this policy journey.'}}});}
    if(path==='/api/auth/me')return route.fulfill({json:{user:authenticated?{...inactiveCreator,language:locale}:null}});
    if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'stripe',paymentsReady:true,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,passPromotion:{enabled:true},limits:{activationHkd:88,maxEpisodeBytes:200*1024**2,maxEpisodeSeconds:240,quotaBytes:5*1024**3},auth:{google:false,apple:false,email:false}}});
    if(path==='/api/display-currency')return route.fulfill({json:{quote:{country:'US',currency:'USD',ratePerHkd:1/7.8,asOf:'2026-11-07'}}});
    if(path==='/api/studio')return route.fulfill({json:{user:{...inactiveCreator,language:locale},series:[],stats:{sales:0,lifetime_micros:0},withdrawals:[],storageRequests:[]}});
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'No fixture for this read.'}}});
  });
  return writes;
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

for(const locale of ['en','zh-TW','zh-CN'] as const)for(const kind of ['terms','privacy'] as const)test(`${locale} ${kind} is public, dated and navigable on a 320px phone`,async({page})=>{
  const writes=await fixture(page,locale);await page.goto('/'+kind);const policy=page.locator('.legal-policy-page');
  await expect(policy).toBeVisible();await expect(policy).toHaveAttribute('lang',locale);await expect(policy).toHaveAttribute('dir','ltr');await expect(policy).toHaveAttribute('data-policy-version',version);await expect(policy.getByRole('heading',{level:1})).toHaveText(names[locale][kind]);
  await expect(policy.locator('.legal-effective-date time')).toHaveAttribute('datetime',version);await expect(policy.locator('.legal-language-notice')).toHaveCount(0);await expect(policy.locator('.legal-summary ul')).toBeVisible();expect(await policy.locator('.legal-summary li').count()).toBeGreaterThan(1);
  await expect(policy).toContainText('HK NovaXR Production');await expect(policy.locator(`a[href="mailto:${contact}"]`).first()).toBeVisible();
  const ids=kind==='terms'?termsIds:privacyIds;await expect(policy.locator('.legal-section')).toHaveCount(ids.length);
  for(const id of ids){await expect(policy.locator('.legal-section#'+id+' h2')).toHaveCount(1);await expect(policy.locator(`.legal-toc a[href="#${id}"]`)).toHaveCount(1);}
  if(kind==='terms'){
    await expect(policy.locator('#copyright-reports')).toContainText(contact);await expect(policy.locator('#disputes')).toContainText(locale==='en'?/internal/i:/內部|内部/);await expect(policy.locator('#disputes')).toContainText(locale==='en'?/courts?|regulators?/i:/法院|法庭|監管|监管/);
    await expect(policy).toContainText(locale==='en'?/mandatory|non-waivable|statutory/i:/強制|强制|法定|不可放棄|不可放弃/);
  }
  const target=kind==='terms'?'creator-pass':'privacy-rights',tocLink=policy.locator(`.legal-toc a[href="#${target}"]`);await tocLink.focus();await expect(tocLink).toBeFocused();await page.keyboard.press('Enter');await expect(page).toHaveURL(url=>url.pathname==='/'+kind&&url.hash==='#'+target);await expect(policy.locator('#'+target+' h2')).toBeInViewport();await noOverflow(page);expect(writes).toEqual([]);
});

for(const kind of ['terms','privacy'] as const)test(`Arabic ${kind} keeps the interface RTL while the English legal fallback stays LTR`,async({page})=>{
  const writes=await fixture(page,'ar');await page.goto('/'+kind);await expect(page.locator('html')).toHaveAttribute('lang','ar');await expect(page.locator('html')).toHaveAttribute('dir','rtl');const policy=page.locator('.legal-policy-page');
  await expect(policy).toHaveAttribute('lang','en');await expect(policy).toHaveAttribute('dir','ltr');await expect(policy).toHaveAttribute('data-policy-version',version);await expect(policy.getByRole('heading',{level:1})).toHaveText(names.en[kind]);await expect(policy.locator('.legal-language-notice')).toBeVisible();
  expect(await policy.evaluate(node=>getComputedStyle(node).direction)).toBe('ltr');const target=kind==='terms'?'disputes':'privacy-rights';await policy.locator(`.legal-toc a[href="#${target}"]`).click();await expect(page).toHaveURL(url=>url.hash==='#'+target);await expect(policy.locator('#'+target+' h2')).toBeInViewport();await noOverflow(page);expect(writes).toEqual([]);
});

for(const locale of ['en','zh-TW','zh-CN'] as const)test(`${locale} inactive creators see publishing-risk disclosure and keyboard-accessible policies before paying`,async({page})=>{
  const writes=await fixture(page,locale,true);await page.goto('/studio');const card=page.locator('.activation-card'),disclosure=card.locator('.creator-pass-risk-disclosure'),activate=card.locator(':scope > button.primary');
  await expect(disclosure).toBeVisible();await expect(disclosure).toHaveAttribute('role','note');await expect(activate).toBeDisabled();const consent=card.locator('input[name="creator_pass_consent"]');await expect(consent).not.toBeChecked();await consent.check();await expect(activate).toBeEnabled();await consent.uncheck();await expect(activate).toBeDisabled();
  if(locale==='en')await expect(disclosure.locator('p')).toHaveText(passRisk);
  else{await expect(disclosure.locator('p')).toContainText(locale==='zh-TW'?/不保證|不代表|不會保證/:/不保证|不代表|不会保证/);await expect(disclosure.locator('p')).toContainText(locale==='zh-TW'?'收益可能為零':'收益可能为零');}
  expect(await disclosure.evaluate((note)=>{const card=note.closest('.activation-card')!,button=Array.from(card.children).find(node=>node.matches('button.primary'))!;return!!(note.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING);})).toBe(true);
  const terms=disclosure.locator('a[href="/terms#creator-pass"]'),privacy=disclosure.locator('a[href="/privacy"]');await expect(terms).toBeVisible();await expect(privacy).toBeVisible();for(const link of [terms,privacy]){const box=await link.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);}
  await privacy.focus();await expect(privacy).toBeFocused();await page.keyboard.press('Enter');await expect(page).toHaveURL('/privacy');await expect(page.locator('.legal-policy-page')).toHaveAttribute('lang',locale);await page.goBack();await expect(page).toHaveURL('/studio');const returnTerms=page.locator('.creator-pass-risk-disclosure a[href="/terms#creator-pass"]');await returnTerms.focus();await expect(returnTerms).toBeFocused();await page.keyboard.press('Enter');await expect(page).toHaveURL('/terms#creator-pass');await expect(page.locator('.legal-section#creator-pass h2')).toBeInViewport();await noOverflow(page);expect(writes).toEqual([]);
});
