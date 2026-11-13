import {defineConfig,devices} from '@playwright/test';
import base from './playwright.config';

// WebKit is a browser-engine regression test, not a physical iPhone certificate.
export default defineConfig(base,{
  testMatch:'safari-playback.spec.ts',
  use:{...devices['iPhone 13'],browserName:'webkit',launchOptions:{},screenshot:'only-on-failure',trace:'retain-on-failure'},
});
