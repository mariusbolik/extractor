---
name: extract-public-url
description: Extract a public webpage or supported platform page as clean Markdown or normalized JSON using extractor.sh.
---

# Extract a public URL

Use extractor.sh when you need readable content from one public HTTP or HTTPS page.

If the exact page is unknown, use the separate [`search_web`](https://extractor.sh/.well-known/agent-skills/search-web/SKILL.md) skill first and extract only the relevant result URLs.

MCP clients can connect directly to the hosted Streamable HTTP endpoint at `https://extractor.sh/mcp` and call `extract_public_url`. The tool accepts `url`, optional `format` (defaulting to `markdown`), and an optional short `focus` topic. When the user asks for a specific part of a landing page, such as pricing, features, or FAQ, pass that topic as `focus`.

## Request

Call the GET-only endpoint with an absolute public page URL:

```sh
curl --get 'https://extractor.sh/api/extract' \
  --data-urlencode 'url=https://example.com/article' \
  --data-urlencode 'focus=pricing' \
  --data-urlencode 'format=markdown'
```

Use `format=markdown` for a raw Markdown body or `format=json` for the versioned typed entity schema. JSON is the default. Read the [JSON Schema](https://extractor.sh/schemas/extraction-v1.json) before storing JSON responses.

Always submit the ordinary public page URL a person would open in a browser. Do not send credentials, cookies, authorization tokens, private URLs, or private data.

Exact public LinkedIn `/in/` and `/company/` URLs can return profile details and recent public activity exposed on the same page. If the exact profile URL is unknown, use `search_web` first and then extract a matching public URL. Do not attempt native LinkedIn people or company search and never send LinkedIn cookies or credentials.

For paid cache misses, send the API key only as `Authorization: Bearer ext_live_…`. Omit the header to use the free anonymous allowance. Identical cache hits are free.

## Limits

- 60 uncached requests per client per 60 seconds
- 10 successful uncached operations per anonymous IP per UTC day
- Public HTTP and HTTPS URLs only
- Maximum URL length: 2,048 characters
- Maximum extracted result size: 2 MB

See [MCP documentation](https://extractor.sh/docs/mcp/) for client configuration and [developer documentation](https://extractor.sh/docs/) for response fields, supported sources, caching, and errors.
