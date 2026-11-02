import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectStripeSettings} from '../shared/stripe-settings';
import {config as worker,configure} from '../cloudflare/config';
import type {Env} from '../cloudflare/runtime';

const live={STRIPE_SECRET_KEY:'rk_live_saved_fixture_only',STRIPE_WEBHOOK_SECRET:'whsec_saved_live_fixture',STRIPE_ACTIVATION_PRICE_ID:'price_live_fixture',STRIPE_WALLET_PRODUCT_ID:'prod_live_fixture'};
const testPair={STRIPE_TEST_SECRET_KEY:'rk_test_saved_fixture_only',STRIPE_TEST_WEBHOOK_SECRET:'whsec_saved_test_fixture'};
const dir=await mkdtemp(path.join(tmpdir(),'lingying-mode-settings-'));
after(async()=>{await rm(dir,{recursive:true,force:true});});

test('one switch selects the saved pair and retains the inactive credentials unchanged',()=>{
  const env={...live,...testPair};
  const launch=selectStripeSettings(env,false),testing=selectStripeSettings(env,true);
  assert.equal(launch.stripeKey,live.STRIPE_SECRET_KEY);assert.equal(launch.stripeWebhook,live.STRIPE_WEBHOOK_SECRET);
  assert.equal(testing.stripeKey,testPair.STRIPE_TEST_SECRET_KEY);assert.equal(testing.stripeWebhook,testPair.STRIPE_TEST_WEBHOOK_SECRET);
  for(const selected of [launch,testing]){
    assert.equal(selected.stripeLiveKey,live.STRIPE_SECRET_KEY);assert.equal(selected.stripeLiveWebhook,live.STRIPE_WEBHOOK_SECRET);
    assert.equal(selected.stripeTestKey,testPair.STRIPE_TEST_SECRET_KEY);assert.equal(selected.stripeTestWebhook,testPair.STRIPE_TEST_WEBHOOK_SECRET);
  }
  assert.equal(launch.stripeActivationPriceId,live.STRIPE_ACTIVATION_PRICE_ID);assert.equal(launch.stripeWalletProductId,live.STRIPE_WALLET_PRODUCT_ID);
  assert.equal(testing.stripeActivationPriceId,'');assert.equal(testing.stripeWalletProductId,'');
  assert.deepEqual(env,{...live,...testPair});
});

test('missing or partial dedicated test pairs cannot borrow either live credential',()=>{
  for(const patch of [{},{STRIPE_TEST_SECRET_KEY:testPair.STRIPE_TEST_SECRET_KEY},{STRIPE_TEST_WEBHOOK_SECRET:testPair.STRIPE_TEST_WEBHOOK_SECRET},{STRIPE_TEST_SECRET_KEY:'',STRIPE_TEST_WEBHOOK_SECRET:''}]){
    const selected=selectStripeSettings({...live,...patch},true);
    assert.notEqual(selected.stripeKey,live.STRIPE_SECRET_KEY);assert.notEqual(selected.stripeWebhook,live.STRIPE_WEBHOOK_SECRET);
    assert.ok(!selected.stripeKey||!selected.stripeWebhook,'An incomplete test pair remains incomplete.');
  }
});

test('invalid mode text fails closed without losing either saved pair',()=>{
  for(const value of ['TRUE','FALSE','test','production','1',' true ','0']){
    const selected=selectStripeSettings({...live,...testPair,STRIPE_TEST_MODE:value},false);
    assert.equal(selected.stripeKey,'');assert.equal(selected.stripeWebhook,'');
    assert.equal(selected.stripeLiveKey,live.STRIPE_SECRET_KEY);assert.equal(selected.stripeTestKey,testPair.STRIPE_TEST_SECRET_KEY);
    configure({...live,...testPair,STRIPE_TEST_MODE:value,ENVIRONMENT:'production',PAYMENTS_MODE:'stripe'} as Env);
    assert.equal(worker.stripeKey,'');assert.equal(worker.stripeWebhook,'');
  }
  for(const value of [undefined,'','false'])assert.equal(selectStripeSettings({...live,...testPair,STRIPE_TEST_MODE:value},false).stripeKey,live.STRIPE_SECRET_KEY);
});

test('dedicated test catalogue IDs are optional and never fall back to the live catalogue',()=>{
  const selected=selectStripeSettings({...live,...testPair,STRIPE_TEST_ACTIVATION_PRICE_ID:'price_test_fixture',STRIPE_TEST_WALLET_PRODUCT_ID:'prod_test_fixture'},true);
  assert.equal(selected.stripeActivationPriceId,'price_test_fixture');assert.equal(selected.stripeWalletProductId,'prod_test_fixture');
  const partial=selectStripeSettings({...live,...testPair,STRIPE_TEST_ACTIVATION_PRICE_ID:'price_test_fixture'},true);
  assert.equal(partial.stripeActivationPriceId,'price_test_fixture');assert.equal(partial.stripeWalletProductId,'');
});

test('legacy isolated test pairs work only when the original API key is explicitly test-prefixed',()=>{
  const legacy={STRIPE_SECRET_KEY:'sk_test_legacy_fixture',STRIPE_WEBHOOK_SECRET:'whsec_legacy_fixture',STRIPE_ACTIVATION_PRICE_ID:'price_legacy_test',STRIPE_WALLET_PRODUCT_ID:'prod_legacy_test'};
  const selected=selectStripeSettings(legacy,true);assert.equal(selected.stripeKey,legacy.STRIPE_SECRET_KEY);assert.equal(selected.stripeWebhook,legacy.STRIPE_WEBHOOK_SECRET);assert.equal(selected.stripeActivationPriceId,'price_legacy_test');
  const partial=selectStripeSettings({...legacy,STRIPE_TEST_SECRET_KEY:testPair.STRIPE_TEST_SECRET_KEY},true);assert.equal(partial.stripeWebhook,'');
  const explicitlyBlank=selectStripeSettings({...legacy,STRIPE_TEST_SECRET_KEY:''},true);assert.equal(explicitlyBlank.stripeKey,'');assert.equal(explicitlyBlank.stripeWebhook,'');
  const noFallback=selectStripeSettings({...legacy,STRIPE_SECRET_KEY:'not_a_test_key'},true);assert.equal(noFallback.stripeKey,'');assert.equal(noFallback.stripeWebhook,'');
});

test('Cloudflare configuration applies both switch directions with automation left enabled',()=>{
  const env={...live,...testPair,ENVIRONMENT:'production',PAYMENTS_MODE:'stripe',PAYOUTS_ENABLED:'false',STRIPE_AUTO_CONFIGURE_WEBHOOK:'true',STRIPE_TEST_MODE:'true',APP_URL:'https://lingyingdrama.com'} as Env;
  configure(env);assert.equal(worker.stripeTestMode,true);assert.equal(worker.stripeKey,testPair.STRIPE_TEST_SECRET_KEY);assert.equal(worker.stripeWebhook,testPair.STRIPE_TEST_WEBHOOK_SECRET);assert.equal(worker.stripeAutoConfigureWebhook,true);assert.equal(worker.payoutsEnabled,false);assert.equal(worker.stripeActivationPriceId,'');
  configure({...env,STRIPE_TEST_MODE:'false'});assert.equal(worker.stripeTestMode,false);assert.equal(worker.stripeKey,live.STRIPE_SECRET_KEY);assert.equal(worker.stripeWebhook,live.STRIPE_WEBHOOK_SECRET);assert.equal(worker.stripeActivationPriceId,live.STRIPE_ACTIVATION_PRICE_ID);
  configure({...env,STRIPE_TEST_SECRET_KEY:undefined,STRIPE_TEST_WEBHOOK_SECRET:undefined});assert.equal(worker.stripeKey,'');assert.equal(worker.stripeWebhook,'');assert.equal(worker.stripeLiveKey,live.STRIPE_SECRET_KEY);
});

test('standalone Node configuration selects the same dedicated pair without consuming live credentials',async()=>{
  process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.STRIPE_TEST_MODE='true';
  Object.assign(process.env,live,testPair);
  const{config}=await import('../server/config');
  assert.equal(config.stripeKey,testPair.STRIPE_TEST_SECRET_KEY);assert.equal(config.stripeWebhook,testPair.STRIPE_TEST_WEBHOOK_SECRET);assert.equal(config.stripeLiveKey,live.STRIPE_SECRET_KEY);assert.equal(config.stripeActivationPriceId,'');
});
