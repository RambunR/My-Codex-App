import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const dir=await mkdtemp(path.join(tmpdir(),'lingying-moderation-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';
const {one,all,run,transaction,db}=await import('../server/db');
const moderation=await import('../server/moderation');
const {config}=await import('../server/config');
const {unlockEpisode}=await import('../server/finance');
const {startPlayback,recordPlayback}=await import('../server/analytics');
const admin='moderation-admin',owner='moderation-owner',viewer='moderation-viewer';
for(const[id,role]of [[admin,'admin'],[owner,'publisher'],[viewer,'viewer']])run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros,earnings_micros) VALUES (?,?,?,?,?,?,?,?)',id,id+'@moderation.test',id,'local-unused-password',role,role==='publisher'?1:0,5_000_000,700_000);
function fixture(status:'draft'|'published'|'archived'='published',title='An original drama'){
  const id=randomUUID(),episode=randomUUID();
  run('INSERT INTO series (id,creator_id,title,description,language,genres,status,cover_key) VALUES (?,?,?,?,?,?,?,?)',id,owner,title,'Original synopsis for moderation tests.','en','["drama"]',status,'private-cover.webp');
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episode,id,'Episode one',1,10,1024,'private-episode.mp4');
  return{id,episode};
}
function expectCode(action:()=>unknown,code:string,status?:number){assert.throws(action,(error:any)=>error.code===code&&(status===undefined||error.status===status));}
after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});

test('only a persisted administrator may take down or restore, with an auditable reason',()=>{
  const drama=fixture();
  for(const actor of [owner,viewer,'missing-user'])expectCode(()=>moderation.setSeriesModeration(actor,drama.id,'takedown','A rights complaint requires investigation.'),'FORBIDDEN',403);
  for(const reason of ['', 'too short','x'.repeat(2001)])expectCode(()=>moderation.setSeriesModeration(admin,drama.id,'takedown',reason),'MODERATION_REASON_REQUIRED',400);
  expectCode(()=>moderation.setSeriesModeration(admin,drama.id,'delete' as any,'A valid reason for an invalid action.'),'INVALID_MODERATION_ACTION',400);
  assert.equal(one('SELECT COUNT(*) AS n FROM series_moderation_events WHERE series_id=?',drama.id)!.n,0);
  assert.equal(moderation.seriesIsTakenDown(drama.id),false);
  expectCode(()=>moderation.setSeriesModeration(admin,'missing-series','takedown','A missing series cannot be moderated.'),'NOT_FOUND',404);
});

test('takedown removes discovery and public access even for an owner or an existing purchaser',()=>{
  const removed=fixture(),available=fixture();
  const purchase=randomUUID();run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',purchase,viewer,removed.episode,100_000,70_000,30_000);
  moderation.setSeriesModeration(admin,removed.id,'takedown','A reported licence violation is under review.');
  const ids=all('SELECT s.id FROM series s WHERE s.status=\'published\' AND '+moderation.publicSeriesAllowedSql('s')).map(s=>s.id);
  assert.equal(ids.includes(removed.id),false);assert.equal(ids.includes(available.id),true);
  for(const actor of [undefined,viewer,owner,admin])expectCode(()=>moderation.assertSeriesAvailable(removed.id,{viewerId:actor,allowOwnerPreview:true}),'NOT_FOUND',404);
  assert.equal(moderation.assertSeriesAvailable(available.id).id,available.id);
  assert.equal(one('SELECT id FROM purchases WHERE id=?',purchase)!.id,purchase);
});

test('normal owner preview is constrained to that owner and never bypasses takedown',()=>{
  const draft=fixture('draft');
  expectCode(()=>moderation.assertSeriesAvailable(draft.id),'NOT_FOUND',404);
  expectCode(()=>moderation.assertSeriesAvailable(draft.id,{viewerId:viewer,allowOwnerPreview:true}),'NOT_FOUND',404);
  expectCode(()=>moderation.assertSeriesAvailable(draft.id,{viewerId:admin,allowOwnerPreview:true}),'NOT_FOUND',404);
  assert.equal(moderation.assertSeriesAvailable(draft.id,{viewerId:owner,allowOwnerPreview:true}).id,draft.id);
  moderation.setSeriesModeration(admin,draft.id,'takedown','The unpublished upload is under content review.');
  expectCode(()=>moderation.assertSeriesAvailable(draft.id,{viewerId:owner,allowOwnerPreview:true}),'NOT_FOUND',404);
  expectCode(()=>moderation.assertSeriesAvailable('missing-series',{viewerId:owner,allowOwnerPreview:true}),'NOT_FOUND',404);
});

test('publisher writes stay blocked until restoration, preserving the original publication state',()=>{
  for(const status of ['draft','published','archived'] as const){
    const drama=fixture(status);
    assert.equal(moderation.assertSeriesWritable(drama.id).status,status);
    moderation.setSeriesModeration(admin,drama.id,'takedown','This content must be unavailable during review.');
    expectCode(()=>transaction(()=>{moderation.assertSeriesWritable(drama.id);run("UPDATE series SET status='published' WHERE id=?",drama.id);}), 'SERIES_TAKEN_DOWN',423);
    assert.equal(one('SELECT status FROM series WHERE id=?',drama.id)!.status,status);
    moderation.setSeriesModeration(admin,drama.id,'restore','The complaint has been reviewed and resolved.');
    assert.equal(moderation.assertSeriesWritable(drama.id).status,status);
    assert.equal(one('SELECT status FROM series WHERE id=?',drama.id)!.status,status);
    assert.equal(moderation.seriesIsTakenDown(drama.id),false);
    if(status==='published')assert.equal(moderation.assertSeriesAvailable(drama.id).id,drama.id);
    else expectCode(()=>moderation.assertSeriesAvailable(drama.id),'NOT_FOUND',404);
  }
});

test('takedown and restoration are idempotent and preserve private media, purchases and all money records',()=>{
  const drama=fixture(),livePurchase=randomUUID(),testPurchase=randomUUID(),ledger=randomUUID(),testLedger=randomUUID();
  run('INSERT INTO test_accounts (user_id,wallet_micros,earnings_micros,publisher_active) VALUES (?,?,?,?)',viewer,900_000,0,0);
  for(const[table,id]of [['purchases',livePurchase],['test_purchases',testPurchase]])run(`INSERT INTO ${table} (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)`,id,viewer,drama.episode,100_000,70_000,30_000);
  for(const[table,id]of [['ledger',ledger],['test_ledger',testLedger]])run(`INSERT INTO ${table} (id,user_id,kind,amount_micros,reference_id,description) VALUES (?,?,?,?,?,?)`,id,viewer,'unlock',-100_000,drama.episode,'A previously paid episode');
  const before={users:all('SELECT id,role,publisher_active,wallet_micros,earnings_micros,quota_bytes,used_bytes FROM users ORDER BY id'),test:all('SELECT * FROM test_accounts'),episode:one('SELECT * FROM episodes WHERE id=?',drama.episode),series:one('SELECT * FROM series WHERE id=?',drama.id),purchases:all('SELECT * FROM purchases WHERE episode_id=?',drama.episode),testPurchases:all('SELECT * FROM test_purchases WHERE episode_id=?',drama.episode),ledger:one('SELECT * FROM ledger WHERE id=?',ledger),testLedger:one('SELECT * FROM test_ledger WHERE id=?',testLedger)};
  assert.equal(moderation.setSeriesModeration(admin,drama.id,'takedown','Reported infringement requires content review.').alreadyApplied,false);
  assert.equal(moderation.setSeriesModeration(admin,drama.id,'takedown','Reported infringement requires content review.').alreadyApplied,true);
  assert.equal(moderation.setSeriesModeration(admin,drama.id,'restore','Verified documentation permits restoring access.').alreadyApplied,false);
  assert.equal(moderation.setSeriesModeration(admin,drama.id,'restore','Verified documentation permits restoring access.').alreadyApplied,true);
  const after={users:all('SELECT id,role,publisher_active,wallet_micros,earnings_micros,quota_bytes,used_bytes FROM users ORDER BY id'),test:all('SELECT * FROM test_accounts'),episode:one('SELECT * FROM episodes WHERE id=?',drama.episode),series:one('SELECT * FROM series WHERE id=?',drama.id),purchases:all('SELECT * FROM purchases WHERE episode_id=?',drama.episode),testPurchases:all('SELECT * FROM test_purchases WHERE episode_id=?',drama.episode),ledger:one('SELECT * FROM ledger WHERE id=?',ledger),testLedger:one('SELECT * FROM test_ledger WHERE id=?',testLedger)};
  assert.deepEqual(after,before);
  const audit=moderation.adminModerationEvents(admin,drama.id);assert.equal(audit.length,2);assert.equal(audit[0].action,'restore');assert.equal(audit[1].action,'takedown');assert.equal(audit[0].actor_id,admin);assert.equal(audit[1].snapshot.before.taken_down,false);assert.equal(audit[1].snapshot.after.taken_down,true);
  assert.equal(JSON.stringify(audit).includes('password_hash'),false);
});

test('metadata edits can be audited in the same transaction and roll back with an invalid actor or snapshot',()=>{
  const drama=fixture();
  transaction(()=>{const before=one('SELECT title FROM series WHERE id=?',drama.id);run('UPDATE series SET title=? WHERE id=?','A corrected title',drama.id);moderation.recordSeriesMetadataEdit(admin,drama.id,'Corrected the title after verifying the original.',{before,after:{title:'A corrected title'}});});
  assert.equal(one('SELECT title FROM series WHERE id=?',drama.id)!.title,'A corrected title');
  const event=moderation.adminModerationEvents(admin,drama.id)[0];assert.equal(event.action,'metadata');assert.equal(event.snapshot.before.title,'An original drama');
  expectCode(()=>transaction(()=>{run('UPDATE series SET title=? WHERE id=?','A forbidden edit',drama.id);moderation.recordSeriesMetadataEdit(viewer,drama.id,'A viewer cannot make administrative adjustments.',{});}), 'FORBIDDEN',403);
  expectCode(()=>transaction(()=>{run('UPDATE series SET title=? WHERE id=?','An oversized edit',drama.id);moderation.recordSeriesMetadataEdit(admin,drama.id,'A snapshot must remain bounded in persistent storage.',{large:'x'.repeat(64*1024)});}), 'INVALID_MODERATION_SNAPSHOT',400);
  assert.equal(one('SELECT title FROM series WHERE id=?',drama.id)!.title,'A corrected title');assert.equal(moderation.adminModerationEvents(admin,drama.id).length,1);
});

test('admin discovery supports bounded search, hidden-content filtering and real/test purchase counts',()=>{
  const title='Specific administrative search '+randomUUID(),drama=fixture('published',title),draft=fixture('draft',title+' draft');
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer,drama.episode,100_000,70_000,30_000);
  run('INSERT INTO test_purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer,drama.episode,100_000,70_000,30_000);
  moderation.setSeriesModeration(admin,drama.id,'takedown','An operator is reviewing the reported series.');
  const found=moderation.listAdminSeries(admin,{q:title,status:'all',limit:1});assert.equal(found.total,2);assert.equal(found.series.length,1);assert.equal(found.page,1);assert.equal(found.limit,1);
  const hidden=moderation.listAdminSeries(admin,{q:title,status:'taken_down'});assert.equal(hidden.total,1);assert.equal(hidden.series[0].id,drama.id);assert.equal(hidden.series[0].paid_unlocks,1);assert.equal(hidden.series[0].test_unlocks,1);assert.equal(hidden.series[0].taken_down,1);
  assert.equal(moderation.listAdminSeries(admin,{q:title,status:'draft'}).series[0].id,draft.id);
  for(const actor of [viewer,owner]){expectCode(()=>moderation.listAdminSeries(actor),'FORBIDDEN',403);expectCode(()=>moderation.adminModerationEvents(actor,drama.id),'FORBIDDEN',403);}
  for(const filters of [{page:0},{page:1.1},{limit:51},{limit:0},{q:'x'.repeat(121)},{status:'invalid' as any}])expectCode(()=>moderation.listAdminSeries(admin,filters),filters.page!==undefined||filters.limit!==undefined?'INVALID_PAGE':'INVALID_FILTER',400);
});

test('query aliases cannot inject SQL and a schema reinitialization preserves moderation history',async()=>{
  const drama=fixture();moderation.setSeriesModeration(admin,drama.id,'takedown','The saved moderation decision must survive restart.');
  for(const alias of ['s; DROP TABLE users;--','s.id','s WHERE 1=1',''])expectCode(()=>moderation.publicSeriesAllowedSql(alias),'INVALID_SQL_ALIAS',400);
  const {DATABASE_SCHEMA}=await import('../shared/schema');db.exec(DATABASE_SCHEMA);
  assert.equal(moderation.seriesIsTakenDown(drama.id),true);assert.equal(moderation.adminModerationEvents(admin,drama.id).length,1);assert.ok(one('SELECT id FROM users WHERE id=?',admin));
});

test('administrative creator search uses the configured official alias without changing user identity',()=>{
  const saved={ownerId:config.platformOwnerUserId,name:config.officialCreatorName};
  try{
    config.platformOwnerUserId=owner;config.officialCreatorName='LingYingDrama Offical';
    const drama=fixture(),found=moderation.listAdminSeries(admin,{q:'LingYingDrama Offical',limit:50});
    assert.ok(found.series.some(series=>series.id===drama.id));assert.ok(found.series.every(series=>series.creator_name==='LingYingDrama Offical'));
    assert.equal(one('SELECT name FROM users WHERE id=?',owner)!.name,owner);
    config.platformOwnerUserId=viewer;
    assert.equal(moderation.listAdminSeries(admin,{q:'LingYingDrama Offical'}).total,0);
    config.platformOwnerUserId=owner;config.officialCreatorName='';
    assert.equal(moderation.listAdminSeries(admin,{q:owner,limit:50}).series[0].creator_name,owner);
  }finally{config.platformOwnerUserId=saved.ownerId;config.officialCreatorName=saved.name;}
});

test('finance refuses moderated episodes before free, creator, already-paid or new wallet purchases',()=>{
  const free=fixture(),paid=fixture();run('UPDATE series SET free_episodes=0 WHERE id=?',paid.id);
  run('INSERT INTO purchases (id,user_id,episode_id,price_micros,creator_micros,platform_micros) VALUES (?,?,?,?,?,?)',randomUUID(),viewer,paid.episode,100_000,70_000,30_000);
  const available=fixture();run('UPDATE series SET free_episodes=0 WHERE id=?',available.id);
  assert.equal(unlockEpisode(viewer,free.episode).alreadyUnlocked,true);
  assert.equal(unlockEpisode(owner,paid.episode).alreadyUnlocked,true);
  assert.equal(unlockEpisode(viewer,paid.episode).alreadyUnlocked,true);
  for(const drama of [free,paid,available])moderation.setSeriesModeration(admin,drama.id,'takedown','Moderated content must not accept additional unlocks.');
  const snapshot=()=>({users:all('SELECT * FROM users ORDER BY id'),testAccounts:all('SELECT * FROM test_accounts ORDER BY user_id'),purchases:all('SELECT * FROM purchases ORDER BY id'),testPurchases:all('SELECT * FROM test_purchases ORDER BY id'),ledger:all('SELECT * FROM ledger ORDER BY id'),testLedger:all('SELECT * FROM test_ledger ORDER BY id')});
  const before=snapshot(),saved=config.stripeTestMode;
  try{
    for(const testMode of [false,true]){
      config.stripeTestMode=testMode;
      for(const[actor,episode]of [[viewer,free.episode],[owner,paid.episode],[viewer,paid.episode],[viewer,available.episode]])expectCode(()=>unlockEpisode(actor,episode),'NOT_FOUND',404);
    }
  }finally{config.stripeTestMode=saved;}
  assert.deepEqual(snapshot(),before);
});

test('analytics reject new and existing moderated playback without modifying viewing evidence',()=>{
  const drama=fixture(),viewerKey='a'.repeat(64),started=startPlayback(drama.episode,viewerKey,1000);
  const before={session:one('SELECT * FROM playback_sessions WHERE id=?',started.sessionId),views:one('SELECT views FROM series WHERE id=?',drama.id)!.views};
  moderation.setSeriesModeration(admin,drama.id,'takedown','Playback and heartbeat activity must stop during review.');
  expectCode(()=>startPlayback(drama.episode,viewerKey,4000),'NOT_FOUND',404);
  expectCode(()=>startPlayback(drama.episode,'b'.repeat(64),4000),'NOT_FOUND',404);
  expectCode(()=>recordPlayback(started.sessionId,viewerKey,3000,4000),'NOT_FOUND',404);
  assert.deepEqual({session:one('SELECT * FROM playback_sessions WHERE id=?',started.sessionId),views:one('SELECT views FROM series WHERE id=?',drama.id)!.views},before);
  assert.equal(one('SELECT COUNT(*) AS n FROM playback_sessions WHERE episode_id=?',drama.episode)!.n,1);
  moderation.setSeriesModeration(admin,drama.id,'restore','The review is complete and normal playback can resume.');
  assert.equal(recordPlayback(started.sessionId,viewerKey,3000,4000).viewCounted,true);
  // HTTP routes enforce publication and entitlements; this low-level helper
  // retains the fixture and private-preview semantics of existing callers.
  const draft=fixture('draft');assert.ok(startPlayback(draft.episode,viewerKey,1000).sessionId);
});
