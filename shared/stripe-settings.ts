/** Server-only inputs. Never serialize the result into public configuration. */
export interface StripeEnvironment {
  STRIPE_TEST_MODE?:string;
  STRIPE_SECRET_KEY?:string;
  STRIPE_WEBHOOK_SECRET?:string;
  STRIPE_ACTIVATION_PRICE_ID?:string;
  STRIPE_WALLET_PRODUCT_ID?:string;
  STRIPE_TEST_SECRET_KEY?:string;
  STRIPE_TEST_WEBHOOK_SECRET?:string;
  STRIPE_TEST_ACTIVATION_PRICE_ID?:string;
  STRIPE_TEST_WALLET_PRODUCT_ID?:string;
}

/** Keep both modes saved, but select credentials and catalogue as one unit. */
export function selectStripeSettings(env:StripeEnvironment,testMode:boolean){
  const modeValid=env.STRIPE_TEST_MODE===undefined||env.STRIPE_TEST_MODE===''||env.STRIPE_TEST_MODE==='true'||env.STRIPE_TEST_MODE==='false';
  const originalKey=env.STRIPE_SECRET_KEY||'',originalWebhook=env.STRIPE_WEBHOOK_SECRET||'';
  // A partial dedicated pair must not borrow either value from the live pair.
  const dedicatedTest=env.STRIPE_TEST_SECRET_KEY!==undefined||env.STRIPE_TEST_WEBHOOK_SECRET!==undefined;
  const legacyTest=!dedicatedTest&&/^(sk|rk)_test_/.test(originalKey);
  const testKey=dedicatedTest?env.STRIPE_TEST_SECRET_KEY||'':legacyTest?originalKey:'';
  const testWebhook=dedicatedTest?env.STRIPE_TEST_WEBHOOK_SECRET||'':legacyTest?originalWebhook:'';
  const liveActivation=env.STRIPE_ACTIVATION_PRICE_ID||'',liveWallet=env.STRIPE_WALLET_PRODUCT_ID||'';
  // Dedicated testing uses dedicated IDs or inline pricing. Never select live IDs.
  const testActivation=env.STRIPE_TEST_ACTIVATION_PRICE_ID??(legacyTest?liveActivation:'');
  const testWallet=env.STRIPE_TEST_WALLET_PRODUCT_ID??(legacyTest?liveWallet:'');
  return{
    // A typo in the launch/test switch pauses new Checkout instead of charging live.
    stripeKey:modeValid?(testMode?testKey:originalKey):'',
    stripeWebhook:modeValid?(testMode?testWebhook:originalWebhook):'',
    stripeActivationPriceId:testMode?testActivation:liveActivation,
    stripeWalletProductId:testMode?testWallet:liveWallet,
    stripeLiveKey:originalKey,
    stripeLiveWebhook:originalWebhook,
    stripeTestKey:testKey,
    stripeTestWebhook:testWebhook,
    stripeLiveActivationPriceId:liveActivation,
    stripeLiveWalletProductId:liveWallet,
    stripeTestActivationPriceId:testActivation,
    stripeTestWalletProductId:testWallet,
  };
}
