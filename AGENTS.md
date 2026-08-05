# extractor.sh contributor guide

## Project shape

- Bun workspace with an Astro 7 application deployed as the Cloudflare Worker `extractor` and a private `@extractor/core` package.
- Use [Firecrawl](https://www.firecrawl.dev/), [Tavily](https://www.tavily.com/), and [Context](https://www.context.dev/) as product, positioning, documentation, and developer-experience inspiration. Adapt useful ideas to extractor.sh's simpler, cache-first product instead of copying their implementation or visual identity.
- Prefer Bun as the project runtime and command runner in general: use `bun install`, `bun run <script>`, and `bun scripts/<name>`. Use Node.js or npm only when a required tool is incompatible with Bun.
- Use `bun run dev` for the native Astro visual preview and `bun run dev:worker` only when debugging Cloudflare bindings; production builds and deployments always use `astro.config.mjs`.
- Keep portable extraction behavior in `packages/core/src`: source routing, adapters, guarded public fetching, parsing, normalization, schema validation, and TTL policy. The core package must not import Astro, generated Worker globals, Cloudflare bindings, rate limiters, or Cache API orchestration.
- Keep Cloudflare extraction integration in `src/features/extraction`: inject Browser Rendering into core as a function, enforce both rate limits, and own the versioned edge-cache key. Keep API routes thin.
- Put reusable presentation in `src/components` and route-level content in `src/pages`.
- Keep generated blog and alternatives content in `src/features/marketing/content.ts`; derive article years at build time rather than hard-coding a calendar year.
- Prefer small source adapters over shared abstractions that only have one consumer.
- The public extraction contract is `GET /api/extract?url=<url>&format=json|markdown&focus=<optional-topic>`.
- The public web-search contract is `GET /api/search?q=<query>&limit=1..10&language=<bcp47>&country=<alpha2>&site=<optional-hostname>&format=json|markdown`.
- The public news-search contract is `GET /api/news?q=<query>&limit=1..50&language=<bcp47>&country=<alpha2>&timeframe=any|1h|1d|7d|30d&format=json|markdown`.
- The public image-search contract is `GET /api/images?q=<query>&limit=1..20&usage=all|commercial|modify|commercial-and-modify&orientation=any|landscape|portrait|square&format=json|markdown`.
- The public video-search contract is `GET /api/videos?q=<query>&limit=1..20&language=<bcp47>&country=<alpha2>&platform=any|youtube&sort=relevance|date&creator=<optional-name>&format=json|markdown`.
- The public place-search contract is `GET /api/places?q=<query>&limit=1..10&language=<bcp47>&country=<optional-alpha2>&lat=<optional>&lon=<optional>&type=any|house|street|locality|city|county|state|country|other&format=json|markdown`.
- Keep `GET /api/maps` only as a deprecated compatibility alias of `GET /api/places`. It must return the canonical Places response and share the exact same cache entry. Do not advertise it as a separate feature or MCP tool.
- The public finance contracts are `GET /api/finance?symbol=<symbol>&timeframe=1d|5d|1mo|3mo|6mo|1y|5y|max&format=json|markdown`, `GET /api/finance/search?q=<query>&instrument=equity|crypto&limit=1..10&format=json|markdown`, and `GET /api/finance/movers?list=gainers|losers|active&limit=1..10&format=json|markdown`; finance search defaults to `instrument=equity`, and movers default to `gainers`.
- Keep the contact form as the only non-extraction POST endpoint. It must use a fixed Cloudflare Email binding destination, validate every field, preserve the honeypot and same-origin check, use its dedicated rate limiter, and never store messages or accept caller-controlled mail headers.

## Required behavior

- Keep public extraction and search contracts GET-only. Prefer public GET requests upstream, but a source adapter may send a fixed, bounded POST to a public machine-readable representation when it requires no API key, authentication, copied session state, or caller-controlled destination. Never use this exception to bypass access controls.
- Keep web search provider-neutral in public output. Make upstream requests sequentially: try Bing RSS first, the existing lightweight Brave HTML rescue second, and Google HTML only as the final fallback when both earlier sources fail or return no relevant items. Stop after the first usable result set and do not make an autocomplete or secondary request merely to enrich successful results. Search returns a schema-v1 `web-search` feed, is capped at 10 ordered results, shares the standard rate limiter, caches successes for 1 hour, and must never launch Browser Run.
- Keep news search query-first and provider-neutral in its public URL. It returns a schema-v1 `google-news` feed with up to 50 article items, shares both extraction rate limits, caches successes for 1 hour, and preserves the Google News adapter's RSS → HTML → Browser Run order.
- Keep image search provider-neutral in public output. Prefer Openverse and use Wikimedia Commons only when the first catalog fails or returns no usable images. Return a schema-v1 `image-search` feed with up to 20 document items, preserve creator and license metadata, share the standard limiter, cache successes for 1 hour, and never launch Browser Run.
- Keep video search provider-neutral in public output. Make upstream requests sequentially: query YouTube's no-auth structured search first, then Google Videos only when YouTube fails or returns no usable items. Stop after the first usable result set. Do not query Dailymotion or PeerTube catalogs and never aggregate multiple upstream result sets. Use Google Videos' current compact async representation with a bounded rotating arc ID; do not use the obsolete `_fmt:json` hint. When `platform=youtube`, restrict the Google fallback to YouTube. Send no API key, Authorization header, Cookie header, visitor token, or copied session context; request listings only and return only public source-page URLs plus metadata already present in those responses. Return a schema-v1 `video-search` feed with up to 20 semantic video items, never return streams or downloads, share the standard limiter, cache successes for 1 hour, and never launch Browser Run.
- Keep place search provider-neutral in public output. Use one submitted Photon request against `photon.komoot.io`, never autocomplete traffic, return a schema-v1 `place-search` feed with up to 10 document items for addresses, businesses, landmarks, and local categories, retain OpenStreetMap attribution, share the standard limiter, cache successes for 1 hour, and never launch Browser Run. Preserve website, phone, and opening-hours values only when they are present in the fetched result; never fabricate ratings or reviews. The public demo service is fair-use only; if traffic becomes extensive, move to a private instance instead of evading throttling.
- Video search accepts `sort=relevance|date`; use newest-first `date` ordering for “latest” and “newest” requests, preserve the source's displayed upload time when available, and keep the sequential source policy unchanged.
- Video search accepts an optional exact creator-name filter. Apply it to the already fetched result set, and treat an empty filtered primary result as eligible for the existing sequential fallback; do not make a creator lookup or enrichment request.
- Keep finance provider-neutral in public output. Normalize symbols to uppercase, select the interval from the requested timeframe, cap history at 512 points, preserve the exact listing currency or subunit, share the standard limiter, cache successes for 5 minutes, and never launch Browser Run.
- When researching or adding a source, search for low-cost machine-readable paths before scraping HTML: standards and discovery links, XML/RSS/Atom feeds, JSON/JSON-LD, oEmbed, official or public APIs, compact/mobile representations, and publicly reachable source-specific endpoints. Treat “backdoors” only as alternate public representations—never bypass authentication, paywalls, access controls, captchas, or other protections. Prefer no-key/no-cost paths, reuse a fetched response when possible, and keep Browser Run as the final fallback.
- Keep retrieval mechanisms private. Public UI, docs, examples, agent-readable files, errors, and API or MCP responses may describe supported platforms, accepted URL types, capabilities, result entities, limits, and caching, but must not identify or imply the internal endpoint, feed, API, oEmbed provider, compact or mobile representation, library, parser, fallback order, or Browser Run path used to obtain data. Internal code, comments, contributor documentation, and tests may name these mechanisms. Continue stripping `method` from public schema-v1 output.
- Preserve the generic fallback order: native `text/markdown`, LinkeDOM/readability, then Browser Run.
- Route recognized Amazon products/searches, Apple App Store apps, Bluesky profiles/posts, Google News searches/topics/top stories, Google Play apps, Instagram posts/profiles, Reddit, Shopify, SoundCloud, Spotify, TikTok posts/profiles, Vimeo, X, Yahoo Finance quote/history pages, and YouTube URLs through their dedicated adapters first.
- For an exact Amazon product URL, extract the ASIN and fetch Amazon's compact product page. For an Amazon search URL containing `k`, fetch its compact search representation and return up to 20 product items. Do not send recognized Amazon products or searches to Browser Run.
- For exact Apple App Store pages, use the numeric app ID with Apple's public lookup service and cache successful upstream metadata for one week. If Apple limits lookup/search, parse the localized App Store page's SoftwareApplication JSON-LD; Apple Marketing Tools chart metadata is the final cheap rescue path. For exact Google Play pages, parse the public app page's structured metadata and visible description. Return software product entities and never send either recognized app source to Browser Run.
- Use Bluesky's public profile RSS for exact profile pages and its public AppView for exact post pages. Post requests must use zero reply and parent depth.
- For Google News search, topic, and top-stories pages, try the public feed first and ordinary HTML second. Use the rate-limited Browser Run only when both cheap requests fail, return at most 50 article entities, and cache a successful result for one hour.
- Prefer X's public oEmbed response before the existing server-side fallback.
- For recognized TikTok pages, prefer public page data and fall back to TikTok's public oEmbed response. Resolve supported short links, but do not launch Browser Run for TikTok.
- For recognized Instagram posts and reels, use their public embed representation; for exact public profiles, return profile details and recent public posts when exposed. Do not launch Browser Run for Instagram.
- Use official public oEmbed metadata for recognized Vimeo, SoundCloud, and Spotify URLs. Strip active embed markup and do not launch Browser Run for these sources.
- Treat status-shaped URLs on arbitrary domains as possible Mastodon posts. Validate them through the instance's public oEmbed endpoint, enrich confirmed statuses through public status data, and otherwise return the URL to normal webpage extraction. Confirmed Mastodon posts must not launch Browser Run.
- Try publisher-advertised WordPress JSON, oEmbed, and feed links only after ordinary HTML extraction fails and before Browser Run.
- Keep `linkpeek` benchmark-only; production metadata extraction must reuse the LinkeDOM tree already created from HTML fetched through the guarded request pipeline. Preserve readable body content as the primary result, enrich safe deep-page dates and missing non-URL authors, and use a sufficiently detailed publisher description only after discovery fails and before Browser Run. Never call linkpeek's network-fetching `preview()` API.
- For confirmed Shopify storefront HTML, prefer its public product JSON before theme parsing. Exact product pages are products; storefront roots and collection pages are feeds capped at 50 products. Keep blogs, pages, policies, searches, and other Shopify content routes in ordinary webpage extraction.
- For confirmed WooCommerce storefront HTML, prefer the unauthenticated Store API before theme parsing. Exact product pages are products; supported storefront roots, shop pages, product searches, and identified product categories are feeds capped at 50 products. Keep ordinary WooCommerce content pages in generic webpage extraction and preserve integer minor-unit prices from the Store API.
- For recognized Yahoo Finance quote and price-history pages, return a document containing the latest available market snapshot and at most one month of daily OHLCV history. Use only the fixed public GET representation, cache successful results for 5 minutes, clearly treat values as potentially delayed, and never launch Browser Run.
- Keep public JSON output on schema version 1. Treat `packages/core/src/schema.ts` as the runtime and generated JSON Schema source of truth and keep TypeScript types in `packages/core/src/types.ts` aligned with it.
- Use semantic entity types: `document`, `article`, `product`, `post`, `profile`, `video`, `audio`, and `feed`. Keep shared nullable fields present; omit unavailable optional type-specific attributes. Only profiles and feeds contain `items`.
- Represent product and variant `price` values as non-negative integers in the currency's minor unit. Keep display text separate in `priceDisplay`.
- Preserve URL safety checks, redirect validation, timeouts, size limits, and Browser Run cleanup.
- Successful products, profiles, and feeds cache for 1 hour; finance requests and Yahoo Finance market documents cache for 5 minutes; other successful extractions cache for 30 days. Errors must not be cached.
- Cache successful API responses through the versioned `caches.default` key in `src/worker.ts`. Cache hits must bypass rate-limited extraction work and expose `X-Extractor-Cache: HIT`; bump the internal version when a deployment must not reuse older result shapes.
- Rate-limit uncached extraction work to 60 requests/IP/minute and Browser Run to 5 requests/IP/minute.

## Design system

- Use Tailwind CSS for layout, spacing, typography, and responsive styling.
- The UI is square-cornered neo-brutalism: white surfaces, black type and borders. Only code boxes may use a subtle 3px radius.
- Buttons stay white with asymmetric black right/bottom borders and a pressed hover state.
- Functional SVG icons come from Heroicons through `astro-icon`.
- Platform card marks come from the Iconify `logos` pack when it contains a suitable colored mark. Keep approved inline brand artwork in a reusable Astro component when the pack is missing or visually inaccurate; official brand colors are allowed.
- Do not add a client framework for simple interactions. Keep browser JavaScript small and sanitize rendered Markdown.
- Add every new public page to the custom `/sitemap.xml` route and provide an agent-readable Markdown representation when practical.
- Keep the hosted `/mcp` server stateless. Its tools must reuse the public extraction cache and both Worker rate-limit bindings so MCP cannot bypass browser-rendering cost controls.
- When changing MCP behavior, update `/docs/mcp/`, the MCP Server Card, API catalog, agent skill, and `llms*.txt`, then verify `initialize`, `tools/list`, and `tools/call` against production.

## Verification

- Standalone test and smoke scripts must use Bun unless a documented incompatibility requires Node.js.

Run before deployment:

```sh
bun run check
bun run test
bun run deploy:dry
```

Add fixture tests for extraction changes. After deployment, smoke-test both API formats and verify a repeated identical GET becomes an edge cache hit.

Every adapter fixture and production smoke must assert the public v1 schema, including `schemaVersion`, semantic `type`, absence of internal `method`, and integer minor-unit prices where applicable.

Chromium verification is mandatory after changes to extraction adapters, the homepage form, result rendering, layouts, or public documentation:

```sh
npx playwright install chromium
EXTRACTOR_API_KEY='ext_live_…' bun run test:smoke:browser
```

- Run the Chromium smoke suite against the deployed production Worker, not only a local build.
- Exercise both Markdown and JSON previews through the homepage form.
- Include every newly added or materially changed source adapter in the browser suite using stable public HTML URLs.
- Check desktop and mobile overflow, browser console/page errors, raw-result links, response content, and that internal extraction methods remain hidden.
- Server-only rescue branches that cannot be induced reliably on a public site still require deterministic fixture tests; state clearly that those branches were fixture-tested rather than claiming Chromium coverage.
- Do not report a change as Chromium-smoke-tested unless this command completed successfully after the relevant production deployment.
- Evaluate proposed generic HTML extractor replacements with `bun run benchmark:extractors`. Compare both implementations against the same fetched HTML on at least 100 successful public HTML responses; do not add the losing implementation to the Worker runtime.
- Evaluate generic metadata parser changes with `bun run benchmark:metadata`. Keep a balanced corpus of root and deep content URLs, compare identical fetched HTML on at least 100 successful responses, and manually inspect dates, authors, and image disagreements before adopting higher-coverage fields.

## Cloudflare safety

- Never print, commit, bind, or expose the value in `.env`.
- The existing `CLOUDFLARE_API_KEY` value is a Bearer API token used only by Wrangler. Map it to `CLOUDFLARE_API_TOKEN` in the deployment process.
- Deploy only to the account and Worker name already declared in `wrangler.jsonc`.
- `workers.dev` does not belong to a customer zone, so do not attempt to create a zone Cache Rule for it. Add that rule only after `extractor.sh` is purchased and onboarded.
- Do not add authentication, persistence, billing, history, crawling, transcripts, or comment extraction without an explicit product decision.
