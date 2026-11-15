import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import type {SeriesUnlockQuote} from '../shared/series-unlock';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-series-unlock-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.SEED_DEMO='false';process.env.PAYMENTS_MODE='disabled';process.env.STRIPE_TEST_MODE='false';process.env.PLATFORM_OWNER_USER_ID='';process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,all,run}=await import('../server/db');
const finance=await import('../server/finance');
const {DATABASE_SCHEMA}=await import('../shared/schema');
const origin='https://series-unlock.example.test';let server:Server,base:string;
interface Actor{id:string;cookie:string}
interface Fixture{id:string;ids:string[];owner:Actor;viewer:Actor}
function actor(role='viewer',wallet=20_000_000,withTestAccount=true):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex');run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,wallet_micros) VALUES (?,?,?,?,?,?,?)',id,id+'@series-unlock.test','Local '+role,'unused-local-hash',role,role==='viewer'?0:1,wallet);
  if(withTestAccount)run('INSERT INTO test_accounts (user_id,wallet_micros) VALUES (?,?)',id,wallet);
  run('INSERT INTO sessions VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);return{id,cookie:'drama_session='+token};
}
function append(f:Fixture,number:number){const id=randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',id,f.id,'Episode '+number,number,30,64,'series-unlock/fixture.mp4','original.mp4');f.ids.push(id);return id;}
function fixture(numbers=[1,2,3],free=0,last=false,price=11,owner=actor('publisher'),viewer=actor()):Fixture{
  const f={id:randomUUID(),ids:[],owner,viewer} as Fixture;run('INSERT INTO series (id,creator_id,title,description,language,genres,price_cents,free_episodes,status,cover_key) VALUES (?,?,?,?,?,?,?,?,?,?)',f.id,owner.id,'Series unlock '+f.id,'An original drama for local atomic series-purchase verification.','en','["drama"]',price,free,'published','public:/images/midnight.jpg');
  run('INSERT INTO series_episode_access_settings (series_id,last_episode_free) VALUES (?,?)',f.id,last?1:0);for(const number of numbers)append(f,number);return f;
}
function receipt(f:Fixture,episodeId:string,table='purchases',buyer=f.viewer,cents=501){const id=randomUUID();run('INSERT INTO '+table+' (id,user_id,episode_id,price_micros,creator_micros,platform_micros,created_at) VALUES (?,?,?,?,?,?,?)',id,buyer.id,episodeId,cents*10000,cents*7000,cents*3000,'2022-03-04 05:06:07');return one('SELECT * FROM '+table+' WHERE id=?',id)!;}
function award(f:Fixture,buyer=f.viewer){run('INSERT INTO lucky_draw_results (id,user_id,series_id,request_id,title,drawn_at) VALUES (?,?,?,?,?,?)',randomUUID(),buyer.id,f.id,randomUUID(),'Saved free-series award','2026-11-12T12:00:00.000Z');}
const stateTables=['users','test_accounts','payments','test_payments','purchases','test_purchases','ledger','test_ledger','creator_pass_consents','lucky_draw_accounts','lucky_draw_results','lucky_draw_grants','lucky_draw_pool','lucky_draw_pool_events'];
function state(){const result:Record<string,unknown>={};for(const table of stateTables)result[table]=all('SELECT * FROM '+table+' ORDER BY rowid');return result;}
function catalog(){return{series:all('SELECT * FROM series ORDER BY id'),episodes:all('SELECT * FROM episodes ORDER BY id')};}
async function request(route:string,buyer?:Actor,body?:unknown,status:number|number[]=200,method=body===undefined?'GET':'POST',requestOrigin=origin){
  const response=await fetch(base+route,{method,headers:{...(buyer?{Cookie:buyer.cookie}:{}),...(body===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);return{data,response};
}
const quoteRoute=(f:Fixture)=>'/api/series/'+f.id+'/unlock-quote',buyRoute=(f:Fixture)=>'/api/series/'+f.id+'/unlock-all';
async function quote(f:Fixture,buyer=f.viewer):Promise<SeriesUnlockQuote>{return(await request(quoteRoute(f),buyer)).data;}
async function buy(f:Fixture,q:SeriesUnlockQuote,buyer=f.viewer,status:number|number[]=200){return(await request(buyRoute(f),buyer,{revision:q.revision},status)).data;}
function accountBalance(id:string,testMode=false){return one('SELECT wallet_micros,earnings_micros FROM '+(testMode?'test_accounts WHERE user_id=?':'users WHERE id=?'),id)!;}
function assertReceipts(f:Fixture,ids:string[],cents:number,table='purchases'){
  for(const episodeId of ids){const proof=one('SELECT * FROM '+table+' WHERE user_id=? AND episode_id=?',f.viewer.id,episodeId)!;assert.ok(proof);assert.equal(proof.price_micros,cents*10000);assert.equal(proof.creator_micros,cents*7000);assert.equal(proof.platform_micros,cents*3000);
    const ledger=all('SELECT user_id,kind,amount_micros FROM '+(table==='purchases'?'ledger':'test_ledger')+' WHERE reference_id=? ORDER BY kind',proof.id).map(row=>({...row}));assert.deepEqual(ledger,[{user_id:f.owner.id,kind:'earning',amount_micros:cents*7000},{user_id:f.viewer.id,kind:'unlock',amount_micros:-cents*10000}]);}
}
before(async()=>{config.appUrl=origin;config.mailProvider='disabled';await mkdir(path.join(directory,'objects','series-unlock'),{recursive:true});await writeFile(path.join(directory,'objects','series-unlock','fixture.mp4'),Buffer.alloc(64));const app=createApp();app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
beforeEach(()=>{config.stripeTestMode=false;config.payments='disabled';config.sandbox=false;config.stripeKey='';});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});});

test('quote and purchase require authentication, same-origin writes and a strict current-revision payload',async()=>{
  const f=fixture(),before=state();await request(quoteRoute(f),undefined,undefined,401);await request(buyRoute(f),undefined,{revision:'0'.repeat(64)},401);
  const q=await quote(f);assert.match(q.revision,/^[a-f0-9]{64}$/);assert.equal(q.series_id,f.id);assert.deepEqual(Object.keys(q).sort(),['episode_count','episode_ids','revision','series_id','total_micros','unit_price_micros']);
  await request(buyRoute(f),f.viewer,{revision:q.revision},403,'POST','https://another-origin.example.test');
  for(const body of [{},null,[],{revision:null},{revision:1},{revision:'a'.repeat(63)},{revision:'A'.repeat(64)},{revision:'g'.repeat(64)},{revision:q.revision,total_micros:1},{revision:q.revision,episode_ids:[f.ids[0]]},{revision:q.revision,discount:100}])await request(buyRoute(f),f.viewer,body,400,'POST');
  for(const revision of [undefined,null,1,'A'.repeat(64),'a'.repeat(63)])assert.throws(()=>finance.unlockAllEpisodes(f.viewer.id,f.id,revision as string),{status:400,code:'VALIDATION'});
  assert.deepEqual(state(),before);
});

test('read-only quotes charge only remaining paid episodes using real highest-numbered finale, previous receipts and the current price cap',async()=>{
  const f=fixture([1,3,8,11,20],1,true),previous=receipt(f,f.ids[2]),before=state(),media=catalog(),q=await quote(f);
  assert.deepEqual(q.episode_ids,[f.ids[1],f.ids[3]]);assert.equal(q.episode_count,2);assert.equal(q.unit_price_micros,110000);assert.equal(q.total_micros,220000);assert.deepEqual(await quote(f),q);assert.deepEqual(state(),before);assert.deepEqual(catalog(),media);assert.deepEqual(one('SELECT * FROM purchases WHERE id=?',previous.id),previous);
  for(const entry of [fixture([],0,true),fixture([9],0,true),fixture([1,2],5,false)]){const preview=await quote(entry);assert.deepEqual(preview.episode_ids,[]);assert.equal(preview.total_micros,0);}
  assert.equal((await quote(f,f.owner)).episode_count,0);const capped=fixture([1,7],0,false,501);assert.equal((await quote(capped)).unit_price_micros,1_000_000);assert.equal((await quote(capped)).total_micros,2_000_000);
  const bareOwner=actor('publisher',20_000_000,false),bareBuyer=actor('viewer',20_000_000,false),bare=fixture([1,2],0,false,11,bareOwner,bareBuyer);config.stripeTestMode=true;const noInitialization=state();assert.equal(finance.quoteSeriesUnlock(bareBuyer.id,bare.id).episode_count,2);assert.deepEqual(state(),noInitialization);assert.equal(one('SELECT 1 FROM test_accounts WHERE user_id IN (?,?)',bareBuyer.id,bareOwner.id),undefined);
});

test('one confirmed series purchase commits exact per-episode 70/30 receipts and ledger entries without altering catalogue or earlier receipts',async()=>{
  const f=fixture([1,2,3,8,12],1,true),old=receipt(f,f.ids[1]),q=await quote(f),media=catalog();run("INSERT INTO payments (id,user_id,kind,amount_cents,currency,provider,status) VALUES (?,?,'funding',500,'usd','stripe','paid')",randomUUID(),f.viewer.id);const payments=all('SELECT * FROM payments ORDER BY rowid'),draws=all('SELECT * FROM lucky_draw_results ORDER BY rowid'),beforeOwner=accountBalance(f.owner.id),result=await buy(f,q);
  assert.equal(result.unlocked_count,2);assert.equal(result.paid_micros,220000);assert.equal(result.alreadyUnlocked,false);assert.equal(result.user.wallet_micros,20_000_000-220000);assert.equal(accountBalance(f.owner.id).earnings_micros,beforeOwner.earnings_micros+154000);assertReceipts(f,[f.ids[2],f.ids[3]],11);assert.deepEqual(one('SELECT * FROM purchases WHERE id=?',old.id),old);assert.deepEqual(catalog(),media);assert.deepEqual(all('SELECT * FROM payments ORDER BY rowid'),payments);assert.deepEqual(all('SELECT * FROM lucky_draw_results ORDER BY rowid'),draws);assert.equal((await quote(f)).episode_count,0);
});

test('aggregate insufficient funds and creator overflow reject before any account initialization, receipt or financial write',async()=>{
  for(const testMode of [false,true]){
    const creator=actor('publisher',0,!testMode),viewer=actor('viewer',110000),f=fixture([1,2],0,false,11,creator,viewer);config.stripeTestMode=testMode;const q=finance.quoteSeriesUnlock(viewer.id,f.id),before=state();assert.equal(q.total_micros,220000);assert.throws(()=>finance.unlockAllEpisodes(viewer.id,f.id,q.revision),{status:402,code:'INSUFFICIENT_FUNDS'});assert.deepEqual(state(),before);if(testMode)assert.equal(one('SELECT 1 FROM test_accounts WHERE user_id=?',creator.id),undefined);
    if(testMode){const noAccount=actor('viewer',20_000_000,false),beforeMissing=state(),missingQuote=finance.quoteSeriesUnlock(noAccount.id,f.id);assert.throws(()=>finance.unlockAllEpisodes(noAccount.id,f.id,missingQuote.revision),{status:402,code:'INSUFFICIENT_FUNDS'});assert.deepEqual(state(),beforeMissing);}
    const overflow=fixture([1,2]);config.stripeTestMode=testMode;run('UPDATE '+(testMode?'test_accounts SET earnings_micros=? WHERE user_id=?':'users SET earnings_micros=? WHERE id=?'),Number.MAX_SAFE_INTEGER-77000,overflow.owner.id);const overflowQuote=await quote(overflow),beforeOverflow=state();assert.equal(Number.MAX_SAFE_INTEGER-77000+77000,Number.MAX_SAFE_INTEGER,'one episode fits, while both together exceed the creator balance range');const response=await buy(overflow,overflowQuote,overflow.viewer,409);assert.equal(response.error.code,'BALANCE_LIMIT');assert.deepEqual(state(),beforeOverflow);
  }
});

test('failure during a later receipt or ledger insert rolls the entire series charge back in either financial partition',async()=>{
  for(const testMode of [false,true])for(const failure of ['receipt','ledger']){
    const f=fixture([1,2,3]),purchaseTable=testMode?'test_purchases':'purchases',ledgerTable=testMode?'test_ledger':'ledger';receipt(f,f.ids[0],purchaseTable);config.stripeTestMode=testMode;const q=finance.quoteSeriesUnlock(f.viewer.id,f.id),before=state();
    const target=failure==='receipt'?purchaseTable:ledgerTable,condition=failure==='receipt'?`NEW.episode_id='${f.ids[2]}'`:`NEW.kind='earning' AND EXISTS(SELECT 1 FROM ${purchaseTable} p WHERE p.id=NEW.reference_id AND p.episode_id='${f.ids[2]}')`;
    run(`CREATE TRIGGER local_series_unlock_failure BEFORE INSERT ON ${target} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'local later receipt failure'); END;`);
    try{assert.throws(()=>finance.unlockAllEpisodes(f.viewer.id,f.id,q.revision),/local later receipt failure/);assert.deepEqual(state(),before);assert.deepEqual(finance.quoteSeriesUnlock(f.viewer.id,f.id),q);}finally{run('DROP TRIGGER local_series_unlock_failure');}
    const result=await buy(f,q);assert.equal(result.unlocked_count,2);assertReceipts(f,[f.ids[1],f.ids[2]],11,purchaseTable);
  }
});

test('price, free status, final-episode movement, numbering, ownership and partial purchases invalidate a pending quote without charging',async()=>{
  const changes:Array<{name:string;last?:boolean;price?:number;change:(f:Fixture)=>void}>=[
    {name:'price',change:f=>run('UPDATE series SET price_cents=12 WHERE id=?',f.id)},
    {name:'raw price even with the same cap',price:501,change:f=>run('UPDATE series SET price_cents=777 WHERE id=?',f.id)},
    {name:'first free',change:f=>run('UPDATE series SET free_episodes=2 WHERE id=?',f.id)},
    {name:'last free enabled',change:f=>run('UPDATE series_episode_access_settings SET last_episode_free=1 WHERE series_id=?',f.id)},
    {name:'append final',last:true,change:f=>{append(f,30);}},
    {name:'remove final',last:true,change:f=>{run('DELETE FROM episodes WHERE id=?',f.ids[2]);}},
    {name:'reorder final',last:true,change:f=>{run('UPDATE episodes SET number=999 WHERE id=?',f.ids[0]);run('UPDATE episodes SET number=2 WHERE id=?',f.ids[2]);run('UPDATE episodes SET number=20 WHERE id=?',f.ids[0]);}},
    {name:'creator',change:f=>{const replacement=actor('publisher');run('UPDATE series SET creator_id=? WHERE id=?',replacement.id,f.id);}},
    {name:'partial entitlement',change:f=>{receipt(f,f.ids[0]);}},
  ];
  for(const entry of changes){const f=fixture([2,9,20],0,entry.last,entry.price??11),q=await quote(f);entry.change(f);const before=state(),changed=await quote(f);assert.notEqual(changed.revision,q.revision,entry.name);const result=await buy(f,q,f.viewer,409);assert.equal(result.error.code,'UNLOCK_QUOTE_CHANGED',entry.name);assert.deepEqual(state(),before,entry.name);}
});

test('quote revisions bind the exact account, selected financial mode and target series',async()=>{
  const f=fixture(),q=await quote(f),other=actor(),otherSeries=fixture([1,2,3],0,false,11,f.owner,f.viewer),before=state();
  const wrongAccount=await buy(f,q,other,409);assert.equal(wrongAccount.error.code,'UNLOCK_QUOTE_CHANGED');const wrongSeries=await buy(otherSeries,q,f.viewer,409);assert.equal(wrongSeries.error.code,'UNLOCK_QUOTE_CHANGED');config.stripeTestMode=true;const testQuote=await quote(f);assert.equal(testQuote.total_micros,q.total_micros);assert.notEqual(testQuote.revision,q.revision);const wrongMode=await buy(f,q,f.viewer,409);assert.equal(wrongMode.error.code,'UNLOCK_QUOTE_CHANGED');assert.deepEqual(state(),before);
});

test('retries, concurrent bundles and a racing single-episode unlock cannot duplicate a receipt, charge or creator earning',async()=>{
  const f=fixture(),q=await quote(f),results=await Promise.all(Array.from({length:6},()=>buy(f,q)));assert.equal(results.filter(result=>!result.alreadyUnlocked).length,1);assert.equal(results.reduce((sum,result)=>sum+result.paid_micros,0),330000);assert.equal(results.reduce((sum,result)=>sum+result.unlocked_count,0),3);assertReceipts(f,f.ids,11);const beforeReplay=state(),replay=await buy(f,q);assert.equal(replay.unlocked_count,0);assert.equal(replay.paid_micros,0);assert.equal(replay.alreadyUnlocked,true);assert.deepEqual(state(),beforeReplay);
  const race=fixture(),raceQuote=await quote(race);await Promise.all([request('/api/episodes/'+race.ids[0]+'/unlock',race.viewer,{}),buy(race,raceQuote,race.viewer,[200,409])]);const remaining=await quote(race);if(remaining.episode_count)await buy(race,remaining);assertReceipts(race,race.ids,11);assert.equal(one('SELECT COUNT(*) AS n FROM purchases WHERE user_id=?',race.viewer.id)!.n,3);assert.equal(accountBalance(race.viewer.id).wallet_micros,20_000_000-330000);assert.equal(accountBalance(race.owner.id).earnings_micros,231000);assert.equal(one('SELECT COUNT(*) AS n FROM ledger WHERE user_id IN (?,?)',race.viewer.id,race.owner.id)!.n,6);
});

test('real entitlements apply in both modes while test receipts and each new series charge remain financially isolated',async()=>{
  const f=fixture([1,2,3,4]),realProof=receipt(f,f.ids[0]),testProof=receipt(f,f.ids[1],'test_purchases',f.viewer,22),live=await quote(f);assert.deepEqual(live.episode_ids,f.ids.slice(1));config.stripeTestMode=true;const testQuote=await quote(f);assert.deepEqual(testQuote.episode_ids,f.ids.slice(2));await buy(f,testQuote);assertReceipts(f,f.ids.slice(2),11,'test_purchases');assert.equal(accountBalance(f.viewer.id).wallet_micros,20_000_000);assert.equal(accountBalance(f.owner.id).earnings_micros,0);
  config.stripeTestMode=false;assert.deepEqual((await quote(f)).episode_ids,f.ids.slice(1));await buy(f,await quote(f));assertReceipts(f,f.ids.slice(1),11);assert.equal(accountBalance(f.viewer.id).wallet_micros,20_000_000-330000);assert.equal(accountBalance(f.viewer.id,true).wallet_micros,20_000_000-220000);assert.equal(accountBalance(f.owner.id).earnings_micros,231000);assert.equal(accountBalance(f.owner.id,true).earnings_micros,154000);assert.deepEqual(one('SELECT * FROM purchases WHERE id=?',realProof.id),realProof);assert.deepEqual(one('SELECT * FROM test_purchases WHERE id=?',testProof.id),testProof);for(const testMode of [true,false]){config.stripeTestMode=testMode;assert.equal((await quote(f)).episode_count,0);}
});

test('Lucky Draw awards and actual ownership remain free across modes and include future episodes without inventing paid receipts',async()=>{
  const f=fixture(),oldQuote=await quote(f);award(f);const before=state();for(const testMode of [false,true]){config.stripeTestMode=testMode;const current=await quote(f);assert.equal(current.episode_count,0);const noCharge=await buy(f,oldQuote);assert.equal(noCharge.alreadyUnlocked,true);assert.equal(noCharge.paid_micros,0);assert.equal((await quote(f,f.owner)).episode_count,0);assert.equal((await buy(f,await quote(f,f.owner),f.owner)).unlocked_count,0);}
  append(f,20);for(const testMode of [false,true]){config.stripeTestMode=testMode;assert.equal((await quote(f)).total_micros,0);const single=(await request('/api/episodes/'+f.ids.at(-1)+'/unlock',f.viewer,{})).data;assert.equal(single.alreadyUnlocked,true);assert.equal((await quote(f,f.owner)).episode_count,0);}assert.deepEqual(state(),before);
});

test('quotes and purchases preserve publication, moderation, deletion and payment-review guards even for a prize winner or creator',async()=>{
  for(const unavailable of ['draft','archived','moderated','deleted','retired']){
    const f=fixture(),q=await quote(f);award(f);if(unavailable==='draft'||unavailable==='archived')run('UPDATE series SET status=? WHERE id=?',unavailable,f.id);if(unavailable==='moderated')run('INSERT INTO series_moderation (series_id,taken_down,reason,actor_id) VALUES (?,1,?,?)',f.id,'Local rights review',f.owner.id);if(unavailable==='deleted')run('INSERT INTO series_deletions (series_id,creator_id,actor_id,summary_json) VALUES (?,?,?,?)',f.id,f.owner.id,f.owner.id,'{}');if(unavailable==='retired')run('INSERT INTO retired_catalog_series (series_id,operation_key) VALUES (?,?)',f.id,'local-fixture-retirement');const before=state();for(const buyer of [f.viewer,f.owner]){await request(quoteRoute(f),buyer,undefined,404);await buy(f,q,buyer,404);}assert.deepEqual(state(),before);
  }
  for(const testMode of [false,true]){const f=fixture(),q=await quote(f);config.stripeTestMode=testMode;const hold=randomUUID();run('INSERT INTO payment_risk_cases (id,table_group,livemode,kind,provider_object_id,user_id,status) VALUES (?,?,?,?,?,?,?)',hold,testMode?'test':'default',0,'dispute','local-series-review-'+hold,f.viewer.id,'open');const before=state();const result=await request(quoteRoute(f),f.viewer,undefined,423);assert.equal(result.data.error.code,'PAYMENT_REVIEW_REQUIRED');assert.equal((await buy(f,q,f.viewer,423)).error.code,'PAYMENT_REVIEW_REQUIRED');assert.deepEqual(state(),before);}
});

test('saved per-episode receipts survive restart, while episodes uploaded later require their own fresh quote and purchase',async()=>{
  const f=fixture([1,3]),q=await quote(f);await buy(f,q);const before=state();db.exec(DATABASE_SCHEMA);createApp();const reopened=new DatabaseSync(path.join(directory,'platform.sqlite'));try{reopened.exec('PRAGMA foreign_keys=ON;');assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM purchases WHERE user_id=?').get(f.viewer.id)!.n,2);assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}assert.deepEqual(state(),before);assert.equal((await quote(f)).episode_count,0);
  const future=append(f,8),oldProofs=all('SELECT * FROM purchases WHERE user_id=? ORDER BY rowid',f.viewer.id),beforeStale=state(),stale=await buy(f,q,f.viewer,409);assert.equal(stale.error.code,'UNLOCK_QUOTE_CHANGED');assert.deepEqual(state(),beforeStale);const next=await quote(f);assert.deepEqual(next.episode_ids,[future]);assert.equal(next.total_micros,110000);await buy(f,next);assert.equal(one('SELECT COUNT(*) AS n FROM purchases WHERE user_id=?',f.viewer.id)!.n,3);assert.deepEqual(all('SELECT * FROM purchases WHERE user_id=? ORDER BY rowid LIMIT 2',f.viewer.id),oldProofs);assert.equal(one('SELECT 1 FROM lucky_draw_results WHERE user_id=?',f.viewer.id),undefined);
});

test('a single-episode price increase rejects the displayed price without writes, then a reviewed retry pays once in the selected mode',async()=>{
  for(const testMode of [false,true]){
    const f=fixture([1,2],0,false,35),table=testMode?'test_purchases':'purchases',historical=receipt(f,f.ids[0],table);config.stripeTestMode=testMode;
    const displayed=(await request('/api/series/'+f.id,f.viewer)).data.series.price_cents;assert.equal(displayed,35);run('UPDATE series SET price_cents=51 WHERE id=?',f.id);const before=state(),route='/api/episodes/'+f.ids[1]+'/unlock';
    const rejected=await request(route,f.viewer,{expected_price_cents:displayed},409);assert.equal(rejected.data.error.code,'EPISODE_PRICE_CHANGED');assert.deepEqual(state(),before);assert.throws(()=>finance.unlockEpisode(f.viewer.id,f.ids[1],displayed),{status:409,code:'EPISODE_PRICE_CHANGED'});assert.deepEqual(state(),before);
    const reviewed=(await request('/api/series/'+f.id,f.viewer)).data.series.price_cents,result=(await request(route,f.viewer,{expected_price_cents:reviewed})).data;assert.equal(reviewed,51);assert.equal(result.paid_micros,510000);assert.equal(result.creator_micros,357000);assert.equal(result.platform_micros,153000);assertReceipts(f,[f.ids[1]],51,table);assert.deepEqual(one('SELECT * FROM '+table+' WHERE id=?',historical.id),historical);assert.equal(accountBalance(f.viewer.id,testMode).wallet_micros,20_000_000-510000);assert.equal(accountBalance(f.viewer.id,!testMode).wallet_micros,20_000_000);
    run('UPDATE series SET price_cents=100 WHERE id=?',f.id);const beforeReplay=state(),replay=(await request(route,f.viewer,{expected_price_cents:displayed})).data;assert.equal(replay.alreadyUnlocked,true);assert.equal(replay.paid_micros??0,0);assert.deepEqual(state(),beforeReplay);assert.deepEqual(one('SELECT * FROM '+table+' WHERE id=?',historical.id),historical);
  }
});

test('single-price acknowledgements validate bounded integer cents while missing fields and legacy unknown fields retain compatibility',async()=>{
  for(const testMode of [false,true]){
    const f=fixture([1,2],0,false,51);config.stripeTestMode=testMode;const route='/api/episodes/'+f.ids[0]+'/unlock',before=state();
    for(const expected_price_cents of ['51',51.5,null,9,101,{},[]])await request(route,f.viewer,{expected_price_cents},400);assert.deepEqual(state(),before);
    const absent=(await request(route,f.viewer,undefined,200,'POST')).data;assert.equal(absent.paid_micros,510000);const legacy=(await request('/api/episodes/'+f.ids[1]+'/unlock',f.viewer,{price_cents:1,amount_cents:1,discount:100,unit_price_micros:0})).data;assert.equal(legacy.paid_micros,510000);assertReceipts(f,f.ids,51,testMode?'test_purchases':'purchases');
    const capped=fixture([1],0,false,501),accepted=(await request('/api/episodes/'+capped.ids[0]+'/unlock',capped.viewer,{expected_price_cents:100})).data;assert.equal(accepted.paid_micros,1_000_000);assertReceipts(capped,capped.ids,100,testMode?'test_purchases':'purchases');
  }
});

test('a valid older single-episode price never charges free episodes, their creator or a Lucky Draw winner',async()=>{
  const f=fixture([1,2,3],1,true,51),winner=actor();award(f,winner);const before=state();
  for(const testMode of [false,true]){
    config.stripeTestMode=testMode;for(const[buyer,episodeId]of [[f.viewer,f.ids[0]],[f.viewer,f.ids[2]],[f.owner,f.ids[1]],[winner,f.ids[1]]] as const){const result=(await request('/api/episodes/'+episodeId+'/unlock',buyer,{expected_price_cents:10})).data;assert.equal(result.alreadyUnlocked,true);assert.equal(result.paid_micros??0,0);}
  }assert.deepEqual(state(),before);
});
