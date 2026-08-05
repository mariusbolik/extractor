---
name: search-videos
description: Search public video pages as typed JSON or readable Markdown using extractor.sh.
---

# Search public videos

Use extractor.sh when a user wants relevant or newest public videos and no exact video URL is known.

MCP clients can connect to `https://extractor.sh/mcp` and call `search_videos`. Pass a concise `query`, optional exact `creator`, optional `format`, limit from 1 to 20, canonical BCP 47 `language`, two-letter `country`, optional `platform=any|youtube`, and optional `sort=relevance|date`. The default `any` mode finds public video pages from supported sources. Set `platform=youtube` whenever the user specifically asks for YouTube-only results. Set `sort=date` whenever the user says “latest,” “newest,” or otherwise requests reverse-chronological results. Safe search is always strict.

## Request

```sh
curl --get 'https://extractor.sh/api/videos' \
  --data-urlencode 'q=Cloudflare Workers tutorial' \
  --data-urlencode 'limit=10' \
  --data-urlencode 'language=en-US' \
  --data-urlencode 'country=US' \
  --data-urlencode 'platform=youtube' \
  --data-urlencode 'sort=relevance' \
  --data-urlencode 'format=json'
```

JSON returns a schema-v1 `video-search` feed containing semantic `video` items. Items include a playable public source-page URL plus creator, publication time, description, duration, exact view count, and thumbnail metadata when available. Markdown returns a readable ordered list.

For “give me the latest video of Taylor Swift,” interpret “of” as an upload from the named artist and call `search_videos` with `{ "query": "Taylor Swift", "creator": "Taylor Swift", "platform": "youtube", "sort": "date", "limit": 1, "format": "json" }`. Return the first item’s title, creator, displayed publication time, thumbnail, and YouTube page URL. For the newest video merely about a person, omit `creator`. Do not guess recency from relevance-ranked results.

Use the returned source-page URL with `extract_public_url` only when the page itself needs further extraction. Direct media streams, downloads, transcripts, comments, pagination, and private videos are not returned.

## Limits

- Query length: up to 200 characters
- Results per request: 1 to 20
- 60 uncached requests per client per 60 seconds
- Successful results may be cached for up to one hour
- Unknown query parameters are ignored and do not fragment cache entries

See [video search documentation](https://extractor.sh/docs/videos/) and [MCP documentation](https://extractor.sh/docs/mcp/).
