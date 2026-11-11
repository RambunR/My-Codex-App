import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {publicSiteOrigin} from './api';
import {brandName} from './brand';
import {useI18n} from './i18n';
import type {Series} from '../shared/config';
import {searchOrigin,searchRoute,searchSchemaText,staticSearchDocument,type SearchDocument,type SearchSeries} from '../shared/search-discovery';

export function searchClientOrigin(){
  const canonical=window.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if(canonical)return searchOrigin(canonical.href);
  return ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)?window.location.origin:publicSiteOrigin;
}

export function searchSeriesFromPublic(series:Series):SearchSeries{return{id:series.id,title:series.title,description:series.description,language:series.language,genres:series.genres,episodeCount:series.episode_count,cover:series.cover,...(series.publisher_id?{publisher:{id:series.publisher_id,name:series.creator_name}}:{})};}
function apply(document:SearchDocument,locale:string){
  const head=window.document.head,localizedTitle=locale.startsWith('zh')?document.title.replace('LingYing 靈映',brandName(locale)+' LingYing'):document.title;
  window.document.title=localizedTitle;
  const meta=(attribute:'name'|'property',name:string,content:string)=>{
    const matches=head.querySelectorAll<HTMLMetaElement>(`meta[${attribute}="${name}"]`);const element=matches[0]||head.appendChild(window.document.createElement('meta'));for(const duplicate of Array.from(matches).slice(1))duplicate.remove();element.setAttribute(attribute,name);element.content=content;
  };
  meta('name','lingying-search','1');meta('name','description',document.description);meta('name','robots',document.robots);
  for(const[name,value]of Object.entries({'og:site_name':'LingYing','og:type':'website','og:title':localizedTitle,'og:description':document.description,'og:url':document.canonical,'og:image':document.image||new URL('/icon-512.png',document.canonical).href}))meta('property',name,value);
  meta('name','twitter:card','summary_large_image');meta('name','twitter:title',localizedTitle);meta('name','twitter:description',document.description);meta('name','twitter:image',document.image||new URL('/icon-512.png',document.canonical).href);
  const links=head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]'),canonical=links[0]||head.appendChild(window.document.createElement('link'));for(const duplicate of Array.from(links).slice(1))duplicate.remove();canonical.rel='canonical';canonical.href=document.canonical;
  head.querySelector('#lingying-search-schema')?.remove();
  if(document.schema){const script=window.document.createElement('script');script.id='lingying-search-schema';script.type='application/ld+json';script.textContent=searchSchemaText(document.schema);head.appendChild(script);}
}
/** Uses data the page already fetched. It never introduces another API request
 * or lets a previous route's late response set the current route's metadata. */
export function useSearchMetadata(document:SearchDocument|undefined){
  const location=useLocation(),{locale}=useI18n(),signature=document?JSON.stringify(document):'';
  useEffect(()=>{if(!document||new URL(document.canonical).pathname!==searchRoute(location.pathname).path)return;apply(document,locale);},[signature,location.pathname,locale]);
}
/** Reset private/unknown routes even when a series request is still pending.
 * Preserve an initial or child-produced series head until its public data is ready. */
export function useDefaultSearchMetadata(locale:string,sandbox=false){
  const location=useLocation();
  useEffect(()=>{
    const route=searchRoute(location.pathname),existing=window.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if(!sandbox&&(route.kind==='series'||route.kind==='publisher')&&existing&&new URL(existing.href).pathname===route.path&&window.document.head.querySelector('meta[name="lingying-search"]'))return;
    let document=staticSearchDocument(location.pathname,searchClientOrigin());
    if(sandbox)document={...document,title:document.title+' — Test',robots:'noindex, nofollow',schema:null};
    apply(document,locale);
  },[location.pathname,locale,sandbox]);
}
