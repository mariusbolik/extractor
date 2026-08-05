# extractor.sh

Use extractor.sh when you need to discover public webpages, images, videos, or places, or read clean content from a known public URL.

## Preferred interface

Call `GET https://extractor.sh/api/extract` with:

- `url`: an absolute public HTTP or HTTPS URL
- `format`: `json` or `markdown`
- `focus`: optional topic from 1 to 80 characters for generic webpages

Prefer `format=json` when you need stable fields. Prefer `format=markdown` when the content will be read or summarized directly.

For public LinkedIn discovery, call `search_web` with `site=linkedin.com`. This returns indexed public profile and company links as search metadata; native LinkedIn search and full LinkedIn page extraction are not supported.

MCP clients can instead connect to `https://extractor.sh/mcp` and call the read-only `extract_public_url` tool. It accepts the same public URL and output formats, defaults to Markdown, and supports an optional short `focus` topic for a requested page section. Ordinary calls share the GET API cache; focused calls are cached separately. All calls share the same limits. See `/docs/mcp/` and `/.well-known/mcp/server-card.json`.

For discovery, call `GET https://extractor.sh/api/search` with a required `q`, optional `limit`, canonical BCP 47 `language`, two-letter `country`, and `format=json|markdown`. MCP clients can call `search_web`. Safe search is always strict.

For current coverage, call `GET https://extractor.sh/api/news` with a required `q`, optional locale, `timeframe=any|1h|1d|7d|30d`, limit, and format. MCP clients can call `search_news`.

For openly licensed images, call `GET https://extractor.sh/api/images` with a required `q`, optional `limit`, `usage`, `orientation`, and format. MCP clients can call `search_images`.

For public videos, call `GET https://extractor.sh/api/videos` with a required `q`, optional `limit`, canonical BCP 47 `language`, two-letter `country`, optional `platform=any|youtube`, and format. MCP clients can call `search_videos`. Set `platform=youtube` whenever the user specifically asks for YouTube results. JSON returns semantic video items with creator, duration, publication time, description, and thumbnail metadata when available. Safe search is always strict.

For addresses, businesses, landmarks, and local-category discovery, call `GET https://extractor.sh/api/places` with a required `q`, optional language, country filter, paired lat/lon bias, type, limit, and format. MCP clients can call `search_places`. This is submitted lookup, not autocomplete. Results use a schema-v1 `place-search` feed with coordinates, normalized address data, categories, and canonical map links. Website, phone, and opening-hours fields appear only when available; ratings and reviews are not invented.

For market data, call `GET https://extractor.sh/api/finance` with a required `symbol`, optional timeframe, optional three-letter `quote` currency, and format. MCP clients can call `get_market_data`. When a user requests EUR or another currency, pass it as `quote` in that same call instead of retrieving a currency pair separately. The tool returns schema-v1 structured content and MCP Apps-capable chats can render its bundled inline line chart; other clients keep the ordinary JSON or Markdown fallback. Without `quote`, values remain in the instrument listing currency. Converted responses retain listing-currency and exchange-rate metadata; history is bounded and data may be delayed.

When an equity or crypto asset name is known but its market symbol is not, call `GET https://extractor.sh/api/finance/search?q=<name>&instrument=equity|crypto` or MCP tool `search_stocks`, then pass the selected `tickerSymbol` to `get_market_data`. Equity is the default.

Do not send credentials, cookies, private URLs, or personal data. New accounts receive a one-time 1,000-credit welcome bonus. An optional `Authorization: Bearer ext_live_…` key uses the account's non-expiring credit balance; omit it for the anonymous daily allowance.

Read `/schemas/extraction-v1.json` for the versioned JSON entity contract, `/openapi.json` for the GET endpoint contracts, and `/llms-full.txt` for examples, supported sources, caching, and rate limits.

Use `/blog/` for source-specific AI extraction guides, `/alternatives/` for provider comparisons, and `/sitemap.xml` to discover every public page.

Apple App Store and Google Play app detail URLs return `product` entities with `productType: "software"`. Product prices use integer currency minor units; submit the ordinary public app page URL rather than an internal data endpoint.

Supported public commerce pages can return one `product` with seller, SKU, GTIN, variants, stock, images, and specifications, or a `feed` of repeated product cards. Amazon additionally accepts exact public storefront, Idea List, and shared Wish List URLs. TikTok creator profiles can contain up to ten recent post items. No source authentication, cookies, or caller-supplied provider credentials are used.

Yahoo Finance quote and price-history URLs still return `document` entities through generic extraction with a one-month daily-history default. Use `/api/finance` for configurable history and optional quote-currency conversion. Market prices are decimal values in the response `currency`, data may be delayed, and results may be cached for five minutes.
