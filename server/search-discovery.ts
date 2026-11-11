import type {Express} from 'express';
import {all,one} from './db.js';
import {config} from './config.js';
import {publicSeriesAllowedSql} from './moderation.js';
import {publisherNameSql} from './publisher-profile-sql.js';
import {discoveryRobots,escapeSearchHtml,missingSearchDocument,publisherSearchDocument,searchOrigin,searchRoute,seriesSearchDocument,sitemapXml,staticSearchDocument,type SearchDocument,type SearchSeries} from '../shared/search-discovery.js';

const PAGE_SIZE=1000;
const visible=`s.status='published' AND ${publicSeriesAllowedSql('s')} AND EXISTS(SELECT 1 FROM episodes e WHERE e.series_id=s.id)`;
const publisherId=`COALESCE((SELECT p.id FROM series_publisher_profiles a JOIN publisher_profiles p ON p.id=a.publisher_id WHERE a.series_id=s.id),(SELECT p.id FROM publisher_profiles p WHERE p.is_official=1 AND p.legacy_owner_id=s.creator_id),(SELECT a.public_id FROM account_public_publishers a WHERE a.user_id=s.creator_id))`;
const query=`SELECT s.id,s.title,s.description,s.language,s.genres,s.cover_key,s.updated_at,${publisherNameSql()} AS publisher_name,${publisherId} AS publisher_id,(SELECT COUNT(*) FROM episodes e WHERE e.series_id=s.id) AS episode_count FROM series s JOIN users u ON u.id=s.creator_id`;
type Row=Record<string,any>;
export function searchSiteOrigin(){return searchOrigin(config.publicUrl||config.appUrl);}
function safeSeries(row:Row):SearchSeries{
  let genres:string[]=[];try{const value=JSON.parse(row.genres);if(Array.isArray(value))genres=value.filter(item=>typeof item==='string');}catch{}
  return{id:row.id,title:row.title,description:row.description,language:row.language,genres,episodeCount:Number(row.episode_count),...(row.cover_key?{cover:'/api/series/'+encodeURIComponent(row.id)+'/cover'}:{}),...(row.publisher_id?{publisher:{id:row.publisher_id,name:row.publisher_name}}:{}),updatedAt:row.updated_at};
}
function publicSeries({limit=60,offset=0,sort='new'}:{limit?:number;offset?:number;sort?:'new'|'popular'}={}){
  return all<Row>(query+` WHERE ${visible} ORDER BY ${sort==='popular'?'s.views DESC,':''}s.created_at DESC,s.id LIMIT ? OFFSET ?`,limit,offset).map(safeSeries);
}
/** Anonymous/public data only. Never adapt discovery to an authenticated owner,
 * and never serialize creator IDs, account emails, storage keys or finances. */
export function searchDocumentForPath(path:string):SearchDocument{
  const origin=searchSiteOrigin(),route=searchRoute(path);
  if(config.sandbox)return{...staticSearchDocument('/auth',origin),canonical:origin+route.path};
  if(route.kind==='series'){
    const row=one<Row>(query+` WHERE ${visible} AND s.id=?`,route.id);
    return row?seriesSearchDocument(safeSeries(row),origin):missingSearchDocument(path,origin);
  }
  if(route.kind==='publisher'){
    const series=all<Row>(query+` WHERE ${visible} AND (${publisherId})=? ORDER BY s.created_at DESC,s.id LIMIT 100`,route.id).map(safeSeries);
    if(series.length){const publisher=series[0].publisher!;return publisherSearchDocument(publisher,series,origin);}
    // Managed profiles are public attribution even before the first release;
    // they stay usable but thin/empty profiles are not suggested for indexing.
    const profile=one<{id:string;display_name:string}>('SELECT id,display_name FROM publisher_profiles WHERE id=?',route.id);
    return profile?{...publisherSearchDocument({id:profile.id,name:profile.display_name},[],origin),robots:'noindex, follow'}:missingSearchDocument(path,origin);
  }
  return staticSearchDocument(path,origin,['home','browse','rankings'].includes(route.kind)?publicSeries({sort:route.kind==='rankings'?'popular':'new'}):[]);
}
const staticPaths=['/','/browse','/rankings','/help','/terms','/privacy'];
function sitemapUrls(series:SearchSeries[],includeStatic=true){
  const origin=searchSiteOrigin(),urls:Array<{url:string;updatedAt?:string}>=includeStatic?staticPaths.map(path=>({url:origin+path})):[];
  const publishers=new Set<string>();
  for(const item of series){urls.push({url:origin+'/series/'+encodeURIComponent(item.id),updatedAt:item.updatedAt});if(item.publisher)publishers.add(item.publisher.id);}
  for(const id of publishers)urls.push({url:origin+'/publishers/'+encodeURIComponent(id)});
  return urls;
}
export function searchSitemap(page?:number){
  if(config.sandbox)return sitemapXml([]);
  const total=Number(one<{n:number}>(`SELECT COUNT(*) AS n FROM series s WHERE ${visible}`)!.n);
  if(page!==undefined){if(!Number.isSafeInteger(page)||page<1||page>Math.max(1,Math.ceil(total/PAGE_SIZE)))return null;return sitemapXml(sitemapUrls(publicSeries({limit:PAGE_SIZE,offset:(page-1)*PAGE_SIZE}),page===1));}
  if(total<=PAGE_SIZE)return sitemapXml(sitemapUrls(publicSeries({limit:PAGE_SIZE})));
  const origin=searchSiteOrigin();return'<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Array.from({length:Math.ceil(total/PAGE_SIZE)},(_,index)=>`<sitemap><loc>${escapeSearchHtml(origin+'/sitemap-page.xml?page='+(index+1))}</loc></sitemap>`).join('')+'</sitemapindex>';
}
export function registerSearchDiscovery(app:Express){
  app.get('/api/discovery/document',(req,res)=>{
    const path=req.query.path;if(typeof path!=='string'||path.length>2048){res.status(400).json({error:{code:'INVALID_DISCOVERY_PATH',message:'Choose a valid page path.'}});return;}
    const document=searchDocumentForPath(path);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex');res.status(document.status).json(document);
  });
  const sitemap=(req:any,res:any)=>{const raw=req.query.page;const page=raw===undefined?undefined:typeof raw==='string'&&/^\d{1,8}$/u.test(raw)?Number(raw):NaN;const xml=searchSitemap(page);res.setHeader('Cache-Control','private, no-store');if(xml===null){res.status(404).type('text/plain').send('Sitemap not found.');return;}res.type('application/xml').send(xml);};
  app.get(['/sitemap.xml','/api/discovery/sitemap.xml'],sitemap);
  app.get(['/sitemap-page.xml','/api/discovery/sitemap-page.xml'],(req,res)=>{if(req.query.page===undefined){res.status(404).type('text/plain').send('Sitemap not found.');return;}sitemap(req,res);});
  app.get(['/robots.txt','/api/discovery/robots.txt'],(_req,res)=>{res.setHeader('Cache-Control','private, no-store');res.type('text/plain').send(discoveryRobots(searchSiteOrigin(),config.sandbox));});
}
