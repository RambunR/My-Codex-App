import {LEGACY_API_SITE_ORIGIN,PUBLIC_SITE_ORIGIN} from '../shared/site-origins';

interface GatewayEnv {LINGYING:{fetch(request:Request):Promise<Response>}}

/** Compatibility endpoint for existing API sessions, OAuth registrations and webhooks. */
export default {
  async fetch(request:Request,env:GatewayEnv):Promise<Response>{
    const url=new URL(request.url);
    if(url.origin!==LEGACY_API_SITE_ORIGIN)return new Response('Unknown application origin.',{status:403,headers:{'Cache-Control':'no-store'}});
    if(url.pathname.startsWith('/api/'))return env.LINGYING.fetch(request);
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed.',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
    const destination=new URL(PUBLIC_SITE_ORIGIN);
    // Assign URL components independently so a double-slash path cannot change origin.
    destination.pathname=url.pathname;
    destination.search=url.search;
    return new Response(null,{status:308,headers:{Location:destination.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  },
};
