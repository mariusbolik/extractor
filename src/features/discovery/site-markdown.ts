import { CURRENT_YEAR, alternativePages, platformArticles } from '../marketing/content';
import { platformPageList } from '../marketing/platform-pages';

const ORIGIN = 'https://extractor.sh';

const apiExample = `~~~sh
curl --get '${ORIGIN}/api/extract' \\
  --data-urlencode 'url=https://example.com/article' \\
  --data-urlencode 'format=markdown'
~~~`;

const searchExample = `~~~sh
curl --get '${ORIGIN}/api/search' \\
  --data-urlencode 'q=Cloudflare Workers documentation' \\
  --data-urlencode 'format=json'
~~~`;

const newsExample = `~~~sh
curl --get '${ORIGIN}/api/news' \\
  --data-urlencode 'q=AI infrastructure' \\
  --data-urlencode 'limit=10' \\
  --data-urlencode 'format=json'
~~~`;

const imageExample = `~~~sh
curl --get '${ORIGIN}/api/images' \\
  --data-urlencode 'q=coral reef' \\
  --data-urlencode 'limit=10' \\
  --data-urlencode 'format=json'
~~~`;

const videoExample = `~~~sh
curl --get '${ORIGIN}/api/videos' \\
  --data-urlencode 'q=Cloudflare Workers tutorial' \\
  --data-urlencode 'limit=10' \\
  --data-urlencode 'format=json'
~~~`;

const placeExample = `~~~sh
curl --get '${ORIGIN}/api/places' \\
  --data-urlencode 'q=Brandenburg Gate Berlin' \\
  --data-urlencode 'limit=5' \\
  --data-urlencode 'format=json'
~~~`;

const financeExample = `~~~sh
curl --get '${ORIGIN}/api/finance' \\
  --data-urlencode 'symbol=AAPL' \\
  --data-urlencode 'timeframe=3mo' \\
  --data-urlencode 'quote=EUR' \\
  --data-urlencode 'format=json'
~~~`;

const stockSearchExample = `~~~sh
curl --get '${ORIGIN}/api/finance/search' \\
  --data-urlencode 'q=Apple' \\
  --data-urlencode 'limit=10' \\
  --data-urlencode 'format=json'
~~~`;

const pages: Record<string, string> = {
  '/': `# extractor.sh

> Search the public web and turn known URLs into clean Markdown or normalized JSON through cacheable GET requests.

## Search the public web

Call \`GET ${ORIGIN}/api/search\` with a required \`q\`, optional \`limit\` from 1 to 10, and \`format=markdown\` or \`format=json\`.

${searchExample}

## Search current news

Call \`GET ${ORIGIN}/api/news\` with a required \`q\`, optional \`limit\` from 1 to 50, and \`format=markdown\` or \`format=json\`.

${newsExample}

## Search public images

Call \`GET ${ORIGIN}/api/images\` with a required \`q\`, optional \`limit\` from 1 to 20, and \`format=markdown\` or \`format=json\`.

${imageExample}

## Search public videos

Call GET ${ORIGIN}/api/videos with a required q, optional limit from 1 to 20, and format=markdown or format=json.

${videoExample}

## Search places

Call \`GET ${ORIGIN}/api/places\` with a required address, business, landmark, or local-category query, optional \`limit\` from 1 to 10, and \`format=markdown\` or \`format=json\`. Paired \`lat\` and \`lon\` coordinates can bias results toward a nearby area.

${placeExample}

## Get market data

Call \`GET ${ORIGIN}/api/finance\` with a required market \`symbol\`, optional \`timeframe\` from \`1d|5d|1mo|3mo|6mo|1y|5y|max\`, optional three-letter \`quote\` currency, and \`format=markdown|json\`. Omit \`quote\` to preserve the listing currency.

${financeExample}

## Search stocks

Call \`GET ${ORIGIN}/api/finance/search\` with a company name or partial ticker when the exact symbol is unknown.

${stockSearchExample}

## Extract a public URL

Call \`GET ${ORIGIN}/api/extract\` with an absolute public \`url\` and \`format=markdown\` or \`format=json\`. No account is required for 10 successful uncached operations per IP each UTC day. New accounts receive a one-time bonus of 1,000 non-expiring credits. Signed-in website tools and an optional Bearer key use the same account balance.

${apiExample}

## Supported sources

- [Amazon](${ORIGIN}/amazon/): Public products, search results, storefronts, Idea Lists, and shared Wish Lists from supported country stores.
- [Apple App Store](${ORIGIN}/app-store/): Public iPhone and iPad app detail pages as software products.
- [Bluesky](${ORIGIN}/bluesky/): Public profile feeds and individual posts.
- [Google News](${ORIGIN}/google-news/): Public searches, topics, and top stories as article feeds.
- [Google Play](${ORIGIN}/google-play/): Public Android app detail pages as software products.
- [Instagram](${ORIGIN}/instagram/): Public posts, reels, profiles, and recent profile posts.
- [Mastodon](${ORIGIN}/mastodon/): Public statuses from compatible federated instances.
- [Reddit](${ORIGIN}/reddit/): Public posts, communities, and user profiles.
- [Shopify](${ORIGIN}/shopify/): Public products, collections, and storefront catalogs.
- [WooCommerce](${ORIGIN}/woocommerce/): Public product pages, shops, product-search result pages, and product categories.
- [SoundCloud](${ORIGIN}/soundcloud/): Public tracks, playlists, sets, and creator profiles.
- [Spotify](${ORIGIN}/spotify/): Public music, artist, playlist, and podcast links.
- [TikTok](${ORIGIN}/tiktok/): Public video and photo posts, short links, and creator profiles.
- [Vimeo](${ORIGIN}/vimeo/): Public video metadata.
- [X](${ORIGIN}/x/): Public X and Twitter status URLs.
- [Yahoo Finance](${ORIGIN}/yahoo-finance/): Public quote and price-history pages with market snapshots and recent daily prices.
- [YouTube](${ORIGIN}/youtube/): Public videos, channels, and playlists.
- Web pages: Public HTTP and HTTPS content, product-detail, and product-listing pages.

## Documentation

- [Developer documentation](${ORIGIN}/docs/)
- [Web search](${ORIGIN}/docs/search/): Discover relevant public pages through one GET request.
- [News search](${ORIGIN}/docs/news/): Find current public coverage as a normalized article feed.
- [Image search](${ORIGIN}/docs/images/): Find openly licensed images with source and license metadata.
- [Video search](${ORIGIN}/docs/videos/): Find public video pages with available creator, duration, date, description, and thumbnail metadata.
- [Places](${ORIGIN}/docs/places/): Resolve addresses, businesses, landmarks, and local categories with normalized coordinates.
- [Finance](${ORIGIN}/docs/finance/): Search stock symbols and retrieve native or converted snapshots with configurable, bounded history.
- [Hosted MCP server](${ORIGIN}/docs/mcp/): Connect to \`${ORIGIN}/mcp\` and call \`search_web\` or \`extract_public_url\`.
- [OpenAPI 3.1](${ORIGIN}/openapi.json)
- [API catalog](${ORIGIN}/.well-known/api-catalog)
- [JSON Schema](${ORIGIN}/schemas/extraction-v1.json)
- [Full agent documentation](${ORIGIN}/llms-full.txt)
- [Pricing](${ORIGIN}/pricing/)
- [Contact](${ORIGIN}/contact/)
`,
  '/docs/': `# extractor.sh developer documentation

> Search the public web or send a known page URL and receive Markdown or normalized JSON.

${apiExample}

## Documentation

- [Quickstart](${ORIGIN}/docs/quickstart/)
- [Web search](${ORIGIN}/docs/search/)
- [News search](${ORIGIN}/docs/news/)
- [Image search](${ORIGIN}/docs/images/)
- [Video search](${ORIGIN}/docs/videos/)
- [Place search](${ORIGIN}/docs/places/)
- [Finance](${ORIGIN}/docs/finance/)
- [Hosted MCP server](${ORIGIN}/docs/mcp/)
- [API reference](${ORIGIN}/docs/api/)
- [API keys](${ORIGIN}/docs/authentication/)
- [Billing and credits](${ORIGIN}/docs/billing/)
- [JSON schema](${ORIGIN}/docs/schema/)
- [Supported sources](${ORIGIN}/docs/sources/)
- [Limits and caching](${ORIGIN}/docs/limits/)
- [Limitations](${ORIGIN}/docs/limitations/)
`,
  '/docs/authentication/': `# extractor.sh API keys

The public APIs provide 10 successful uncached operations per IP each UTC day without an account. New free accounts receive a one-time bonus of 1,000 non-expiring credits. The homepage and platform playgrounds use a valid Hanko session automatically. For external integrations, create up to two active keys in the private dashboard and send the key only as:

\`Authorization: Bearer ext_live_…\`

The complete key is shown once and stored only as a cryptographic hash. Never copy the Hanko session cookie into an integration. Cache lookup happens before authentication, so hits are free. On a miss, invalid or revoked keys return HTTP 401. Successful cacheable work uses one account credit; errors refund the reservation. An account with insufficient credits returns HTTP 402.

See [billing and credits](${ORIGIN}/docs/billing/) and the [API reference](${ORIGIN}/docs/api/).

Example endpoint: \`GET ${ORIGIN}/api/extract\`.
`,
  '/docs/billing/': `# extractor.sh billing and credits

Prepaid credits cost $0.49 per 1,000 successful uncached operations and never expire. Exact purchases from $10.00 through $4,900.00 grant \`floor(amount_cents × 1,000 / 49)\` credits; $100 grants 204,081 credits.

Add prepaid credits in the dashboard through Dodo Payments' hosted checkout. Manual top-ups are one-time purchases. Optional automatic funding is off by default and requires a separate hosted mandate approval, a balance threshold, a top-up amount, and a maximum pre-tax subtotal per UTC calendar month. There is no postpaid usage.

Dodo Payments acts as merchant of record. Credits are granted only after a successful signed payment webhook. Failed charges create no credits or debt. extractor.sh sends billing-address alerts at 80%, 90%, and 100% usage with a direct top-up link. Refunds and disputes reverse the complete original grant and can make a balance negative, blocking paid cache misses until replenished.

Prepaid keys apply to \`GET ${ORIGIN}/api/extract\` and the other public GET APIs.
`,
  '/docs/quickstart/': `# extractor.sh quickstart

Call \`GET ${ORIGIN}/api/extract\` with a required public \`url\` and optional \`format\` of \`json\` or \`markdown\`.

${apiExample}

Always submit an ordinary public page URL a person could open in a browser.
`,
  '/docs/search/': `# extractor.sh web search

Call \`GET ${ORIGIN}/api/search\` to discover public pages when no exact URL is known.

- \`q\`: required query, up to 200 characters.
- \`limit\`: optional integer from 1 to 10; default 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`language\`: optional canonical BCP 47 tag; default \`en-US\`.
- \`country\`: optional two-letter country; default \`US\`.

${searchExample}

JSON uses schema version 1 with a \`web-search\` feed containing ordered \`document\` items. Each item has a title, URL, and short snippet. Safe search remains strict. Call \`GET ${ORIGIN}/api/extract\` on selected URLs for full page content.
`,
  '/docs/news/': `# extractor.sh news search

Call \`GET ${ORIGIN}/api/news\` for current public news coverage.

- \`q\`: required query, up to 200 characters.
- \`limit\`: optional integer from 1 to 50; default 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`language\`: optional canonical BCP 47 tag; default \`en-US\`.
- \`country\`: optional two-letter country; default \`US\`.
- \`timeframe\`: optional \`any|1h|1d|7d|30d\`; default \`any\`.

${newsExample}

JSON uses schema version 1 with a \`google-news\` feed containing \`article\` items. A recent timeframe excludes undated and older articles. Complete publisher bodies, personalized feeds, and pagination are not included.
`,
  '/docs/images/': `# extractor.sh image search

Call \`GET ${ORIGIN}/api/images\` to find openly licensed public images.

- \`q\`: required query, up to 200 characters.
- \`limit\`: optional integer from 1 to 20; default 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`usage\`: optional \`all|commercial|modify|commercial-and-modify\`.
- \`orientation\`: optional \`any|landscape|portrait|square\`.

${imageExample}

JSON uses schema version 1 with an \`image-search\` feed. Document items include public source pages and image media, plus creator, dimensions, description, and license metadata when available. Always follow the returned license requirements. Successful searches may be cached for up to one hour.
`,
  '/docs/videos/': `# extractor.sh video search

Call GET ${ORIGIN}/api/videos to find public video pages.

- q: required query, up to 200 characters.
- limit: optional integer from 1 to 20; default 10.
- format: optional json (default) or markdown.
- language: optional canonical BCP 47 tag; default en-US.
- country: optional two-letter country; default US.
- platform: optional any for public video pages from supported sources (default), or youtube for YouTube-only results.
- sort: optional relevance (default) or date for newest-first results. Use date when the user asks for the latest video.

${videoExample}

JSON uses schema version 1 with a video-search feed containing semantic video items. Public source-page links and available creator, publication time, displayed relative upload time, description, duration, exact view count, and thumbnail metadata are returned. For “latest video of Taylor Swift,” send q=Taylor Swift official, platform=youtube, and sort=date; the first item is the newest matching artist upload. Omit official when the user wants any recent video about the subject. Safe search remains strict, direct streams are not returned, and successful searches may be cached for up to one hour.
`,
  '/docs/places/': `# extractor.sh place search

Call \`GET ${ORIGIN}/api/places\` to resolve an address, business, landmark, or local-category query.

- \`q\`: required address, business, landmark, or local-category query, up to 200 characters.
- \`limit\`: optional integer from 1 to 10; default 5.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`language\`: optional canonical BCP 47 tag; default \`en\`.
- \`country\`: optional two-letter hard filter.
- \`lat\` and \`lon\`: optional paired location bias.
- \`type\`: optional \`any|house|street|locality|city|county|state|country|other\`.

${placeExample}

JSON uses schema version 1 with a \`place-search\` feed. Document items can include latitude, longitude, address, category, country code, website, phone, opening hours, and a canonical map link. This is a submitted search rather than autocomplete. Results are bounded and ranked, not an exhaustive business directory. Unavailable ratings and reviews are omitted. Results contain OpenStreetMap data and its required attribution. Successful searches may be cached for up to one hour.
`,
  '/docs/finance/': `# extractor.sh finance API

Call \`GET ${ORIGIN}/api/finance\` with a required \`symbol\`, optional \`timeframe\`, optional three-letter \`quote\` currency, and \`format=json|markdown\`.

${financeExample}

Symbols are canonicalized to uppercase and contain at most 32 supported characters. Timeframes are \`1d\`, \`5d\`, \`1mo\`, \`3mo\`, \`6mo\`, \`1y\`, \`5y\`, and \`max\`. History is capped at 512 points. Without \`quote\`, values remain in the listing currency. With \`quote=EUR\` or another three-letter currency, the snapshot and history are converted in the same one-credit operation and include listing-currency and exchange-rate metadata. Successful responses may be cached for five minutes.

Use \`GET ${ORIGIN}/api/finance/search?q=Apple&limit=10&format=json\` to resolve company names or partial tickers into equity listings. Successful stock searches may be cached for one hour.
`,
  '/docs/mcp/': `# extractor.sh hosted MCP server

Connect an MCP-compatible client to the public stateless Streamable HTTP endpoint at \`${ORIGIN}/mcp\`. No account, API key, or OAuth flow is required.

## Tool: extract_public_url

- \`url\`: required absolute public HTTP or HTTPS page URL.
- \`format\`: optional \`markdown\` (default) or \`json\`.
- \`focus\`: optional short topic such as \`pricing\`, \`features\`, or \`FAQ\`.

## Tool: search_web

- \`query\`: required public web query, up to 200 characters.
- \`format\`: optional \`markdown\` (default) or \`json\`.
- \`limit\`: optional integer from 1 to 10.
- \`language\` and \`country\`: optional locale controls.

## Tool: search_news

- \`query\`: required news query.
- \`limit\`: optional integer from 1 to 50.
- \`language\`, \`country\`, and \`timeframe\`: optional effective filters.

## Tool: search_images

- \`query\`: required image query, up to 200 characters.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`limit\`: optional integer from 1 to 20.
- \`usage\` and \`orientation\`: optional image filters.

## Tool: search_videos

- \`query\`: required video query, up to 200 characters.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`limit\`: optional integer from 1 to 20.
- \`language\` and \`country\`: optional locale controls.
- \`platform\`: optional \`any\` or \`youtube\`.
- \`sort\`: optional \`relevance\` or newest-first \`date\`; use \`date\` for latest-video requests.

## Tool: search_places

- \`query\`: required address, business, landmark, or local-category query, up to 200 characters.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`limit\`: optional integer from 1 to 10.
- \`language\`, \`country\`, paired \`lat\`/\`lon\`, and \`type\`: optional place controls.

## Tool: get_market_data

- \`symbol\`: required market symbol.
- \`timeframe\`: optional finance range.
- \`quote\`: optional three-letter output currency. Pass it directly instead of making a separate currency-pair call.
- \`format\`: optional \`json\` (default) or \`markdown\`.

## Tool: search_stocks

- \`query\`: required company name, brand, or partial ticker.
- \`limit\`: optional integer from 1 to 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.

Use search for discovery, then extract selected result URLs for full content. Markdown is best for reading and summarizing. JSON follows extractor.sh schema version 1. MCP calls share cache entries and limits with \`GET ${ORIGIN}/api/search\` and \`GET ${ORIGIN}/api/extract\`. Do not send credentials, cookies, private URLs, or private data.

- [MCP Server Card](${ORIGIN}/.well-known/mcp/server-card.json)
- [Limits and caching](${ORIGIN}/docs/limits/)
`,
  '/docs/api/': `# extractor.sh API reference

## GET /api/extract

- \`url\`: required absolute public HTTP or HTTPS URL, up to 2,048 characters.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`focus\`: optional topic from 1 to 80 characters.

## GET /api/search

- \`q\`: required query, up to 200 characters.
- \`limit\`: optional integer from 1 to 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.

## GET /api/news

- \`q\`: required news query, up to 200 characters.
- \`limit\`: optional integer from 1 to 50.
- \`format\`: optional \`json\` (default) or \`markdown\`.

## GET /api/images

- \`q\`: required image query, up to 200 characters.
- \`limit\`: optional integer from 1 to 20.
- \`format\`: optional \`json\` (default) or \`markdown\`.

## GET /api/videos

- \`q\`: required video query, up to 200 characters.
- \`limit\`: optional integer from 1 to 20.
- \`format\`: optional \`json\` (default) or \`markdown\`.
- \`language\` and \`country\`: optional locale controls.
- \`platform\`: optional \`any\` or \`youtube\`.

## GET /api/places

- \`q\`: required place name or address, up to 200 characters.
- \`limit\`: optional integer from 1 to 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.

## GET /api/finance

- \`symbol\`: required market symbol, up to 32 characters.
- \`timeframe\`: optional \`1d|5d|1mo|3mo|6mo|1y|5y|max\`.
- \`quote\`: optional three-letter output currency such as \`EUR\`.
- \`format\`: optional \`json\` (default) or \`markdown\`.

## GET /api/finance/search

- \`q\`: required company name, brand, or partial ticker, up to 200 characters.
- \`limit\`: optional integer from 1 to 10.
- \`format\`: optional \`json\` (default) or \`markdown\`.

JSON responses use schema version \`1\` and contain the shared fields \`type\`, \`source\`, \`id\`, \`url\`, \`title\`, \`author\`, \`publishedAt\`, \`content\`, \`media\`, and \`attributes\`. The semantic \`type\` is \`document\`, \`article\`, \`product\`, \`post\`, \`profile\`, \`video\`, \`audio\`, or \`feed\`. Feed and profile responses also contain \`items\`. Errors use an \`error\` object with \`code\` and \`message\`.

See the [schema guide](${ORIGIN}/docs/schema/), [JSON Schema](${ORIGIN}/schemas/extraction-v1.json), and [OpenAPI 3.1 document](${ORIGIN}/openapi.json) for the machine-readable contracts.
`,
  '/docs/schema/': `# extractor.sh JSON response schema

Every successful JSON response uses \`schemaVersion: 1\` and a semantic \`type\`: \`document\`, \`article\`, \`product\`, \`post\`, \`profile\`, \`video\`, \`audio\`, or \`feed\`.

The schema applies to successful JSON responses from \`GET ${ORIGIN}/api/extract\`, \`GET ${ORIGIN}/api/search\`, \`GET ${ORIGIN}/api/news\`, \`GET ${ORIGIN}/api/images\`, \`GET ${ORIGIN}/api/videos\`, \`GET ${ORIGIN}/api/places\`, \`GET ${ORIGIN}/api/finance\`, and \`GET ${ORIGIN}/api/finance/search\`.

The common fields are \`source\`, \`id\`, \`url\`, \`title\`, \`author\`, \`publishedAt\`, \`content\`, \`media\`, and \`attributes\`. Content is Markdown. Common nullable fields are present with \`null\` when unavailable; optional type-specific attributes are omitted. Feed and profile entities include \`items\`, whose entries use the same entity shape.

Product \`attributes.price\` and variant \`price\` values are non-negative integers in the currency's minor unit. For example, \`1999\` with \`EUR\` means €19.99. \`priceDisplay\` is presentation text.

Finance document attributes can include \`tickerSymbol\`, \`exchange\`, effective \`currency\`, \`listingCurrency\`, \`quoteCurrency\`, \`exchangeRate\`, \`exchangeRateTimestamp\`, \`instrumentType\`, quote fields, \`marketState\`, \`historyTimeframe\`, \`historyInterval\`, bounded \`history\`, and market \`events\`. Finance feeds from stock search contain equity documents and effective \`resultCount\`. Market prices are decimal quote values; the integer minor-unit rule applies only to product prices.

- [JSON Schema Draft 2020-12](${ORIGIN}/schemas/extraction-v1.json)
- [OpenAPI 3.1](${ORIGIN}/openapi.json)
`,
  '/docs/sources/': `# Supported extractor.sh sources

Submit normal public browser URLs to \`GET ${ORIGIN}/api/extract\`.

- Web: public HTTP and HTTPS content pages, including supported product details and repeated product listings.
- Amazon: public product detail, search, storefront, Idea List, and shared Wish List pages. Results may be cached for up to one hour.
- Apple App Store: public app detail pages containing a numeric app ID. Results are software product entities.
- Bluesky: public profile feeds and individual public post pages.
- Google News: public search, topic, and top-stories pages. Feeds contain up to 50 article entities.
- Google Play: public app detail pages containing an Android package ID. Results are software product entities.
- Instagram: public post, reel, and profile pages with exposed carousel media, profile details, and recent posts when available.
- Mastodon: public status pages on compatible instances.
- Shopify: public product pages, collections, and storefront homepages. Submit the normal storefront URL; catalog feeds contain up to 50 products.
- WooCommerce: public product pages, shop and storefront pages, product-search result pages, and supported product-category pages. Results use product entities with integer minor-unit prices.
- SoundCloud: public tracks, playlists, sets, and creator profiles.
- Spotify: public tracks, albums, artists, playlists, podcast shows, and episodes.
- TikTok: public video posts, photo posts, short links, and creator profiles with up to ten recent posts.
- Vimeo: public video pages, including supported channel, group, showcase, and On Demand links.
- Reddit: public post, subreddit, community, and user profile pages.
- X: public x.com and twitter.com status pages.
- Yahoo Finance: public quote and price-history pages. Results include the latest available market snapshot and up to one month of recent daily OHLCV history, and may be cached for up to five minutes.
- YouTube: public video, Shorts, channel, handle, user, and playlist pages.

Private sources, credentials, stories, transcripts, media downloads, Bluesky reply threads, and complete Reddit comment trees are not supported.
`,
  '/docs/limits/': `# extractor.sh limits and caching

The public \`GET ${ORIGIN}/api/search\`, \`/api/news\`, \`/api/images\`, \`/api/videos\`, \`/api/places\`, \`/api/finance\`, \`/api/finance/search\`, and \`/api/extract\` APIs allow 60 uncached requests per client per 60 seconds. Extraction and news search additionally share the limit of at most 5 high-cost requests per client per 60 seconds when a high-cost request is required.

- Single entities and pages may be cached at the edge for up to 30 days.
- Products, profiles, and feeds may be cached for up to 1 hour.
- Yahoo Finance market documents may be cached for up to 5 minutes.
- Web searches may be cached for up to 1 hour.
- News searches may be cached for up to 1 hour.
- Image searches may be cached for up to 1 hour.
- Video searches may be cached for up to 1 hour.
- Place searches may be cached for up to 1 hour.
- Errors are not cached.
- URLs may contain up to 2,048 characters.
- Extracted results may contain up to 2 MB.
- Only public HTTP and HTTPS URLs are accepted.
`,
  '/docs/limitations/': `# extractor.sh limitations

extractor.sh is designed for straightforward extraction of public content through \`GET ${ORIGIN}/api/extract\`.

- CAPTCHAs are not bypassed or solved.
- Login walls, private pages, paywalls, age gates, and other access controls are not bypassed.
- Callers cannot select a server, country, region, or request location. Cloudflare selects the infrastructure location automatically.
- Cookies, authorization headers, custom request headers, and browser sessions cannot be supplied.
- Highly interactive, protected, or region-locked pages may return incomplete content or fail.
- Reddit comment trees, YouTube transcripts or media, and private or deleted X posts are not provided.
`,
  '/pricing/': `# extractor.sh pricing

> Simple prepaid pricing: $0.49 / 1,000 credits.

Each successful uncached extraction, web search, news search, image search, video search, place or map search, or finance request counts as one credit.

Credits never expire and form the hard usage cap. New accounts receive 1,000 welcome credits once. Buy an exact one-time amount from $10.00 to $4,900.00 whenever you need more. Optional capped automatic funding can be authorized separately and runs only when the prepaid balance reaches the customer's threshold. Anonymous callers receive 10 successful uncached operations per IP each UTC day. The website tools use the account session automatically, while external integrations use an API key. Identical cache hits are free, and the 60-per-minute protection still applies. Manage credits, automatic funding, and API keys in the private [dashboard](${ORIGIN}/dashboard/). API usage is documented at \`GET ${ORIGIN}/api/extract\`.

## Pricing FAQ

- **Is there a free tier?** Yes: 10 successful uncached requests per IP each UTC day without an account, plus a one-time 1,000-credit welcome bonus for new accounts.
- **How do API credits work?** Each successful uncached account operation uses one non-expiring welcome or purchased credit.
- **Are failed requests charged?** No. Failed work releases its reservation, and cache hits are free.
- **What happens at zero credits?** Uncached account requests return HTTP 402 until credits are added.
- **Is there a monthly plan?** No scheduled monthly plan is required. Funding uses one-time pay-as-you-go top-ups, with optional capped automatic funding triggered by a low balance.
- **What are the rate limits?** The standard limit is 60 uncached requests per client per minute, with 5 high-cost extraction requests per minute.
- **Why do I see tax, and which payment methods are accepted?** Dodo Payments applies tax under the transaction details and local rules, and displays the available payment methods in checkout.
- **Are startup or nonprofit discounts available?** There is no standard program; contact extractor.sh when the public pricing does not fit the use case.
- **Are there extra fees for complex pages?** No. Every supported successful uncached account operation has the same one-credit cost.
- **Do all endpoints and features cost the same?** Yes. Every supported successful uncached API or MCP operation uses one allowance slot or credit, regardless of endpoint or extraction method. Failed requests and cache hits are free.
`,
  '/contact/': `# Contact extractor.sh

> Ask a question or get help evaluating extractor.sh for a specific public URL.

Use the contact form at ${ORIGIN}/contact/. Include a public example URL and describe the Markdown or JSON result you need. Do not send credentials, private URLs, or sensitive data.

For technical details before contacting us, see the [developer documentation](${ORIGIN}/docs/) for \`GET ${ORIGIN}/api/extract\`.
`,
};

// Platform HTML, structured data, and agent-readable Markdown share one
// source of truth so capability promises cannot drift between representations.
for (const platform of platformPageList) {
  pages[`/${platform.slug}/`] = `# ${platform.headline}

> ${platform.description}

## Capabilities

${platform.capabilities.map((capability) => `- **${capability.name}** (${capability.output}): ${capability.description}`).join('\n')}

## Supported inputs

${platform.includes.map((item) => `- ${item}`).join('\n')}

## Boundaries

${platform.limitations.map((item) => `- ${item}`).join('\n')}

Call \`GET ${ORIGIN}/api/extract\` with an ordinary public ${platform.platform} URL in the \`url\` parameter. Choose \`format=markdown\` or \`format=json\`. The public playground at ${ORIGIN}/${platform.slug}/ uses the anonymous allowance without an account and the account credit balance after sign-in.
`;
}

pages['/blog/'] = `# extractor.sh blog

> ${CURRENT_YEAR} guides for extracting public pages, searching the web, and giving AI agents source-linked Markdown or normalized JSON.

${platformArticles.map((article) => `- [${article.headline ?? `How to scrape data from ${article.platform} in ${CURRENT_YEAR}`}](${ORIGIN}/blog/${article.slug}/): ${article.description}`).join('\n')}

The guides cover public extraction, web search, news, images, places, and the hosted MCP server.
`;

for (const article of platformArticles) {
  const headline = article.headline ?? `How to scrape data from ${article.platform} in ${CURRENT_YEAR}`;
  const apiExample = article.apiExample ?? `curl --get '${ORIGIN}/api/extract' \\
  --data-urlencode 'url=${article.exampleUrl}' \\
  --data-urlencode 'format=json'`;
  pages[`/blog/${article.slug}/`] = `# ${headline}

> ${article.description}

${article.introduction}

## Available public data

${article.extracts.map((item) => `- ${item}`).join('\n')}

## Boundaries

${article.boundaries.map((item) => `- ${item}`).join('\n')}

## Example

\`\`\`
${apiExample}
\`\`\`
`;
}

pages['/alternatives/'] = `# extractor.sh alternatives

> Compare focused extraction and search APIs with broader search, proxy, browser, crawling, and automation providers.

${alternativePages.map((page) => `- [extractor.sh vs. ${page.provider}](${ORIGIN}/alternatives/${page.slug}/): ${page.description}`).join('\n')}

Try the public \`GET ${ORIGIN}/api/extract\` endpoint without an account or API key.
`;

for (const alternative of alternativePages) {
  pages[`/alternatives/${alternative.slug}/`] = `# A focused ${alternative.provider} alternative

> Skip the scraping stack when you already have a public URL and need clean Markdown or normalized JSON.

extractor.sh gives applications and AI agents focused GET endpoints for public-page extraction plus web, news, image, and place search without proxy configuration, browser-session management, crawl jobs, or result polling.

## Where extractor.sh wins

${alternative.chooseExtractor.map((item) => `- ${item}`).join('\n')}

## Where ${alternative.provider} fits

${alternative.providerStrength}

${alternative.chooseProvider.map((item) => `- ${item}`).join('\n')}

## What stays simple

- One GET endpoint
- Raw Markdown or consistent, typed JSON
- Platform-aware extraction across supported sources
- Edge caching; cache hits are not billed

Try the public \`GET ${ORIGIN}/api/extract\` endpoint without an account, API key, SDK, or POST body.
`;
}

export function getSiteMarkdown(pathname: string): string | null {
  const normalized = pathname === '/' ? '/' : `${pathname.replace(/\/+$/, '')}/`;
  return pages[normalized] ?? null;
}
