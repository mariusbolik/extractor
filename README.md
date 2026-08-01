# extractor.sh

A public, cache-first GET API and small web interface that turns public URLs into clean Markdown or normalized JSON.

## Supported sources

- Generic public webpages and articles.
- Public Amazon product detail pages from supported country stores.
- Public Bluesky profile feeds and individual posts.
- Public Instagram posts, reels, profiles, and recent profile posts.
- Reddit posts, communities, and public user feeds.
- Public Shopify products, collections, and storefront catalogs.
- Public TikTok video and photo posts plus creator profiles.
- Public X and Twitter status URLs.
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
```

Run all verification:

```sh
bun run check
bun run test
bun run deploy:dry
```

After deployment, run the production Chromium smoke suite:

```sh
npx playwright install chromium
bun run test:smoke:browser
```

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

The Worker name is `extractor`, producing `https://extractor.mcb-software.workers.dev` on the configured account.

## Cache and limits

- Feeds: 1 hour at Cloudflare’s edge.
- Amazon products: 1 hour at Cloudflare’s edge.
- Documents, posts, tweets, and videos: 30 days at the edge.
- Cache misses: 30 extractions per IP per minute.
- Rendered-page fallback: 5 launches per IP per minute.

The current `workers.dev` hostname uses Workers Caching. A zone-level Cache Rule can only be added after `extractor.sh` is purchased and onboarded to Cloudflare.

## Icons

Functional icons use the MIT-licensed Heroicons pack. Platform marks use the CC0 SVG Logos pack through Iconify and retain their official brand colors.
