import {CUSTOM_SITE_ORIGIN} from './site-origins.js';

export const SEARCH_BRAND='LingYing 靈映';
export const SEARCH_DESCRIPTION='Watch short dramas on LingYing (靈映 / 灵映). Discover AI-generated, AI-assisted and human-created stories from independent creators in multiple languages.';
export interface SearchSeries {id:string;title:string;description:string;language:string;genres:string[];episodeCount:number;cover?:string;publisher?:{id:string;name:string};updatedAt?:string}
export interface SearchDocument {version:1;status:number;title:string;description:string;canonical:string;robots:string;snapshotHtml:string;schema:unknown;image?:string}
export type SearchRoute={kind:'home'|'browse'|'rankings'|'help'|'terms'|'privacy'|'private'|'missing';path:string}|{kind:'series'|'publisher';path:string;id:string};
const publicPaths:Record<string,'home'|'browse'|'rankings'|'help'|'terms'|'privacy'>={'/':'home','/browse':'browse','/rankings':'rankings','/help':'help','/terms':'terms','/privacy':'privacy'};
export function searchRoute(value:string):SearchRoute{
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f]/u.test(value))return{kind:'missing',path:'/404'};
  const path=value.split(/[?#]/u)[0]||'/';
  if(publicPaths[path])return{kind:publicPaths[path],path};
  const match=/^\/(series|publishers)\/([^/]+)\/?$/u.exec(path);
  if(match){try{const id=decodeURIComponent(match[2]);if(!id||id.length>128||/[\/\\\u0000-\u001f]/u.test(id)||id==='.'||id==='..')return{kind:'missing',path:'/404'};return{kind:match[1]==='series'?'series':'publisher',path:`/${match[1]}/${encodeURIComponent(id)}`,id};}catch{return{kind:'missing',path:'/404'};}}
  if(/^\/(auth|account|wallet|library|studio|admin|watch)(?:\/|$)/u.test(path))return{kind:'private',path};
  return{kind:'missing',path};
}
/** Application route IDs may contain dots. Recognize them before excluding
 * static asset extensions, so they still receive correct 404/noindex metadata. */
export function searchPageRequest(pathname:string){
  if(/^\/(series|publishers|auth|account|wallet|library|studio|admin|watch)(?:\/|$)/u.test(pathname))return true;
  return !pathname.startsWith('/api/')&&!pathname.startsWith('/assets/')&&!pathname.startsWith('/src/')&&!pathname.startsWith('/@')&&!pathname.startsWith('/node_modules/')&&!/\.[A-Za-z0-9]{1,10}$/u.test(pathname);
}
export function searchOrigin(value= CUSTOM_SITE_ORIGIN){
  try{const url=new URL(value);if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return CUSTOM_SITE_ORIGIN;return url.origin;}catch{return CUSTOM_SITE_ORIGIN;}
}
export const escapeSearchHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const metaDescription=(text:string)=>Array.from(text.replace(/\s+/gu,' ').trim()).slice(0,180).join('');
export const searchSchemaText=(value:unknown)=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const seriesPath=(id:string)=>'/series/'+encodeURIComponent(id);
function navigation(){return'<nav aria-label="LingYing"><a href="/">LingYing 靈映 · 灵映</a> · <a href="/browse">Explore short dramas</a> · <a href="/rankings">Top charts</a> · <a href="/help">Help</a></nav>';}
function seriesList(series:SearchSeries[]){return'<ul>'+series.map(item=>`<li><article><h2><a href="${escapeSearchHtml(seriesPath(item.id))}">${escapeSearchHtml(item.title)}</a></h2><p>${escapeSearchHtml(metaDescription(item.description))}</p><p>${escapeSearchHtml(item.language)} · ${item.episodeCount} episodes${item.publisher?` · <a href="/publishers/${encodeURIComponent(item.publisher.id)}">${escapeSearchHtml(item.publisher.name)}</a>`:''}</p></article></li>`).join('')+'</ul>';}
function snapshot(heading:string,content:string){return`<section class="search-snapshot" data-search-snapshot>${navigation()}<main><h1>${escapeSearchHtml(heading)}</h1>${content}</main><footer><p>LingYing 靈映 · 灵映 is operated by HK NovaXR Production.</p><a href="/terms">Terms of Use</a> · <a href="/privacy">Privacy Policy</a> · <a href="mailto:contactus@hknovaxrproduction.com">Contact us</a></footer></section>`;}
export function staticSearchDocument(path:string,origin:string,series:SearchSeries[]=[]):SearchDocument{
  const base=searchOrigin(origin),route=searchRoute(path),canonical=base+route.path;
  const pages={home:{title:`${SEARCH_BRAND} | AI & Creator Short Dramas`,heading:'LingYing 靈映 · Short dramas, original stories',description:SEARCH_DESCRIPTION},browse:{title:`Explore Short Dramas | ${SEARCH_BRAND}`,heading:'Explore short dramas',description:'Browse original short dramas by language, genre and production style on LingYing 靈映. Discover AI-generated, AI-assisted and human-created stories.'},rankings:{title:`Popular Short Dramas | ${SEARCH_BRAND}`,heading:'Popular short dramas',description:'Discover popular short dramas from independent creators on LingYing 靈映.'},help:{title:`Help & Contact | ${SEARCH_BRAND}`,heading:'LingYing help and contact',description:'Get help with watching short dramas, publishing a series and using LingYing. Contact HK NovaXR Production at contactus@hknovaxrproduction.com.'},terms:{title:`Terms of Use | ${SEARCH_BRAND}`,heading:'LingYing Terms of Use',description:'Read the LingYing Terms of Use, including creator ownership, publishing, episode purchases and platform policies.'},privacy:{title:`Privacy Policy | ${SEARCH_BRAND}`,heading:'LingYing Privacy Policy',description:'Read how LingYing and HK NovaXR Production handle account information, purchases, creator uploads and viewing statistics.'}};
  if(route.kind==='private'||route.kind==='series'||route.kind==='publisher'||route.kind==='missing'){
    const missing=route.kind==='missing';return{version:1,status:missing?404:200,title:`${missing?'Page not found':'LingYing'} | ${SEARCH_BRAND}`,description:SEARCH_DESCRIPTION,canonical,robots:'noindex, nofollow',snapshotHtml:snapshot(missing?'Page not found':'LingYing 靈映',`<p>${missing?'This page is not available.':'Explore original short dramas on LingYing.'}</p><a href="/browse">Explore available series</a>`),schema:null};
  }
  const page=pages[route.kind],schema=route.kind==='home'?{'@context':'https://schema.org','@graph':[{'@type':'WebSite','@id':base+'/#website',name:'LingYing',alternateName:['靈映','灵映','LingYing Drama','LingYingDrama'],url:base+'/',description:SEARCH_DESCRIPTION,publisher:{'@id':base+'/#organization'}},{'@type':'Organization','@id':base+'/#organization',name:'HK NovaXR Production',url:base+'/',logo:base+'/icon-512.png',contactPoint:{'@type':'ContactPoint',email:'contactus@hknovaxrproduction.com',contactType:'customer support'}}]}:{'@context':'https://schema.org','@type':series.length?'CollectionPage':'WebPage',name:page.title,url:canonical,description:page.description,...(series.length?{mainEntity:{'@type':'ItemList',itemListElement:series.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.title,url:base+seriesPath(item.id)}))}}:{})};
  const intro=route.kind==='home'||route.kind==='browse'?`<p>${escapeSearchHtml(SEARCH_DESCRIPTION)}</p><p>Choose from multiple languages and genres. Creators can publish AI-generated, AI-assisted or human-created dramas and set their episode unlock prices.</p>`:`<p>${escapeSearchHtml(page.description)}</p>`;
  return{version:1,status:200,title:page.title,description:page.description,canonical,robots:'index, follow',snapshotHtml:snapshot(page.heading,intro+seriesList(series)),schema};
}
export function seriesSearchDocument(series:SearchSeries,origin:string):SearchDocument{
  const base=searchOrigin(origin),canonical=base+seriesPath(series.id),description=metaDescription(series.description)||`Watch ${series.title} on LingYing 靈映.`;
  const publisher=series.publisher?`<p>By <a href="/publishers/${encodeURIComponent(series.publisher.id)}">${escapeSearchHtml(series.publisher.name)}</a></p>`:'';
  const image=series.cover?new URL(series.cover,base).href:undefined;
  return{version:1,status:200,title:`${series.title} | ${SEARCH_BRAND}`,description,canonical,robots:'index, follow',...(image?{image}:{}),snapshotHtml:snapshot(series.title,`${publisher}<p>${escapeSearchHtml(series.description)}</p><p>${escapeSearchHtml(series.language)} · ${series.episodeCount} episodes</p><a href="${escapeSearchHtml(seriesPath(series.id))}#episodes">Browse episodes</a>`),schema:{'@context':'https://schema.org','@type':'TVSeries',name:series.title,description:series.description,url:canonical,inLanguage:series.language,genre:series.genres,numberOfEpisodes:series.episodeCount,...(image?{image}:{}),...(series.publisher?{creator:{name:series.publisher.name,url:base+'/publishers/'+encodeURIComponent(series.publisher.id)}}:{})}};
}
export function publisherSearchDocument(publisher:{id:string;name:string},series:SearchSeries[],origin:string):SearchDocument{
  const base=searchOrigin(origin),canonical=base+'/publishers/'+encodeURIComponent(publisher.id),title=`${publisher.name} — Short Dramas | ${SEARCH_BRAND}`,description=metaDescription(`Watch short dramas published by ${publisher.name} on LingYing 靈映. Browse their available series and original stories.`);
  return{version:1,status:200,title,description,canonical,robots:'index, follow',snapshotHtml:snapshot(publisher.name,`<p>${escapeSearchHtml(description)}</p>${seriesList(series)}`),schema:{'@context':'https://schema.org','@type':'CollectionPage',name:title,description,url:canonical,mainEntity:{'@type':'ItemList',itemListElement:series.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.title,url:base+seriesPath(item.id)}))}}};
}
export function missingSearchDocument(path:string,origin:string):SearchDocument{
  const result=staticSearchDocument('/404',origin);return{...result,canonical:searchOrigin(origin)+searchRoute(path).path,status:404};
}
export function isSearchDocument(value:unknown):value is SearchDocument{
  if(!value||typeof value!=='object')return false;const d=value as Partial<SearchDocument>;
  return d.version===1&&(d.status===200||d.status===404)&&typeof d.title==='string'&&typeof d.description==='string'&&typeof d.canonical==='string'&&typeof d.robots==='string'&&typeof d.snapshotHtml==='string'&&Object.hasOwn(d,'schema');
}
export function searchHead(document:SearchDocument){
  const h=escapeSearchHtml,d=document,image=d.image||new URL('/icon-512.png',d.canonical).href;return`<title>${h(d.title)}</title><meta name="lingying-search" content="1"><meta name="description" content="${h(d.description)}"><meta name="robots" content="${h(d.robots)}"><link rel="canonical" href="${h(d.canonical)}"><meta property="og:site_name" content="LingYing"><meta property="og:type" content="website"><meta property="og:title" content="${h(d.title)}"><meta property="og:description" content="${h(d.description)}"><meta property="og:url" content="${h(d.canonical)}"><meta property="og:image" content="${h(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${h(d.title)}"><meta name="twitter:description" content="${h(d.description)}"><meta name="twitter:image" content="${h(image)}">${d.schema?`<script id="lingying-search-schema" type="application/ld+json">${searchSchemaText(d.schema)}</script>`:''}<style>.search-snapshot{max-width:1100px;margin:auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.6}.search-snapshot a{color:#d5b6ff}.search-snapshot li{margin:20px 0}.search-snapshot footer{margin-top:40px}</style>`;
}
/** Only the trusted application shell and this module's escaped snapshot enter
 * the HTML response. Creator text is never treated as markup or script. */
export function renderSearchShell(shell:string,document:SearchDocument){
  const clean=shell.replace(/<title\b[^>]*>[\s\S]*?<\/title>/giu,'').replace(/<meta\b[^>]*(?:name=["'](?:description|robots|lingying-search|twitter:[^"']+)["']|property=["']og:[^"']+["'])[^>]*>/giu,'').replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/giu,'').replace(/<script\b[^>]*id=["']lingying-search-schema["'][^>]*>[\s\S]*?<\/script>/giu,'');
  return clean.replace(/<\/head>/iu,()=>searchHead(document)+'</head>').replace(/<div\b[^>]*id=["']root["'][^>]*>[\s\S]*?<\/div>/iu,()=>`<div id="root">${document.snapshotHtml}</div>`);
}
export function sitemapXml(urls:Array<{url:string;updatedAt?:string}>){return'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(item=>`<url><loc>${escapeSearchHtml(item.url)}</loc>${item.updatedAt&&/^\d{4}-\d{2}-\d{2}/u.test(item.updatedAt)?`<lastmod>${item.updatedAt.slice(0,10)}</lastmod>`:''}</url>`).join('')+'</urlset>';}
export function discoveryRobots(origin:string,sandbox=false){return`User-agent: *\n${sandbox?'Disallow: /':'Allow: /\nDisallow: /api/\nAllow: /api/config$\nAllow: /api/series$\nAllow: /api/series?\nAllow: /api/series/\nAllow: /api/publishers/'}\n\nSitemap: ${searchOrigin(origin)}/sitemap.xml\n`;}
