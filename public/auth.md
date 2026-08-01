# Auth.md — extractor.sh

extractor.sh currently requires no account, API key, OAuth flow, cookie, or authorization header.

Call the public `GET /api/extract` endpoint with an absolute public URL and `format=json` or `format=markdown`.

Do not send credentials, cookies, authorization tokens, private URLs, or private data. Requests are subject to the published rate limits.

See the [developer documentation](https://extractor.mcb-software.workers.dev/docs/) and [limits](https://extractor.mcb-software.workers.dev/docs/limits/) for details.
