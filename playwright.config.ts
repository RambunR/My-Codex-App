import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:3001',browserName:'chromium',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:3001/api/health',timeout:90000,reuseExistingServer:false,env:{PORT:'3001',DATA_DIR:'/tmp/aidramio-browser-tests',PAYMENTS_MODE:'demo',SEED_DEMO:'true',APP_URL:'http://127.0.0.1:3001'}},
});
