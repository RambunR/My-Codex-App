import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import type {Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {SeriesComment} from '../shared/series-comments-schema';

const directory=await mkdtemp(path.join(tmpdir(),'lingying-series-comments-'));
process.env.DATA_DIR=directory;
process.env.NODE_ENV='test';
process.env.SEED_DEMO='false';
process.env.PAYMENTS_MODE='disabled';
process.env.STRIPE_TEST_MODE='false';
process.env.PLATFORM_OWNER_USER_ID='';
process.env.PLATFORM_ADMIN_EMAIL_SHA256='';
process.env.PLATFORM_ADDITIONAL_ADMIN_EMAIL_SHA256='';
const {config}=await import('../server/config');
const {createApp,errorHandler}=await import('../server/app');
const {db,one,run}=await import('../server/db');

interface Actor {id:string; name:string; email:string; cookie:string}
interface Drama {id:string; title:string; episodeId:string; commentsPath:string}
let server:Server;
let base:string;

function account(name:string,role:'viewer'|'publisher'|'admin'='viewer'):Actor{
  const id=randomUUID(),token=randomBytes(32).toString('hex'),email=id+'@series-comments.test';
  run('INSERT INTO users (id,email,name,password_hash,role,publisher_active) VALUES (?,?,?,?,?,?)',id,email,name,'unused-local-hash',role,role==='viewer'?0:1);
  run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now()+3_600_000);
  return{id,name,email,cookie:'drama_session='+token};
}

function publishedDrama(owner=account('Drama creator','publisher')):Drama{
  const id=randomUUID(),title='Comments drama '+id,episodeId=randomUUID();
  run("INSERT INTO series (id,creator_id,title,description,language,genres,status,cover_key,free_episodes) VALUES (?,?,?,?,?,?,'published','public:/images/midnight.jpg',0)",id,owner.id,title,'A paid drama for local discussion tests.','en','["drama"]');
  run('INSERT INTO episodes (id,series_id,title,number,duration,bytes,storage_key) VALUES (?,?,?,?,?,?,?)',episodeId,id,'Episode 1',1,20,40,'demo/comments-fixture.mp4');
  return{id,title,episodeId,commentsPath:`/api/series/${id}/comments`};
}

interface RequestOptions {actor?:Actor; body?:unknown; method?:string; headers?:Record<string,string>}
async function request(route:string,expected:number,options:RequestOptions={}){
  const {actor,body,method='GET',headers}=options;
  const response=await fetch(base+route,{
    method,
    headers:{Origin:base,...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const raw=await response.text();
  assert.equal(response.status,expected,`${method} ${route}: ${raw}`);
  return{response,data:raw?JSON.parse(raw):undefined};
}

async function postComment(drama:Drama,actor:Actor,body:string):Promise<SeriesComment>{
  const {data}=await request(drama.commentsPath,201,{actor,body:{body},method:'POST'});
  return data.comment;
}
const commentPath=(drama:Drama,commentId:number)=>`${drama.commentsPath}/${commentId}`;
const likePath=(drama:Drama,commentId:number)=>`${commentPath(drama,commentId)}/like`;

before(async()=>{
  const app=createApp();
  app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  config.appUrl=base;
  config.publicUrl=base;
});

after(async()=>{
  if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
  db.close();
  await rm(directory,{recursive:true,force:true});
});

test('guests can read a paid drama discussion, and author details are limited to the display name',async()=>{
  const drama=publishedDrama(),author=account('Comment author');
  const empty=await request(drama.commentsPath,200);
  assert.deepEqual(empty.data,{comments:[],nextBefore:null});
  assert.match(empty.response.headers.get('Cache-Control')??'',/private, no-store/);
  assert.equal(empty.response.headers.get('X-Robots-Tag'),'noindex');

  await request(drama.commentsPath,401,{method:'POST',body:{body:'Anonymous post'}});
  const text='我喜歡這一集 🎬\n<b>A great ending!</b>';
  const comment=await postComment(drama,author,`  ${text}\t `);
  assert.ok(Number.isSafeInteger(comment.id)&&comment.id>0);
  assert.ok(Number.isSafeInteger(comment.createdAt)&&Math.abs(Date.now()-comment.createdAt)<60_000);
  assert.deepEqual(comment,{
    id:comment.id,authorName:author.name,body:text,createdAt:comment.createdAt,
    likeCount:0,likedByViewer:false,isOwn:true,
  });

  const {data}=await request(drama.commentsPath,200);
  assert.deepEqual(data,{comments:[{...comment,isOwn:false}],nextBefore:null});
  assert.ok(!JSON.stringify(data).includes(author.id));
  assert.ok(!JSON.stringify(data).includes(author.email));
  assert.deepEqual((await request(drama.commentsPath,200,{actor:author})).data.comments,[comment]);
  await request(likePath(drama,comment.id),401,{method:'PUT',body:{liked:true}});
  await request(commentPath(drama,comment.id),401,{method:'DELETE'});
});

test('only the author can delete a comment, and each other account can like and unlike it',async()=>{
  const owner=account('Drama creator','publisher'),author=account('Comment author'),viewer=account('Another viewer');
  const drama=publishedDrama(owner),otherDrama=publishedDrama(owner);
  const comment=await postComment(drama,author,'I really liked the first scene.');
  const like=likePath(drama,comment.id),remove=commentPath(drama,comment.id);

  const ownLike=await request(like,400,{actor:author,method:'PUT',body:{liked:true}});
  assert.equal(ownLike.data.error.code,'OWN_COMMENT_LIKE');
  for(const actor of [viewer,owner,account('Administrator','admin')]){
    const denied=await request(remove,403,{actor,method:'DELETE'});
    assert.equal(denied.data.error.code,'FORBIDDEN');
  }
  await request(likePath(otherDrama,comment.id),404,{actor:viewer,method:'PUT',body:{liked:true}});
  await request(commentPath(otherDrama,comment.id),404,{actor:author,method:'DELETE'});

  const setLike=async(actor:Actor,liked:boolean,likeCount:number)=>{
    const {data}=await request(like,200,{actor,method:'PUT',body:{liked}});
    assert.deepEqual(data,{likeCount,likedByViewer:liked});
  };
  await Promise.all([setLike(viewer,true,1),setLike(viewer,true,1)]);
  await setLike(owner,true,2);
  const guestList=(await request(drama.commentsPath,200)).data.comments;
  const viewerList=(await request(drama.commentsPath,200,{actor:viewer})).data.comments;
  assert.deepEqual(guestList,[{...comment,likeCount:2,isOwn:false}]);
  assert.deepEqual(viewerList,[{...comment,likeCount:2,likedByViewer:true,isOwn:false}]);
  await Promise.all([setLike(viewer,false,1),setLike(viewer,false,1)]);

  assert.equal(one('SELECT COUNT(*) AS n FROM series_comment_likes WHERE comment_id=?',comment.id)?.n,1);
  await request(remove,204,{actor:author,method:'DELETE'});
  assert.equal(one('SELECT COUNT(*) AS n FROM series_comment_likes WHERE comment_id=?',comment.id)?.n,0);
  assert.deepEqual((await request(drama.commentsPath,200)).data,{comments:[],nextBefore:null});
  await request(like,404,{actor:viewer,method:'PUT',body:{liked:true}});
});

test('cursor pages keep their order when new comments arrive and the boundary comment is deleted',async()=>{
  const drama=publishedDrama(),otherDrama=publishedDrama(),author=account('Discussion author');
  const first=await postComment(drama,author,'First comment');
  await postComment(otherDrama,author,'Only on the other drama');
  const second=await postComment(drama,author,'Second comment');
  const third=await postComment(drama,author,'Third comment');
  const fourth=await postComment(drama,author,'Fourth comment');

  const initial=(await request(`${drama.commentsPath}?limit=2`,200,{actor:author})).data;
  assert.deepEqual(initial,{comments:[fourth,third],nextBefore:third.id});
  await request(commentPath(drama,third.id),204,{actor:author,method:'DELETE'});
  const newest=await postComment(drama,author,'Newest comment after reading page one');
  const older=(await request(`${drama.commentsPath}?limit=2&before=${initial.nextBefore}`,200,{actor:author})).data;
  assert.deepEqual(older,{comments:[second,first],nextBefore:null});
  const current=(await request(`${drama.commentsPath}?limit=2`,200,{actor:author})).data;
  assert.deepEqual(current,{comments:[newest,fourth],nextBefore:fourth.id});
  assert.deepEqual((await request(`${drama.commentsPath}?before=${first.id}`,200)).data,{comments:[],nextBefore:null});
});

test('comment inputs, cursor bounds and credentialed request origins are validated',async()=>{
  const drama=publishedDrama(),author=account('Comment author'),viewer=account('Another viewer');
  const untrustedOrigin={Origin:'https://untrusted.example.test'};
  for(const body of [null,{}, {body:' \t\n　 '},{body:'\u200d'},{body:15},{body:'hi\u0000there'},{body:'\ud800'},{body:'🎬'.repeat(501)},{body:'Hello',authorName:'Imposter'}]){
    await request(drama.commentsPath,400,{actor:author,method:'POST',body});
  }
  await request(drama.commentsPath,403,{actor:author,method:'POST',body:{body:'An untrusted write'},headers:untrustedOrigin});
  assert.deepEqual((await request(drama.commentsPath,200)).data,{comments:[],nextBefore:null});

  const boundary='🎬'.repeat(500);
  const comment=await postComment(drama,author,boundary);
  assert.equal(comment.body,boundary);
  for(const query of ['limit=0','limit=-1','limit=10000','limit=1e2','limit=1&limit=2','before=0','before=1.2','before=9007199254740992']){
    await request(`${drama.commentsPath}?${query}`,400);
  }
  for(const body of [{},{liked:'true'},{liked:1},{liked:true,likeCount:500}]){
    await request(likePath(drama,comment.id),400,{actor:viewer,method:'PUT',body});
  }
  await request(likePath(drama,comment.id),403,{actor:viewer,method:'PUT',body:{liked:true},headers:untrustedOrigin});
  await request(commentPath(drama,comment.id),403,{actor:author,method:'DELETE',headers:untrustedOrigin});
  assert.deepEqual((await request(drama.commentsPath,200,{actor:author})).data.comments,[comment]);
});

test('the posting limit applies to the account across different drama discussions',async()=>{
  const first=publishedDrama(),second=publishedDrama();
  const author=account('Frequent commenter'),other=account('Independent commenter');
  for(let count=1;count<=12;count++){
    await postComment(first,author,`Comment ${count}`);
  }
  const {data}=await request(second.commentsPath,429,{actor:author,method:'POST',body:{body:'Comment 13'}});
  assert.equal(data.error.code,'RATE_LIMIT');
  assert.deepEqual((await request(second.commentsPath,200)).data,{comments:[],nextBefore:null});
  await postComment(second,other,'Another viewer may still comment.');
});

test('discussions are unavailable when the series is draft, archived, taken down, retired or has no episodes',async()=>{
  const owner=account('Drama creator','publisher'),visitor=account('Another viewer'),admin=account('Administrator','admin');
  const drama=publishedDrama(owner),comment=await postComment(drama,owner,'A comment from the publisher.');
  const assertUnavailable=async()=>{
    await request(drama.commentsPath,404);
    await request(drama.commentsPath,404,{actor:owner});
    await request(drama.commentsPath,404,{actor:owner,method:'POST',body:{body:'Try a private comment'}});
    await request(likePath(drama,comment.id),404,{actor:visitor,method:'PUT',body:{liked:true}});
    await request(commentPath(drama,comment.id),404,{actor:owner,method:'DELETE'});
  };

  for(const status of ['draft','archived']){
    run('UPDATE series SET status=? WHERE id=?',status,drama.id);
    await assertUnavailable();
  }
  run("UPDATE series SET status='published' WHERE id=?",drama.id);
  run('INSERT INTO series_moderation (series_id,taken_down,reason,actor_id) VALUES (?,1,?,?)',drama.id,'A local test takedown.',admin.id);
  await assertUnavailable();
  run('UPDATE series_moderation SET taken_down=0 WHERE series_id=?',drama.id);
  assert.deepEqual((await request(drama.commentsPath,200,{actor:owner})).data.comments,[comment]);
  run('INSERT INTO retired_catalog_series (series_id,operation_key) VALUES (?,?)',drama.id,'local-comment-test');
  await assertUnavailable();
  run('DELETE FROM retired_catalog_series WHERE series_id=?',drama.id);
  run('DELETE FROM episodes WHERE id=?',drama.episodeId);
  await assertUnavailable();
});

test('permanent series deletion removes its comments and likes with the series tombstone',async()=>{
  const owner=account('Drama creator','publisher'),author=account('Comment author');
  const drama=publishedDrama(owner),comment=await postComment(drama,author,'This discussion is removed with the drama.');
  await request(likePath(drama,comment.id),200,{actor:owner,method:'PUT',body:{liked:true}});
  const studioPath=`/api/studio/series/${drama.id}`;
  const {data:preview}=await request(`${studioPath}/lifecycle`,200,{actor:owner});
  await request(studioPath,200,{actor:owner,method:'DELETE',body:{confirmation_token:preview.confirmation_token,confirm_title:drama.title,acknowledge:true}});

  assert.ok(one('SELECT 1 FROM series_deletions WHERE series_id=?',drama.id));
  assert.equal(one('SELECT 1 FROM series_comments WHERE series_id=?',drama.id),undefined);
  assert.equal(one('SELECT 1 FROM series_comment_likes WHERE comment_id=?',comment.id),undefined);
  await request(drama.commentsPath,404);
  await request(drama.commentsPath,404,{actor:author,method:'POST',body:{body:'Try posting against the tombstone'}});
  await request(commentPath(drama,comment.id),404,{actor:author,method:'DELETE'});
});
