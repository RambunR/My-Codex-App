/** Keep host-only sessions and registered OAuth callbacks on the stable API host. */
export function canonicalApiRedirect(request:Request,env:{APP_URL?:string;PUBLIC_APP_URL?:string}):Response|null{
  if(!env.APP_URL||!env.PUBLIC_APP_URL)return null;
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return null;
  const destination=new URL(env.APP_URL);
  if(url.origin===destination.origin)return null;
  destination.pathname=url.pathname;
  destination.search=url.search;
  return new Response(null,{status:307,headers:{Location:destination.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
