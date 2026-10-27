import { DEMO_CATALOG as titles } from '../shared/catalog.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { one, run, transaction } from './db.js';
import { hashPassword } from './auth.js';



export async function seed() {
  if(one('SELECT id FROM users LIMIT 1'))return;
  const password=await hashPassword('DemoPass123!'); const creator='demo-creator';
  const dir=path.join(config.dataDir,'objects','demo');mkdirSync(dir,{recursive:true});
  const video=path.join(dir,'preview.mp4');
  if(!existsSync(video)) {
    const source=path.resolve('public/images/hero.jpg');
    const args=existsSync(source)?['-loop','1','-i',source]:['-f','lavfi','-i','color=c=0x191c35:s=720x1280:r=24'];
    await promisify(execFile)(config.ffmpeg,['-nostdin','-y',...args,'-f','lavfi','-i','sine=frequency=220:sample_rate=44100','-t','12','-vf',"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,drawtext=text='A NEW STORY AWAITS':fontcolor=white:fontsize=30:x=(w-tw)/2:y=h/2,drawtext=text='SAMPLE PREVIEW':fontcolor=white@0.6:fontsize=16:x=(w-tw)/2:y=h/2+54",'-af','volume=0.03','-c:v','libx264','-pix_fmt','yuv420p','-preset','ultrafast','-c:a','aac','-b:a','64k','-movflags','+faststart','-threads','2',video],{timeout:60000,maxBuffer:2*1024*1024});
  }
  const size=statSync(video).size;
  transaction(()=>{
    run('INSERT INTO users (id,email,name,password_hash,role,publisher_active,language) VALUES (?,?,?,?,?,?,?)',creator,'creator@demo.aidramio.test','Studio Afterglow',password,'publisher',1,'en');
    run('INSERT INTO users (id,email,name,password_hash,role,wallet_micros) VALUES (?,?,?,?,?,?)','demo-viewer','viewer@demo.aidramio.test','Alex Morgan',password,'viewer',10_000_000);
    run('INSERT INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,?)','demo-admin','admin@demo.aidramio.test','Platform Admin',password,'admin',1);
    let used=0;
    titles.forEach((item,index)=>{
      const [seriesId,title,description,language,genres,image,type,featured]=item;
      run('INSERT INTO series (id,creator_id,title,description,language,genres,creation_type,price_cents,free_episodes,cover_key,status,featured,demo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',seriesId,creator,title,description,language,JSON.stringify(genres),type,index%3===0?30:20,2,`public:/images/${image}.jpg`,'published',featured,1,new Date(Date.now()-index*25*60*60*1000).toISOString());
      for(let n=1;n<=8;n++){run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',`${seriesId}-${n}`,seriesId,['A chance encounter','The first secret','Crossing the line','Nothing is as it seems','A different kind of truth','The turning point','One last chance','A new beginning'][n-1],n,12,size,'demo/preview.mp4');used+=size;}
    });
    run('UPDATE users SET used_bytes=? WHERE id=?',used,creator);
  });
  console.log('Demo catalogue seeded. DemoPass123! is for local demo accounts only.');
}
if(process.argv[1]?.endsWith('/seed.ts'))await seed();
