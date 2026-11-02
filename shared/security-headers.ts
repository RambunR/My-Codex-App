// Keep these policies compatible with OAuth redirects, hosted Checkout and
// native video playback. React renders creator text as text, never HTML.
export function responseSecurityHeaders(pathname:string):Record<string,string>{
  return{
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':pathname==='/auth'||pathname.startsWith('/api/auth/')?'no-referrer':'strict-origin-when-cross-origin',
    'X-Frame-Options':'DENY',
    'Content-Security-Policy':"base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  };
}
