import { upload, coverUpload } from './uploads.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { z, ZodError } from 'zod';
import { config } from './config.js';
import { registerGoogleAuth,googleEnabled } from './google.js';
import { one, all, run, transaction } from './db.js';
import { AppError, assert } from './errors.js';
import { readSession, requireAuth, requirePublisher, requireAdmin, hashPassword, verifyPassword, createSession, destroySession, getUser, rateLimit } from './auth.js';
import { prepareVideo, prepareCover, putObject, deleteObject, serveObject, removeTempFile } from './storage.js';
import { createCheckout, settlePayment, unlockEpisode, requestWithdrawal, addLedger, stripe } from './finance.js';
import { LANGUAGES, GENRES, MAX_EPISODE_BYTES, DEFAULT_QUOTA_BYTES } from '../shared/config.js';

const language = z.enum(LANGUAGES.map(x => x.code) as [string, ...string[]]);
const id = (req: Request, field = 'id') => String(req.params[field] || '');
const registration = z.object({ name: z.string().trim().min(2).max(60), email: z.email().max(254).transform(s => s.toLowerCase()), password: z.string().min(10).max(128), language: language.default('en') });
const seriesSchema = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(10).max(4000), language,
  genres: z.array(z.enum(GENRES)).min(1).max(3), creation_type: z.enum(['human','ai-assisted','ai-generated']).default('human'),
  price_cents: z.number().int().min(10).max(10000), free_episodes: z.number().int().min(0).max(1000),
});
function ownSeries(req: Request, seriesId = id(req)) {
  const s = one('SELECT * FROM series WHERE id=?', seriesId);
  assert(s, 404, 'NOT_FOUND', 'Series not found.'); assert(s.creator_id === req.user!.id, 403, 'FORBIDDEN', 'This series belongs to another publisher.'); return s;
}
const catalogSelect = `SELECT s.*,u.name AS creator_name,
 (SELECT id FROM episodes e WHERE e.series_id=s.id ORDER BY number LIMIT 1) AS first_episode_id,
 (SELECT COUNT(*) FROM episodes e WHERE e.series_id=s.id) AS episode_count,
 (SELECT COUNT(*) FROM saves sv WHERE sv.series_id=s.id) AS saves
 FROM series s JOIN users u ON u.id=s.creator_id`;
function serializeSeries(s: Record<string, any>, userId?: string) {
  const { cover_key, cover_bytes, ...safe } = s;
  return { ...safe, genres: JSON.parse(s.genres), cover: cover_key.startsWith('public:') ? cover_key.slice(7) : cover_key ? `/api/series/${s.id}/cover` : '/images/placeholder.svg',
    saved: !!(userId && one('SELECT 1 FROM saves WHERE user_id=? AND series_id=?', userId, s.id)) };
}
function canWatch(userId: string | undefined, e: any) { return e.number <= e.free_episodes || e.creator_id === userId || !!(userId && one('SELECT 1 FROM purchases WHERE user_id=? AND episode_id=?', userId, e.id)); }
function episodeRow(episodeId: string) { return one(`SELECT e.*,s.free_episodes,s.creator_id,s.status FROM episodes e JOIN series s ON s.id=e.series_id WHERE e.id=?`, episodeId); }

export function createApp() {
  const app = express();
  const recentViews=new Map<string,number>();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options','DENY'); next(); });
  app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    assert(config.payments === 'stripe' && stripe && config.stripeWebhook, 503, 'PAYMENTS_UNAVAILABLE', 'Webhook is not configured.');
    let event;
    try { event = await stripe.webhooks.constructEventAsync(req.body, req.headers['stripe-signature'] as string, config.stripeWebhook); }
    catch { throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.'); }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid' && session.metadata?.paymentId) settlePayment(session.metadata.paymentId, { amount: session.amount_total!, currency: session.currency!, session: session.id });
    }
    res.json({ received: true });
  });
  app.use('/api', express.json({ limit: '128kb' }), (req, res, next) => {
    res.setHeader('Cache-Control','private, no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin; const allowed = new Set([new URL(config.appUrl).origin]);
      if (!config.production && req.headers.host) allowed.add(`${req.protocol}://${req.headers.host}`);
      assert(!origin || allowed.has(origin), 403, 'INVALID_ORIGIN', 'This request origin is not allowed.');
      assert(req.headers['sec-fetch-site'] !== 'cross-site', 403, 'INVALID_ORIGIN', 'This request origin is not allowed.');
    }
    next();
  }, readSession, rateLimit('api', 1500, 60_000));
  registerGoogleAuth(app);
  app.get('/api/health', (_req,res) => res.json({ ok: true, database: !!one('SELECT 1 AS ready') }));
  app.get('/api/config', (_req,res) => res.json({ brand: 'AIDramio', languages: LANGUAGES, genres: GENRES, paymentsMode: config.payments, usdToHkd: config.usdToHkd,
    limits: { maxEpisodeSeconds: 180, maxEpisodeBytes: MAX_EPISODE_BYTES, quotaBytes: DEFAULT_QUOTA_BYTES, activationHkd: 88, minimumPriceUsd: 0.1, creatorShare: 0.7, minimumPayoutHkd: 20 }, demo: config.seed, runtime: (config as any).runtime || 'node', videoFormats: (config as any).videoFormats || ['mp4','mov','webm','m4v'], auth:{google:googleEnabled()} }));
  app.get('/api/auth/me', (req,res) => res.json({ user: req.user || null }));
  app.post('/api/auth/register', rateLimit('register', 12, 15 * 60_000), async (req,res) => {
    const body = registration.parse(req.body);
    assert(!one('SELECT id FROM users WHERE email=?', body.email), 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    const password = await hashPassword(body.password); const userId = crypto.randomUUID();
    try { run('INSERT INTO users (id,email,name,password_hash,language) VALUES (?,?,?,?,?)', userId, body.email, body.name, password, body.language); }
    catch (error) { if (one('SELECT id FROM users WHERE email=?', body.email)) throw new AppError(409,'EMAIL_EXISTS','An account with this email already exists.'); throw error; }
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
    const query = z.object({ q: z.string().max(120).optional(), language: language.optional(), genre: z.enum(GENRES).optional(), sort: z.enum(['popular','new','saved']).optional(), saved: z.enum(['true']).optional(), creation: z.enum(['human','ai-assisted','ai-generated']).optional() }).parse(req.query);
    const conditions = ["s.status='published'"]; const params: any[] = [];
    if (query.q) { conditions.push('(s.title LIKE ? OR s.description LIKE ? OR u.name LIKE ?)'); params.push(`%${query.q}%`,`%${query.q}%`,`%${query.q}%`); }
    if (query.language) { conditions.push('s.language=?'); params.push(query.language); }
    if (query.genre) { conditions.push('s.genres LIKE ?'); params.push(`%"${query.genre}"%`); }
    if (query.creation) { conditions.push('s.creation_type=?'); params.push(query.creation); }
    if (query.saved) { assert(req.user,401,'AUTH_REQUIRED','Sign in to view your list.'); conditions.push('EXISTS(SELECT 1 FROM saves sv WHERE sv.series_id=s.id AND sv.user_id=?)'); params.push(req.user.id); }
    const order = query.sort === 'new' ? 's.created_at DESC' : query.sort === 'saved' ? 'saves DESC,s.views DESC' : 's.views DESC';
    res.json({ series: all(`${catalogSelect} WHERE ${conditions.join(' AND ')} ORDER BY ${order} LIMIT 150`, ...params).map(s => serializeSeries(s,req.user?.id)) });
  });
  app.get('/api/series/:id', (req,res) => {
    const s = one(`${catalogSelect} WHERE s.id=?`,id(req)); assert(s && (s.status === 'published' || s.creator_id === req.user?.id),404,'NOT_FOUND','Series not found.');
    const episodes = all('SELECT id,series_id,title,number,duration,bytes FROM episodes WHERE series_id=? ORDER BY number',id(req)).map(e => ({...e,free:e.number <= s.free_episodes,unlocked:canWatch(req.user?.id,{...e,...{free_episodes:s.free_episodes,creator_id:s.creator_id}})}));
    res.json({ series: serializeSeries(s,req.user?.id), episodes });
  });
  app.get('/api/series/:id/cover', async (req,res) => {
    const s = one('SELECT cover_key,status,creator_id FROM series WHERE id=?',id(req)); assert(s?.cover_key && (s.status === 'published' || s.creator_id === req.user?.id),404,'NOT_FOUND','Cover not found.');
    if (s.cover_key.startsWith('public:')) { res.redirect(s.cover_key.slice(7)); return; } await serveObject(s.cover_key,req,res,'image/webp');
  });
  app.post('/api/series/:id/save', requireAuth, (req,res) => {
    assert(one("SELECT id FROM series WHERE id=? AND status='published'",id(req)),404,'NOT_FOUND','Series not found.');
    const saved = one('SELECT 1 FROM saves WHERE user_id=? AND series_id=?',req.user!.id,id(req));
    if (saved) run('DELETE FROM saves WHERE user_id=? AND series_id=?',req.user!.id,id(req)); else run('INSERT INTO saves VALUES (?,?)',req.user!.id,id(req));
    res.json({ saved: !saved });
  });
  app.get('/api/episodes/:id/stream', async (req,res) => {
    const e = episodeRow(id(req)); assert(e && (e.status === 'published' || e.creator_id === req.user?.id),404,'NOT_FOUND','Episode not found.');
    assert(canWatch(req.user?.id,e),403,'EPISODE_LOCKED','Unlock this episode to watch.');
    if(req.method==='GET'&&req.user?.id!==e.creator_id){
      const key=crypto.createHash('sha256').update(`${req.user?.id||req.ip}:${e.id}`).digest('hex');const now=Date.now();
      if((recentViews.get(key)||0)<now-15*60_000){recentViews.set(key,now);run('UPDATE series SET views=views+1 WHERE id=?',e.series_id);}
      if(recentViews.size>10000)for(const[k,v]of recentViews)if(v<now-15*60_000)recentViews.delete(k);
    }
    await serveObject(e.storage_key,req,res,'video/mp4');
  });
  app.post('/api/episodes/:id/unlock', requireAuth, (req,res) => res.json({ ...unlockEpisode(req.user!.id,id(req)), user: getUser(req.user!.id) }));
  app.post('/api/episodes/:id/progress', requireAuth, (req,res) => {
    const e = episodeRow(id(req)); assert(e && canWatch(req.user!.id,e),403,'EPISODE_LOCKED','Unlock this episode to watch.');
    const { seconds } = z.object({ seconds: z.number().min(0).max(180) }).parse(req.body);
    run("INSERT INTO progress (user_id,episode_id,seconds) VALUES (?,?,?) ON CONFLICT(user_id,episode_id) DO UPDATE SET seconds=excluded.seconds,updated_at=datetime('now')",req.user!.id,id(req),Math.min(seconds,e.duration)); res.json({ ok:true });
  });
  app.get('/api/history', requireAuth, (req,res) => {
    const rows=all(`SELECT s.*,u.name AS creator_name,e.id AS episode_id,e.number AS episode_number,e.duration,p.seconds,p.updated_at AS watched_at,
      (SELECT COUNT(*) FROM episodes ep WHERE ep.series_id=s.id) AS episode_count,(SELECT COUNT(*) FROM saves sv WHERE sv.series_id=s.id) AS saves
      FROM progress p JOIN episodes e ON e.id=p.episode_id JOIN series s ON s.id=e.series_id JOIN users u ON u.id=s.creator_id WHERE p.user_id=? AND s.status='published' ORDER BY p.updated_at DESC LIMIT 50`,req.user!.id);
    const seen=new Set(); res.json({ history: rows.filter(s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;}).map(s=>serializeSeries(s,req.user!.id)) });
  });
  app.get('/api/wallet', requireAuth, (req,res) => res.json({ user: getUser(req.user!.id), ledger: all('SELECT * FROM ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',req.user!.id), payments: all('SELECT id,kind,amount_cents,currency,status,created_at FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 30',req.user!.id) }));
  app.post('/api/payments/checkout', requireAuth, rateLimit('checkout',20,60_000), async (req,res) => {
    const body=z.object({kind:z.enum(['funding','activation']),amount_cents:z.number().int().min(500).max(20000).default(1000)}).parse(req.body);
    res.json(await createCheckout(req.user!.id,body.kind,body.amount_cents));
  });
  app.post('/api/payments/:id/demo-confirm', requireAuth, (req,res) => {
    assert(config.payments==='demo' && !config.production,404,'NOT_FOUND','Not found.');
    const payment=one('SELECT * FROM payments WHERE id=? AND user_id=?',id(req),req.user!.id); assert(payment?.provider==='demo',404,'NOT_FOUND','Payment not found.');
    settlePayment(payment.id); res.json({ user:getUser(req.user!.id) });
  });
  app.post('/api/payments/reconcile', requireAuth, async (req,res) => {
    const { session_id }=z.object({session_id:z.string().max(300)}).parse(req.body); assert(stripe && config.payments==='stripe',503,'PAYMENTS_UNAVAILABLE','Payments unavailable.');
    const payment=one('SELECT * FROM payments WHERE provider_session=? AND user_id=?',session_id,req.user!.id);assert(payment,404,'NOT_FOUND','Payment not found.');
    const session=await stripe.checkout.sessions.retrieve(session_id);
    if(session.payment_status==='paid')settlePayment(payment.id,{amount:session.amount_total!,currency:session.currency!,session:session.id});
    res.json({ paid:session.payment_status==='paid',user:getUser(req.user!.id) });
  });
  app.get('/api/studio', requireAuth, (req,res) => {
    const user=req.user!;res.json({ user:getUser(user.id),series:all(`${catalogSelect} WHERE s.creator_id=? ORDER BY s.created_at DESC`,user.id).map(s=>serializeSeries(s,user.id)),
      stats:one('SELECT COUNT(*) AS sales,COALESCE(SUM(p.creator_micros),0) AS lifetime_micros FROM purchases p JOIN episodes e ON e.id=p.episode_id JOIN series s ON s.id=e.series_id WHERE s.creator_id=?',user.id),
      withdrawals:all('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC',user.id), storageRequests:all('SELECT * FROM storage_requests WHERE user_id=? ORDER BY created_at DESC',user.id) });
  });
  app.post('/api/studio/series', requirePublisher, (req,res) => {
    const b=seriesSchema.parse(req.body);const seriesId=crypto.randomUUID();
    run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes) VALUES (?,?,?,?,?,?,?,?,?)',seriesId,req.user!.id,b.title,b.description,b.language,JSON.stringify(b.genres),b.creation_type,b.price_cents,b.free_episodes);
    res.status(201).json({ id:seriesId });
  });
  app.patch('/api/studio/series/:id', requirePublisher, (req,res) => {
    ownSeries(req);const b=seriesSchema.parse(req.body);
    run("UPDATE series SET title=?,description=?,language=?,genres=?,creation_type=?,price_cents=?,free_episodes=?,updated_at=datetime('now') WHERE id=?",b.title,b.description,b.language,JSON.stringify(b.genres),b.creation_type,b.price_cents,b.free_episodes,id(req));res.json({ok:true});
  });
  app.post('/api/studio/series/:id/cover', requirePublisher, (req,_res,next)=>{ownSeries(req);next();}, coverUpload.single('cover'), async (req,res) => {
    assert(req.file,400,'FILE_REQUIRED','Choose a cover image.'); let processed: {path:string;bytes:number}|undefined;const key=`covers/${crypto.randomUUID()}.webp`;let saved=false;
    try {
      processed=await prepareCover(req.file.path);await putObject(processed.path,key,'image/webp');saved=true;
      const old=transaction(()=>{const s=ownSeries(req);const u=getUser(req.user!.id)!;assert(u.used_bytes-s.cover_bytes+processed!.bytes<=u.quota_bytes,413,'QUOTA_EXCEEDED','This cover exceeds your storage allowance.');run('UPDATE users SET used_bytes=used_bytes-?+? WHERE id=?',s.cover_bytes,processed!.bytes,u.id);run('UPDATE series SET cover_key=?,cover_bytes=? WHERE id=?',key,processed!.bytes,s.id);return s.cover_key;});
      saved=false;
      if(old)deleteObject(old).catch(error=>console.error('Old cover cleanup failed',error));res.json({cover:`/api/series/${id(req)}/cover`,user:getUser(req.user!.id)});
    } catch(error) { if(saved)await deleteObject(key);throw error; }
    finally {await removeTempFile(req.file.path);if(processed)await removeTempFile(processed.path);}
  });
  app.post('/api/studio/series/:id/episodes', requirePublisher, rateLimit('upload',60,60_000), (req,_res,next)=>{ownSeries(req);next();}, upload.single('video'), async (req,res) => {
    assert(req.file,400,'FILE_REQUIRED','Choose an episode video.');let processed:{path:string;bytes:number;duration:number}|undefined;const key=`videos/${req.user!.id}/${crypto.randomUUID()}.mp4`;let saved=false;
    try {
      const body=z.object({title:z.string().trim().min(1).max(120),number:z.coerce.number().int().min(1).max(1000)}).parse(req.body);
      assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=?',id(req),body.number),409,'EPISODE_EXISTS','An episode with this number already exists.');
      const u=getUser(req.user!.id)!;assert(u.used_bytes+req.file.size<=u.quota_bytes,413,'QUOTA_EXCEEDED','Not enough storage. Request an increase from your studio.');
      processed=await prepareVideo(req.file.path);await putObject(processed.path,key,'video/mp4');saved=true;
      const episodeId=transaction(()=>{ownSeries(req);const user=getUser(req.user!.id)!;assert(user.used_bytes+processed!.bytes<=user.quota_bytes,413,'QUOTA_EXCEEDED','Not enough storage. Request an increase.');
        assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=?',id(req),body.number),409,'EPISODE_EXISTS','An episode with this number already exists.');
        const eid=crypto.randomUUID();run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key,original_name) VALUES (?,?,?,?,?,?,?,?)',eid,id(req),body.title,body.number,processed!.duration,processed!.bytes,key,req.file!.originalname.slice(0,255));run('UPDATE users SET used_bytes=used_bytes+? WHERE id=?',processed!.bytes,user.id);return eid;});
      res.status(201).json({id:episodeId,user:getUser(req.user!.id),duration:processed.duration,bytes:processed.bytes});
    }catch(error){if(saved)await deleteObject(key);throw error;}
    finally{await removeTempFile(req.file.path);if(processed)await removeTempFile(processed.path);}
  });
  app.patch('/api/studio/episodes/:id', requirePublisher, (req,res) => {
    const e=episodeRow(id(req));assert(e,404,'NOT_FOUND','Episode not found.');ownSeries(req,e.series_id);
    const b=z.object({title:z.string().trim().min(1).max(120),number:z.number().int().min(1).max(1000)}).parse(req.body);
    assert(!one('SELECT id FROM episodes WHERE series_id=? AND number=? AND id<>?',e.series_id,b.number,e.id),409,'EPISODE_EXISTS','This episode number is already in use.');run('UPDATE episodes SET title=?,number=? WHERE id=?',b.title,b.number,e.id);res.json({ok:true});
  });
  app.delete('/api/studio/episodes/:id', requirePublisher, async (req,res) => {
    const e=transaction(()=>{const ep=episodeRow(id(req));assert(ep,404,'NOT_FOUND','Episode not found.');ownSeries(req,ep.series_id);assert(!one('SELECT id FROM purchases WHERE episode_id=?',ep.id),409,'EPISODE_PURCHASED','Purchased episodes must remain available. Archive the series to stop new sales.');run('DELETE FROM episodes WHERE id=?',ep.id);run('UPDATE users SET used_bytes=MAX(0,used_bytes-?) WHERE id=?',ep.bytes,req.user!.id);return ep;});
    await deleteObject(e.storage_key);res.json({ok:true,user:getUser(req.user!.id)});
  });
  app.post('/api/studio/series/:id/status', requirePublisher, (req,res) => {
    const s=ownSeries(req);const {status}=z.object({status:z.enum(['draft','published','archived'])}).parse(req.body);
    if(status==='published'){assert(s.cover_key,400,'COVER_REQUIRED','Add a cover before publishing.');assert(one('SELECT id FROM episodes WHERE series_id=?',s.id),400,'EPISODES_REQUIRED','Upload at least one episode before publishing.');}
    if(status!=='published')assert(!one('SELECT p.id FROM purchases p JOIN episodes e ON e.id=p.episode_id WHERE e.series_id=?',s.id),409,'HAS_PURCHASES','This series has paid viewers. Contact support before removing access.');
    run('UPDATE series SET status=? WHERE id=?',status,s.id);res.json({ok:true});
  });
  app.post('/api/studio/storage-requests', requirePublisher, (req,res) => {
    const b=z.object({requested_gb:z.number().int().min(6).max(1000),reason:z.string().trim().min(10).max(1000)}).parse(req.body);
    assert(!one("SELECT id FROM storage_requests WHERE user_id=? AND status='pending'",req.user!.id),409,'REQUEST_PENDING','You already have a storage request awaiting review.');
    assert(b.requested_gb*1024**3>req.user!.quota_bytes,400,'INVALID_QUOTA','Request a larger total storage allowance.');
    run('INSERT INTO storage_requests (id,user_id,requested_gb,reason) VALUES (?,?,?,?)',crypto.randomUUID(),req.user!.id,b.requested_gb,b.reason);res.status(201).json({ok:true});
  });
  app.post('/api/studio/connect', requirePublisher, async (req,res) => {
    assert(stripe && config.payments==='stripe',503,'PAYMENTS_UNAVAILABLE','Payout onboarding is not configured yet.');
    let account=req.user!.stripe_account_id;
    if(!account){const created=await stripe.accounts.create({type:'express',email:req.user!.email,capabilities:{transfers:{requested:true}},metadata:{userId:req.user!.id}});account=created.id;run('UPDATE users SET stripe_account_id=? WHERE id=?',account,req.user!.id);}
    const link=await stripe.accountLinks.create({account,refresh_url:`${config.appUrl}/studio?connect=retry`,return_url:`${config.appUrl}/studio?connect=done`,type:'account_onboarding'});res.json({url:link.url});
  });
  app.post('/api/studio/withdrawals', requirePublisher, async (req,res) => {
    const b=z.object({amount_cents:z.number().int().min(1).max(10000000),note:z.string().max(500).default('')}).parse(req.body);
    if(config.payments==='stripe') {assert(stripe && req.user!.stripe_account_id,400,'CONNECT_REQUIRED','Connect your payout account first.');const account=await stripe.accounts.retrieve(req.user!.stripe_account_id);assert(account.payouts_enabled,400,'CONNECT_REQUIRED','Complete your payout account verification first.');}
    else assert(config.payments==='demo' && !config.production,503,'PAYMENTS_UNAVAILABLE','Payouts are not configured yet.');
    res.status(201).json({id:requestWithdrawal(req.user!.id,b.amount_cents,b.note),user:getUser(req.user!.id)});
  });
  app.get('/api/admin', requireAdmin, (_req,res) => res.json({
    stats:{users:one('SELECT COUNT(*) AS n FROM users')!.n,publishers:one('SELECT COUNT(*) AS n FROM users WHERE publisher_active=1')!.n,
      sales:one('SELECT COUNT(*) AS n,COALESCE(SUM(price_micros),0) AS gross_micros,COALESCE(SUM(platform_micros),0) AS platform_micros FROM purchases'),activation_hkd:one("SELECT COALESCE(SUM(amount_cents),0)/100.0 AS n FROM payments WHERE kind='activation' AND status='paid'")!.n},
    storageRequests:all('SELECT r.*,u.name,u.email,u.quota_bytes,u.used_bytes FROM storage_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC'),
    withdrawals:all('SELECT w.*,u.name,u.email,u.stripe_account_id FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC'),
    users:all('SELECT id,name,email,role,publisher_active,quota_bytes,used_bytes FROM users ORDER BY created_at DESC LIMIT 200'),
  }));
  app.post('/api/admin/storage-requests/:id', requireAdmin, (req,res) => {
    const {approve}=z.object({approve:z.boolean()}).parse(req.body);
    transaction(()=>{const r=one("SELECT * FROM storage_requests WHERE id=? AND status='pending'",id(req));assert(r,404,'NOT_FOUND','Pending request not found.');if(approve)run('UPDATE users SET quota_bytes=MAX(quota_bytes,?) WHERE id=?',r.requested_gb*1024**3,r.user_id);run('UPDATE storage_requests SET status=? WHERE id=?',approve?'approved':'rejected',r.id);});res.json({ok:true});
  });
  app.post('/api/admin/withdrawals/:id', requireAdmin, async (req,res) => {
    const {approve}=z.object({approve:z.boolean()}).parse(req.body);
    const w=one('SELECT w.*,u.stripe_account_id FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.id=?',id(req));assert(w,404,'NOT_FOUND','Payout not found.');
    if(!approve){transaction(()=>{const current=one('SELECT * FROM withdrawals WHERE id=?',w.id)!;assert(current.status==='pending',409,'ALREADY_PROCESSED','This payout is already being processed.');run("UPDATE withdrawals SET status='rejected' WHERE id=?",w.id);run('UPDATE users SET earnings_micros=earnings_micros+? WHERE id=?',w.amount_micros,w.user_id);addLedger(w.user_id,'withdrawal_refund',w.amount_micros,w.id,'Payout declined · funds returned');});res.json({ok:true});return;}
    assert(w.status==='pending'||w.status==='processing',409,'ALREADY_PROCESSED','This payout is already processed.');
    run("UPDATE withdrawals SET status='processing' WHERE id=? AND status='pending'",w.id);
    if(config.payments==='stripe'){
      assert(stripe && w.stripe_account_id,400,'CONNECT_REQUIRED','Publisher payout account is missing.');
      const transfer=await stripe.transfers.create({amount:Math.floor(w.amount_micros/10000),currency:'usd',destination:w.stripe_account_id,metadata:{withdrawalId:w.id}},{idempotencyKey:`withdrawal:${w.id}`});
      run("UPDATE withdrawals SET status='paid',transfer_id=? WHERE id=?",transfer.id,w.id);
    }else{assert(config.payments==='demo'&&!config.production,503,'PAYMENTS_UNAVAILABLE','Payouts unavailable.');run("UPDATE withdrawals SET status='paid',transfer_id=? WHERE id=?",`demo_${w.id}`,w.id);}
    res.json({ok:true});
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'This endpoint does not exist.'}}));
  return app;
}
export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
  if(res.headersSent)return;
  if(error instanceof ZodError){res.status(400).json({error:{code:'VALIDATION',message:error.issues[0]?.message || 'Check the information you entered.',fields:error.issues.map(x=>({path:x.path.join('.'),message:x.message}))}});return;}
  if(error instanceof multer.MulterError){res.status(413).json({error:{code:'FILE_TOO_LARGE',message:error.code==='LIMIT_FILE_SIZE'?'This file is too large. Episodes: 75 MB maximum. Covers: 5 MB maximum.':'Upload one file at a time.'}});return;}
  if(error instanceof AppError){res.status(error.status).json({error:{code:error.code,message:error.message}});return;}
  console.error(error);res.status(500).json({error:{code:'INTERNAL',message:'Something went wrong. Please try again.'}});
}
