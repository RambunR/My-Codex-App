import {test,expect,type Page} from '@playwright/test';

const account={id:'last-free-creator',name:'Last chapter creator',email:'last-free@browser.test',role:'publisher',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,storage_unlimited:false,language:'en',payment_review:false};
const original={id:'last-free-editor',creator_id:account.id,creator_name:account.name,title:'A final short chapter',description:'An original drama whose creator chooses whether the final short episode is free to watch.',language:'en',genres:['drama'],themes:[],format:'live-action',creation_type:'human',cover:'/images/placeholder.svg',price_cents:10,free_episodes:1,episode_count:3,views:0,saves:0,likes:0,liked:false,status:'draft',featured:0,created_at:'2026-11-03 00:00:00',last_episode_free:false};
const label='Make the last episode free',info='About making the last episode free';
async function fixture(page:Page,{admin=false,enabled=false,episodes=false}:{admin?:boolean;enabled?:boolean;episodes?:boolean}={}){
  const user={...account,role:admin?'admin':'publisher',storage_unlimited:admin};let series={...original,last_episode_free:enabled};const writes:Record<string,any>[]=[];
  let rows=episodes?[1,3,5].map((number,index)=>({id:`last-free-episode-${number}`,series_id:series.id,number,title:`Original chapter ${number}`,duration:index===2?15:120,bytes:1024,free:index===0||enabled&&index===2,unlocked:false})):[];
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user}}));
  await page.route('**/api/admin/publishers',route=>route.fulfill({json:{publishers:[],default_publisher_id:null}}));
  await page.route('**/api/studio/series',route=>{writes.push(route.request().postDataJSON());series={...series,...route.request().postDataJSON()};return route.fulfill({status:201,json:{id:series.id}});});
  await page.route('**/api/studio/series/last-free-editor',route=>{
    if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();writes.push(body);series={...series,...body};return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:{series,episodes:rows,episodes_revision:'a'.repeat(64),owner_storage:{used_bytes:0,quota_bytes:user.quota_bytes,storage_unlimited:admin}}});
  });
  await page.route('**/api/studio/series/last-free-editor/episodes/batch',route=>{const body=route.request().postDataJSON();writes.push(body);rows=body.episode_ids.map((id:string,index:number)=>({...rows.find(row=>row.id===id),number:index+1}));return route.fulfill({json:{ok:true,episodes:rows,episodes_revision:'b'.repeat(64)}});});
  return{writes,stored:()=>series};
}

for(const admin of [false,true])test(`${admin?'administrator':'publisher'} saves, reloads and disables the optional final free episode`,async({page})=>{
  const state=await fixture(page,{admin});await page.goto('/studio/new');const checkbox=page.getByRole('checkbox',{name:label,exact:true});await expect(checkbox).not.toBeChecked();await expect(page.locator('.pricing-panel>div').last().getByRole('checkbox')).toHaveCount(1);
  await checkbox.check();await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect(page.locator('.editor-validation-summary')).toBeVisible();expect(state.writes).toHaveLength(0);await expect(checkbox).toBeChecked();
  await page.locator('#series-title').fill(original.title);await page.locator('#series-description').fill(original.description);await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect(page).toHaveURL('/studio/series/last-free-editor');expect(state.writes[0].last_episode_free).toBe(true);await expect(checkbox).toBeChecked();await page.reload();await expect(checkbox).toBeChecked();
  await checkbox.uncheck();await page.getByRole('button',{name:'Save details',exact:true}).first().click();await expect.poll(()=>state.stored().last_episode_free).toBe(false);await page.reload();await expect(checkbox).not.toBeChecked();
  await page.goto('/studio/new');await expect(checkbox).not.toBeChecked();
});

test('info explanation works with hover, keyboard focus, Escape and click without toggling the choice',async({page})=>{
  const state=await fixture(page,{episodes:true});await page.goto('/studio/series/last-free-editor');const button=page.getByRole('button',{name:info,exact:true}),tooltip=page.getByRole('tooltip');
  await button.hover();await expect(tooltip).toContainText('much shorter');await expect(tooltip).toContainText('reordering or new uploads');await page.locator('#series-title').hover();await expect(tooltip).toHaveCount(0);
  await button.focus();await expect(tooltip).toBeVisible();await expect(button).toHaveAttribute('aria-expanded','true');await expect(button).toHaveAttribute('aria-describedby',await tooltip.getAttribute('id') as string);await page.keyboard.press('Escape');await expect(tooltip).toHaveCount(0);await expect(button).toBeFocused();
  await button.click();await expect(tooltip).toBeVisible();await button.click();await expect(tooltip).toHaveCount(0);await expect(page.getByRole('checkbox',{name:label,exact:true})).not.toBeChecked();expect(state.writes).toHaveLength(0);
});

for(const[locale,translated]of [['en',label],['zh-TW','將最後一集設為免費'],['ar','إتاحة الحلقة الأخيرة مجانًا']] as const)test(`final-free checkbox and touch info fit a 320px ${locale} phone`,async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3001',hasTouch:true,isMobile:true,viewport:{width:320,height:740}});const page=await context.newPage();
  try{
    await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);await fixture(page,{enabled:true});await page.goto('/studio/series/last-free-editor');await expect(page.locator('html')).toHaveAttribute('lang',locale);const checkbox=page.locator('.last-episode-free-choice input');await expect(checkbox).toBeChecked();await expect(page.locator('.last-episode-free-choice')).toHaveText(translated);
    await page.locator('.last-episode-free-info').tap();await expect(page.getByRole('tooltip')).toBeVisible();await checkbox.tap();await expect(page.getByRole('tooltip')).toHaveCount(0);await expect(checkbox).not.toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }finally{await context.close();}
});

test('episode rows and reorder confirmation account for a free final episode with numbering gaps',async({page})=>{
  const state=await fixture(page,{enabled:true,episodes:true});await page.goto('/studio/series/last-free-editor');const last=page.locator('[data-episode-id="last-free-episode-5"]'),middle=page.locator('[data-episode-id="last-free-episode-3"]');await expect(last.locator('.episode-editor-copy')).toContainText('Free');await expect(middle.locator('.episode-editor-copy')).toContainText('$0.10');
  await last.getByRole('button',{name:'Move episode 5 up',exact:true}).click();await expect(last.locator('.episode-editor-copy')).toContainText('$0.10');await expect(middle.locator('.episode-editor-copy')).toContainText('Free');await expect(page.locator('.episode-access-changing')).toHaveCount(2);
  await page.getByRole('button',{name:'Save episode order',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('2 episodes will change between free and paid.');await expect(dialog.getByRole('button',{name:'Save episode order',exact:true})).toBeDisabled();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Save episode order',exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0]).toMatchObject({action:'reorder',acknowledge_access_change:true,episode_ids:['last-free-episode-1','last-free-episode-5','last-free-episode-3']});
});

test('viewer episode count includes the free final chapter without adding overlapping opening episodes',async({page})=>{
  await page.route('**/api/series/last-free-editor',route=>route.fulfill({json:{series:{...original,status:'published',last_episode_free:true,free_episode_count:2},episodes:[1,3,5].map(number=>({id:`episode-${number}`,series_id:original.id,number,title:`Chapter ${number}`,duration:20,bytes:1000,free:number===1||number===5,unlocked:false}))}}));
  await page.goto('/watch/last-free-editor/episode-5');await expect(page.locator('.watch-episode-title')).toContainText('2 Free episodes');await expect(page.getByRole('button',{name:/Unlock/})).toHaveCount(0);await expect(page.locator('.watch-episode-grid a').last()).toHaveAttribute('aria-label',/Free/);
});

test('same-document editor navigation restores saved final-free choice and resets a new draft',async({page})=>{
  const state=await fixture(page,{enabled:true});await page.goto('/studio/series/last-free-editor');const checkbox=page.getByRole('checkbox',{name:label,exact:true});await expect(checkbox).toBeChecked();
  await page.evaluate(()=>{(window as any).editorNavigationMarker='same-document';history.pushState({},'','/studio/new');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page).toHaveURL('/studio/new');await expect(checkbox).not.toBeChecked();await expect(page.locator('#series-title')).toHaveValue('');await expect(page.locator('#series-description')).toHaveValue('');await expect(page.locator('#series-price')).toHaveValue('0.30');await expect(page.locator('#series-free-episodes')).toHaveValue('2');await expect(page.locator('.cover-artwork-editor-frame img')).toHaveCount(0);
  await checkbox.check();await page.locator('#series-title').fill('An unsaved new drama');await page.locator('#series-price').fill('1.25');await page.locator('#series-free-episodes').fill('7');
  await page.goBack();await expect(page).toHaveURL('/studio/series/last-free-editor');await expect(checkbox).toBeChecked();await expect(page.locator('#series-title')).toHaveValue(original.title);await expect(page.locator('#series-price')).toHaveValue('0.10');await expect(page.locator('#series-free-episodes')).toHaveValue('1');
  await page.goForward();await expect(page).toHaveURL('/studio/new');await expect(checkbox).not.toBeChecked();await expect(page.locator('#series-title')).toHaveValue('');await expect(page.locator('#series-price')).toHaveValue('0.30');await expect(page.locator('#series-free-episodes')).toHaveValue('2');
  await page.goBack();await expect(checkbox).toBeChecked();expect(await page.evaluate(()=>(window as any).editorNavigationMarker)).toBe('same-document');expect(state.writes).toHaveLength(0);
});
