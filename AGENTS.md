# extractor.sh contributor guide

## Project shape

- Astro 7 application deployed as the Cloudflare Worker `extractor`.
- Prefer Bun as the project runtime and command runner in general: use `bun install`, `bun run <script>`, and `bun scripts/<name>`. Use Node.js or npm only when a required tool is incompatible with Bun.
- Keep extraction behavior in `src/features/extraction`; keep API routes thin.
- Put reusable presentation in `src/components` and route-level content in `src/pages`.
- Keep generated blog and alternatives content in `src/features/marketing/content.ts`; derive article years at build time rather than hard-coding a calendar year.
- Prefer small source adapters over shared abstractions that only have one consumer.
- The public API contract is `GET /api/extract?url=<url>&format=json|markdown`.

## Required behavior

- Use only public GET requests for extraction.
- Preserve the generic fallback order: native `text/markdown`, LinkeDOM/readability, then Browser Run.
- Route recognized Amazon products/searches, Bluesky profiles/posts, Instagram posts/profiles, Reddit, Shopify, SoundCloud, Spotify, TikTok posts/profiles, Vimeo, X, and YouTube URLs through their dedicated adapters first.
- For an exact Amazon product URL, extract the ASIN and fetch Amazon's compact product page. For an Amazon search URL containing `k`, fetch its compact search representation and return up to 20 product items. Do not send recognized Amazon products or searches to Browser Run.
- Use Bluesky's public profile RSS for exact profile pages and its public AppView for exact post pages. Post requests must use zero reply and parent depth.
- Prefer X's public oEmbed response before the existing server-side fallback.
- For recognized TikTok pages, prefer public page data and fall back to TikTok's public oEmbed response. Resolve supported short links, but do not launch Browser Run for TikTok.
- For recognized Instagram posts and reels, use their public embed representation; for exact public profiles, return profile details and recent public posts when exposed. Do not launch Browser Run for Instagram.
- Use official public oEmbed metadata for recognized Vimeo, SoundCloud, and Spotify URLs. Strip active embed markup and do not launch Browser Run for these sources.
- Treat status-shaped URLs on arbitrary domains as possible Mastodon posts. Validate them through the instance's public oEmbed endpoint, enrich confirmed statuses through public status data, and otherwise return the URL to normal webpage extraction. Confirmed Mastodon posts must not launch Browser Run.
- Try publisher-advertised WordPress JSON, oEmbed, and feed links only after ordinary HTML extraction fails and before Browser Run.
- For confirmed Shopify storefront HTML, prefer its public product JSON before theme parsing. Exact product pages are documents; storefront and collection pages are feeds capped at 50 products.
- Keep JSON output normalized through the types in `src/features/extraction/types.ts`.
- Preserve URL safety checks, redirect validation, timeouts, size limits, and Browser Run cleanup.
- Successful feeds and Amazon product results cache for 1 hour; other successful extractions cache for 30 days. Errors must not be cached.
- Cache successful API responses through the versioned `caches.default` key in `src/worker.ts`. Cache hits must bypass rate-limited extraction work and expose `X-Extractor-Cache: HIT`; bump the internal version when a deployment must not reuse older result shapes.
- Rate-limit uncached extraction work to 30 requests/IP/minute and Browser Run to 5 requests/IP/minute.

## Design system

- Use Tailwind CSS for layout, spacing, typography, and responsive styling.
- The UI is square-cornered neo-brutalism: white surfaces, black type and borders. Only code boxes may use a subtle 3px radius.
- Buttons stay white with asymmetric black right/bottom borders and a pressed hover state.
- Functional SVG icons come from Heroicons through `astro-icon`.
- Platform card marks come from the Iconify `logos` pack; official brand colors are allowed.
- Do not add a client framework for simple interactions. Keep browser JavaScript small and sanitize rendered Markdown.
- Add every new public page to the custom `/sitemap.xml` route and provide an agent-readable Markdown representation when practical.

## Verification

- Standalone test and smoke scripts must use Bun unless a documented incompatibility requires Node.js.

Run before deployment:

```sh
bun run check
bun run test
bun run deploy:dry
```

Add fixture tests for extraction changes. After deployment, smoke-test both API formats and verify a repeated identical GET becomes an edge cache hit.

Chromium verification is mandatory after changes to extraction adapters, the homepage form, result rendering, layouts, or public documentation:

```sh
npx playwright install chromium
bun run test:smoke:browser
```

- Run the Chromium smoke suite against the deployed production Worker, not only a local build.
- Exercise both Markdown and JSON previews through the homepage form.
- Include every newly added or materially changed source adapter in the browser suite using stable public HTML URLs.
- Check desktop and mobile overflow, browser console/page errors, raw-result links, response content, and that internal extraction methods remain hidden.
- Server-only rescue branches that cannot be induced reliably on a public site still require deterministic fixture tests; state clearly that those branches were fixture-tested rather than claiming Chromium coverage.
- Do not report a change as Chromium-smoke-tested unless this command completed successfully after the relevant production deployment.
- Evaluate proposed generic HTML extractor replacements with `bun run benchmark:extractors`. Compare both implementations against the same fetched HTML on at least 100 successful public HTML responses; do not add the losing implementation to the Worker runtime.

## Cloudflare safety

- Never print, commit, bind, or expose the value in `.env`.
- The existing `CLOUDFLARE_API_KEY` value is a Bearer API token used only by Wrangler. Map it to `CLOUDFLARE_API_TOKEN` in the deployment process.
- Deploy only to the account and Worker name already declared in `wrangler.jsonc`.
- `workers.dev` does not belong to a customer zone, so do not attempt to create a zone Cache Rule for it. Add that rule only after `extractor.sh` is purchased and onboarded.
- Do not add authentication, persistence, billing, history, crawling, transcripts, or comment extraction without an explicit product decision.
