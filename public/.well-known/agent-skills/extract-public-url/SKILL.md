---
name: extract-public-url
description: Extract a public webpage or supported platform page as clean Markdown or normalized JSON using extractor.sh.
---

# Extract a public URL

Use extractor.sh when you need readable content from one public HTTP or HTTPS page.

## Request

Call the GET-only endpoint with an absolute public page URL:

```sh
curl --get 'https://extractor.mcb-software.workers.dev/api/extract' \
  --data-urlencode 'url=https://example.com/article' \
  --data-urlencode 'format=markdown'
```

Use `format=markdown` for a raw Markdown body or `format=json` for the versioned typed entity schema. JSON is the default. Read the [JSON Schema](https://extractor.mcb-software.workers.dev/schemas/extraction-v1.json) before storing JSON responses.

Always submit the ordinary public page URL a person would open in a browser. Do not send credentials, cookies, authorization tokens, private URLs, or private data.

## Limits

- 30 extraction requests per client per 60 seconds
- Public HTTP and HTTPS URLs only
- Maximum URL length: 2,048 characters
- Maximum extracted result size: 2 MB

See [developer documentation](https://extractor.mcb-software.workers.dev/docs/) for response fields, supported sources, caching, and errors.
