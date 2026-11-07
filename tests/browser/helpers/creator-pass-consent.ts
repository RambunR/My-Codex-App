import {expect,type Page} from '@playwright/test';
import {LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION} from '../../../shared/creator-pass-consent';

export const creatorConsent={accepted:true,policy_version:LEGAL_POLICY_VERSION,disclosure_version:CREATOR_PASS_DISCLOSURE_VERSION};

export async function agreeToCreatorPass(page:Page){
  const checkbox=page.locator('input[name="creator_pass_consent"]');
  await expect(checkbox).toBeVisible();
  await checkbox.check();
}
