import path from 'node:path';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { config } from './config.js';
import { createApp, errorHandler } from './app.js';
import { seed } from './seed.js';
import { one } from './db.js';

if(config.payments==='demo'&&config.production)throw new Error('Demo payments are prohibited in production. Configure Stripe or use PAYMENTS_MODE=disabled.');
if(config.seed&&config.production)throw new Error('Public demo accounts must not be seeded in production. Set SEED_DEMO=false.');
if(config.production&&one("SELECT id FROM users WHERE id IN ('demo-admin','demo-viewer','demo-creator') LIMIT 1"))throw new Error('Demo accounts are present. Use a fresh DATA_DIR for production.');
if(config.production&&config.payments==='stripe'&&!config.appUrl.startsWith('https://'))throw new Error('Live payments require an HTTPS APP_URL.');
if(config.seed)await seed();
const app=createApp();
if(!config.production){
  const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true,hmr:{port:config.port+21000}},appType:'spa'});
  app.use(vite.middlewares);
  app.use(async(req,res,next)=>{try{const html=await readFile(path.resolve('index.html'),'utf8');res.status(200).type('html').send(await vite.transformIndexHtml(req.originalUrl,html));}catch(e){vite.ssrFixStacktrace(e as Error);next(e);}});
}else{
  app.use('/assets',express.static(path.resolve('dist/client/assets'),{maxAge:'1y',immutable:true}));
  app.use(express.static(path.resolve('dist/client'),{index:false,maxAge:'1h'}));
  app.use((_req,res)=>res.sendFile(path.resolve('dist/client/index.html')));
}
app.use(errorHandler);
const server=app.listen(config.port,'0.0.0.0',()=>console.log(`AIDramio running on port ${config.port} · payments: ${config.payments}`));
server.requestTimeout=240000;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
