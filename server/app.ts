import {registerWechatAuth,wechatAuthEnabled} from './wechat-auth.js';
import {registerSearchDiscovery} from './search-discovery.js';
import {wechatPayEnabled,createWechatFundingQuote} from './wechat-pay.js';
import {episodeFreeSql,lastEpisodeFreeSchema,seriesLastEpisodeFree,writeSeriesLastEpisodeFree,seriesFreeEpisodeCount} from './episode-access.js';
import {getOwnerStorage,withinStorageQuota} from './storage-quota.js';
import { upload, coverUpload } from './uploads.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { z, ZodError } from 'zod';
import { config } from './config.js';
import {apiUrl,publicAppUrl,stripeSiteOrigin,trustedOrigins,credentialedCors} from './origins.js';
import { registerGoogleAuth,googleEnabled } from './google.js';
import {registerAppleAuth,appleEnabled} from './apple.js';
import {registerEmailAuth,emailAuthEnabled,sendRegistrationVerification} from './email-auth.js';
import { one, all, run, transaction } from './db.js';
import { AppError, assert } from './errors.js';
import { readSession, requireAuth, requirePublisher, requireAdmin, hashPassword, verifyPassword, createSession, destroySession, getUser, rateLimit } from './auth.js';
import { prepareVideo, prepareCover, putObject, serveObject, removeTempFile } from './storage.js';
import { createCheckout, cancelCheckout, settlePayment, unlockEpisode, requestWithdrawal,returnWithdrawalFunds, addLedger, stripe,paymentsReady,stripeConfigured,stripeModeMatches,stripeTestPayments,assertPayoutsEnabled } from './finance.js';
import {requireCreatorPassConsent} from './creator-pass-consent.js';
import {LEGAL_POLICY_VERSION,CREATOR_PASS_DISCLOSURE_VERSION} from '../shared/creator-pass-consent.js';
import {processRiskEvent,recordPaymentLink,adminPaymentReviews,resolvePaymentReview,assertPaymentAccountClear} from './payment-risk.js';
import {ensurePlatformOwnerAccess,creatorDisplayName} from './owner.js';
import {publicSeriesAllowedSql,assertSeriesAvailable,assertSeriesWritable,moderationState,setSeriesModeration,setSeriesFeatured,recordSeriesMetadataEdit,adminModerationEvents,listAdminSeries} from './moderation.js';
import {ensureStripeWebhookReady,stripeWebhookReadiness} from './stripe-readiness.js';
import {runWithVerifiedStripeEventContext,type VerifiedStripeEventContext} from './stripe-event-context.js';
import { paymentTable,purchaseTable,ledgerTable,hasEpisodePurchase,usingTestPaymentState } from './payment-state.js';
import { startPlayback,recordPlayback,readSeriesAnalytics } from './analytics.js';
import {isSeriesDeleted,previewSeriesDeletion,deleteSeriesPermanently,cleanupSeriesMedia,queueUnreferencedSeriesMedia,assertSeriesLifecycleFinancialClear} from './series-lifecycle.js';
import {finishInBackground,scheduleMediaCleanup} from './background.js';
import { LANGUAGES, GENRES, MAX_EPISODE_BYTES, MAX_EPISODE_SECONDS, DEFAULT_QUOTA_BYTES,MIN_WALLET_FUNDING_CENTS,MAX_WALLET_FUNDING_CENTS,MIN_PRICE_CENTS,MAX_PRICE_CENTS } from '../shared/config.js';
import {SERIES_LIMITS} from '../shared/series-validation.js';
import {STANDARD_GENRES,STORY_THEMES,SERIES_FORMATS,CREATION_TYPES} from '../shared/taxonomy.js';
import {SERIES_ACCESS_FILTERS} from '../shared/catalog-access.js';
import {seriesAccessTypeSql,readSeriesAccessType} from './catalog-access.js';
import {initializePromotions,adminPromotions,createPromotion,updatePromotion,quotePromotion} from './promotions.js';
import {themesSchema,formatSchema,seriesClassification,writeSeriesClassification,SERIES_FORMAT_SQL} from './taxonomy.js';
import {registerEpisodeUploadSessions,chunkedEpisodeUploadsEnabled,EPISODE_UPLOAD_CHUNK_BYTES,reservedEpisodeUploadBytes,cleanupExpiredEpisodeUploads} from './episode-upload-sessions.js';
import {episodeDurationSql,legacyEpisodeDuration,writeEpisodeDuration} from './episode-duration.js';
import {episodeUploadLimits,assertEpisodeUploadDuration} from './episode-upload-policy.js';
import {responseSecurityHeaders} from '../shared/security-headers.js';
import {registerEpisodeBatch,episodeBatchRevision,assertEpisodeBatchWritable,deleteSingleEpisode} from './episode-batch.js';
import {WALLET_FUNDING_OPTIONS} from '../shared/funding-rewards.js';
import {WITHDRAWAL_POLICY} from '../shared/withdrawals.js';
import {withdrawalTerms,WITHDRAWAL_TERMS_SQL} from './withdrawal-terms.js';
import {registerTestPayoutRoutes,registerTestPayoutWebhook} from './test-payouts.js';
import {initializePublisherProfiles,registerPublisherProfiles,seriesPublisher,assignSeriesPublisher,publisherProfileIdSchema} from './publisher-profiles.js';
import {publisherNameSql} from './publisher-profile-sql.js';
import {coverAspectRatioSchema,seriesCoverAspectRatio,writeSeriesCoverLayout} from './cover-layout.js';
import {subtitleLanguagesSchema,seriesSubtitleLanguages,writeSeriesSubtitleLanguages} from './subtitle-languages.js';
import {applyEpisodePriceCap,episodePriceCents} from './episode-pricing.js';
import {SPOKEN_LANGUAGES,SPOKEN_LANGUAGE_CODES} from '../shared/spoken-languages.js';
import {seriesTitleAvailable,assertSeriesTitleAvailable} from './series-titles.js';

const language = z.enum(LANGUAGES.map(x => x.code) as [string, ...string[]]);
const spokenLanguage=z.enum(SPOKEN_LANGUAGE_CODES as [string,...string[]]);
const id = (req: Request, field = 'id') => String(req.params[field] || '');
const registration = z.object({ name: z.string().trim().min(2).max(60), email: z.email().max(254).transform(s => s.toLowerCase()), password: z.string().min(10).max(128), language: language.default('en') });
const seriesSchema = z.object({ title: z.string().trim().min(SERIES_LIMITS.titleMin).max(SERIES_LIMITS.titleMax), description: z.string().trim().min(SERIES_LIMITS.synopsisMin).max(SERIES_LIMITS.synopsisMax), language:spokenLanguage,
  genres: z.array(z.enum(GENRES)).min(SERIES_LIMITS.genresMin).max(SERIES_LIMITS.genresMax).refine(values=>new Set(values).size===values.length,'Choose each genre only once.'), creation_type: z.enum(CREATION_TYPES).default('human'),
  themes:themesSchema.optional(),format:formatSchema.optional(),publisher_profile_id:publisherProfileIdSchema,cover_aspect_ratio:coverAspectRatioSchema,subtitle_languages:subtitleLanguagesSchema,
  price_cents: z.number().int().min(SERIES_LIMITS.priceMin).max(SERIES_LIMITS.priceMax), free_episodes: z.number().int().min(SERIES_LIMITS.freeMin).max(SERIES_LIMITS.freeMax),last_episode_free:lastEpisodeFreeSchema,
});
function ownSeries(req: Request, seriesId = id(req)) {
  const s = one('SELECT * FROM series WHERE id=?', seriesId);
  assert(s&&!isSeriesDeleted(seriesId), 404, 'NOT_FOUND', 'Series not found.'); assert(s.creator_id === req.user!.id || req.user!.role==='admin', 403, 'FORBIDDEN', 'This series belongs to another publisher.'); return s;
}
function writableSeries(req:Request,seriesId=id(req)){
  const s=ownSeries(req,seriesId);if(req.user!.role!=='admin')assertSeriesWritable(seriesId);return s;
}
function ownerStorage(series:Record<string,any>){return getOwnerStorage(series.creator_id);}
const catalogSelect = `SELECT s.*,u.name AS creator_name,COALESCE(sp.published_at,s.created_at) AS published_at,
 (${seriesAccessTypeSql()}) AS access_type,
 (SELECT id FROM episodes e WHERE e.series_id=s.id ORDER BY number LIMIT 1) AS first_episode_id,
 (SELECT COUNT(*) FROM episodes e WHERE e.series_id=s.id) AS episode_count,
 (SELECT COUNT(*) FROM saves sv WHERE sv.series_id=s.id) AS saves,
 (SELECT COUNT(*) FROM series_likes sl WHERE sl.series_id=s.id) AS likes
 FROM series s JOIN users u ON u.id=s.creator_id LEFT JOIN series_publications sp ON sp.series_id=s.id`;
function serializeSeries(s: Record<string, any>, userId?: string, privateView=false) {
  const { cover_key, cover_bytes,creator_id,...safe } = s;
  const {publisher,publisher_profile_id}=seriesPublisher(s);
  const genres=JSON.parse(s.genres);
  return { ...safe,price_cents:episodePriceCents(s.price_cents),...(privateView?{creator_id}:{}),creator_name:publisher.display_name,publisher_id:publisher.id,publisher,publisher_profile_id,access_type:s.access_type===undefined?readSeriesAccessType(s.id):s.access_type,genres,...seriesClassification(s.id,genres),cover_aspect_ratio:seriesCoverAspectRatio(s.id),last_episode_free:seriesLastEpisodeFree(s.id),free_episode_count:seriesFreeEpisodeCount(s.id),subtitle_languages:seriesSubtitleLanguages(s.id),cover: cover_key?.startsWith('public:') ? cover_key.slice(7) : cover_key ? apiUrl(`/api/${privateView?'studio/series':'series'}/${s.id}/cover`) : '/images/placeholder.svg',
    ...(privateView?{taken_down:moderationState(s.id).taken_down,moderation_reason:moderationState(s.id).reason}:{}),
    likes:Number(s.likes??one('SELECT COUNT(*) AS n FROM series_likes WHERE series_id=?',s.id)!.n),
    liked:!!(userId&&one('SELECT 1 FROM series_likes WHERE user_id=? AND series_id=?',userId,s.id)),
    saved: !!(userId && one('SELECT 1 FROM saves WHERE user_id=? AND series_id=?', userId, s.id)) };
}
function canWatch(userId: string | undefined, e: any) { return !!e.free || e.creator_id === userId || !!(userId && hasEpisodePurchase(userId,e.id)); }
function episodeRow(episodeId: string) { return one(`SELECT e.*,${episodeDurationSql('e')} AS duration,${episodeFreeSql()} AS free,s.free_episodes,s.creator_id,s.status FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.id=?`, episodeId); }
function playbackViewer(req:Request,res:Response,create=false):string|undefined {
  if(req.user)return crypto.createHash('sha256').update('user:'+req.user.id).digest('hex');
  let token=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('drama_viewer='))?.slice('drama_viewer='.length);
  if(!token||!/^[a-f0-9]{48}$/.test(token)){
    if(!create)return undefined;
    token=crypto.randomBytes(24).toString('hex');
    res.cookie('drama_viewer',token,{httpOnly:true,secure:config.production,sameSite:'lax',path:'/',maxAge:30*24*60*60*1000});
  }
  return crypto.createHash('sha256').update('guest:'+token).digest('hex');
}

export function createApp() {
  applyEpisodePriceCap();
  ensurePlatformOwnerAccess();
  initializePublisherProfiles();
  if(one("SELECT 1 FROM series_media_deletions WHERE status='pending' LIMIT 1")||one("SELECT 1 FROM episode_upload_sessions WHERE status<>'complete' AND (status<>'cancelled' OR cleanup_pending=1) LIMIT 1"))void finishInBackground(scheduleMediaCleanup()).catch(()=>{});
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use((req, res, next) => { for(const[name,value]of Object.entries(responseSecurityHeaders(req.path)))res.setHeader(name,value); if(req.path==='/auth')res.setHeader('Cache-Control','no-store'); next(); });
  app.use('/api',credentialedCors);
  // The standalone server has no trusted country metadata. Local development
  // and unsupported locations show the exact HKD price without guessing.
  app.get('/api/display-currency',(_req,res)=>res.setHeader('Cache-Control','private, no-store').json({quote:{country:null,currency:'HKD',ratePerHkd:1,asOf:null}}));
  app.all('/api/display-currency',(_req,res)=>res.status(405).set({'Cache-Control':'private, no-store',Allow:'GET, HEAD'}).json({error:{code:'METHOD_NOT_ALLOWED'}}));
  registerTestPayoutWebhook(app);
  app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    // Check both saved pairs. The UI switch selects new Checkout, not which
    // already-issued payments or later refund/dispute events remain payable.
    const candidates:Array<{client:Stripe;secret:string;context:VerifiedStripeEventContext}>=[];
    if(stripe&&stripeConfigured())candidates.push({client:stripe,secret:config.stripeWebhook,context:{testState:usingTestPaymentState(),livemode:/^(sk|rk)_live_/.test(config.stripeKey),configured:true}});
    const addSaved=(key:string,secret:string,livemode:boolean)=>{
      if(!(livemode?/^(sk|rk)_live_/:/^(sk|rk)_test_/).test(key)||!secret.startsWith('whsec_'))return;
      if(candidates.some(candidate=>candidate.secret===secret&&candidate.context.livemode===livemode))return;
      candidates.push({client:new Stripe(key,{httpClient:Stripe.createFetchHttpClient()}),secret,context:{testState:!livemode,livemode,configured:true}});
    };
    // The legacy isolated sandbox must never start handling real-money events.
    if(!config.sandbox)addSaved(config.stripeLiveKey,config.stripeLiveWebhook,true);
    addSaved(config.stripeTestKey,config.stripeTestWebhook,false);
    assert(candidates.length,503,'PAYMENTS_UNAVAILABLE','Webhook is not configured.');
    let verified:{event:Stripe.Event;context:VerifiedStripeEventContext}|undefined,wrongMode=false;
    for(const candidate of candidates){
      let event:Stripe.Event;
      try{event=await candidate.client.webhooks.constructEventAsync(req.body,req.headers['stripe-signature'] as string,candidate.secret);}
      catch{continue;}
      if(event.livemode!==candidate.context.livemode){wrongMode=true;continue;}
      verified={event,context:candidate.context};break;
    }
    if(!verified){if(wrongMode){res.json({received:true,ignored:true});return;}throw new AppError(400,'INVALID_SIGNATURE','Invalid webhook signature.');}
    const verifiedEvent=verified.event;
    return runWithVerifiedStripeEventContext(verified.context,()=>{
      const risk=processRiskEvent(verifiedEvent);
      if(risk.handled){res.json({received:true,...risk});return;}
      const checkoutEvent=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','checkout.session.async_payment_failed'].includes(verifiedEvent.type);
      if(checkoutEvent){
        const session=verifiedEvent.data.object as Stripe.Checkout.Session;
        if(!stripeModeMatches(session.livemode)||session.metadata?.site&&session.metadata.site!==stripeSiteOrigin()){res.json({received:true,ignored:true});return;}
      }
      if (verifiedEvent.type === 'checkout.session.completed' || verifiedEvent.type === 'checkout.session.async_payment_succeeded') {
        const session = verifiedEvent.data.object;
        if(!stripeModeMatches(session.livemode)){res.json({received:true,ignored:true});return;}
        if(session.metadata?.site&&session.metadata.site!==stripeSiteOrigin()){res.json({received:true,ignored:true});return;}
        if (session.payment_status === 'paid' && session.metadata?.paymentId) {
          if(!one(`SELECT id FROM ${paymentTable()} WHERE id=?`,session.metadata.paymentId)){res.json({received:true,ignored:true});return;}
          settlePayment(session.metadata.paymentId, { amount: session.amount_total!, currency: session.currency!, session: session.id,livemode:session.livemode,sessionObject:session });
        }
      }
      if(verifiedEvent.type==='checkout.session.expired'||verifiedEvent.type==='checkout.session.async_payment_failed'){
        const session=verifiedEvent.data.object;
        if(stripeModeMatches(session.livemode)&&session.metadata?.paymentId)run(`UPDATE ${paymentTable()} SET status=? WHERE id=? AND provider_session=? AND provider='stripe' AND status='pending'`,verifiedEvent.type==='checkout.session.expired'?'expired':'failed',session.metadata.paymentId,session.id);
      }
      if(checkoutEvent&&typeof verifiedEvent.id==='string'){
        const session=verifiedEvent.data.object as Stripe.Checkout.Session;
        const payment=session.metadata?.paymentId?one(`SELECT id FROM ${paymentTable()} WHERE id=? AND provider_session=? AND provider='stripe'`,session.metadata.paymentId,session.id):undefined;
        if(payment)run('INSERT OR IGNORE INTO stripe_webhook_receipts (event_id,financial_mode,event_type,object_id,payment_id,endpoint_host) VALUES (?,?,?,?,?,?)',verifiedEvent.id,verifiedEvent.livemode?'live':'test',verifiedEvent.type,session.id,payment.id,String(req.headers.host||'').slice(0,255));
      }
      res.json({ received: true });
    });
  });
  app.post('/api/auth/apple/callback',express.urlencoded({extended:false,limit:'16kb',parameterLimit:8}));
  app.use('/api', express.json({ limit: '128kb' }), (req, res, next) => {
    res.setHeader('Cache-Control','private, no-store');
    // Crawlers may fetch public JSON to render the page, while the HTML page
    // remains the search result. Cover images retain their own image policy.
    if(['GET','HEAD'].includes(req.method)&&/^\/(?:config|series(?:\/[^/]+)?|publishers\/[^/]+)\/?$/u.test(req.path))res.setHeader('X-Robots-Tag','noindex');
    // Apple's cross-site form_post is authenticated by its one-use state,
    // browser binding and verified identity token in the dedicated handler.
    if (!['GET','HEAD','OPTIONS'].includes(req.method)&&!(req.method==='POST'&&req.path==='/auth/apple/callback')) {
      const origin = req.headers.origin; const allowed = trustedOrigins();
      if (!config.production && req.headers.host) allowed.add(`${req.protocol}://${req.headers.host}`);
      assert(!origin || allowed.has(origin), 403, 'INVALID_ORIGIN', 'This request origin is not allowed.');
      assert(req.headers['sec-fetch-site'] !== 'cross-site', 403, 'INVALID_ORIGIN', 'This request origin is not allowed.');
    }
    next();
  }, readSession, rateLimit('api', 1500, 60_000));
  registerGoogleAuth(app);
  registerWechatAuth(app);
  registerTestPayoutRoutes(app);
  registerAppleAuth(app);
  registerEmailAuth(app);
  registerPublisherProfiles(app,{catalogSelect,serializeSeries});
  app.get('/api/health', (_req,res) => res.setHeader('X-LingYing-Upload-Policy','owner-duration-v1').json({ ok: true, database: !!one('SELECT 1 AS ready') }));
  app.get('/api/config', async (_req,res) => {initializePromotions();if(config.payments==='stripe'&&stripeConfigured())await ensureStripeWebhookReady(stripe);return res.json({ brand: 'LingYing', languages: LANGUAGES, spokenLanguages:SPOKEN_LANGUAGES, genres: GENRES,standardGenres:STANDARD_GENRES,storyThemes:STORY_THEMES,formats:SERIES_FORMATS,creationTypes:CREATION_TYPES, passPromotion:{enabled:true},creatorPassConsent:{policyVersion:LEGAL_POLICY_VERSION,disclosureVersion:CREATOR_PASS_DISCLOSURE_VERSION},paymentMethods:{wechatPay:wechatPayEnabled()},paymentsMode: config.payments,paymentsReady:paymentsReady(),paymentsConfigured:stripeConfigured(),paymentSetup:stripeWebhookReadiness(),sandbox:config.sandbox,paymentsTestMode:stripeTestPayments()||config.payments==='demo',payoutsEnabled:config.payoutsEnabled&&!stripeTestPayments(),uploadsEnabled:!config.sandbox,usdToHkd: config.usdToHkd,
    limits: { maxEpisodeSeconds: MAX_EPISODE_SECONDS, maxEpisodeBytes: MAX_EPISODE_BYTES, quotaBytes: DEFAULT_QUOTA_BYTES, activationHkd: 88, minimumPriceUsd: MIN_PRICE_CENTS/100,maximumPriceUsd:MAX_PRICE_CENTS/100, creatorShare: 0.7, minimumPayoutUsd: WITHDRAWAL_POLICY.minimumCents/100,minWalletFundingUsd:MIN_WALLET_FUNDING_CENTS/100,maxWalletFundingUsd:MAX_WALLET_FUNDING_CENTS/100 },withdrawalPolicy:WITHDRAWAL_POLICY,walletFunding:WALLET_FUNDING_OPTIONS, demo: config.seed,episodeUpload:{mode:chunkedEpisodeUploadsEnabled()?'chunked':'multipart',chunkBytes:EPISODE_UPLOAD_CHUNK_BYTES}, runtime: (config as any).runtime || 'node', videoFormats: (config as any).videoFormats || ['mp4','mov','webm','m4v'], auth:{wechat:wechatAuthEnabled(),google:googleEnabled(),apple:appleEnabled(),email:emailAuthEnabled()} });});
  app.get('/api/auth/me', (req,res) => res.json({ user: req.user || null }));
  app.post('/api/auth/register', rateLimit('register', 12, 15 * 60_000), async (req,res) => {
    const body = registration.parse(req.body);
    assert(!one('SELECT id FROM users WHERE email=?', body.email), 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    const password = await hashPassword(body.password); const userId = crypto.randomUUID();
    try { run('INSERT INTO users (id,email,name,password_hash,language) VALUES (?,?,?,?,?)', userId, body.email, body.name, password, body.language); }
    catch (error) { if (one('SELECT id FROM users WHERE email=?', body.email)) throw new AppError(409,'EMAIL_EXISTS','An account with this email already exists.'); throw error; }
    await sendRegistrationVerification(userId);
    createSession(res,userId); res.status(201).json({ user: getUser(userId) });
  });
  app.post('/api/auth/login', rateLimit('login', 30, 15 * 60_000), async (req,res) => {
    const body = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).parse(req.body);
    const user = one('SELECT id,password_hash FROM users WHERE email=?', body.email.toLowerCase());
    const valid = await verifyPassword(body.password, user?.password_hash || 'not-found:00');
    assert(user && valid, 401, 'INVALID_LOGIN', 'The email or password is incorrect.');
    destroySession(req,res,false); createSession(res,user.id); res.json({ user: getUser(user.id) });
  });
  app.post('/api/auth/logout', (req,res) => { destroySession(req,res); res.json({ ok: true }); });
  app.patch('/api/account', requireAuth, (req,res) => {
    const body = z.object({ name: z.string().trim().min(2).max(60), language }).parse(req.body);
    run('UPDATE users SET name=?,language=? WHERE id=?', body.name, body.language, req.user!.id); res.json({ user: getUser(req.user!.id) });
  });
  app.get('/api/series', (req,res) => {
    const query = z.object({ q: z.string().max(120).optional(), language: spokenLanguage.optional(), genre: z.enum(GENRES).optional(),theme:z.enum(STORY_THEMES).optional(),format:z.enum(SERIES_FORMATS).optional(),access:z.enum(SERIES_ACCESS_FILTERS).optional(),featured:z.enum(['true']).optional(), sort: z.enum(['popular','new','saved']).optional(), saved: z.enum(['true']).optional(), creation: z.enum(CREATION_TYPES).optional() }).parse(req.query);
    const conditions = ["s.status='published'",publicSeriesAllowedSql('s')]; const params: any[] = [];
    if (query.q) { conditions.push(`(s.title LIKE ? OR s.description LIKE ? OR (${publisherNameSql()}) LIKE ?)`); params.push(`%${query.q}%`,`%${query.q}%`,`%${query.q}%`); }
    if (query.language) { conditions.push('s.language=?'); params.push(query.language); }
    if(query.genre==='animation')conditions.push(`(EXISTS(SELECT 1 FROM json_each(s.genres) old_genre WHERE old_genre.value='animation') OR (${SERIES_FORMAT_SQL}) IN ('animation','anime-donghua','motion-comic'))`);
    else if(query.genre){conditions.push('EXISTS(SELECT 1 FROM json_each(s.genres) chosen_genre WHERE chosen_genre.value=?)');params.push(query.genre);}
    if(query.theme){conditions.push('EXISTS(SELECT 1 FROM series_classifications c,json_each(c.themes) chosen_theme WHERE c.series_id=s.id AND chosen_theme.value=?)');params.push(query.theme);}
    if(query.format){conditions.push(`(${SERIES_FORMAT_SQL})=?`);params.push(query.format);}
    if (query.creation) { conditions.push('s.creation_type=?'); params.push(query.creation); }
    if(query.access){conditions.push(`(${seriesAccessTypeSql()})=?`);params.push(query.access);}
    if(query.featured)conditions.push('s.featured=1 AND EXISTS (SELECT 1 FROM episodes suggested_episode WHERE suggested_episode.series_id=s.id)');
    if (query.saved) { assert(req.user,401,'AUTH_REQUIRED','Sign in to view your list.'); conditions.push('EXISTS(SELECT 1 FROM saves sv WHERE sv.series_id=s.id AND sv.user_id=?)'); params.push(req.user.id); }
    const order = query.sort === 'new' ? 'julianday(COALESCE(sp.published_at,s.created_at)) DESC,s.rowid DESC' : query.sort === 'saved' ? 'saves DESC,s.views DESC' : 's.views DESC';
    res.json({ series: all(`${catalogSelect} WHERE ${conditions.join(' AND ')} ORDER BY ${order} LIMIT 150`, ...params).map(s => serializeSeries(s,req.user?.id)) });
  });
  app.get('/api/series/:id', (req,res) => {
    assertSeriesAvailable(id(req),{viewerId:req.user?.id,allowOwnerPreview:true});
    const s = one(`${catalogSelect} WHERE s.id=?`,id(req))!;
    const episodes = all(`SELECT e.id,e.series_id,e.title,e.number,${episodeDurationSql('e')} AS duration,e.bytes,(SELECT COUNT(*) FROM playback_sessions p WHERE p.episode_id=e.id AND p.counted_view=1) AS views,${episodeFreeSql()} AS free FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.series_id=? ORDER BY e.number`,id(req)).map(e => ({...e,free:!!e.free,unlocked:canWatch(req.user?.id,{...e,creator_id:s.creator_id})}));
    res.json({ series: serializeSeries(s,req.user?.id), episodes });
  });
  app.get('/api/series/:id/cover', async (req,res) => {
    const s=assertSeriesAvailable(id(req),{viewerId:req.user?.id,allowOwnerPreview:true});assert(s.cover_key,404,'NOT_FOUND','Cover not found.');
    if (s.cover_key.startsWith('public:')) { res.redirect(s.cover_key.slice(7)); return; } await serveObject(s.cover_key,req,res,'image/webp');
  });
  app.post('/api/series/:id/save', requireAuth, (req,res) => {
    assertSeriesAvailable(id(req));
    const saved = one('SELECT 1 FROM saves WHERE user_id=? AND series_id=?',req.user!.id,id(req));
    if (saved) run('DELETE FROM saves WHERE user_id=? AND series_id=?',req.user!.id,id(req)); else run('INSERT INTO saves VALUES (?,?)',req.user!.id,id(req));
    res.json({ saved: !saved });
  });
  app.put('/api/series/:id/like', requireAuth, rateLimit('like',120,60_000), (req,res)=>{
    const {liked}=z.object({liked:z.boolean()}).parse(req.body);
    const result=transaction(()=>{
      assertSeriesAvailable(id(req));
      if(liked)run('INSERT OR IGNORE INTO series_likes (user_id,series_id) VALUES (?,?)',req.user!.id,id(req));
      else run('DELETE FROM series_likes WHERE user_id=? AND series_id=?',req.user!.id,id(req));
      return{liked,likes:one('SELECT COUNT(*) AS n FROM series_likes WHERE series_id=?',id(req))!.n};
    });
    res.json(result);
  });
  app.get('/api/episodes/:id/stream', async (req,res) => {
    const e = episodeRow(id(req));assert(e,404,'NOT_FOUND','Episode not found.');assertSeriesAvailable(e.series_id,{viewerId:req.user?.id,allowOwnerPreview:true});
    assert(canWatch(req.user?.id,e),403,'EPISODE_LOCKED','Unlock this episode to watch.');
    await serveObject(e.storage_key,req,res,'video/mp4');
  });
  app.post('/api/episodes/:id/playback', rateLimit('playback-start',90,60_000), (req,res)=>{
    const e=episodeRow(id(req));assert(e,404,'NOT_FOUND','Episode not found.');assertSeriesAvailable(e.series_id,{viewerId:req.user?.id,allowOwnerPreview:true});
    assert(canWatch(req.user?.id,e),403,'EPISODE_LOCKED','Unlock this episode to watch.');
    if(e.creator_id===req.user?.id&&e.status!=='published'){res.json({excluded:true});return;}
    res.json(startPlayback(e.id,playbackViewer(req,res,true)!));
  });
  app.put('/api/playback/:id', rateLimit('playback-heartbeat',180,60_000), (req,res)=>{
    const {watchedMs}=z.object({watchedMs:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).parse(req.body);
    const viewer=playbackViewer(req,res);assert(viewer,404,'NOT_FOUND','Playback session not found.');
    const session=one('SELECT episode_id FROM playback_sessions WHERE id=? AND viewer_key=?',id(req),viewer);assert(session,404,'NOT_FOUND','Playback session not found.');
    const e=episodeRow(session.episode_id);assert(e,404,'NOT_FOUND','Episode not found.');assertSeriesAvailable(e.series_id);assert(canWatch(req.user?.id,e),403,'EPISODE_LOCKED','This episode is unavailable.');
    res.json(recordPlayback(id(req),viewer,watchedMs));
  });
  app.post('/api/episodes/:id/unlock', requireAuth, (req,res) => res.json({ ...unlockEpisode(req.user!.id,id(req)), user: getUser(req.user!.id) }));
  app.post('/api/episodes/:id/progress', requireAuth, (req,res) => {
    const e = episodeRow(id(req));assert(e,404,'NOT_FOUND','Episode not found.');assertSeriesAvailable(e.series_id,{viewerId:req.user?.id,allowOwnerPreview:true});assert(canWatch(req.user!.id,e),403,'EPISODE_LOCKED','Unlock this episode to watch.');
    const { seconds } = z.object({ seconds: z.number().min(0).max(Math.max(MAX_EPISODE_SECONDS,e.duration)) }).parse(req.body);
    run("INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?) ON CONFLICT(user_id,episode_id) DO UPDATE SET seconds=excluded.seconds,updated_at=datetime('now')",req.user!.id,id(req),Math.min(seconds,e.duration)); res.json({ ok:true });
  });
  app.get('/api/history', requireAuth, (req,res) => {
    const rows=all(`SELECT s.*,u.name AS creator_name,e.id AS episode_id,e.number AS episode_number,${episodeDurationSql('e')} AS duration,p.seconds,p.updated_at AS watched_at,
      (SELECT COUNT(*) FROM episodes ep WHERE ep.series_id=s.id) AS episode_count,(SELECT COUNT(*) FROM saves sv WHERE sv.series_id=s.id) AS saves
      FROM progress p JOIN episodes e ON e.id=p.episode_id JOIN series s ON s.id=e.series_id JOIN users u ON u.id=s.creator_id WHERE p.user_id=? AND s.status='published' AND ${publicSeriesAllowedSql('s')} ORDER BY p.updated_at DESC LIMIT 50`,req.user!.id);
    const seen=new Set(); res.json({ history: rows.filter(s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;}).map(s=>serializeSeries(s,req.user!.id)) });
  });
  app.get('/api/wallet', requireAuth, (req,res) => res.json({ user: getUser(req.user!.id), ledger: all(`SELECT l.*,p.amount_cents AS payment_amount_cents,p.currency AS payment_currency FROM ${ledgerTable()} l LEFT JOIN ${paymentTable()} p ON p.id=l.reference_id AND p.user_id=l.user_id AND p.kind='activation' WHERE l.user_id=? ORDER BY l.created_at DESC,l.rowid DESC LIMIT 100`,req.user!.id), payments: all(`SELECT id,kind,amount_cents,currency,status,created_at FROM ${paymentTable()} WHERE user_id=? ORDER BY created_at DESC LIMIT 30`,req.user!.id) }));
  app.post('/api/payments/promotion/quote',requireAuth,rateLimit('promotion-quote',30,60_000),(req,res)=>{
    const body=z.object({promo_code:z.string().trim().min(1).max(64)}).strict().parse(req.body);
    assertPaymentAccountClear(req.user!.id);const quote=quotePromotion(req.user!.id,body.promo_code);
    const{code,amountHkdCents,regularAmountHkdCents,currency,revision}=quote;
    res.setHeader('Cache-Control','private, no-store');res.json({promotion:{code,amountHkdCents,regularAmountHkdCents,currency,revision}});
  });
  app.post('/api/payments/wechat/quote',requireAuth,rateLimit('wechat-quote',30,60_000),(req,res)=>{
    const body=z.object({amount_cents:z.number().int().min(MIN_WALLET_FUNDING_CENTS).max(MAX_WALLET_FUNDING_CENTS)}).strict().parse(req.body);
    assertPaymentAccountClear(req.user!.id);res.setHeader('Cache-Control','private, no-store');res.json({quote:createWechatFundingQuote(req.user!.id,body.amount_cents)});
  });
  app.post('/api/payments/checkout', requireAuth, rateLimit('checkout',20,60_000), async (req,res) => {
    const consent=req.body?.kind==='activation'?requireCreatorPassConsent(req.body.creator_consent):undefined;
    const body=z.discriminatedUnion('kind',[z.object({kind:z.literal('activation'),promo_code:z.string().trim().min(1).max(64).optional(),promo_revision:z.number().int().positive().max(1000000000).optional(),creator_consent:z.object({accepted:z.literal(true),policy_version:z.string().min(1).max(64),disclosure_version:z.string().min(1).max(64)}).strict()}),z.object({kind:z.literal('funding'),amount_cents:z.number().int().min(MIN_WALLET_FUNDING_CENTS).max(MAX_WALLET_FUNDING_CENTS),promo_code:z.never().optional(),promo_revision:z.never().optional()})]).and(z.object({language:language.optional(),payment_method:z.enum(['card','wechat_pay']).default('card'),funding_quote_id:z.string().uuid().optional()})).parse(req.body);
    res.json(await createCheckout(req.user!.id,body.kind,body.kind==='funding'?body.amount_cents:8800,body.language,body.promo_code,body.promo_revision,consent,{method:body.payment_method,fundingQuoteId:body.funding_quote_id}));
  });
  app.post('/api/payments/:id/cancel',requireAuth,rateLimit('checkout-cancel',30,60_000),async(req,res)=>{
    res.json(await cancelCheckout(req.user!.id,id(req)));
  });
  app.get('/api/payments/:id/status',requireAuth,(req,res)=>{
    const payment=one(`SELECT id,status,kind,amount_cents,currency FROM ${paymentTable()} WHERE id=? AND user_id=? AND provider='stripe'`,id(req),req.user!.id);
    assert(payment,404,'NOT_FOUND','Payment not found.');
    const financialMode=/^(sk|rk)_live_/.test(config.stripeKey)?'live':'test';
    const webhooks=all('SELECT event_type AS type,received_at,endpoint_host FROM stripe_webhook_receipts WHERE payment_id=? AND financial_mode=? ORDER BY received_at DESC,event_id DESC LIMIT 20',payment.id,financialMode);
    res.json({payment,webhooks});
  });
  app.post('/api/payments/:id/demo-confirm', requireAuth, (req,res) => {
    assert(config.payments==='demo' && !config.production,404,'NOT_FOUND','Not found.');
    const payment=one('SELECT * FROM payments WHERE id=? AND user_id=?',id(req),req.user!.id); assert(payment?.provider==='demo',404,'NOT_FOUND','Payment not found.');
    settlePayment(payment.id); res.json({ user:getUser(req.user!.id) });
  });
  app.post('/api/payments/reconcile', requireAuth, async (req,res) => {
    const { session_id }=z.object({session_id:z.string().max(300)}).parse(req.body); assert(stripe && stripeConfigured(),503,'PAYMENTS_UNAVAILABLE','Payments unavailable.');
    const payment=one(`SELECT * FROM ${paymentTable()} WHERE provider_session=? AND user_id=?`,session_id,req.user!.id);assert(payment,404,'NOT_FOUND','Payment not found.');
    const session=await stripe.checkout.sessions.retrieve(session_id);
    assert(stripeModeMatches(session.livemode),400,'PAYMENT_MODE_MISMATCH','Payment mode does not match this application.');
    if(session.payment_status==='paid')settlePayment(payment.id,{amount:session.amount_total!,currency:session.currency!,session:session.id,livemode:session.livemode,sessionObject:session});
    else recordPaymentLink(payment.id,session);
    res.json({ paid:session.payment_status==='paid',user:getUser(req.user!.id) });
  });
  app.get('/api/studio', requireAuth, (req,res) => {
    const user=req.user!;void finishInBackground(cleanupSeriesMedia(undefined,20)).catch(()=>{});void finishInBackground(cleanupExpiredEpisodeUploads(5)).catch(()=>{});res.json({ user:getUser(user.id),series:all(`${catalogSelect} WHERE s.creator_id=? AND NOT EXISTS (SELECT 1 FROM series_deletions d WHERE d.series_id=s.id) AND NOT EXISTS (SELECT 1 FROM retired_catalog_series r WHERE r.series_id=s.id) ORDER BY s.created_at DESC`,user.id).map(s=>serializeSeries(s,user.id,true)),
      stats:one(`SELECT COUNT(*) AS sales,COALESCE(SUM(p.creator_micros),0) AS lifetime_micros FROM ${purchaseTable()} p JOIN episodes e ON e.id=p.episode_id JOIN series s ON s.id=e.series_id WHERE s.creator_id=?`,user.id),
      withdrawals:stripeTestPayments()?[]:all(`SELECT w.*,${WITHDRAWAL_TERMS_SQL} FROM withdrawals w LEFT JOIN withdrawal_terms wt ON wt.withdrawal_id=w.id WHERE w.user_id=? ORDER BY w.created_at DESC`,user.id), storageRequests:all('SELECT * FROM storage_requests WHERE user_id=? ORDER BY created_at DESC',user.id) });
  });
  app.get('/api/studio/series/:id/lifecycle',requireAuth,rateLimit('series-delete-preview',30,60_000),(req,res)=>{
    ownSeries(req);res.setHeader('Cache-Control','private, no-store');res.json(previewSeriesDeletion(req.user!.id,id(req)));
  });
  app.delete('/api/studio/series/:id',requireAuth,rateLimit('series-delete',20,60_000),async(req,res)=>{
    const target=ownSeries(req);const body=z.object({confirmation_token:z.string().max(200),confirm_title:z.string().max(120),acknowledge:z.boolean()}).strict().parse(req.body);
    const result=await deleteSeriesPermanently(req.user!.id,id(req),body);
    try{res.json({...result,user:getUser(req.user!.id),owner_storage:ownerStorage(target)});}catch{res.json({...result,cleanup_pending:true});}
  });
  app.get('/api/studio/title-availability',requirePublisher,rateLimit('series-title-availability',30,60_000),(req,res)=>{
    const query=z.object({title:z.string().max(1024).trim().min(SERIES_LIMITS.titleMin).max(SERIES_LIMITS.titleMax),exclude:z.string().min(1).max(200).optional()}).strict().parse(req.query);
    const current=query.exclude?ownSeries(req,query.exclude):undefined;
    res.setHeader('Cache-Control','private, no-store');
    res.json({available:seriesTitleAvailable(query.title,current?{id:current.id,title:current.title}:undefined)});
  });
  app.get('/api/studio/series/:id',requireAuth,(req,res)=>{
    ownSeries(req);const s=one(`${catalogSelect} WHERE s.id=?`,id(req))!;
    const episodes=all(`SELECT e.id,e.series_id,e.title,e.number,${episodeDurationSql('e')} AS duration,e.bytes FROM episodes e WHERE e.series_id=? ORDER BY e.number`,s.id);
    res.setHeader('Cache-Control','private, no-store');res.json({series:serializeSeries(s,req.user!.id,true),episodes,episodes_revision:episodeBatchRevision(s.id),owner_storage:ownerStorage(s),owner_upload_limits:episodeUploadLimits(s.creator_id)});
  });
  app.get('/api/studio/series/:id/cover',requireAuth,async(req,res)=>{
    const s=ownSeries(req);assert(s.cover_key,404,'NOT_FOUND','Cover not found.');res.setHeader('Cache-Control','private, no-store');
    if(s.cover_key.startsWith('public:')){res.redirect(s.cover_key.slice(7));return;}await serveObject(s.cover_key,req,res,'image/webp');
  });
  app.get('/api/studio/episodes/:id/stream',requireAuth,async(req,res)=>{
    const episode=episodeRow(id(req));assert(episode,404,'NOT_FOUND','Episode not found.');const series=ownSeries(req,episode.series_id);if(req.user!.role!=='admin')assertSeriesWritable(series.id);
    res.setHeader('Cache-Control','private, no-store');await serveObject(episode.storage_key,req,res,'video/mp4');
  });
  app.get('/api/studio/series/:id/analytics',requirePublisher,(req,res)=>{
    const s=ownSeries(req);
    const query=z.object({period:z.enum(['7d','30d','90d','all']).optional(),start:z.string().max(10).optional(),end:z.string().max(10).optional()}).parse(req.query);
    res.json(readSeriesAnalytics(s.creator_id,id(req),query));
  });
  app.post('/api/studio/series', requirePublisher, (req,res) => {
    const b=seriesSchema.parse(req.body);const seriesId=crypto.randomUUID();
    transaction(()=>{assertSeriesTitleAvailable(b.title);run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes) VALUES (?,?,?,?,?,?,?,?,?)',seriesId,req.user!.id,b.title,b.description,b.language,JSON.stringify(b.genres),b.creation_type,b.price_cents,b.free_episodes);
      writeSeriesClassification(seriesId,b.genres,b);
      assignSeriesPublisher(req.user!.id,one('SELECT * FROM series WHERE id=?',seriesId)!,b.publisher_profile_id,{creating:true});
      writeSeriesCoverLayout(seriesId,b.cover_aspect_ratio,{creating:true});
      writeSeriesSubtitleLanguages(seriesId,b.subtitle_languages);
      writeSeriesLastEpisodeFree(seriesId,b.last_episode_free);
    });
    res.status(201).json({ id:seriesId });
  });
  app.patch('/api/studio/series/:id', requirePublisher, (req,res) => {
    const b=seriesSchema.parse(req.body);
    transaction(()=>{const before=writableSeries(req),beforeGenres=JSON.parse(before.genres),beforeClassification=seriesClassification(before.id,beforeGenres),beforeCoverRatio=seriesCoverAspectRatio(before.id),beforeSubtitles=seriesSubtitleLanguages(before.id),beforeLastEpisodeFree=seriesLastEpisodeFree(before.id);
      assertSeriesTitleAvailable(b.title,{id:before.id,title:before.title});
      run("UPDATE series SET title=?,description=?,language=?,genres=?,creation_type=?,price_cents=?,free_episodes=?,updated_at=datetime('now') WHERE id=?",b.title,b.description,b.language,JSON.stringify(b.genres),b.creation_type,b.price_cents,b.free_episodes,id(req));
      // Preserve proven legacy format when an older editor changes only genre metadata.
      const classificationInput=b.format===undefined&&beforeClassification.format==='animation'&&!b.genres.includes('animation')?{...b,format:beforeClassification.format}:b;
      writeSeriesClassification(id(req),beforeGenres,classificationInput);
      assignSeriesPublisher(req.user!.id,before,b.publisher_profile_id);
      writeSeriesCoverLayout(id(req),b.cover_aspect_ratio);
      writeSeriesSubtitleLanguages(id(req),b.subtitle_languages);
      writeSeriesLastEpisodeFree(id(req),b.last_episode_free);
      if(req.user!.role==='admin')recordSeriesMetadataEdit(req.user!.id,id(req),'Administrator updated series details.',{before:{title:before.title,description:before.description,language:before.language,genres:beforeGenres,creation_type:before.creation_type,price_cents:before.price_cents,free_episodes:before.free_episodes,cover_aspect_ratio:beforeCoverRatio,subtitle_languages:beforeSubtitles,last_episode_free:beforeLastEpisodeFree,...beforeClassification},after:{...b,cover_aspect_ratio:seriesCoverAspectRatio(id(req)),subtitle_languages:seriesSubtitleLanguages(id(req)),last_episode_free:seriesLastEpisodeFree(id(req)),...seriesClassification(id(req),b.genres)}});
    });res.json({ok:true});
  });
  app.post('/api/studio/series/:id/cover', requirePublisher, (req,_res,next)=>{assert(!config.sandbox,403,'SANDBOX_UPLOAD_DISABLED','Uploads are disabled on the payment-test site. Use its sample episodes to test wallet purchases.');const s=writableSeries(req);assertPaymentAccountClear(s.creator_id);next();}, coverUpload.single('cover'), async (req,res) => {
    assert(req.file,400,'FILE_REQUIRED','Choose a cover image.');let coverOwnerId=req.user!.id;let processed: {path:string;bytes:number}|undefined;const key=`covers/${crypto.randomUUID()}.webp`;let saved=false;
    try {
      coverOwnerId=ownSeries(req).creator_id;
      processed=await prepareCover(req.file.path);saved=true;await putObject(processed.path,key,'image/webp');
      const old=transaction(()=>{const s=writableSeries(req);assertPaymentAccountClear(s.creator_id);const u=ownerStorage(s);assert(withinStorageQuota(u,u.used_bytes-s.cover_bytes+reservedEpisodeUploadBytes(s.creator_id)+processed!.bytes),413,'QUOTA_EXCEEDED','This cover exceeds your storage allowance.');run('UPDATE users SET used_bytes=used_bytes-?+? WHERE id=?',s.cover_bytes,processed!.bytes,s.creator_id);run('UPDATE series SET cover_key=?,cover_bytes=? WHERE id=?',key,processed!.bytes,s.id);return s.cover_key;});
      saved=false;
      if(old)void finishInBackground(queueUnreferencedSeriesMedia(id(req),coverOwnerId,old)).catch(()=>console.warn('Old cover cleanup remains pending.'));res.json({cover:apiUrl(`/api/studio/series/${id(req)}/cover`),user:getUser(req.user!.id),owner_storage:ownerStorage(ownSeries(req))});
    } catch(error) { if(saved)try{await queueUnreferencedSeriesMedia(id(req),coverOwnerId,key);}catch{console.warn('Uncommitted cover cleanup could not be queued.');}throw error; }
    finally {await removeTempFile(req.file.path);if(processed)await removeTempFile(processed.path);}
  });
  registerEpisodeUploadSessions(app,{writableSeries,ownerStorage});
  app.post('/api/studio/series/:id/episodes', requirePublisher, rateLimit('upload',60,60_000), (req,_res,next)=>{assert(!config.sandbox,403,'SANDBOX_UPLOAD_DISABLED','Uploads are disabled on the payment-test site. Use its sample episodes to test wallet purchases.');const s=writableSeries(req);assertPaymentAccountClear(s.creator_id);next();}, upload.single('video'), async (req,res) => {
    assert(req.file,400,'FILE_REQUIRED','Choose an episode video.');let target:ReturnType<typeof writableSeries>|undefined;let processed:{path:string;bytes:number;duration:number}|undefined;let key='';let saved=false;
    try {
      assert(req.file.size<=MAX_EPISODE_BYTES,413,'FILE_TOO_LARGE',`Episodes must be ${MAX_EPISODE_BYTES/1024**2} MiB or less.`);target=writableSeries(req);key=`videos/${target.creator_id}/${crypto.randomUUID()}.mp4`;
      const body=z.object({title:z.string().trim().min(1).max(120),number:z.coerce.number().int().min(1).max(1000)}).parse(req.body);
      assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=?',id(req),body.number),409,'EPISODE_EXISTS','An episode with this number already exists.');
      const u=ownerStorage(target);assert(withinStorageQuota(u,u.used_bytes+reservedEpisodeUploadBytes(target.creator_id)+req.file.size),413,'QUOTA_EXCEEDED','Not enough storage. Request an increase from your studio.');
      processed=await prepareVideo(req.file.path,episodeUploadLimits(target.creator_id).maxEpisodeSeconds);
      assert(processed.bytes<=MAX_EPISODE_BYTES,413,'FILE_TOO_LARGE',`Processed episodes must be ${MAX_EPISODE_BYTES/1024**2} MiB or less.`);saved=true;await putObject(processed.path,key,'video/mp4');
      const episodeId=transaction(()=>{const s=writableSeries(req);assertPaymentAccountClear(s.creator_id);assertEpisodeUploadDuration(s.creator_id,processed!.duration);const user=ownerStorage(s);assert(withinStorageQuota(user,user.used_bytes+reservedEpisodeUploadBytes(s.creator_id)+processed!.bytes),413,'QUOTA_EXCEEDED','Not enough storage. Request an increase.');
        assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=?',id(req),body.number),409,'EPISODE_EXISTS','An episode with this number already exists.');
        const eid=crypto.randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',eid,id(req),body.title,body.number,legacyEpisodeDuration(processed!.duration),processed!.bytes,key,req.file!.originalname.slice(0,255));writeEpisodeDuration(eid,processed!.duration);run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',processed!.bytes,s.creator_id);return eid;});
      saved=false;res.status(201).json({id:episodeId,user:getUser(req.user!.id),owner_storage:ownerStorage(target),duration:processed.duration,bytes:processed.bytes});
    }catch(error){if(saved&&target)try{await queueUnreferencedSeriesMedia(id(req),target.creator_id,key);}catch{console.warn('Uncommitted episode cleanup could not be queued.');}throw error;}
    finally{await removeTempFile(req.file.path);if(processed)await removeTempFile(processed.path);}
  });
  app.patch('/api/studio/episodes/:id', requirePublisher, (req,res) => {
    const e=episodeRow(id(req));assert(e,404,'NOT_FOUND','Episode not found.');assertEpisodeBatchWritable(req,e.series_id);
    const b=z.object({title:z.string().trim().min(1).max(120),number:z.number().int().min(1).max(1000)}).parse(req.body);
    assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=? AND id<>?',e.series_id,b.number,e.id),409,'EPISODE_EXISTS','This episode number is already in use.');run('UPDATE episodes SET title=?,number=? WHERE id=?',b.title,b.number,e.id);res.json({ok:true});
  });
  registerEpisodeBatch(app);
  app.delete('/api/studio/episodes/:id', requirePublisher, async (req,res) => {
    res.json(await deleteSingleEpisode(req,id(req)));
  });
  app.post('/api/studio/series/:id/status', requirePublisher, (req,res) => {
    const s=ownSeries(req);assertSeriesWritable(s.id);assertPaymentAccountClear(s.creator_id);const {status}=z.object({status:z.enum(['draft','published','archived'])}).parse(req.body);if(status!=='published')assertSeriesLifecycleFinancialClear(req.user!.id,s.creator_id);
    if(status==='published'){assert(s.cover_key,400,'COVER_REQUIRED','Add a cover before publishing.');assert(one('SELECT id FROM episodes WHERE series_id=?',s.id),400,'EPISODES_REQUIRED','Upload at least one episode before publishing.');}
    if(status==='draft')assert(!one('SELECT p.id FROM purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? UNION ALL SELECT p.id FROM test_purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=? LIMIT 1',s.id,s.id),409,'HAS_PURCHASES','This series has paid viewers. Contact support before removing access.');
    transaction(()=>{
      // Older published rows predate the publication ledger. Preserve their
      // original listing date before a reversible hide changes their status.
      if(s.status==='published')run('INSERT OR IGNORE INTO series_publications (series_id,published_at) VALUES (?,?)',s.id,s.created_at);
      if(status==='published')run('INSERT OR IGNORE INTO series_publications (series_id,published_at) VALUES (?,?)',s.id,s.status==='published'?s.created_at:new Date().toISOString());
      run('UPDATE series SET status=? WHERE id=?',status,s.id);
    });res.json({ok:true});
  });
  app.post('/api/studio/storage-requests', requirePublisher, (req,res) => {
    assert(!req.user!.storage_unlimited,400,'STORAGE_UNLIMITED','Administrator upload storage is already unlimited.');
    const b=z.object({requested_gb:z.number().int().min(6).max(1000),reason:z.string().trim().min(10).max(1000)}).parse(req.body);
    assert(!one("SELECT id FROM storage_requests WHERE user_id=? AND status='pending'",req.user!.id),409,'REQUEST_PENDING','You already have a storage request awaiting review.');
    assert(b.requested_gb*1024**3>req.user!.quota_bytes,400,'INVALID_QUOTA','Request a larger total storage allowance.');
    run('INSERT INTO storage_requests (id,user_id,requested_gb,reason) VALUES (?,?,?,?)',crypto.randomUUID(),req.user!.id,b.requested_gb,b.reason);res.status(201).json({ok:true});
  });
  app.post('/api/studio/connect', requirePublisher, async (req,res) => {
    assertPayoutsEnabled();
    assert(stripe && config.payments==='stripe'&&paymentsReady(),503,'PAYMENTS_UNAVAILABLE','Payout onboarding is not configured yet.');
    let account=req.user!.stripe_account_id;
    if(!account){const created=await stripe.accounts.create({type:'express',email:req.user!.email,capabilities:{transfers:{requested:true}},metadata:{userId:req.user!.id}});account=created.id;run('UPDATE users SET stripe_account_id=? WHERE id=?',account,req.user!.id);}
    const link=await stripe.accountLinks.create({account,refresh_url:`${publicAppUrl()}/studio?connect=retry`,return_url:`${publicAppUrl()}/studio?connect=done`,type:'account_onboarding'});res.json({url:link.url});
  });
  app.post('/api/studio/withdrawals', requirePublisher, async (req,res) => {
    assertPayoutsEnabled();
    const b=z.object({amount_cents:z.number().int().min(1).max(10000000),note:z.string().max(500).default('')}).parse(req.body);
    if(config.payments==='stripe') {assert(stripe&&paymentsReady(),503,'PAYMENTS_UNAVAILABLE','Payouts are not configured yet.');assert(req.user!.stripe_account_id,400,'CONNECT_REQUIRED','Connect your payout account first.');const account=await stripe.accounts.retrieve(req.user!.stripe_account_id);assert(account.payouts_enabled,400,'CONNECT_REQUIRED','Complete your payout account verification first.');}
    else assert(config.payments==='demo' && !config.production,503,'PAYMENTS_UNAVAILABLE','Payouts are not configured yet.');
    res.status(201).json({id:requestWithdrawal(req.user!.id,b.amount_cents,b.note),user:getUser(req.user!.id)});
  });
  app.get('/api/admin/series',requireAdmin,(req,res)=>{
    const filters=z.object({q:z.string().trim().max(120).optional(),status:z.enum(['all','draft','published','archived','taken_down']).optional(),page:z.coerce.number().int().min(1).max(100000).optional(),limit:z.coerce.number().int().min(1).max(50).optional()}).parse(req.query);
    const result=listAdminSeries(req.user!.id,filters);res.setHeader('Cache-Control','private, no-store');res.json({...result,series:result.series.map(s=>serializeSeries(s,req.user!.id,true))});
  });
  app.get('/api/admin/series/:id/moderation',requireAdmin,(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.json({events:adminModerationEvents(req.user!.id,id(req))});
  });
  app.put('/api/admin/series/:id/featured',requireAdmin,(req,res)=>{
    const body=z.object({featured:z.boolean()}).strict().parse(req.body);
    res.setHeader('Cache-Control','private, no-store');res.json(setSeriesFeatured(req.user!.id,id(req),body.featured));
  });
  app.post('/api/admin/series/:id/moderation',requireAdmin,(req,res)=>{
    const body=z.object({action:z.enum(['takedown','restore']),reason:z.string().trim().min(10).max(2000)}).parse(req.body);
    res.json(setSeriesModeration(req.user!.id,id(req),body.action,body.reason));
  });
  app.get('/api/admin/episodes/:id/stream',requireAdmin,async(req,res)=>{
    const episode=episodeRow(id(req));assert(episode&&!isSeriesDeleted(episode.series_id),404,'NOT_FOUND','Episode not found.');
    // Reviewing private media creates no purchase, playback session or counted view.
    await serveObject(episode.storage_key,req,res,'video/mp4');
  });
  const promotionSettings=z.object({enabled:z.boolean(),discount_type:z.enum(['amount','percent']),discount_value:z.number().int().positive().max(8400),max_redemptions:z.number().int().positive().max(1000000).nullable()});
  app.get('/api/admin/promotions',requireAdmin,(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json(adminPromotions(req.user!.id));});
  app.post('/api/admin/promotions',requireAdmin,rateLimit('promotion-admin',60,60_000),(req,res)=>{
    const body=promotionSettings.extend({code:z.string().trim().min(3).max(32),enabled:z.boolean().default(true),max_redemptions:z.number().int().positive().max(1000000).nullable().default(null)}).strict().parse(req.body);
    res.status(201).json({promotion:createPromotion(req.user!.id,body)});
  });
  app.patch('/api/admin/promotions/:id',requireAdmin,rateLimit('promotion-admin',60,60_000),(req,res)=>{
    const body=promotionSettings.partial().strict().refine(value=>Object.keys(value).length>0,'Choose at least one setting to update.').parse(req.body);
    res.json({promotion:updatePromotion(req.user!.id,id(req),body)});
  });
  app.get('/api/admin', requireAdmin, (_req,res) => res.json({
    stats:{users:one('SELECT COUNT(*) AS n FROM users')!.n,publishers:one(`SELECT COUNT(*) AS n FROM users WHERE publisher_active=1${usingTestPaymentState()?' OR EXISTS(SELECT 1 FROM test_accounts t WHERE t.user_id=users.id AND t.publisher_active=1)':''}`)!.n,
      sales:one(`SELECT COUNT(*) AS n,COALESCE(SUM(price_micros),0) AS gross_micros,COALESCE(SUM(platform_micros),0) AS platform_micros FROM ${purchaseTable()}`),activation_hkd:one(`SELECT COALESCE(SUM(amount_cents),0)/100.0 AS n FROM ${paymentTable()} WHERE kind='activation' AND status='paid'`)!.n},
    storageRequests:all('SELECT r.*,u.name,u.email,u.quota_bytes,u.used_bytes FROM storage_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC'),
    withdrawals:stripeTestPayments()?[]:all(`SELECT w.*,u.name,u.email,u.stripe_account_id,${WITHDRAWAL_TERMS_SQL} FROM withdrawals w JOIN users u ON u.id=w.user_id LEFT JOIN withdrawal_terms wt ON wt.withdrawal_id=w.id ORDER BY w.created_at DESC`),
    users:all('SELECT id,name,email,role,publisher_active,quota_bytes,used_bytes FROM users ORDER BY created_at DESC LIMIT 200').map(user=>{const current=usingTestPaymentState()?{...user,role:getUser(user.id)!.role,publisher_active:getUser(user.id)!.publisher_active}:user;return{...current,storage_unlimited:current.role==='admin'};}),
  }));
  app.post('/api/admin/storage-requests/:id', requireAdmin, (req,res) => {
    const {approve}=z.object({approve:z.boolean()}).parse(req.body);
    transaction(()=>{const r=one("SELECT * FROM storage_requests WHERE id=? AND status='pending'",id(req));assert(r,404,'NOT_FOUND','Pending request not found.');if(approve)run('UPDATE users SET quota_bytes=MAX(quota_bytes,?) WHERE id=?',r.requested_gb*1024**3,r.user_id);run('UPDATE storage_requests SET status=? WHERE id=?',approve?'approved':'rejected',r.id);});res.json({ok:true});
  });
  app.post('/api/admin/withdrawals/:id', requireAdmin, async (req,res) => {
    assertPayoutsEnabled();
    const {approve}=z.object({approve:z.boolean()}).parse(req.body);
    const w=one('SELECT w.*,u.stripe_account_id FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.id=?',id(req));assert(w,404,'NOT_FOUND','Payout not found.');
    if(!approve){transaction(()=>{const current=one('SELECT * FROM withdrawals WHERE id=?',w.id)!;assert(current.status==='pending',409,'ALREADY_PROCESSED','This payout is already being processed.');run("UPDATE withdrawals SET status='rejected' WHERE id=?",w.id);returnWithdrawalFunds(w.user_id,w.amount_micros);addLedger(w.user_id,'withdrawal_refund',w.amount_micros,w.id,'Payout declined · funds returned');});res.json({ok:true});return;}
    assert(w.status==='pending'||w.status==='processing',409,'ALREADY_PROCESSED','This payout is already processed.');
    assert(config.payments==='demo'&&!config.production||config.payments==='stripe'&&paymentsReady(),503,'PAYMENTS_UNAVAILABLE','Payouts unavailable.');
    run("UPDATE withdrawals SET status='processing' WHERE id=? AND status='pending'",w.id);
    if(config.payments==='stripe'){
      assert(stripe && w.stripe_account_id,400,'CONNECT_REQUIRED','Publisher payout account is missing.');
      const terms=withdrawalTerms(w.id,w.amount_micros);
      const transfer=await stripe.transfers.create({amount:Math.floor(terms.payout_micros/10000),currency:'usd',destination:w.stripe_account_id,metadata:{withdrawalId:w.id}},{idempotencyKey:`withdrawal:${w.id}`});
      run("UPDATE withdrawals SET status='paid',transfer_id=? WHERE id=?",transfer.id,w.id);
    }else{assert(config.payments==='demo'&&!config.production,503,'PAYMENTS_UNAVAILABLE','Payouts unavailable.');run("UPDATE withdrawals SET status='paid',transfer_id=? WHERE id=?",`demo_${w.id}`,w.id);}
    res.json({ok:true});
  });
  app.get('/api/admin/payment-reviews',requireAdmin,(_req,res)=>res.json({reviews:adminPaymentReviews()}));
  app.post('/api/admin/payment-reviews/:id/resolve',requireAdmin,(req,res)=>{
    const body=z.object({decision:z.enum(['reconciled','platform_loss','provider_reversed']),note:z.string().trim().min(10).max(2000),wallet_debit_cents:z.number().int().min(0).max(MAX_WALLET_FUNDING_CENTS).optional()}).parse(req.body);
    res.json({review:resolvePaymentReview(id(req),req.user!.id,body)});
  });
  registerSearchDiscovery(app);
  app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'This endpoint does not exist.'}}));
  return app;
}
export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
  if(res.headersSent)return;
  if(error instanceof ZodError){res.status(400).json({error:{code:'VALIDATION',message:error.issues[0]?.message || 'Check the information you entered.',fields:error.issues.map(x=>({path:x.path.join('.'),message:x.message}))}});return;}
  if(error?.type==='entity.too.large'){res.status(413).json({error:{code:'FILE_TOO_LARGE',message:'This upload part exceeds the 5 MiB limit.'}});return;}
  if(error instanceof multer.MulterError){res.status(413).json({error:{code:'FILE_TOO_LARGE',message:error.code==='LIMIT_FILE_SIZE'?`This file is too large. Episodes: ${MAX_EPISODE_BYTES/1024**2} MiB maximum. Covers: 5 MiB maximum.`:'Upload one file at a time.'}});return;}
  if(error instanceof AppError){res.status(error.status).json({error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{})}});return;}
  if(error instanceof Stripe.errors.StripeError){res.status(502).json({error:{code:'PAYMENT_PROVIDER_ERROR',message:'The payment provider could not complete this request. Please try again shortly.'}});return;}
  console.error(error);res.status(500).json({error:{code:'INTERNAL',message:'Something went wrong. Please try again.'}});
}
