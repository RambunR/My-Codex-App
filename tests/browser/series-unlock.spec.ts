import {test,expect,type Page} from '@playwright/test';

const viewer={id:'series-unlock-viewer',name:'Series viewer',email:'series-unlock@browser.test',role:'viewer',publisher_active:0,wallet_micros:1_000_000,earnings_micros:0,quota_bytes:10*1024**3,used_bytes:0,language:'en',payment_review:false};
const original={id:'series-unlock-original',creator_id:'another-creator',creator_name:'Original Studio',title:'The complete story — 靈映之約',description:'An original drama with free opening and final chapters and separately priced episodes.',language:'en',genres:['romance'],themes:[],format:'live-action',creation_type:'human',cover:'/images/placeholder.svg',cover_aspect_ratio:'9:16',price_cents:30,free_episodes:1,free_episode_count:2,last_episode_free:true,episode_count:5,first_episode_id:'series-unlock-original-1',views:15,likes:2,liked:false,status:'published',featured:0,demo:0,created_at:'2026-11-15T00:00:00Z',subtitle_languages:['en','zh-TW','zh-CN']};
const other={...original,id:'series-unlock-other',title:'A different complete story',price_cents:45,first_episode_id:'series-unlock-other-1'};
const purchaseReturn=`/series/${original.id}?unlock=all`;
const initialRevision='a'.repeat(64),updatedRevision='b'.repeat(64);
function episodes(id:string){return[1,3,7,9,12].map(number=>({id:`${id}-${number}`,series_id:id,title:`Chapter ${number}`,number,duration:90,bytes:1234,views:0,free:number===1||number===12,unlocked:number===3}));}
interface Quote{series_id:string;episode_ids:string[];episode_count:number;total_micros:number;unit_price_micros:number;revision:string}
interface FixtureOptions{locale?:string;guest?:boolean;walletMicros?:number;freeOnly?:boolean;allOwned?:boolean}

async function fixture(page:Page,options:FixtureOptions={}){
  const locale=options.locale||'en';await page.addInitScript(value=>localStorage.setItem('drama-language',value),locale);
  let user={...viewer,wallet_micros:options.walletMicros??viewer.wallet_micros,language:locale};
  const releases=new Map([original,other].map(series=>[series.id,{...series,access_type:options.freeOnly?'all-free':'free-then-paid'}]));
  const rows=new Map([original,other].map(series=>[series.id,episodes(series.id).map(episode=>({...episode,...(options.freeOnly?{free:true}:{}),...(options.allOwned?{unlocked:true}:{})}))]));
  const revisions=new Map([original,other].map(series=>[series.id,initialRevision]));const unavailable=new Set<string>();
  const writes:Array<{path:string;body:unknown}>=[],unexpected:string[]=[],errors:string[]=[],quoteReads:Quote[]=[];
  const failures:Array<{status:number;code:string;message:string;before?:()=>void}>=[];
  const quoteGates=new Map<string,Promise<void>>();let postGate:Promise<void>|undefined;
  function quote(id:string):Quote{
    const series=releases.get(id)!,remaining=rows.get(id)!.filter(episode=>!episode.free&&!episode.unlocked),unit=series.price_cents*10000;
    return{series_id:id,episode_ids:remaining.map(episode=>episode.id),episode_count:remaining.length,total_micros:remaining.length*unit,unit_price_micros:unit,revision:revisions.get(id)!};
  }
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='GET'){
      if(path==='/api/auth/me')return route.fulfill({json:{user:options.guest?null:user}});
      if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,paymentsTestMode:false,payoutsEnabled:false,uploadsEnabled:true,usdToHkd:7.8,demo:false,auth:{email:true},limits:{minimumPriceUsd:0.1,maximumPriceUsd:1}}});
      if(path==='/api/wallet')return route.fulfill({json:{user,ledger:[],payments:[]}});
      if(path==='/api/series')return route.fulfill({json:{series:[]}});
      const id=path.split('/')[3];
      if(unavailable.has(id)&&path===`/api/series/${id}`)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'This series is unavailable.'}}});
      if(releases.has(id)&&path===`/api/series/${id}`)return route.fulfill({json:{series:releases.get(id),episodes:rows.get(id)}});
      if(releases.has(id)&&path===`/api/series/${id}/unlock-quote`){const snapshot=quote(id);quoteReads.push(snapshot);const gate=quoteGates.get(id);if(gate)await gate;return route.fulfill({json:snapshot});}
      unexpected.push('GET '+path);return route.fulfill({status:404,json:{error:{message:'Unexpected series-unlock fixture read'}}});
    }
    const body=request.postDataJSON();writes.push({path,body});const id=path.split('/')[3];
    if(request.method()!=='POST'||!releases.has(id)||path!==`/api/series/${id}/unlock-all`){unexpected.push(request.method()+' '+path);return route.abort();}
    const gate=postGate;if(gate)await gate;
    const failure=failures.shift();if(failure){failure.before?.();return route.fulfill({status:failure.status,json:{error:{code:failure.code,message:failure.message}}});}
    const current=quote(id);
    if(body.revision!==current.revision)return route.fulfill({status:409,json:{error:{code:'UNLOCK_QUOTE_CHANGED',message:'The available episode quote changed.'}}});
    if(user.wallet_micros<current.total_micros)return route.fulfill({status:402,json:{error:{code:'INSUFFICIENT_FUNDS',message:'Your wallet balance changed.'}}});
    const selected=new Set(current.episode_ids);rows.set(id,rows.get(id)!.map(episode=>selected.has(episode.id)?{...episode,unlocked:true}:episode));user={...user,wallet_micros:user.wallet_micros-current.total_micros};
    return route.fulfill({json:{unlocked_count:current.episode_count,paid_micros:current.total_micros,alreadyUnlocked:current.episode_count===0,user}});
  });
  return{writes,quoteReads,setUnavailable:(id:string,value=true)=>{if(value)unavailable.add(id);else unavailable.delete(id);},rows:(id=original.id)=>rows.get(id)!,
    fail:(status:number,code:string,message:string,before?:()=>void)=>failures.push({status,code,message,before}),
    setPrice:(price:number,id=original.id)=>{releases.set(id,{...releases.get(id)!,price_cents:price});revisions.set(id,updatedRevision);},
    setWallet:(micros:number)=>{user={...user,wallet_micros:micros};},
    setOwned:(id=original.id)=>{rows.set(id,rows.get(id)!.map(episode=>({...episode,unlocked:true})));},
    holdPost:()=>{let release!:()=>void;postGate=new Promise<void>(resolve=>{release=resolve;});return()=>{postGate=undefined;release();};},
    holdQuote:(id=original.id)=>{let release!:()=>void;quoteGates.set(id,new Promise<void>(resolve=>{release=resolve;}));return()=>{quoteGates.delete(id);release();};},
    clean:()=>{expect(unexpected).toEqual([]);expect(errors).toEqual([]);},
  };
}
const action=(page:Page)=>page.locator('.series-unlock-button');
const dialog=(page:Page)=>page.getByRole('dialog').filter({has:page.locator('.series-unlock-dialog')});
const confirm=(page:Page)=>dialog(page).locator('.series-unlock-confirm');
async function open(page:Page){await page.goto('/series/'+original.id);await expect(action(page)).toBeEnabled();await action(page).click();await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.60');}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);await expect.poll(()=>dialog(page).evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);}

test('remaining paid episodes need explicit confirmation and one revision-only request even after rapid repeat clicks',async({page})=>{
  const state=await fixture(page);await page.setViewportSize({width:1440,height:900});await open(page);
  await expect(action(page)).toContainText('$0.60');await expect(dialog(page).locator('.series-unlock-wallet')).toContainText('$1.00');await expect(dialog(page)).toContainText(/free|already unlocked/i);await expect(dialog(page)).toContainText(/future/i);
  expect(state.writes).toEqual([]);expect(state.quoteReads.length).toBeGreaterThanOrEqual(1);for(const quote of state.quoteReads)expect(quote).toMatchObject({episode_ids:[original.id+'-7',original.id+'-9'],episode_count:2,total_micros:600000});
  const release=state.holdPost();try{
    await confirm(page).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});await expect.poll(()=>state.writes.length).toBe(1);await expect(confirm(page)).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog(page)).toBeVisible();
    expect(state.writes).toEqual([{path:`/api/series/${original.id}/unlock-all`,body:{revision:initialRevision}}]);
  }finally{release();}
  await expect(dialog(page)).toHaveCount(0);await expect(action(page)).toBeDisabled();await expect(action(page)).toContainText('All available episodes unlocked');expect(state.rows().filter(episode=>!episode.free&&!episode.unlocked)).toEqual([]);state.clean();
});

for(const locale of ['zh-TW','zh-CN','ar'])test(`${locale} series unlock confirmation fits a 320px phone and traps keyboard focus until cancelled`,async({page})=>{
  const state=await fixture(page,{locale});await page.setViewportSize({width:320,height:740});await page.goto('/series/'+original.id);await action(page).focus();await page.keyboard.press('Enter');await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.60');await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');await expect(dialog(page)).toHaveAttribute('aria-modal','true');await noOverflow(page);
  const controls=dialog(page).locator('button:not(:disabled),a[href],input,select,textarea');await controls.last().focus();await page.keyboard.press('Tab');await expect(controls.first()).toBeFocused();await controls.first().focus();await page.keyboard.press('Shift+Tab');await expect(controls.last()).toBeFocused();await expect(confirm(page)).toBeEnabled();await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);await expect(action(page)).toBeFocused();expect(state.writes).toEqual([]);state.clean();
});

test('an insufficient wallet cannot submit and its add-funds link returns to the same series',async({page})=>{
  const state=await fixture(page,{walletMicros:100000});await open(page);await expect(dialog(page).locator('.series-unlock-wallet')).toContainText('$0.10');await expect(dialog(page).locator('.series-unlock-confirm:not(:disabled)')).toHaveCount(0);const topup=dialog(page).locator('.series-unlock-topup');await expect(topup).toBeVisible();const href=await topup.getAttribute('href');expect(new URL(href!,'http://127.0.0.1:3001').searchParams.get('return')).toBe(purchaseReturn);await topup.click();await expect(page).toHaveURL(url=>url.pathname==='/wallet'&&url.searchParams.get('return')===purchaseReturn);const back=page.locator(`.main-content a[href="${purchaseReturn}"]`).first();await expect(back).toBeVisible();await back.click();await expect(page).toHaveURL(url=>url.pathname==='/series/'+original.id);await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.60');await expect(dialog(page).locator('.series-unlock-topup')).toBeVisible();expect(state.writes).toEqual([]);state.clean();
});

test('a balance change rejected by the server offers funding without automatically resubmitting the unlock',async({page})=>{
  const state=await fixture(page);state.fail(402,'INSUFFICIENT_FUNDS','Your wallet balance changed.',()=>state.setWallet(100000));await open(page);await confirm(page).click();await expect(dialog(page).locator('.series-unlock-topup')).toBeVisible();await expect(dialog(page).locator('.series-unlock-wallet')).toContainText('$0.10');await expect(dialog(page).locator('.series-unlock-confirm:not(:disabled)')).toHaveCount(0);await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.60');expect(state.writes).toEqual([{path:`/api/series/${original.id}/unlock-all`,body:{revision:initialRevision}}]);expect(state.rows().filter(episode=>!episode.free&&!episode.unlocked)).toHaveLength(2);state.clean();
});

test('a changed quote refreshes the total and requires another deliberate confirmation',async({page})=>{
  const state=await fixture(page);state.fail(409,'UNLOCK_QUOTE_CHANGED','The available episode quote changed.',()=>state.setPrice(40));await open(page);await confirm(page).click();await expect(dialog(page).locator('.series-unlock-quote-change')).toBeVisible();await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.80');expect(state.quoteReads.some(quote=>quote.revision===updatedRevision&&quote.total_micros===800000)).toBe(true);expect(state.writes).toHaveLength(1);await expect(confirm(page)).toBeEnabled();await confirm(page).click();await expect(dialog(page)).toHaveCount(0);expect(state.writes.map(write=>write.body)).toEqual([{revision:initialRevision},{revision:updatedRevision}]);state.clean();
});

test('a temporary unlock error preserves the quote and can be retried without changing the request amount',async({page})=>{
  const state=await fixture(page);state.fail(503,'TEMPORARY_UNAVAILABLE','The wallet is temporarily unavailable. Please try again.');await open(page);await confirm(page).click();await expect(dialog(page)).toContainText('The wallet is temporarily unavailable. Please try again.');await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.60');await expect(confirm(page)).toBeEnabled();expect(state.rows().filter(episode=>!episode.free&&!episode.unlocked)).toHaveLength(2);await confirm(page).click();await expect(dialog(page)).toHaveCount(0);expect(state.writes.map(write=>write.body)).toEqual([{revision:initialRevision},{revision:initialRevision}]);state.clean();
});

test('a guest is sent to sign in before any quote or unlock request',async({page})=>{
  const state=await fixture(page,{guest:true});await page.goto('/series/'+original.id);await action(page).click();await expect(page).toHaveURL(url=>url.pathname==='/auth'&&url.searchParams.get('next')===purchaseReturn);expect(state.quoteReads).toEqual([]);expect(state.writes).toEqual([]);state.clean();
});

for(const freeOnly of [false,true])test(freeOnly?'an entirely free series has no unlock-all action':'an account that already owns every paid episode has a disabled unlocked action',async({page})=>{
  const state=await fixture(page,{freeOnly,allOwned:!freeOnly});await page.goto('/series/'+original.id);await expect(page.getByRole('heading',{level:1,name:original.title,exact:true})).toBeVisible();if(freeOnly)await expect(action(page)).toHaveCount(0);else{await expect(action(page)).toBeDisabled();await expect(action(page)).toContainText('All available episodes unlocked');}expect(state.quoteReads).toEqual([]);expect(state.writes).toEqual([]);state.clean();
});

test('an empty fresh quote cannot charge episodes already unlocked in another tab',async({page})=>{
  const state=await fixture(page);await page.goto('/series/'+original.id);await expect(action(page)).toBeEnabled();state.setOwned();await action(page).click();await expect(dialog(page)).toContainText('All available episodes unlocked');await expect(dialog(page).locator('.series-unlock-confirm:not(:disabled)')).toHaveCount(0);expect(state.quoteReads[0]).toMatchObject({episode_count:0,total_micros:0,episode_ids:[]});expect(state.writes).toEqual([]);state.clean();
});

test('a delayed quote from the previous series cannot replace a newly opened series quote',async({page})=>{
  const state=await fixture(page,{walletMicros:2000000}),release=state.holdQuote();
  const oldSettled=new Promise<void>(resolve=>{const settled=(request:{url:()=>string})=>{if(new URL(request.url()).pathname===`/api/series/${original.id}/unlock-quote`)resolve();};page.on('requestfinished',settled);page.on('requestfailed',settled);});
  await page.goto('/series/'+original.id);await action(page).click();await expect.poll(()=>state.quoteReads.length).toBeGreaterThanOrEqual(1);
  await page.evaluate(id=>{history.pushState({},'','/series/'+id);window.dispatchEvent(new PopStateEvent('popstate'));},other.id);await expect(page.getByRole('heading',{level:1,name:other.title,exact:true})).toBeVisible();await expect(dialog(page)).toHaveCount(0);await action(page).click();await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.90');release();await oldSettled;await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(dialog(page).locator('.series-unlock-total')).toContainText('$0.90');await expect(dialog(page)).toContainText(other.title);expect(state.writes).toEqual([]);state.clean();
});


test('an unavailable series reached from another series shows its error and can be retried without a stale purchase action',async({page})=>{
  const state=await fixture(page);await page.goto('/series/'+original.id);await expect(action(page)).toBeEnabled();state.setUnavailable(other.id);
  await page.evaluate(id=>{history.pushState({},'','/series/'+id);window.dispatchEvent(new PopStateEvent('popstate'));},other.id);
  await expect(page.getByText('This series is unavailable.',{exact:true})).toBeVisible();await expect(action(page)).toHaveCount(0);await expect(dialog(page)).toHaveCount(0);await expect(page.locator('.loading-state')).toHaveCount(0);
  state.setUnavailable(other.id,false);await page.locator('.empty-state button').click();await expect(page.getByRole('heading',{level:1,name:other.title,exact:true})).toBeVisible();await expect(action(page)).toBeEnabled();expect(state.writes).toEqual([]);state.clean();
});
