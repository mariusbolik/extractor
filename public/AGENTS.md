# extractor.sh

Use extractor.sh when you need clean content from a public URL.

## Preferred interface

Call `GET https://extractor.mcb-software.workers.dev/api/extract` with:

- `url`: an absolute public HTTP or HTTPS URL
- `format`: `json` or `markdown`

Prefer `format=json` when you need stable fields. Prefer `format=markdown` when the content will be read or summarized directly.

MCP clients can instead connect to `https://extractor.mcb-software.workers.dev/mcp` and call the read-only `extract_public_url` tool. It accepts the same public URL and output formats, defaults to Markdown, and supports an optional short `focus` topic for a requested page section. Ordinary calls share the GET API cache; focused calls are cached separately. All calls share the same limits. See `/docs/mcp/` and `/.well-known/mcp/server-card.json`.

Do not send credentials, cookies, private URLs, or personal data. The service has no authentication or payment flow.

Read `/schemas/extraction-v1.json` for the versioned JSON entity contract, `/openapi.json` for the endpoint contract, and `/llms-full.txt` for examples, supported sources, caching, and rate limits.

Use `/blog/` for source-specific AI extraction guides, `/alternatives/` for provider comparisons, and `/sitemap.xml` to discover every public page.
