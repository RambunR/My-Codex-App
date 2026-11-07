import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=process.cwd();
const destination=path.join(root,'dist/cloudflare/server');await mkdir(destination,{recursive:true});
const adapters=['db','config','storage','uploads','background','chunked-storage'];
for(const name of ['app','auth','storage-quota','owner','cover-layout','subtitle-languages','publisher-profiles','publisher-profile-sql','catalog-access','catalog-retirement','series-lifecycle','episode-batch','episode-access','episode-upload-sessions','episode-duration','playback-times','moderation','taxonomy','origins','google','apple','email-auth','mail','finance','creator-pass-consent','test-payouts','test-payout-access','withdrawal-terms','funding-rewards','promotions','payment-state','payment-risk','stripe-event-context','stripe-readiness','analytics','errors']){
  let code=await readFile(path.join(root,'server',`${name}.ts`),'utf8');
  for(const adapter of adapters)code=code.replaceAll(`'./${adapter}.js'`,`'../../../cloudflare/${adapter}'`);
  code=code.replaceAll("'../shared/","'../../../shared/");
  // Keep the same error-class identity between API routes and cloud adapters.
  if(name!=='errors')code=code.replaceAll("'./errors.js'","'../../../server/errors'");
  await writeFile(path.join(destination,`${name}.ts`),code);
}
console.log('Cloudflare API generated from the shared Node API; SQLite, upload, and storage adapters selected.');
