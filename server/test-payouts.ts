import crypto from 'node:crypto';
import express,{type Express,type Request} from 'express';
import Stripe from 'stripe';
import {z} from 'zod';
import {config} from './config.js';
import {one,all,run,transaction} from './db.js';
import {requireAuth,rateLimit} from './auth.js';
import {AppError,assert} from './errors.js';
import {adminTestPayoutAccess,TEST_PAYOUT_PLATFORM} from './test-payout-access.js';
import {WITHDRAWAL_POLICY} from '../shared/withdrawals.js';
import {TEST_PAYOUT_MAX_CENTS,type TestPayoutRequest} from '../shared/test-payouts.js';

interface Row extends TestPayoutRequest {
  user_id:string;platform_id:string;connected_account_id:string;request_key:string;
  funding_amount:number;funding_charge_id:string|null;destination_payment:string|null;
  first_attempt_ms:number|null;lease_token:string|null;lease_until_ms:number;
}
let client:Stripe|undefined,clientKey='';
export function testPayoutClient(){
  assert(/^(sk|rk)_test_/.test(config.stripeTestKey),503,'TEST_PAYOUT_KEY_REQUIRED','A dedicated Stripe sandbox API key is required.');
  if(!client||clientKey!==config.stripeTestKey){clientKey=config.stripeTestKey;client=new Stripe(clientKey,{httpClient:Stripe.createFetchHttpClient(),timeout:15000,maxNetworkRetries:1});}
  return client;
}
function owner(req:Request){assert(adminTestPayoutAccess(req.user),403,'TEST_PAYOUT_FORBIDDEN','Sandbox withdrawals are available only to the platform owner administrator in Stripe test mode.');}
const row=(id:string)=>one<Row>('SELECT * FROM admin_test_withdrawals WHERE id=?',id);
function publicRow(r:Row):TestPayoutRequest{
  const {id,gross_cents,fee_cents,net_cents,currency,provider_amount,exchange_rate,status,transfer_id,payout_id,error_code,created_at,updated_at}=r;
  return{id,gross_cents,fee_cents,net_cents,currency,provider_amount,exchange_rate,status,transfer_id,payout_id,error_code,created_at,updated_at};
}
function event(id:string,kind:string){run('INSERT INTO admin_test_withdrawal_events (id,withdrawal_id,kind) VALUES (?,?,?)',crypto.randomUUID(),id,kind);}
async function remote<T>(stage:string,fn:()=>Promise<T>):Promise<T>{
  try{return await fn();}catch(error){
    if(error instanceof AppError)throw error;
    const denied=(error as any)?.statusCode===403;
    const permission:Record<string,string>={account:'Accounts Read',balance:'Balance Read',funding:'Charges Write',transfer:'Transfers Write',payout:'Payouts Read/Write',reconcile:'Payouts and Balance transactions Read'};
    throw new AppError(503,denied?'TEST_PAYOUT_PERMISSION_REQUIRED':'TEST_PAYOUT_PROVIDER_UNAVAILABLE',denied?`Stripe sandbox access was denied. Enable ${permission[stage]||'the required read permission'} on the test API key.`:`Stripe sandbox ${stage} could not complete. Refresh this request before retrying; its saved amounts and retry key are retained.`);
  }
}
async function context(destination=config.testPayoutAccount,requireReady=true){
  assert(/^acct_[A-Za-z0-9]+$/.test(destination)&&destination!==TEST_PAYOUT_PLATFORM,503,'TEST_PAYOUT_ACCOUNT_REQUIRED','Configure the administrator sandbox connected account.');
  const stripe=testPayoutClient();
  const platform=await remote('account',()=>stripe.accounts.retrieve());
  assert(platform.id===TEST_PAYOUT_PLATFORM,503,'TEST_PAYOUT_PLATFORM_MISMATCH','The test API key belongs to a different Stripe sandbox.');
  const account=await remote('account',()=>stripe.accounts.retrieve(destination));
  assert(account.id===destination,503,'TEST_PAYOUT_ACCOUNT_MISMATCH','The sandbox connected account does not match.');
  const ready=account.capabilities?.transfers==='active'&&account.payouts_enabled===true;
  if(requireReady)assert(ready,409,'TEST_PAYOUT_ACCOUNT_NOT_READY','Complete the connected account verification and payout setup in this sandbox.');
  const currency=account.default_currency;
  assert(currency==='usd'||currency==='hkd',409,'TEST_PAYOUT_CURRENCY_UNSUPPORTED','The administrator test account must pay out in USD or HKD.');
  return{stripe,account,currency,destination,ready};
}
function ownedRow(req:Request){
  const r=row(String(req.params.id));
  assert(r&&r.user_id===req.user!.id&&r.platform_id===TEST_PAYOUT_PLATFORM&&r.connected_account_id===config.testPayoutAccount,404,'NOT_FOUND','Sandbox withdrawal not found.');
  return r;
}
function assertTestObject(livemode:unknown){assert(livemode===false,409,'TEST_PAYOUT_MODE_MISMATCH','Stripe returned an unexpected payment mode. No live object may settle a sandbox withdrawal.');}
const metadata=(r:Row)=>({app:'lingying',testWithdrawalId:r.id,platformId:r.platform_id});
function validateTransfer(t:Stripe.Transfer,r:Row){
  assertTestObject(t.livemode);
  const destination=typeof t.destination==='string'?t.destination:t.destination?.id;
  assert(t.amount===r.provider_amount&&t.currency===r.currency&&destination===r.connected_account_id&&t.metadata.testWithdrawalId===r.id&&!t.reversed,409,'TEST_PAYOUT_TRANSFER_MISMATCH','The sandbox transfer does not match this request.');
}
function savePayout(p:Stripe.Payout,r:Row,automatic=false){
  assertTestObject(p.livemode);
  assert(p.currency===r.currency&&(automatic||p.amount===r.provider_amount&&p.metadata?.testWithdrawalId===r.id),409,'TEST_PAYOUT_BANK_MISMATCH','The bank payout does not match this sandbox withdrawal.');
  const status=p.status==='paid'?'paid':['failed','canceled'].includes(p.status)?'failed':'payout_pending';
  run("UPDATE admin_test_withdrawals SET payout_id=?,status=?,error_code=?,updated_at=datetime('now') WHERE id=?",p.id,status,status==='failed'?'TEST_BANK_PAYOUT_FAILED':'',r.id);
}
async function existingPayout(stripe:Stripe,r:Row){
  if(r.payout_id){
    const payout=await remote('payout',()=>stripe.payouts.retrieve(r.payout_id!,{},{stripeAccount:r.connected_account_id}));
    // Automatic batch payouts were already correlated by their balance entries.
    savePayout(payout,r,payout.automatic);return payout;
  }
  if(!r.transfer_id)return;
  const payouts=await remote('reconcile',()=>stripe.payouts.list({limit:20,created:{gte:Math.floor((r.first_attempt_ms||Date.now())/1000)-60}},{stripeAccount:r.connected_account_id}));
  for(const payout of payouts.data){
    if(payout.metadata?.testWithdrawalId===r.id){savePayout(payout,r);return payout;}
    if(!payout.automatic||!r.destination_payment)continue;
    const entries=await remote('reconcile',()=>stripe.balanceTransactions.list({payout:payout.id,limit:100},{stripeAccount:r.connected_account_id}));
    if(entries.data.some(entry=>(typeof entry.source==='string'?entry.source:entry.source?.id)===r.destination_payment)){savePayout(payout,r,true);return payout;}
    assert(!entries.has_more,409,'TEST_PAYOUT_RECONCILIATION_REQUIRED','This bank payout needs further reconciliation before another payout can be created.');
  }
  assert(!payouts.has_more,409,'TEST_PAYOUT_RECONCILIATION_REQUIRED','Older sandbox payouts need reconciliation before this request can continue.');
}
async function processRequest(initial:Row){
  const lease=crypto.randomUUID(),now=Date.now();
  transaction(()=>{
    const current=row(initial.id)!;
    assert(!['paid','failed','rejected'].includes(current.status),409,'TEST_PAYOUT_CLOSED','This sandbox request is already closed.');
    assert(current.lease_until_ms<=now,409,'TEST_PAYOUT_PROCESSING','This request is already processing. Refresh its status.');
    assert(current.first_attempt_ms===null||now-current.first_attempt_ms<23*60*60_000,409,'TEST_PAYOUT_RECONCILIATION_REQUIRED','This older request needs reconciliation in Stripe before a new payout is attempted.');
    run("UPDATE admin_test_withdrawals SET lease_token=?,lease_until_ms=?,error_code='',updated_at=datetime('now') WHERE id=?",lease,now+120_000,initial.id);
  });
  try{
    const {stripe,account}=await context(initial.connected_account_id);
    let r=row(initial.id)!;
    if(!r.transfer_id){
      run("UPDATE admin_test_withdrawals SET status='processing',first_attempt_ms=COALESCE(first_attempt_ms,?),updated_at=datetime('now') WHERE id=?",Date.now(),r.id);
      r=row(r.id)!;
      const balance=await remote('balance',()=>stripe.balance.retrieve());assertTestObject(balance.livemode);
      const available=balance.available.find(b=>b.currency===r.currency)?.amount||0;
      if(available<r.provider_amount){
        // This fixed Stripe fixture token is usable only with a sandbox key.
        // It replenishes provider test funds; no wallet or earnings are credited.
        const charge=await remote('funding',()=>stripe.charges.create({amount:r.funding_amount,currency:r.currency,source:'tok_bypassPending',description:'LingYing administrator sandbox withdrawal funding',metadata:metadata(r)},{idempotencyKey:`test-withdrawal:fund:${r.id}`}));
        assertTestObject(charge.livemode);
        assert(charge.paid&&charge.status==='succeeded'&&charge.amount===r.funding_amount&&charge.currency===r.currency,409,'TEST_PAYOUT_FUNDING_MISMATCH','The sandbox funding simulation did not succeed.');
        run('UPDATE admin_test_withdrawals SET funding_charge_id=? WHERE id=?',charge.id,r.id);
      }
      const transfer=await remote('transfer',()=>stripe.transfers.create({amount:r.provider_amount,currency:r.currency,destination:r.connected_account_id,metadata:metadata(r)},{idempotencyKey:`test-withdrawal:transfer:${r.id}`}));
      validateTransfer(transfer,r);
      const payment=typeof transfer.destination_payment==='string'?transfer.destination_payment:(transfer.destination_payment as any)?.id||null;
      transaction(()=>{run("UPDATE admin_test_withdrawals SET transfer_id=?,destination_payment=?,status='transferred',updated_at=datetime('now') WHERE id=?",transfer.id,payment,r.id);event(r.id,'test_transfer_created');});
      r=row(r.id)!;
    }else{
      const transfer=await remote('transfer',()=>stripe.transfers.retrieve(r.transfer_id!));validateTransfer(transfer,r);
    }
    if(!await existingPayout(stripe,r)){
      // Use the recipient's already configured bank currency. USD amounts and
      // the indicative test-only conversion were frozen when requested.
      const bank=account.external_accounts?.data.find(b=>b.object==='bank_account'&&b.currency===r.currency&&b.default_for_currency);
      assert(bank,409,'TEST_PAYOUT_BANK_REQUIRED','Add a test bank account in the withdrawal currency before sending the bank payout.');
      const payout=await remote('payout',()=>stripe.payouts.create({amount:r.provider_amount,currency:r.currency,destination:bank.id,method:'standard',metadata:metadata(r)},{stripeAccount:r.connected_account_id,idempotencyKey:`test-withdrawal:bank:${r.id}`}));
      transaction(()=>{savePayout(payout,r);event(r.id,'test_bank_payout_created');});
    }
  }catch(error){
    run("UPDATE admin_test_withdrawals SET error_code=?,updated_at=datetime('now') WHERE id=?",error instanceof AppError?error.code:'TEST_PAYOUT_PROVIDER_UNAVAILABLE',initial.id);
    throw error;
  }finally{run('UPDATE admin_test_withdrawals SET lease_token=NULL,lease_until_ms=0 WHERE id=? AND lease_token=?',initial.id,lease);}
  return row(initial.id)!;
}

export function registerTestPayoutRoutes(app:Express){
  app.get('/api/studio/test-withdrawals',requireAuth,async(req,res)=>{
    owner(req);const setup=await context(config.testPayoutAccount,false);
    res.json({unlimited:true,connectedAccount:setup.destination,platformAccount:TEST_PAYOUT_PLATFORM,ready:setup.ready,currency:setup.currency,exchangeRate:setup.currency==='usd'?1:config.usdToHkd,minimumCents:WITHDRAWAL_POLICY.minimumCents,feeCents:WITHDRAWAL_POLICY.feeCents,maxCents:TEST_PAYOUT_MAX_CENTS,
      requests:all<Row>('SELECT * FROM admin_test_withdrawals WHERE user_id=? AND platform_id=? AND connected_account_id=? ORDER BY rowid DESC LIMIT 50',req.user!.id,TEST_PAYOUT_PLATFORM,setup.destination).map(publicRow)});
  });
  app.post('/api/studio/test-withdrawals',requireAuth,rateLimit('admin-test-withdrawal',30,60_000),async(req,res)=>{
    owner(req);const body=z.object({amount_cents:z.number().int().min(WITHDRAWAL_POLICY.minimumCents).max(TEST_PAYOUT_MAX_CENTS),request_key:z.uuid()}).strict().parse(req.body);
    const setup=await context();
    const exchange=setup.currency==='usd'?1:config.usdToHkd;
    assert(Number.isFinite(exchange)&&exchange>0,503,'TEST_PAYOUT_RATE_INVALID','The test exchange rate is invalid.');
    const net=body.amount_cents-WITHDRAWAL_POLICY.feeCents,amount=Math.round(net*exchange),funding=Math.ceil(amount*1.2)+1000;
    assert(Number.isSafeInteger(amount)&&amount>0&&funding<=99_999_999,400,'TEST_PAYOUT_AMOUNT_LIMIT','This amount exceeds the supported sandbox payout limit.');
    const result=transaction(()=>{
      const previous=one<Row>('SELECT * FROM admin_test_withdrawals WHERE user_id=? AND platform_id=? AND request_key=?',req.user!.id,TEST_PAYOUT_PLATFORM,body.request_key);
      if(previous){assert(previous.gross_cents===body.amount_cents&&previous.connected_account_id===setup.destination,409,'TEST_PAYOUT_REQUEST_CONFLICT','This request key belongs to different withdrawal details.');return previous;}
      const id=crypto.randomUUID();
      run('INSERT INTO admin_test_withdrawals (id,user_id,platform_id,connected_account_id,request_key,gross_cents,fee_cents,net_cents,currency,provider_amount,exchange_rate,policy_version,funding_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,req.user!.id,TEST_PAYOUT_PLATFORM,setup.destination,body.request_key,body.amount_cents,WITHDRAWAL_POLICY.feeCents,net,setup.currency,amount,exchange,WITHDRAWAL_POLICY.version,funding);
      event(id,'unlimited_admin_test_request');return row(id)!;
    });
    res.status(201).json({request:publicRow(result)});
  });
  app.post('/api/studio/test-withdrawals/:id/process',requireAuth,async(req,res)=>{owner(req);res.json({request:publicRow(await processRequest(ownedRow(req)))});});
  app.post('/api/studio/test-withdrawals/:id/sync',requireAuth,async(req,res)=>{
    owner(req);const r=ownedRow(req);const {stripe}=await context(r.connected_account_id,false);
    await existingPayout(stripe,r);res.json({request:publicRow(row(r.id)!)});
  });
  app.post('/api/studio/test-withdrawals/:id/reject',requireAuth,(req,res)=>{
    owner(req);const r=ownedRow(req);
    transaction(()=>{const current=row(r.id)!;assert(current.status==='pending'&&current.lease_until_ms<=Date.now(),409,'TEST_PAYOUT_PROCESSING','Only an unprocessed test request can be rejected.');run("UPDATE admin_test_withdrawals SET status='rejected',updated_at=datetime('now') WHERE id=?",r.id);event(r.id,'test_request_rejected');});
    res.json({request:publicRow(row(r.id)!)});
  });
}

export function registerTestPayoutWebhook(app:Express){
  app.post('/api/test-payouts/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
    assert(config.testConnectWebhook.startsWith('whsec_'),503,'TEST_CONNECT_WEBHOOK_REQUIRED','The test Connect webhook is not configured.');
    const stripe=testPayoutClient();let delivery:Stripe.Event;
    try{delivery=await stripe.webhooks.constructEventAsync(req.body,req.headers['stripe-signature'] as string,config.testConnectWebhook);}catch{throw new AppError(400,'INVALID_SIGNATURE','Invalid test Connect signature.');}
    assertTestObject(delivery.livemode);
    if(!delivery.account||!['account.updated','payout.created','payout.updated','payout.paid','payout.failed','payout.canceled'].includes(delivery.type)){res.json({received:true,ignored:true});return;}
    if(one('SELECT 1 FROM admin_test_payout_receipts WHERE event_id=?',delivery.id)){res.json({received:true});return;}
    const requests=all<Row>("SELECT * FROM admin_test_withdrawals WHERE platform_id=? AND connected_account_id=? AND transfer_id IS NOT NULL AND status<>'rejected' ORDER BY rowid DESC LIMIT 100",TEST_PAYOUT_PLATFORM,delivery.account);
    if(requests.length){
      const setup=await context(delivery.account,false);
      for(const r of requests)await existingPayout(setup.stripe,r);
    }else if(delivery.account!==config.testPayoutAccount){res.json({received:true,ignored:true});return;}
    run('INSERT OR IGNORE INTO admin_test_payout_receipts (event_id,connected_account_id,event_type) VALUES (?,?,?)',delivery.id,delivery.account,delivery.type);
    res.json({received:true});
  });
}
