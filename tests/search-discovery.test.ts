import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import express from 'express';
import {discoveryRobots,renderSearchShell,searchOrigin,searchPageRequest,searchRoute,seriesSearchDocument} from '../shared/search-discovery';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-search-discovery-'));
Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test',SEED_DEMO:'false',PAYMENTS_MODE:'disabled',STRIPE_TEST_MODE:'false',PLATFORM_OWNER_USER_ID:'',PLATFORM_ADMIN_EMAIL_SHA256:'',PUBLIC_APP_URL:''});
const {config}=await import('../server/config');
const {all,run,db,transaction}=await import('../server/db');
const {registerSearchDiscovery,searchDocumentForPath,searchSitemap}=await import('../server/search-discovery');
const origin='https://lingying-search.example.test',owner='private-account-id',email='private-login@search.test',publisher='public-studio';
let server:Server,base:string;
const shell='<!doctype html><html><head><title>Old title</title><meta name="description" content="Old"><link rel="canonical" href="https://old.test/"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
function series(id:string,status='published',withEpisode=true){
  run('INSERT INTO series(id,creator_id,title,description,language,genres,status,cover_key,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id,owner,'Story '+id,'A real public synopsis for '+id,'en','["drama"]',status,'private-covers/'+id+'.png','2026-11-01 12:34:56');
  run('INSERT INTO series_publisher_profiles(series_id,publisher_id,assigned_by) VALUES (?,?,?)',id,publisher,owner);
  if(withEpisode)run('INSERT INTO episodes(id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)','episode-'+id,id,'Private episode title',1,30,64,'private-videos/'+id+'.mp4','private-original.mp4');
  return id;
}
before(async()=>{
  config.appUrl=origin;config.publicUrl='';config.sandbox=false;
  run('INSERT INTO users(id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?,?)',owner,email,'Private login name','!unused','admin',1,5500000,700000);
  run('INSERT INTO publisher_profiles(id,display_name,registered_at,created_by) VALUES (?,?,?,?)',publisher,'Public Studio','2020-01-01',owner);
  series('visible');series('draft','draft');series('archived','archived');series('empty','published',false);
  series('taken-down');run('INSERT INTO series_moderation(series_id,taken_down,reason,actor_id) VALUES (?,1,?,?)','taken-down','Private moderation reason',owner);
  series('deleted');run('INSERT INTO series_deletions(series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)','deleted',owner,owner,'{}');
  series('retired');run('INSERT INTO retired_catalog_series(series_id,operation_key) VALUES (?,?)','retired','private-retirement');
  const app=express();registerSearchDiscovery(app);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as any).port;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(dir,{recursive:true,force:true});});

test('initial HTML safely preserves creator text, including script-close and replacement metacharacters',()=>{
  const title='A <b>story</b> & "$&" $` $\' 靈映',description='A </script><script>alert("x")</script> story with $& and <img src=x onerror=alert(1)>.';
  const document=seriesSearchDocument({id:'visible',title,description,language:'en',genres:['drama'],episodeCount:1,publisher:{id:publisher,name:'Public <Studio>'}},origin),html=renderSearchShell(shell,document);
  assert.equal((html.match(/<title>/gu)||[]).length,1);assert.equal((html.match(/rel="canonical"/gu)||[]).length,1);
  assert.ok(html.includes('&lt;b&gt;story&lt;/b&gt;'));assert.ok(html.includes('$&'));assert.ok(html.includes('data-search-snapshot'));
  assert.equal(html.includes('<img src=x'),false);assert.equal(html.includes('<script>alert'),false);assert.ok(html.includes('/assets/app.js'));
  const structured=JSON.parse(html.match(/<script id="lingying-search-schema" type="application\/ld\+json">([\s\S]*?)<\/script>/u)![1]);
  assert.equal(structured.name,title);assert.equal(structured.description,description);assert.equal(structured['@type'],'TVSeries');assert.equal(structured.numberOfEpisodes,1);
});

test('anonymous discovery and sitemap expose only public available releases, even with owner credentials',async()=>{
  const before=all('SELECT * FROM users'),beforeSeries=all('SELECT * FROM series'),mapping=all('SELECT * FROM account_public_publishers');
  for(const headers of [{} as Record<string,string>,{Cookie:'drama_session=owner-token',Authorization:'Bearer owner-token'}]){
    const response=await fetch(base+'/api/discovery/document?path='+encodeURIComponent('/browse?genre=drama'),{headers});assert.equal(response.status,200);
    const document=await response.json();assert.equal(document.canonical,origin+'/browse');assert.ok(document.snapshotHtml.includes('/series/visible'));
    for(const id of ['draft','archived','empty','taken-down','deleted','retired'])assert.equal(document.snapshotHtml.includes('/series/'+id),false);
    const xml=await(await fetch(base+'/sitemap.xml',{headers})).text();assert.ok(xml.includes(origin+'/series/visible'));assert.ok(xml.includes(origin+'/publishers/'+publisher));
    for(const id of ['draft','archived','empty','taken-down','deleted','retired'])assert.equal(xml.includes('/series/'+id),false);
    const combined=JSON.stringify(document)+xml;for(const secret of [owner,email,'private-covers/','private-videos/','private-original.mp4','Private moderation reason'])assert.equal(combined.includes(secret),false);
  }
  assert.deepEqual(all('SELECT * FROM users'),before);assert.deepEqual(all('SELECT * FROM series'),beforeSeries);assert.deepEqual(all('SELECT * FROM account_public_publishers'),mapping);
});

test('per-series metadata uses actual title, publisher, poster, episode count and configured canonical origin',async()=>{
  const response=await fetch(base+'/api/discovery/document?path='+encodeURIComponent('/series/visible?next=https://attacker.test'),{headers:{'X-Forwarded-Host':'attacker.test',Host:'attacker.test'}}),document=await response.json();
  assert.equal(response.status,200);assert.equal(document.canonical,origin+'/series/visible');assert.equal(document.title,'Story visible | LingYing 靈映');
  assert.equal(document.image,origin+'/api/series/visible/cover');assert.equal(document.schema.numberOfEpisodes,1);assert.equal(document.schema.creator.name,'Public Studio');assert.equal(document.schema.creator.url,origin+'/publishers/'+publisher);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Robots-Tag'),'noindex');
  const head=await fetch(base+'/api/discovery/document?path=%2Fseries%2Fvisible',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('unavailable and malformed series return real 404 metadata; private HTML remains crawlable with noindex',async()=>{
  for(const id of ['missing','draft','archived','empty','taken-down','deleted','retired','foo.json']){
    const response=await fetch(base+'/api/discovery/document?path='+encodeURIComponent('/series/'+id));assert.equal(response.status,404,id);const document=await response.json();assert.match(document.robots,/noindex/u);assert.equal(document.schema,null);assert.equal(document.snapshotHtml.includes('Private'),false);
  }
  for(const route of ['/auth','/account','/wallet','/lucky-draw','/library','/studio','/admin','/watch/visible/episode','/auth/foo.ext']){
    const document=searchDocumentForPath(route);assert.equal(document.status,200);assert.match(document.robots,/noindex/u);assert.equal(document.schema,null);
  }
  assert.equal(searchRoute('/series/%2Fsecret').kind,'missing');assert.equal(searchRoute('//attacker.test').kind,'missing');assert.equal(searchRoute('/series/%ZZ').kind,'missing');
  for(const route of ['/series/foo.json','/publishers/studio.v2','/auth/foo.ext'])assert.equal(searchPageRequest(route),true);
  for(const route of ['/assets/app.js','/src/main.tsx','/api/series/visible'])assert.equal(searchPageRequest(route),false);
  const robots=await(await fetch(base+'/robots.txt')).text();assert.ok(robots.includes('Disallow: /api/'));assert.equal(robots.includes('Disallow: /auth'),false);
  // Interpret the published policy independently using the robots standard's
  // longest matching path rule, with Allow winning equal-specificity ties.
  const rules=robots.split('\n').flatMap(line=>{const match=/^(Allow|Disallow):\s*(.+)$/u.exec(line);return match?[{allow:match[1]==='Allow',path:match[2]}]:[];});
  const crawlAllowed=(url:string)=>{
    const matches=rules.filter(rule=>{const end=rule.path.endsWith('$'),path=end?rule.path.slice(0,-1):rule.path,pattern=path.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('.*');return new RegExp('^'+pattern+(end?'$':'')).test(url);});
    matches.sort((a,b)=>b.path.replace(/[*$]/gu,'').length-a.path.replace(/[*$]/gu,'').length||Number(b.allow)-Number(a.allow));return matches[0]?.allow??true;
  };
  for(const resource of ['/api/config','/api/series','/api/series?featured=true','/api/series?sort=popular&genre=drama','/api/series/visible','/api/series/visible/cover','/api/publishers/public-studio?page=2&page_size=24'])assert.equal(crawlAllowed(resource),true,resource+' must remain available to the JavaScript renderer');
  for(const resource of ['/api/auth/me','/api/payments/checkout','/api/studio','/api/admin','/api/wallet','/api/history','/api/episodes/private/stream','/api/discovery/document?path=/','/api/config-secret','/api/series-title-availability'])assert.equal(crawlAllowed(resource),false,resource+' must remain blocked');
});

test('publisher pages list only public releases and empty managed identities stay noindex',()=>{
  const document=searchDocumentForPath('/publishers/'+publisher);assert.equal(document.status,200);assert.equal(document.schema&&typeof document.schema==='object'&&(document.schema as any).mainEntity.itemListElement.length,1);assert.equal(document.snapshotHtml.includes('Story draft'),false);
  run('INSERT INTO publisher_profiles(id,display_name,registered_at) VALUES (?,?,?)','empty-profile','Empty Public Studio','2020-01-01');
  assert.equal(searchDocumentForPath('/publishers/empty-profile').status,200);assert.match(searchDocumentForPath('/publishers/empty-profile').robots,/noindex/u);
  assert.equal(searchDocumentForPath('/publishers/unknown-profile').status,404);
});

test('large catalogs use complete bounded sitemap pages, and removed content disappears on the next read',()=>{
  transaction(()=>{for(let index=0;index<1001;index++)series('page-'+index);});
  const index=searchSitemap()!;assert.ok(index.includes('<sitemapindex'));assert.ok(index.includes('/sitemap-page.xml?page=1'));assert.ok(index.includes('/sitemap-page.xml?page=2'));
  const first=searchSitemap(1)!,second=searchSitemap(2)!;assert.equal((first.match(/<loc>[^<]+\/series\//gu)||[]).length,1000);assert.equal((second.match(/<loc>[^<]+\/series\//gu)||[]).length,2);
  const combined=first+second;for(let number=0;number<1001;number++)assert.ok(combined.includes('/series/page-'+number+'</loc>'));assert.equal(searchSitemap(3),null);
  run("UPDATE series SET status='archived' WHERE id='visible'");assert.equal(searchSitemap(1)!.includes('/series/visible</loc>'),false);assert.equal(searchDocumentForPath('/series/visible').status,404);
});

test('sandbox discovery stays noindex and has no public sitemap; origin values reject unsafe schemes',()=>{
  config.sandbox=true;try{assert.match(searchDocumentForPath('/').robots,/noindex/u);assert.equal(searchSitemap()!.includes('<loc>'),false);assert.ok(discoveryRobots(origin,true).includes('Disallow: /'));}finally{config.sandbox=false;}
  for(const unsafe of ['javascript:alert(1)','http://attacker.test','https://user:password@attacker.test','not a URL'])assert.equal(searchOrigin(unsafe),'https://lingyingdrama.com');
  assert.equal(searchOrigin('http://127.0.0.1:3001/unused'),'http://127.0.0.1:3001');
});
