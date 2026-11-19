import {test,expect,type Page} from '@playwright/test';
import {localeMessages} from '../../src/i18n';
import type {Locale} from '../../shared/config';
import {DEFAULT_DRIVE_IMPORT_FOLDER,type DriveImportJob,type DriveImportStatus} from '../../shared/drive-import-types';

const endpoint='/api/admin/drive-imports';
const owner={id:'drive-ui-owner',name:'Platform owner',email:'owner@browser.test',role:'admin',publisher_active:1,wallet_micros:0,earnings_micros:0,quota_bytes:10*1024**3,used_bytes:0,storage_unlimited:true,max_episode_seconds:null,language:'en',payment_review:false};
const otherAdmin={...owner,id:'other-drive-admin',name:'Another administrator',email:'admin@browser.test',max_episode_seconds:300};
const fixedTime='2026-11-15T12:00:00Z';
const initialStatus=():DriveImportStatus=>({settings:{enabled:false,folderId:DEFAULT_DRIVE_IMPORT_FOLDER,revision:1,verifiedAt:null},connection:{configured:true,serviceAccountEmail:'private-importer@lingying-browser-test.iam.gserviceaccount.com',runtimeAvailable:true},jobs:[],notifications:[],unread:0});
const job=(overrides:Partial<DriveImportJob>={}):DriveImportJob=>({id:'job-ready',folderId:'series-source-folder',folderName:'001_clips',status:'waiting',seriesId:null,episodeCount:10,finishedFiles:2,totalFiles:10,message:'Waiting for the remaining manifest files.',createdAt:fixedTime,updatedAt:fixedTime,...overrides});
interface FixtureOptions {actor?:typeof owner|typeof otherAdmin;locale?:Locale;status?:DriveImportStatus;forbidden?:boolean}
interface VerificationFailure {code?:string;status?:number;message?:string;details?:Record<string,unknown>;abort?:boolean}
async function fixture(page:Page,{actor=owner,locale='en',status=initialStatus(),forbidden=false}:FixtureOptions={}){
  const unexpected:string[]=[],errors:string[]=[],writes:Array<{method:string;path:string;body:unknown}>=[];
  const state={status:structuredClone(status),forbidden,readFailure:false,mutationFailure:false,verificationFailure:null as VerificationFailure|null,readCount:0,authCount:0};
  await page.addInitScript(language=>localStorage.setItem('drama-language',language),locale);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
    if(method==='GET'){
      if(path==='/api/auth/me'){state.authCount++;return route.fulfill({json:{user:{...actor,drive_import_unread:state.status.unread}}});}
      if(path==='/api/config')return route.fulfill({json:{brand:'LingYing',paymentsMode:'disabled',paymentsReady:false,uploadsEnabled:true,payoutsEnabled:false,demo:false,usdToHkd:7.8,runtime:'cloudflare',limits:{maxEpisodeSeconds:300,maxEpisodeBytes:200*1024**2},auth:{google:false,apple:false,email:false}}});
      if(path==='/api/display-currency')return route.fulfill({json:{quote:null}});
      if(path==='/api/admin')return route.fulfill({json:{stats:{users:1,publishers:1,sales:{gross_micros:0,n:0,platform_micros:0},activation_hkd:0},users:[],withdrawals:[],storageRequests:[]}});
      if(path===endpoint){state.readCount++;if(state.forbidden)return route.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'Owner access required.'}}});if(state.readFailure)return route.fulfill({status:503,json:{error:{code:'TEMPORARY',message:'The private import status is temporarily unavailable.'}}});return route.fulfill({json:state.status});}
    }else if(path===endpoint||path.startsWith(endpoint+'/')){
      const body=request.postDataJSON();writes.push({method,path,body});
      if(state.mutationFailure)return route.fulfill({status:503,json:{error:{code:'TEMPORARY',message:'The folder could not be saved. Please retry.'}}});
      if(state.forbidden)return route.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'Owner access required.'}}});
      if(method==='PATCH'&&path===endpoint){
        if(typeof body.folderId==='string'){state.status.settings.folderId=body.folderId;state.status.settings.enabled=false;state.status.settings.verifiedAt=null;}
        if(typeof body.enabled==='boolean')state.status.settings.enabled=body.enabled;
        state.status.settings.revision++;
        return route.fulfill({json:{ok:true}});
      }
      if(method==='POST'&&path===endpoint+'/connection'){
        const failure=state.verificationFailure;
        if(failure){if(failure.abort)return route.abort('connectionfailed');return route.fulfill({status:failure.status??409,json:{error:{code:failure.code,message:failure.message,details:failure.details}}});}
        state.status.settings.verifiedAt=Date.now();return route.fulfill({json:{ok:true}});
      }
      if(method==='POST'&&path===endpoint+'/scan')return route.fulfill({json:{queued:true}});
      if(method==='POST'&&path===endpoint+'/notifications/read'){state.status.notifications=state.status.notifications.map(item=>({...item,readAt:fixedTime}));state.status.unread=0;return route.fulfill({json:{ok:true}});}
      const action=path.match(/\/jobs\/([^/]+)\/(cancel|retry)$/);
      if(method==='POST'&&action){state.status.jobs=state.status.jobs.map(item=>item.id===action[1]?{...item,status:action[2]==='cancel'?'cancelled':'waiting'}:item);return route.fulfill({json:{ok:true}});}
    }
    unexpected.push(method+' '+path);return route.abort();
  });
  return{state,writes,assertClean(){expect(unexpected).toEqual([]);expect(errors).toEqual([]);}};
}
async function openPanel(page:Page,locale:Locale='en'){
  await page.goto('/admin?tab=drive-imports');
  const panel=page.locator('.drive-import-panel');await expect(panel.getByRole('heading',{name:localeMessages[locale].driveImportTitle!,exact:true})).toBeVisible();return panel;
}

test('missing Drive credentials keep imports disabled without collecting a private key',async({page})=>{
  const status=initialStatus();status.connection.configured=false;status.connection.serviceAccountEmail=null;
  const check=await fixture(page,{status}),panel=await openPanel(page);
  await expect(panel).toContainText('GOOGLE_DRIVE_IMPORT_CREDENTIALS');await expect(panel).toContainText('lingying-ready.json');await expect(panel).toContainText('200 MiB');
  await expect(panel.getByRole('link',{name:localeMessages.en.driveImportSetupGuide!,exact:true})).toHaveAttribute('href','https://github.com/RambunR/My-Codex-App/blob/main/docs/GOOGLE_DRIVE_IMPORT.md');
  const download=panel.getByRole('link',{name:localeMessages.en.driveImportDownloadTool!,exact:true});await expect(download).toHaveAttribute('href','/downloads/verify-clipweave-export.mjs');await expect(download).toHaveAttribute('download','');
  for(const key of ['driveImportVerify','driveImportEnable','driveImportCheckNow'] as const)await expect(panel.getByRole('button',{name:localeMessages.en[key],exact:true})).toBeDisabled();
  await expect(panel.locator('textarea,input[type="password"]')).toHaveCount(0);expect(check.writes).toEqual([]);check.assertClean();
});

test('a runtime without scheduled import support cannot verify or enable the watcher',async({page})=>{
  const status=initialStatus();status.connection.runtimeAvailable=false;status.settings.verifiedAt=Date.now();
  const check=await fixture(page,{status}),panel=await openPanel(page);
  await expect(panel).toContainText(localeMessages.en.driveImportRuntimeMissing!);await expect(panel.getByRole('button',{name:localeMessages.en.driveImportEnable!,exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:localeMessages.en.driveImportVerify!,exact:true})).toBeDisabled();check.assertClean();
});

test('saving a folder, verifying it and enabling checks use the saved folder and exact owner API',async({page})=>{
  const check=await fixture(page),panel=await openPanel(page),copy=localeMessages.en;
  await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeDisabled();
  const nextFolder='new-private-folder-0123456789';await panel.getByLabel(copy.driveImportFolder!,{exact:true}).fill(`https://drive.google.com/drive/folders/${nextFolder}?usp=sharing`);
  await expect(panel.getByRole('button',{name:copy.driveImportVerify!,exact:true})).toBeDisabled();await panel.getByRole('button',{name:copy.driveImportSaveFolder!,exact:true}).click();
  await expect(panel.getByLabel(copy.driveImportFolder!,{exact:true})).toHaveValue(nextFolder);await expect(panel.getByRole('button',{name:copy.driveImportVerify!,exact:true})).toBeEnabled();
  await panel.getByRole('button',{name:copy.driveImportVerify!,exact:true}).click();await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeEnabled();await panel.getByRole('button',{name:copy.driveImportEnable!,exact:true}).click();
  await expect(panel.locator('.drive-import-state')).toContainText(copy.driveImportEnabled!);await panel.getByRole('button',{name:copy.driveImportCheckNow!,exact:true}).click();await expect(page.locator('.toast-stack')).toContainText(copy.driveImportQueued!);
  await panel.getByRole('button',{name:copy.driveImportDisable!,exact:true}).click();await expect(panel.locator('.drive-import-state')).toContainText(copy.driveImportDisabled!);
  expect(check.writes).toEqual([{method:'PATCH',path:endpoint,body:{folderId:nextFolder}},{method:'POST',path:endpoint+'/connection',body:{}},{method:'PATCH',path:endpoint,body:{enabled:true}},{method:'POST',path:endpoint+'/scan',body:{}},{method:'PATCH',path:endpoint,body:{enabled:false}}]);check.assertClean();
});

test('completed drafts stay linked and notifications are marked read without automatic retries',async({page})=>{
  const status=initialStatus();status.jobs=[job({id:'complete-job',status:'complete',seriesId:'editable-draft-001',finishedFiles:10,message:'Imported as an unpublished draft.'}),job({id:'failed-job',status:'error',message:'Checksum mismatch; source must be reviewed.'}),job({id:'review-job',status:'review',seriesId:'existing-draft',message:'Website edits have been preserved.'})];
  status.unread=1;status.notifications=[{id:'notification-001',jobId:'complete-job',kind:'complete',title:'Draft imported',message:'Review its title and language in Creator Studio.',seriesId:'editable-draft-001',createdAt:fixedTime,readAt:null}];
  const check=await fixture(page,{status}),panel=await openPanel(page),copy=localeMessages.en;
  await expect(panel.getByRole('link',{name:copy.driveImportOpenDraft!,exact:true}).first()).toHaveAttribute('href','/studio/series/editable-draft-001');await expect(panel.getByRole('button',{name:copy.driveImportRetry!,exact:true})).toHaveCount(1);await expect(panel.locator('.drive-import-job').filter({hasText:'Imported as an unpublished draft.'}).getByRole('button')).toHaveCount(0);
  await expect(page.locator('.notification-button .drive-unread-badge')).toHaveText('1');await panel.getByRole('button',{name:copy.driveImportReadAll!,exact:true}).click();await expect(panel.getByRole('button',{name:copy.driveImportReadAll!,exact:true})).toBeDisabled();await expect(page.locator('.notification-button .drive-unread-badge')).toHaveCount(0);
  expect(check.state.authCount).toBeGreaterThan(1);expect(check.writes).toEqual([{method:'POST',path:endpoint+'/notifications/read',body:{}}]);check.assertClean();
});

test('retry and cancel are explicit actions and completed destinations cannot be retried',async({page})=>{
  const status=initialStatus();status.jobs=[job({id:'active-job',folderName:'active-source-clips'}),job({id:'failed-job',folderName:'failed-source-clips',status:'error'}),job({id:'partial-job',folderName:'partial-source-clips',status:'error',seriesId:'preserved-draft'})];
  const check=await fixture(page,{status}),panel=await openPanel(page),copy=localeMessages.en;
  await expect(panel.getByRole('button',{name:copy.driveImportRetry!,exact:true})).toHaveCount(1);await panel.getByRole('button',{name:copy.driveImportCancel!,exact:true}).click();await expect(panel.getByRole('button',{name:copy.driveImportCancel!,exact:true})).toHaveCount(0);
  await panel.locator('.drive-import-job').filter({hasText:'failed-source-clips'}).getByRole('button',{name:copy.driveImportRetry!,exact:true}).click();
  expect(check.writes.map(item=>item.path)).toEqual([endpoint+'/jobs/active-job/cancel',endpoint+'/jobs/failed-job/retry']);check.assertClean();
});
test('deleted import history shows Imported without opening or retrying a deleted draft',async({page})=>{
  const status=initialStatus();
  status.jobs=[job({status:'complete',destinationDeleted:true,seriesId:null,message:'',folderName:'Removed drama'})];
  status.notifications=[{id:'past-import',jobId:'job-ready',kind:'complete',title:'Imported drama',message:'Imported successfully.',seriesId:null,createdAt:fixedTime,readAt:fixedTime}];
  const check=await fixture(page,{status}),panel=await openPanel(page),copy=localeMessages.en;
  const entry=panel.locator('.drive-import-job').filter({hasText:'Removed drama'});
  await expect(entry.getByText(copy.driveImportStatusComplete!,{exact:true})).toBeVisible();
  await expect(entry.getByText(copy.driveImportDestinationDeleted!,{exact:true})).toBeVisible();
  await expect(entry.getByRole('progressbar')).toHaveCount(0);
  await expect(panel.getByRole('link',{name:copy.driveImportOpenDraft!,exact:true})).toHaveCount(0);
  await expect(entry.getByRole('button')).toHaveCount(0);
  expect(check.writes).toEqual([]);check.assertClean();
});

test('ordinary administrators cannot discover the import controls or call their private API',async({page})=>{
  const check=await fixture(page,{actor:otherAdmin});await page.goto('/admin?tab=drive-imports');await expect(page.getByRole('heading',{name:localeMessages.en.admin!,exact:true})).toBeVisible();
  await expect(page.locator('.drive-import-panel')).toHaveCount(0);await expect(page.locator('.tab-bar').getByRole('button',{name:localeMessages.en.driveImportsTitle!,exact:true})).toHaveCount(0);expect(check.state.readCount).toBe(0);expect(check.writes).toEqual([]);check.assertClean();
});

test('the backend owner decision takes precedence over a stale owner-looking browser session',async({page})=>{
  const check=await fixture(page,{forbidden:true});await page.goto('/admin?tab=drive-imports');await expect(page.getByText(localeMessages.en.driveImportDenied!,{exact:true})).toBeVisible();await expect(page.locator('.drive-import-panel')).toHaveCount(0);expect(check.writes).toEqual([]);check.assertClean();
});

test('a failed save preserves the unsaved folder and current import activity',async({page})=>{
  const status=initialStatus();status.jobs=[job({status:'complete',seriesId:'retained-draft',message:'Existing draft remains editable.'})];const check=await fixture(page,{status}),panel=await openPanel(page),copy=localeMessages.en;
  const input=panel.getByLabel(copy.driveImportFolder!,{exact:true});await input.fill('new-folder-that-must-be-retained');check.state.mutationFailure=true;await panel.getByRole('button',{name:copy.driveImportSaveFolder!,exact:true}).click();await expect(panel.getByRole('alert')).toContainText('The folder could not be saved.');await expect(input).toHaveValue('new-folder-that-must-be-retained');await expect(panel).toContainText('Existing draft remains editable.');await expect(panel.getByRole('button',{name:copy.driveImportVerify!,exact:true})).toBeDisabled();
  check.state.mutationFailure=false;await panel.getByRole('button',{name:copy.driveImportSaveFolder!,exact:true}).click();await expect(panel.getByRole('button',{name:copy.driveImportSaveFolder!,exact:true})).toBeDisabled();expect(check.state.status.settings.folderId).toBe('new-folder-that-must-be-retained');check.assertClean();
});

test('polling refreshes activity without discarding edited input and stops after leaving the tab',async({page})=>{
  await page.clock.install();const check=await fixture(page),panel=await openPanel(page),copy=localeMessages.en;await panel.getByLabel(copy.driveImportFolder!,{exact:true}).fill('pending-private-folder-edit');const before=check.state.readCount;check.state.status.jobs=[job({message:'A background check discovered this folder.'})];await page.clock.fastForward(30001);await expect(panel).toContainText('A background check discovered this folder.');await expect(panel.getByLabel(copy.driveImportFolder!,{exact:true})).toHaveValue('pending-private-folder-edit');expect(check.state.readCount).toBeGreaterThan(before);
  await page.locator('.tab-bar').getByRole('button',{name:copy.users!,exact:true}).click();await expect(page.locator('.drive-import-panel')).toHaveCount(0);const after=check.state.readCount;await page.clock.fastForward(60001);expect(check.state.readCount).toBe(after);check.assertClean();
});

for(const locale of ['en','zh-TW','ar'] as const)test(`the private import panel fits a 320px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width:320,height:740});const status=initialStatus();status.connection.serviceAccountEmail='very-long-private-drive-service-account-name@lingying-browser-import-project.iam.gserviceaccount.com';status.jobs=[job({folderName:'001_clips_'+('A'.repeat(150)),message:'A detailed manifest error: '+('b'.repeat(200))})];status.notifications=[{id:'phone-notice',jobId:'job-ready',kind:'attention',title:'Source review required',message:'The original draft is preserved. '+('c'.repeat(150)),seriesId:'phone-draft',createdAt:fixedTime,readAt:null}];status.unread=1;
  const check=await fixture(page,{status,locale}),panel=await openPanel(page,locale);await expect(panel.getByLabel(localeMessages[locale].driveImportFolder!,{exact:true})).toHaveValue(DEFAULT_DRIVE_IMPORT_FOLDER);expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);expect(await panel.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);if(locale==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');check.assertClean();
});

const verificationCases=[
  ['DRIVE_IMPORT_API_DISABLED',409,'driveImportApiDisabled'],
  ['DRIVE_IMPORT_AUTH_FAILED',409,'driveImportAuthFailed'],
  ['DRIVE_IMPORT_ACCESS_DENIED',409,'driveImportAccessDenied'],
  ['DRIVE_IMPORT_RATE_LIMITED',429,'driveImportRateLimited'],
  ['DRIVE_IMPORT_UNAVAILABLE',503,'driveImportUnavailable'],
  ['DRIVE_IMPORT_INVALID_FOLDER',422,'driveImportInvalidFolder'],
  ['DRIVE_IMPORT_INVALID_RESPONSE',502,'driveImportInvalidResponse'],
  ['DRIVE_IMPORT_CONNECTION_FAILED',409,'driveImportConnectionFailed'],
] as const;
const privateProviderMarker='PRIVATE_PROVIDER_DETAILS_NEVER_DISPLAY';
const unsafeProviderFailure={message:`${privateProviderMarker} <img src=x onerror="window.__driveProviderInjected=true"> https://untrusted.example/enable?project=foreign-project`,details:{activationUrl:'https://untrusted.example/enable?project=foreign-project',serviceAccountEmail:'provider-controlled@foreign-project.iam.gserviceaccount.com'}};
const apiSettings='https://console.cloud.google.com/apis/library/drive.googleapis.com';

for(const[code,status,key]of verificationCases)test(`${code} shows a fixed diagnostic and keeps the watcher off without exposing provider details`,async({page})=>{
  const check=await fixture(page);check.state.verificationFailure={code,status,...unsafeProviderFailure};const panel=await openPanel(page);await panel.getByRole('button',{name:localeMessages.en.driveImportVerify!,exact:true}).click();const alert=panel.locator('.drive-import-verification-error');await expect(alert).toHaveAttribute('role','alert');await expect(alert.locator('p').first()).toHaveText(localeMessages.en[key]!);await expect(page.locator('body')).not.toContainText(privateProviderMarker);await expect(page.locator('body')).not.toContainText('untrusted.example');expect(await page.evaluate(()=>(window as any).__driveProviderInjected)).toBeUndefined();await expect(panel.getByRole('button',{name:localeMessages.en.driveImportEnable!,exact:true})).toBeDisabled();await expect(panel.locator('.drive-import-state')).toContainText(localeMessages.en.driveImportDisabled!);expect(check.state.status.settings.enabled).toBe(false);expect(check.state.status.settings.verifiedAt).toBeNull();expect(check.writes).toEqual([{method:'POST',path:endpoint+'/connection',body:{}}]);check.assertClean();
});

for(const[code,abort]of [['PRIVATE_UPSTREAM_ERROR',false],['constructor',false],['NETWORK',true]] as const)test(`an unrecognised ${code} verification failure uses the safe connection message`,async({page})=>{
  const check=await fixture(page);check.state.verificationFailure={code,status:502,abort,...unsafeProviderFailure};const panel=await openPanel(page);await panel.getByRole('button',{name:localeMessages.en.driveImportVerify!,exact:true}).click();const alert=panel.locator('.drive-import-verification-error');await expect(alert.locator('p').first()).toHaveText(localeMessages.en.driveImportConnectionFailed!);await expect(page.locator('body')).not.toContainText(privateProviderMarker);await expect(panel.getByRole('button',{name:localeMessages.en.driveImportEnable!,exact:true})).toBeDisabled();expect(check.writes).toEqual([{method:'POST',path:endpoint+'/connection',body:{}}]);check.assertClean();
});

test('a failed recheck suppresses a previously fresh verification through polling until an explicit successful retry',async({page})=>{
  await page.clock.install();const status=initialStatus();status.settings.verifiedAt=Date.now()-1000;const check=await fixture(page,{status}),panel=await openPanel(page),copy=localeMessages.en;await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeEnabled();check.state.verificationFailure={code:'DRIVE_IMPORT_API_DISABLED',status:409,...unsafeProviderFailure};await panel.getByRole('button',{name:copy.driveImportVerify!,exact:true}).click();await expect(panel.locator('.drive-import-verification-error')).toBeVisible();await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeDisabled();await expect(panel.locator('.drive-import-connection-state')).not.toContainText(copy.driveImportVerified!);const reads=check.state.readCount;await page.clock.fastForward(30001);await expect.poll(()=>check.state.readCount).toBeGreaterThan(reads);await expect(panel.locator('.drive-import-verification-error')).toBeVisible();await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeDisabled();expect(check.state.status.settings.enabled).toBe(false);
  check.state.verificationFailure=null;await panel.getByRole('button',{name:copy.driveImportVerify!,exact:true}).click();await expect(panel.locator('.drive-import-verification-error')).toHaveCount(0);await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeEnabled();await expect(panel.locator('.drive-import-state')).toContainText(copy.driveImportDisabled!);expect(check.writes).toEqual([{method:'POST',path:endpoint+'/connection',body:{}},{method:'POST',path:endpoint+'/connection',body:{}}]);check.assertClean();
});

test('diagnostic links use only the saved account project and saved folder and never provider-controlled destinations',async({page})=>{
  const check=await fixture(page);check.state.verificationFailure={code:'DRIVE_IMPORT_API_DISABLED',status:409,...unsafeProviderFailure};const panel=await openPanel(page),copy=localeMessages.en;await panel.getByRole('button',{name:copy.driveImportVerify!,exact:true}).click();const alert=panel.locator('.drive-import-verification-error'),api=alert.locator('.drive-import-open-api'),sharing=alert.locator('.drive-import-open-sharing');await expect(api).toHaveAttribute('href',apiSettings+'?project=lingying-browser-test');await expect(sharing).toHaveAttribute('href','https://drive.google.com/drive/folders/'+DEFAULT_DRIVE_IMPORT_FOLDER);await expect(api).toHaveText(copy.driveImportOpenApiConsole!);await expect(sharing).toHaveText(copy.driveImportOpenSharing!);
  for(const link of [api,sharing]){await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel',/(?:^|\s)noopener(?:\s|$)/);await expect(link).toHaveAttribute('rel',/(?:^|\s)noreferrer(?:\s|$)/);}
  const nextFolder='unsaved-private-folder-0123456789';await panel.getByLabel(copy.driveImportFolder!,{exact:true}).fill(nextFolder);await expect(sharing).toHaveAttribute('href','https://drive.google.com/drive/folders/'+DEFAULT_DRIVE_IMPORT_FOLDER);expect(check.writes).toEqual([{method:'POST',path:endpoint+'/connection',body:{}}]);await expect(panel.locator('textarea,input[type="password"]')).toHaveCount(0);await panel.getByRole('button',{name:copy.driveImportSaveFolder!,exact:true}).click();await expect(alert).toHaveCount(0);await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeDisabled();expect(check.state.status.settings.folderId).toBe(nextFolder);expect(check.state.status.settings.enabled).toBe(false);check.assertClean();
});

for(const[email,reason]of [[null,'missing account'],['reader@lingying-browser-test.iam.gserviceaccount.com?project=foreign-project','query injection'],['reader@lingying-browser-test.iam.gserviceaccount.com.untrusted.example','foreign host suffix']] as const)test(`${reason} uses a generic API settings link instead of an unsafe account project`,async({page})=>{
  const status=initialStatus();status.connection.serviceAccountEmail=email;const check=await fixture(page,{status});check.state.verificationFailure={code:'DRIVE_IMPORT_AUTH_FAILED',status:409,...unsafeProviderFailure};const panel=await openPanel(page);await panel.getByRole('button',{name:localeMessages.en.driveImportVerify!,exact:true}).click();await expect(panel.locator('.drive-import-open-api')).toHaveAttribute('href',apiSettings);await expect(panel.locator('.drive-import-open-sharing')).toHaveAttribute('href','https://drive.google.com/drive/folders/'+DEFAULT_DRIVE_IMPORT_FOLDER);check.assertClean();
});

test('an invalid saved folder never becomes a sharing link after the status refreshes',async({page})=>{
  await page.clock.install();const check=await fixture(page);check.state.verificationFailure={code:'DRIVE_IMPORT_ACCESS_DENIED',status:409,...unsafeProviderFailure};const panel=await openPanel(page);await panel.getByRole('button',{name:localeMessages.en.driveImportVerify!,exact:true}).click();await expect(panel.locator('.drive-import-open-sharing')).toBeVisible();check.state.status.settings.folderId='../../private-source?redirect=https://untrusted.example';const reads=check.state.readCount;await page.clock.fastForward(30001);await expect.poll(()=>check.state.readCount).toBeGreaterThan(reads);await expect(panel.locator('.drive-import-verification-error')).toBeVisible();await expect(panel.locator('.drive-import-open-sharing,.drive-import-folder-link')).toHaveCount(0);await expect(panel.locator('.drive-import-open-api')).toHaveAttribute('href',apiSettings+'?project=lingying-browser-test');await expect(panel.getByRole('button',{name:localeMessages.en.driveImportEnable!,exact:true})).toBeDisabled();expect(check.writes).toEqual([{method:'POST',path:endpoint+'/connection',body:{}}]);check.assertClean();
});

for(const locale of ['en','zh-TW','zh-CN','ar','de'] as const)test(`verification guidance and safe recovery links fit a 320px ${locale} phone`,async({page})=>{
  await page.setViewportSize({width:320,height:740});const check=await fixture(page,{locale});check.state.verificationFailure={code:'DRIVE_IMPORT_API_DISABLED',status:409,...unsafeProviderFailure};const panel=await openPanel(page,locale),copy=localeMessages[locale];await panel.getByRole('button',{name:copy.driveImportVerify!,exact:true}).click();const alert=panel.locator('.drive-import-verification-error');await expect(alert.locator('p').first()).toHaveText(copy.driveImportApiDisabled!);await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);expect(await alert.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  for(const selector of ['.drive-import-open-api','.drive-import-open-sharing']){const link=alert.locator(selector);await link.scrollIntoViewIfNeeded();await expect(link).toBeVisible();const box=await link.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);await link.click({trial:true});}await expect(panel.getByRole('button',{name:copy.driveImportEnable!,exact:true})).toBeDisabled();await expect(page.locator('body')).not.toContainText(privateProviderMarker);expect(check.writes).toEqual([{method:'POST',path:endpoint+'/connection',body:{}}]);check.assertClean();
});
