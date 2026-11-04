# Search appearance and browser icon

The canonical public homepage is `https://lingyingdrama.com/`. Existing permanent page redirects send both HTTP hosts and `https://www.lingyingdrama.com/` to this HTTPS address. TLS-verified public requests and those redirects passed on 4 November 2026. A red shield beside a search result alone does not identify a certificate error; a browser extension or reputation service may supply its own rating. Check the warning's details before attributing it to TLS or declaring the site unsafe.

The existing operator-selected LingYing phoenix supplies a stable 192×192 PNG favicon at `/icon-192.png`. `/favicon.ico` packages the existing 32×32 and 192×192 PNG images without changing their artwork. Both are declared in the homepage head. `robots.txt` allows public crawling and points to `sitemap.xml`, which lists the HTTPS homepage. These are real files, so their responses must not fall through to the application's HTML shell.

The Cloudflare asset `_headers` file supplies an HTTP `Link: <https://lingyingdrama.com/>; rel="canonical"` only for `/`, including query variants. Do not place that same homepage canonical in the shared HTML template: it is also served for series, publisher and other SPA routes, which must retain distinct indexing identities. The existing Worker preserves asset response headers.

After publication, a verified site owner can open [Google Search Console](https://search.google.com/search-console), inspect `https://lingyingdrama.com/`, run a live test and request indexing. Submit `https://lingyingdrama.com/sitemap.xml` under Sitemaps. Check Google's selected canonical if it continues displaying the old HTTP/www address. No Search Console submission or indexing is implied by deployment.

Google must recrawl the homepage and icon before search appearance changes. This can take several days to several weeks; eligibility does not guarantee icon display. Browser tabs can update sooner after a reload. A reputation warning supplied by a browser extension or another security provider requires investigation with that provider, independently of the site's favicon.

References: [Google favicon guidelines](https://developers.google.com/search/docs/appearance/favicon-in-search), [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
