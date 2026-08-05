# Authentication — extractor.sh

Authentication is optional and is evaluated only after the shared edge-cache lookup.

- Without an account, successful uncached operations use the free allowance of 10 per IP each UTC day.
- New accounts receive a one-time welcome bonus of 1,000 non-expiring credits.
- Signed-in homepage and platform-playground requests automatically use the account's credit balance.
- External integrations use that same balance with `Authorization: Bearer ext_live_…`.
- Cache hits, invalid requests, upstream failures, and rate-limited work use neither the anonymous allowance nor account credits.

Create and revoke up to two active API keys in the private [dashboard](https://extractor.sh/dashboard/). Keys are stored only as hashes and the complete value is shown once at creation. Never copy the Hanko browser-session cookie into an integration.

An invalid or revoked key returns HTTP `401` on an uncached request. An account with insufficient credits returns `402`. Anonymous daily or protective rate limits return `429`.

Use the same optional Bearer header with the hosted `/mcp` endpoint. Never put API keys, cookies, credentials, private URLs, or confidential data in query parameters.

See the [API reference](https://extractor.sh/docs/api/), [limits](https://extractor.sh/docs/limits/), and [pricing](https://extractor.sh/pricing/).
