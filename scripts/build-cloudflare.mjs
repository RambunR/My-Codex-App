import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=process.cwd();
const destination=path.join(root,'dist/cloudflare/server');await mkdir(destination,{recursive:true});
const adapters=['db','config','storage','uploads','background'];
for(const name of ['app','auth','google','apple','email-auth','mail','finance','payment-state','analytics','errors']){
  let code=await readFile(path.join(root,'server',`${name}.ts`),'utf8');
  for(const adapter of adapters)code=code.replaceAll(`'./${adapter}.js'`,`'../../../cloudflare/${adapter}'`);
  code=code.replaceAll("'../shared/","'../../../shared/");
  // Keep the same error-class identity between API routes and cloud adapters.
  if(name!=='errors')code=code.replaceAll("'./errors.js'","'../../../server/errors'");
  await writeFile(path.join(destination,`${name}.ts`),code);
}
console.log('Cloudflare API generated from the shared Node API; SQLite, upload, and storage adapters selected.');
