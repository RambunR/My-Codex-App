import express from 'express';
import {createServer} from 'node:http';
import {timingSafeEqual,randomUUID,randomBytes} from 'node:crypto';
import {handleAsNodeRequest} from 'cloudflare:node';
import type {DurableObjectState} from '@cloudflare/workers-types';
import {z} from 'zod';
// Generated from the same API source used by the standalone Node server.
import {createApp,errorHandler} from '../dist/cloudflare/server/app';
import {hashPassword,rateLimit} from '../dist/cloudflare/server/auth';
import {configureStripe} from '../dist/cloudflare/server/finance';
import {AppError,assert} from '../server/errors';
import {bindRuntime,type Env} from './runtime';
import {configure,config} from './config';
import {initializeDatabase,one,run,transaction} from './db';
import {DEMO_CATALOG} from '../shared/catalog';
import {DEMO_PREVIEW_BYTES} from './preview-meta';
import {canonicalApiRedirect,canonicalPageRedirect} from './routing';

let listening=false;
export class AIDramioApp {
  constructor(private ctx:DurableObjectState,private env:Env){
    bindRuntime(ctx.storage,env,p=>ctx.waitUntil(p));configure(env);configureStripe();initializeDatabase(ctx.storage);
    if(config.seed&&!one('SELECT id FROM series LIMIT 1'))this.seedCatalogue();
    if(!listening){
      const app=express();
      app.post('/api/admin/bootstrap',express.json({limit:'16kb'}),async(req,res,next)=>{
        try{
          const expected=env.BOOTSTRAP_TOKEN||'';const supplied=String(req.headers['x-bootstrap-token']||'');
          assert(expected.length>=32&&supplied.length===expected.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)),403,'FORBIDDEN','Bootstrap access is not configured or authorized.');
          assert(!one("SELECT id FROM users WHERE role='admin' LIMIT 1"),409,'ALREADY_CONFIGURED','An administrator already exists.');
          const b=z.object({email:z.email().max(254),name:z.string().min(2).max(60),password:z.string().min(16).max(128)}).parse(req.body);
          const password=await hashPassword(b.password);
          transaction(()=>{assert(!one("SELECT id FROM users WHERE role='admin' LIMIT 1"),409,'ALREADY_CONFIGURED','An administrator already exists.');assert(!one('SELECT id FROM users WHERE email=?',b.email.toLowerCase()),409,'EMAIL_EXISTS','This email already has an account.');run("INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,?, 'admin')",randomUUID(),b.email.toLowerCase(),b.name,password);});
          res.setHeader('Cache-Control','no-store');res.status(201).json({ok:true});
        }catch(error){next(error);}
      });
      app.use((req,_res,next)=>{const address=req.headers['cf-connecting-ip'];if(typeof address==='string')Object.defineProperty(req,'ip',{value:address,configurable:true});next();});
      app.use(createApp());app.use(errorHandler);createServer(app).listen(8080);listening=true;
    }
  }
  private seedCatalogue(){transaction(()=>{
    const creator='catalog-publisher';run("INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,?, 'publisher')",creator,'catalog@aidramio.invalid','Studio Afterglow',randomBytes(64).toString('hex'));
    DEMO_CATALOG.forEach((item,index)=>{
      const[sid,title,description,language,genres,image,type,featured]=item;
      run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,status,featured,demo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',sid,creator,title,description,language,JSON.stringify(genres),type,config.sandbox?10:30,config.sandbox&&index===0?1:8,`public:/images/${image}.jpg`,'published',featured,1,new Date(Date.now()-index*25*60*60*1000).toISOString());
      for(let n=1;n<=8;n++)run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',`${sid}-${n}`,sid,`Sample preview ${n}`,n,12,DEMO_PREVIEW_BYTES,'demo/preview.mp4');
    });
  });}
  async fetch(request:Request){
    bindRuntime(this.ctx.storage,this.env,p=>this.ctx.waitUntil(p));
    if(!this.env.APP_URL&&config.appUrl==='https://aidramio.example')config.appUrl=new URL(request.url).origin;
    return handleAsNodeRequest(8080,request);
  }
}
export default {
  async fetch(request:Request,env:Env){
    const url=new URL(request.url);
    if(env.ENVIRONMENT==='sandbox'&&url.origin!==env.APP_URL)return new Response('This payment sandbox is available only on its isolated origin.',{status:403});
    const canonical=canonicalApiRedirect(request,env)||canonicalPageRedirect(request,env);if(canonical)return canonical;
    if(url.pathname.startsWith('/api/'))return env.APP.get(env.APP.idFromName('platform')).fetch(request as any) as unknown as Promise<Response>;
    const response=await env.ASSETS.fetch(request as any) as unknown as Response;
    if(url.pathname==='/auth'){
      const headers=new Headers(response.headers);headers.set('Referrer-Policy','no-referrer');headers.set('Cache-Control','no-store');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  },
};
