# extractor.sh

A public, cache-first GET API and hosted MCP server that searches webpages, news, images, videos, and places, retrieves market data, and turns known public URLs into clean Markdown or normalized JSON.

## Supported sources

- Generic public webpages, articles, product details, and repeated product listings.
- Public Amazon products, search results, storefronts, Idea Lists, and shared Wish Lists from supported country stores.
- Public Bluesky profile feeds and individual posts.
- Public Google News searches, topics, and top stories.
- Public Instagram posts, reels, complete exposed carousels, profiles, and recent profile posts.
- Public Mastodon statuses from compatible instances.
- Reddit posts, communities, and public user feeds.
- Public Shopify products, collections, and storefront catalogs.
- Public WooCommerce products, shops, store searches, and supported product categories.
- Public SoundCloud tracks, playlists, sets, and profiles.
- Public Spotify music and podcast metadata.
- Public TikTok video and photo posts plus creator profiles with up to ten recent posts.
- Public Vimeo video metadata.
- Public X and Twitter status URLs.
- Public Yahoo Finance quote and price-history pages with market snapshots and recent daily prices.
- YouTube videos, channels, handles, users, and playlists.

The site also includes build-year platform extraction guides under `/blog/`, provider comparisons under `/alternatives/`, and a complete `/sitemap.xml`.

## Local development

```sh
bun install
bun run dev
```

The API is available at:

```text
GET /api/extract?url=https%3A%2F%2Fexample.com&format=json
GET /api/extract?url=https%3A%2F%2Fexample.com&format=markdown
GET /api/search?q=Cloudflare%20Workers&limit=10&format=json
GET /api/news?q=AI%20infrastructure&limit=10&format=json
GET /api/images?q=coral%20reef&limit=10&format=json
GET /api/videos?q=Cloudflare%20Workers%20tutorial&limit=10&format=json
GET /api/places?q=Brandenburg%20Gate%20Berlin&limit=5&format=json
GET /api/places?q=coffee%20Berlin&lat=52.52&lon=13.405&limit=5&format=json
GET /api/finance/search?q=Apple&limit=10&format=json
GET /api/finance/search?q=Bitcoin&instrument=crypto&limit=10&format=json
GET /api/finance/movers?list=gainers&limit=10&format=json
GET /api/finance?symbol=AAPL&quote=EUR&timeframe=1mo&format=json
```

MCP clients can connect to the hosted Streamable HTTP endpoint at `/mcp` and call the read-only `search_web`, `search_news`, `search_images`, `search_videos`, `search_places`, `search_stocks`, `get_market_movers`, `get_market_data`, and `extract_public_url` tools. Web search can be restricted to one hostname, video search can select a named creator’s newest upload, and market movers returns daily gainers, losers, or most-active stocks. `get_market_data` accepts an optional quote currency, returns schema-v1 structured content, and bundles an inline line chart for MCP Apps-capable chats, with ordinary text/JSON fallback everywhere else. See `/docs/mcp/` for configuration.

Anonymous callers receive 10 successful uncached operations per IP each UTC day. New accounts receive a one-time bonus of 1,000 non-expiring credits, shared by signed-in website tools and `ext_live_` Bearer keys; cache hits and errors are free. Hanko protects account sessions, Dodo Payments provides hosted checkout and merchant-of-record billing, D1 stores account and billing references, and SQLite Durable Objects own exact quota, credit, and automatic-funding limits.

Successful JSON responses use the versioned entity contract documented at
`/docs/schema/` and published as JSON Schema at `/schemas/extraction-v1.json`.
Product prices are integer minor units, so `1999` with `EUR` means €19.99.

Run all verification:

```sh
bun run check
bun run test
bun run deploy:dry
```

After deployment, run the production Chromium smoke suite:

```sh
npx playwright install chromium
EXTRACTOR_API_KEY='ext_live_…' bun run test:smoke:browser
```

The Chromium suite uses that key for its authenticated context and creates a separate context for one anonymous MISS/HIT assertion.

Run the production smoke suite against 100 distinct websites sampled from the
current Tranco list:

```sh
bun run test:smoke:prod
```

The suite is intentionally separate from the fast unit tests. It paces requests
below the production extraction limit, retries browser-rate-limited targets at
the browser limit, and writes detailed JSON and Markdown reports to
`.smoke-reports/`. It also verifies the Markdown response and confirms repeated
JSON and Markdown requests become Cloudflare cache hits. Use
`bun run test:smoke:prod -- --help` for overrides or to provide a
newline-delimited URL file.

To compare the production HTML extractor with Defuddle on the same fetched
HTML, run the 220-target shadow benchmark:

```sh
bun run benchmark:extractors
```

Reports are written to `.benchmark-reports/`. Defuddle is a development-only
benchmark dependency and is not included in the Worker unless a future result
justifies replacing the production extractor.

## Deployment

The local `.env` contains a Cloudflare Bearer token under the existing `CLOUDFLARE_API_KEY` name. Map it to Wrangler’s expected variable for deployment without copying it into source or Worker bindings:

```sh
set -a
. ./.env
set +a
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_KEY" bun run deploy
```

The Worker name is `extractor`, producing `https://extractor.sh` on the configured account.

Billing rollout is fail-closed. Apply D1 migrations before deploy, install `DODOPAYMENTS_API_KEY`, `DODOPAYMENTS_BUSINESS_ID`, `DODOPAYMENTS_WEBHOOK_KEY`, and `ANONYMOUS_QUOTA_HMAC_SECRET` with `wrangler secret put`, configure both Dodo Payments product IDs, and keep `BILLING_ENABLED` false until hosted checkout, signed webhook settlement, and automatic-funding authorization pass.

```sh
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_KEY" bunx wrangler d1 migrations apply extractor --remote
```

## Cache and limits

- Products, profiles, and feeds: 1 hour at Cloudflare’s edge.
- Finance requests and Yahoo Finance market documents: 5 minutes at Cloudflare’s edge.
- Web searches: 1 hour at Cloudflare’s edge.
- News searches: 1 hour at Cloudflare’s edge.
- Image searches: 1 hour at Cloudflare’s edge.
- Video searches: 1 hour at Cloudflare’s edge.
- Place searches: 1 hour at Cloudflare’s edge.
- Other single entities and pages: 30 days at the edge.
- Cache misses: 60 search or extraction requests per IP per minute.
- Anonymous successful cache misses: 10 per IP per UTC day.
- New accounts: a one-time 1,000-credit welcome bonus shared by signed-in website tools and active Bearer keys.
- Paid successful cache misses: 1 prepaid credit with a valid signed-in session or active Bearer key.
- Rendered-page fallback: 5 launches per IP per minute.

These TTLs apply only to the internal API result cache. Website HTML, agent-readable representations, and static assets are returned with `Cache-Control: no-store`, and the Worker's front-cache is disabled so deployments become visible immediately.

## Icons

Functional icons use the MIT-licensed Heroicons pack. Platform marks use the CC0 SVG Logos pack through Iconify and retain their official brand colors.
