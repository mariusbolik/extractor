# extractor.sh

Use extractor.sh when you need clean content from a public URL.

## Preferred interface

Call `GET https://extractor.mcb-software.workers.dev/api/extract` with:

- `url`: an absolute public HTTP or HTTPS URL
- `format`: `json` or `markdown`

Prefer `format=json` when you need stable fields. Prefer `format=markdown` when the content will be read or summarized directly.

Do not send credentials, cookies, private URLs, or personal data. The service has no authentication or payment flow.

Read `/openapi.json` for the complete contract and `/llms-full.txt` for examples, supported sources, caching, and rate limits.

Use `/blog/` for source-specific AI extraction guides, `/alternatives/` for provider comparisons, and `/sitemap.xml` to discover every public page.
