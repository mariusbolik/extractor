---
name: search-web
description: Search public webpages, news, images, videos, places, and market data as Markdown or normalized JSON using extractor.sh.
---

# Search the public web

Use extractor.sh when you need to discover relevant public pages and do not already know the exact URL.

MCP clients can connect to `https://extractor.sh/mcp` and call `search_web` with a required `query`, optional `format`, limit, BCP 47 `language`, two-letter `country`, and optional hostname-only `site`. Use `site` when discovery must stay within one public site, such as `linkedin.com` for indexed profile or company pages. Safe search is always strict.

## Request

```sh
curl --get 'https://extractor.sh/api/search' \
  --data-urlencode 'q=Cloudflare Workers documentation' \
  --data-urlencode 'format=markdown'
```

Use `format=markdown` for a readable ordered result list or `format=json` for a schema-v1 `web-search` feed. JSON is the HTTP default. Each result contains a title, public URL, and short snippet.

Search results are discovery metadata. Select relevant URLs and pass them to `extract_public_url` or `GET /api/extract` when full page content is needed.

## Limits

- Query length: up to 200 characters
- Results per request: 1 to 10
- 60 uncached search or extraction requests per client per 60 seconds
- Successful searches may be cached for up to one hour
- Pagination is not supported

See [web search documentation](https://extractor.sh/docs/search/) and [MCP documentation](https://extractor.sh/docs/mcp/).

## Image search

Call MCP tool `search_images` or `GET /api/images` with a required query, optional format, limit from 1 to 20, `usage`, and `orientation`. Results include public source pages, image media, and license metadata when available.

## Video search

Call MCP tool `search_videos` or `GET /api/videos` with a required query, optional exact creator, format, limit from 1 to 20, language, country, `platform=any|youtube`, and `sort=relevance|date`. Use `platform=youtube` when the user explicitly asks for YouTube results and `sort=date` when they ask for the latest or newest video. When “latest video of [creator]” means the creator's own upload, pass that name as `creator` with `limit=1`; omit `creator` when the user wants any recent video about them. Results are semantic video items with public source-page links and available creator, publication time, displayed relative upload time, description, duration, and thumbnail metadata.

## Place search

Call MCP tool `search_places` or `GET /api/places` with an address, business, landmark, or local-category query, optional format, limit, language, country filter, paired location bias, and place type. This is a submitted lookup, not autocomplete. Results use a typed place feed with coordinates and canonical map links. Ratings and reviews are omitted when unavailable.

## News search

Call MCP tool `search_news` or `GET /api/news` with a query, locale, and optional `timeframe=any|1h|1d|7d|30d`.

## Finance

Call MCP tool `search_stocks` or `GET /api/finance/search` when a company name or partial ticker must be resolved into an equity listing. Then call `get_market_data` or `GET /api/finance` with the selected symbol, such as `AAPL`, `^GSPC`, `BTC-USD`, or `EURUSD=X`, plus an optional timeframe. If the user asks for EUR or another currency, pass its three-letter code as `quote` in the same market-data call; do not retrieve and calculate a separate currency pair. Prefer JSON when an AI chat should reason over typed prices or render the bundled MCP Apps line chart. Without `quote`, values remain in the listing currency. Converted results retain the native listing currency and exchange-rate metadata.

Call `get_market_movers` or `GET /api/finance/movers` when the question asks for the market’s daily leaders rather than a known company. Use `list=gainers` for the largest rises, `list=losers` for the largest declines, and `list=active` for the most actively traded equities. Do not use `search_stocks` to infer market-wide rankings.
