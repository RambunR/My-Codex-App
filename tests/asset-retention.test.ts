import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'vite';
import {retainPreviousAssets} from '../scripts/retain-previous-assets';

interface Manifest{current:string[];previous:string[]}
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'lingying-asset-retention-')),output=path.join(root,'dist');
  await writeFile(path.join(root,'index.html'),'<div id="app"></div><script type="module" src="/main.js"></script>');
  const release=async(label:string)=>{
    await writeFile(path.join(root,'main.js'),`import './style.css';document.querySelector('#app').textContent=${JSON.stringify(label)};import('./lazy.js').then(module=>module.show());`);
    await writeFile(path.join(root,'lazy.js'),`export const show=()=>console.log(${JSON.stringify('Lazy '+label)});`);
    await writeFile(path.join(root,'style.css'),`#app{color:${label==='A'?'red':label==='B'?'blue':'green'}}`);
    await build({configFile:false,root,logLevel:'silent',plugins:[retainPreviousAssets()],build:{outDir:output,emptyOutDir:true}});
    return JSON.parse(await readFile(path.join(output,'asset-release.json'),'utf8')) as Manifest;
  };
  return{root,output,release,cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function assertFiles(output:string,manifest:Manifest){
  const expected=[...new Set([...manifest.current,...manifest.previous])].sort();
  const actual=(await readdir(path.join(output,'assets'))).map(name=>'assets/'+name).sort();
  assert.deepEqual(actual,expected,'Only the current and one previous JS/CSS release remain.');
  for(const name of expected)assert.match(name,/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/);
}

test('real Vite builds retain A through B and repeated B, then replace A with B when C is built',async()=>{
  const f=await fixture();try{
    const a=await f.release('A');assert.deepEqual(a.previous,[]);assert.ok(a.current.some(name=>name.endsWith('.css')));assert.ok(a.current.filter(name=>name.endsWith('.js')).length>=2);
    const original=new Map(await Promise.all(a.current.map(async name=>[name,await readFile(path.join(f.output,name))] as const)));
    const b=await f.release('B');assert.notDeepEqual(b.current,a.current);assert.deepEqual(b.previous,a.current);await assertFiles(f.output,b);
    for(const[name,bytes]of original)assert.deepEqual(await readFile(path.join(f.output,name)),bytes,'An open A tab receives its original lazy chunk and styles.');
    const indexB=await readFile(path.join(f.output,'index.html'),'utf8');assert.ok(b.current.some(name=>indexB.includes(name)));assert.ok(a.current.some(name=>!indexB.includes(name)));
    const repeated=await f.release('B');assert.deepEqual(repeated,b,'The deployment rebuild preserves A instead of treating B as the previous release.');await assertFiles(f.output,repeated);
    const c=await f.release('C');assert.deepEqual(c.previous,b.current);await assertFiles(f.output,c);
    for(const name of a.current.filter(name=>![...c.current,...c.previous].includes(name)))await assert.rejects(readFile(path.join(f.output,name)),{code:'ENOENT'});
  }finally{await f.cleanup();}
});

test('legacy output retains only ordinary JS/CSS assets and ignores symlinks, unrelated files and invalid manifests',async()=>{
  const f=await fixture();try{
    await mkdir(path.join(f.output,'assets'),{recursive:true});
    await writeFile(path.join(f.output,'assets','legacy-1234.js'),'console.log("legacy")');
    await writeFile(path.join(f.output,'assets','legacy-1234.css'),'body{color:red}');
    await writeFile(path.join(f.output,'assets','legacy-1234.js.map'),'source map');
    await writeFile(path.join(f.output,'assets','old-image.png'),'not an asset to preserve');
    await writeFile(path.join(f.output,'old-user-upload.mp4'),'not an asset to preserve');
    await writeFile(path.join(f.root,'outside.js'),'private outside data');
    await symlink(path.join(f.root,'outside.js'),path.join(f.output,'assets','linked-secret.js'));
    const a=await f.release('A');assert.deepEqual(a.previous,['assets/legacy-1234.css','assets/legacy-1234.js']);await assertFiles(f.output,a);
    await assert.rejects(readFile(path.join(f.output,'old-user-upload.mp4')),{code:'ENOENT'});
    await writeFile(path.join(f.output,'asset-release.json'),JSON.stringify({current:['../outside.js'],previous:[]}));
    const b=await f.release('B');assert.deepEqual(b.previous,[],'An invalid manifest must not follow outside paths or accumulate unknown releases.');await assertFiles(f.output,b);
    assert.equal(await readFile(path.join(f.root,'outside.js'),'utf8'),'private outside data');
  }finally{await f.cleanup();}
});
