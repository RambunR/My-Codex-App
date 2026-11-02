import {test,expect,type Page} from '@playwright/test';
import {demoAdminSession} from './helpers/admin-session';
import {LANGUAGES} from '../../shared/config';

async function json(response:{status:()=>number;json:()=>Promise<unknown>},status=200):Promise<any>{const body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(status);return body;}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
const toggle=(page:Page)=>page.locator('.subtitle-language-toggle');
const choice=(page:Page,code:string)=>page.locator(`.subtitle-language-option input[value="${code}"]`);

test('subtitle choices support keyboard selection, persist independently of drama language, and clear explicitly',async({page})=>{
  await demoAdminSession(page);await page.goto('/studio/new');
  expect(await page.locator('#series-language').evaluate(element=>element.closest('label')?.nextElementSibling?.classList.contains('subtitle-language-select'))).toBe(true);
  await expect(page.locator('.subtitle-language-hint')).toHaveText('Select the subtitle languages already included in your uploaded video. This does not create or translate subtitles.');
  await expect(toggle(page)).toHaveAttribute('aria-expanded','false');await toggle(page).focus();await toggle(page).press('Enter');await expect(page.locator('.subtitle-language-choices input')).toHaveCount(LANGUAGES.length);
  await page.keyboard.press('Tab');await expect(choice(page,'en')).toBeFocused();await page.keyboard.press('Space');await expect(choice(page,'en')).toBeChecked();await choice(page,'en').press('Escape');await expect(toggle(page)).toBeFocused();await expect(toggle(page)).toHaveAttribute('aria-expanded','false');
  await toggle(page).click();await choice(page,'zh-TW').check();await choice(page,'ja').check();await expect(page.locator('.subtitle-language-chips>li')).toHaveText(['English','繁體中文','日本語']);await expect(toggle(page)).toContainText('3 selected');await expect(page.locator('#series-language')).toHaveValue('en');
  await page.locator('#series-title').fill(`Subtitle metadata ${Date.now()}`);await page.locator('#series-description').fill('An original drama whose selected subtitle languages describe the subtitles already included in the uploaded video.');
  const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/series'&&response.request().method()==='POST');await page.getByRole('button',{name:'Save details',exact:true}).first().click();const createdResponse=await created,{id}=await json(createdResponse,201);expect(createdResponse.request().postDataJSON().subtitle_languages).toEqual(['en','zh-TW','ja']);await expect(page).toHaveURL(`/studio/series/${id}`);
  expect((await json(await page.request.get(`/api/studio/series/${id}`))).series.subtitle_languages).toEqual(['en','zh-TW','ja']);await page.reload();await expect(page.locator('.subtitle-language-chips>li')).toHaveText(['English','繁體中文','日本語']);
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),routePattern=`**/api/studio/series/${id}`;
  await page.route(routePattern,async route=>{if(route.request().method()==='PATCH')await pending;await route.continue();});
  await page.locator('#series-title').fill(`Subtitle metadata edited ${Date.now()}`);const edited=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/studio/series/${id}`&&response.request().method()==='PATCH');
  try{await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect(toggle(page)).toBeDisabled();await expect(page.locator('.subtitle-language-clear')).toBeDisabled();}finally{release();}
  const editedResponse=await edited;await json(editedResponse);expect(editedResponse.request().postDataJSON()).not.toHaveProperty('subtitle_languages');await page.unroute(routePattern);expect((await json(await page.request.get(`/api/studio/series/${id}`))).series.subtitle_languages).toEqual(['en','zh-TW','ja']);
  await expect(page.locator('.subtitle-language-clear')).toBeEnabled();await page.locator('.subtitle-language-clear').click();await expect(page.locator('.subtitle-language-chips')).toHaveCount(0);await expect(toggle(page)).toContainText('No subtitle languages selected');
  const cleared=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/studio/series/${id}`&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save details',exact:true}).first().click();const clearedResponse=await cleared;await json(clearedResponse);expect(clearedResponse.request().postDataJSON().subtitle_languages).toEqual([]);expect((await json(await page.request.get(`/api/studio/series/${id}`))).series.subtitle_languages).toEqual([]);
});

for(const[locale,width]of [['en',320],['zh-TW',390],['ar',320]] as const)test(`all subtitle choices and chips remain usable on a ${width}px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  const user={id:'subtitle-phone-owner',name:'Creator',email:'subtitle-phone@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:locale,payment_review:false};await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
  await page.goto('/studio/new');await expect(page.locator('html')).toHaveAttribute('lang',locale);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');await toggle(page).click();
  await expect(page.locator('.subtitle-language-choices input')).toHaveCount(21);for(const language of LANGUAGES)await choice(page,language.code).check();await expect(page.locator('.subtitle-language-chips>li')).toHaveCount(21);await expect(page.locator('#series-language')).toHaveValue(locale);
  await noOverflow(page);const trigger=await toggle(page).boundingBox();expect(trigger!.height).toBeGreaterThanOrEqual(44);for(const label of await page.locator('.subtitle-language-option').all()){const bounds=await label.boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(44);}
  if(locale!=='en')await expect(page.locator('.subtitle-language-hint')).not.toContainText('This does not create or translate subtitles.');await page.locator('.subtitle-language-clear').click();await expect(page.locator('.subtitle-language-chips')).toHaveCount(0);await expect(page.locator('.subtitle-language-choices input:checked')).toHaveCount(0);await noOverflow(page);
});
