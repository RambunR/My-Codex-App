import {test,expect,type Page} from '@playwright/test';

async function configureAuth(page:Page,auth:{google?:boolean;apple?:boolean;email?:boolean}){
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({response,json:{...config,auth:{...config.auth,google:false,apple:false,email:false,...auth}}});
  });
}

test('unconfigured Apple and email delivery stay explicit while Google and password sign-in remain available',async({page})=>{
  await configureAuth(page,{google:true,apple:false,email:false});
  await page.goto('/auth?mode=login&next=%2Fwallet');
  const google=page.getByRole('link',{name:'Continue with Google',exact:true});
  await expect(google).toBeVisible();
  const googleUrl=new URL((await google.getAttribute('href'))!,'http://127.0.0.1:3001');
  expect(googleUrl.pathname).toBe('/api/auth/google/start');expect(googleUrl.searchParams.get('next')).toBe('/wallet');
  await expect(page.getByRole('button',{name:'Continue with Apple',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Password',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Forgot password?',exact:true}).click();
  await expect(page).toHaveURL(/mode=forgot/);
  await expect(page.getByRole('button',{name:'Send reset link',exact:true})).toBeDisabled();
  await expect(page.locator('.auth-form-panel')).toContainText(/email.*(unavailable|not.*available|not.*configured)/i);
});

test('forgot-password and resend-verification forms acknowledge requests without disclosing an account',async({page})=>{
  await configureAuth(page,{email:true});
  const requests:{path:string;body:Record<string,unknown>}[]=[];
  for(const path of ['forgot-password','resend-verification'])await page.route(`**/api/auth/${path}`,async route=>{
    requests.push({path,body:route.request().postDataJSON()});await route.fulfill({json:{ok:true}});
  });
  await page.goto('/auth?mode=forgot');
  await page.getByLabel('Email address',{exact:true}).fill('unknown-viewer@browser.test');
  await page.getByRole('button',{name:'Send reset link',exact:true}).click();
  await expect(page.locator('.auth-email-status')).toHaveText('If an eligible account exists, check your inbox for a link. Check your spam folder too.');
  expect(requests).toEqual([{path:'forgot-password',body:{email:'unknown-viewer@browser.test',language:'en'}}]);

  await page.goto('/auth?mode=resend');
  await page.getByLabel('Email address',{exact:true}).fill('another-viewer@browser.test');
  await page.getByRole('button',{name:'Resend verification email',exact:true}).click();
  await expect(page.locator('.auth-email-status')).toHaveText('If an eligible account exists, check your inbox for a link. Check your spam folder too.');
  expect(requests[1]).toEqual({path:'resend-verification',body:{email:'another-viewer@browser.test',language:'en'}});
});

test('password reset hides its link token, validates confirmation and posts it only with the chosen password',async({page})=>{
  await configureAuth(page,{email:true});
  const token='a'.repeat(64);const requests:Record<string,unknown>[]=[];const requestedUrls:string[]=[];
  page.on('request',request=>requestedUrls.push(request.url()));
  await page.route('**/api/auth/reset-password',async route=>{
    requests.push(route.request().postDataJSON());await route.fulfill({json:{ok:true}});
  });
  await page.goto(`/auth?mode=reset#token=${token}`);
  await expect(page.getByRole('heading',{name:'Choose a new password',exact:true})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('token')).toBeNull();
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
  expect(requestedUrls.every(url=>!url.includes(token))).toBe(true);
  expect(requests).toEqual([]);
  await page.getByLabel('New password',{exact:true}).fill('BrowserResetPass123!');
  await page.getByLabel('Confirm new password',{exact:true}).fill('DifferentPassword123!');
  await page.getByRole('button',{name:'Update password',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('The passwords do not match.');expect(requests).toEqual([]);
  await page.getByLabel('Confirm new password',{exact:true}).fill('BrowserResetPass123!');
  await page.getByRole('button',{name:'Update password',exact:true}).click();
  await expect(page.locator('.auth-email-status')).toHaveText('Your password has been updated. Sign in with your new password.');
  expect(requests).toEqual([{token,password:'BrowserResetPass123!'}]);expect(page.url()).not.toContain(token);
  await page.getByRole('link',{name:'Back to sign in',exact:true}).click();
  await expect(page.getByLabel('Password',{exact:true})).toBeVisible();
});

test('email verification requires an explicit action and refreshes the signed-in account status',async({page})=>{
  await configureAuth(page,{google:false,email:true});
  let verified=false;const token='b'.repeat(64);const requests:Record<string,unknown>[]=[];const resends:Record<string,unknown>[]=[];
  const user={id:'verification-browser-viewer',name:'Verification Viewer',email:'verification@browser.test',role:'viewer',publisher_active:0,wallet_micros:0,earnings_micros:0,quota_bytes:5*1024**3,used_bytes:0,language:'en',dramio_pass:{active:false,test:false,purchased_at:null}};
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{...user,email_verified:verified}}}));
  await page.route('**/api/auth/verify-email',async route=>{
    requests.push(route.request().postDataJSON());verified=true;await route.fulfill({json:{ok:true}});
  });
  await page.route('**/api/auth/resend-verification',async route=>{
    resends.push(route.request().postDataJSON());await route.fulfill({json:{ok:true}});
  });
  await page.goto('/account');
  const panel=page.locator('.email-verification-panel');await expect(panel).toHaveAttribute('data-state','unverified');
  await panel.getByRole('button',{name:'Resend verification email',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('If an eligible account exists, check your inbox');
  expect(resends).toEqual([{email:user.email,language:'en'}]);
  await page.goto(`/auth?mode=verify#token=${token}`);
  await expect(page.getByRole('heading',{name:'Verify your email',exact:true})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('token')).toBeNull();
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
  expect(requests).toEqual([]);
  await page.getByRole('button',{name:'Verify email',exact:true}).click();
  await expect(page.locator('.auth-email-status')).toHaveText('Your email address has been verified.');
  expect(requests).toEqual([{token}]);expect(page.url()).not.toContain(token);
  await page.goto('/account');
  await expect(page.locator('.email-verification-panel')).toHaveAttribute('data-state','verified');
});

test('Apple authorization preserves safe return paths and cannot inherit an external redirect',async({page})=>{
  await configureAuth(page,{google:true,apple:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/auth?mode=register&next=%2Fwallet');
  const apple=page.getByRole('link',{name:'Continue with Apple',exact:true});await expect(apple).toBeVisible();
  const url=new URL((await apple.getAttribute('href'))!,'http://127.0.0.1:3001');
  expect(url.pathname).toBe('/api/auth/apple/start');expect(url.searchParams.get('next')).toBe('/wallet');expect(url.searchParams.get('language')).toBe('en');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto('/auth?mode=login&next=https%3A%2F%2Fexternal.invalid');
  const safeUrl=new URL((await apple.getAttribute('href'))!,'http://127.0.0.1:3001');
  expect(safeUrl.origin).toBe('http://127.0.0.1:3001');expect(safeUrl.searchParams.get('next')).toBe('/');
});
