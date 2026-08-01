import { CURRENT_YEAR, alternativePages, platformArticles } from '../marketing/content';

const ORIGIN = 'https://extractor.mcb-software.workers.dev';

const apiExample = `~~~sh
curl --get '${ORIGIN}/api/extract' \\
  --data-urlencode 'url=https://example.com/article' \\
  --data-urlencode 'format=markdown'
~~~`;

const pages: Record<string, string> = {
  '/': `# extractor.sh

> Turn public URLs into clean Markdown or normalized JSON through one cacheable GET request.

## Extract a public URL

Call \`GET ${ORIGIN}/api/extract\` with an absolute public \`url\` and \`format=markdown\` or \`format=json\`. The public preview requires no account or API key.

${apiExample}

## Supported sources

- [Amazon](${ORIGIN}/amazon/): Public product detail and search results pages from supported country stores.
- [Bluesky](${ORIGIN}/bluesky/): Public profile feeds and individual posts.
- [Google News](${ORIGIN}/google-news/): Public searches, topics, and top stories as article feeds.
- [Instagram](${ORIGIN}/instagram/): Public posts, reels, profiles, and recent profile posts.
- [Mastodon](${ORIGIN}/mastodon/): Public statuses from compatible federated instances.
- [Reddit](${ORIGIN}/reddit/): Public posts, communities, and user profiles.
- [Shopify](${ORIGIN}/shopify/): Public products, collections, and storefront catalogs.
- [SoundCloud](${ORIGIN}/soundcloud/): Public tracks, playlists, sets, and creator profiles.
- [Spotify](${ORIGIN}/spotify/): Public music, artist, playlist, and podcast links.
- [TikTok](${ORIGIN}/tiktok/): Public video and photo posts, short links, and creator profiles.
- [Vimeo](${ORIGIN}/vimeo/): Public video metadata.
- [X](${ORIGIN}/x/): Public X and Twitter status URLs.
- [YouTube](${ORIGIN}/youtube/): Public videos, channels, and playlists.
- Web pages: Public HTTP and HTTPS pages.

## Documentation

- [Developer documentation](${ORIGIN}/docs/)
- [Hosted MCP server](${ORIGIN}/docs/mcp/): Connect to \`${ORIGIN}/mcp\` and call \`extract_public_url\`.
- [OpenAPI 3.1](${ORIGIN}/openapi.json)
- [API catalog](${ORIGIN}/.well-known/api-catalog)
- [JSON Schema](${ORIGIN}/schemas/extraction-v1.json)
- [Full agent documentation](${ORIGIN}/llms-full.txt)
- [Pricing](${ORIGIN}/pricing/)
`,
  '/amazon/': `# Amazon product and search extraction with extractor.sh

> Turn a public Amazon product detail or search results page into clean Markdown or normalized JSON.

Submit an ordinary product URL containing an ASIN, such as \`https://www.amazon.de/echo-dot-2022/dp/B09B8X9RGM\`, or a search URL such as \`https://www.amazon.de/s?k=mechanical+keyboard\`. Searches return up to 20 normalized product items. Categories, pagination, carts, accounts, reviews, and personalized offers are unavailable. Results may be cached for up to one hour.

Call \`GET ${ORIGIN}/api/extract\` with the product or search page in the \`url\` parameter.
`,
  '/bluesky/': `# Bluesky extraction with extractor.sh

> Turn public Bluesky profiles and individual posts into clean Markdown or normalized JSON.

Profile pages return a profile entity with recent public post items. Individual post pages return one post entity. Replies and parent threads are not included.

Call \`GET ${ORIGIN}/api/extract\` with the Bluesky page in the \`url\` parameter.
`,
  '/google-news/': `# Google News extraction with extractor.sh

> Turn public Google News searches, topics, and top stories into clean Markdown or typed JSON.

Submit an ordinary Google News search, topic, or top-stories URL. Results contain up to 50 normalized article entities with public titles, publishers, dates, summaries, and source links when available. Full publisher article bodies, personalized results, Google Search, and Google Shopping are not included.

Call \`GET ${ORIGIN}/api/extract\` with the Google News page in the \`url\` parameter.
`,
  '/instagram/': `# Instagram extraction with extractor.sh

> Turn public Instagram posts, reels, and profiles into clean Markdown or normalized JSON.

Post and reel pages return one post entity. Public profile pages return a profile entity with recent public post items. Private content, stories, comments, transcripts, and media downloads are not supported.

Call \`GET ${ORIGIN}/api/extract\` with the ordinary Instagram page in the \`url\` parameter.
`,
  '/mastodon/': `# Mastodon extraction with extractor.sh

> Turn one public Mastodon status into clean Markdown or normalized JSON.

Submit a public status URL from a compatible instance. Results can include the post text, author, publication date, content warning, and media descriptions. Private statuses, timelines, complete threads, and media downloads are not supported.

Call \`GET ${ORIGIN}/api/extract\` with the Mastodon status in the \`url\` parameter.
`,
  '/reddit/': `# Reddit extraction with extractor.sh

> Turn public Reddit posts, communities, and profiles into clean Markdown or normalized JSON.

Submit normal public Reddit page URLs such as \`https://www.reddit.com/r/CloudFlare/\`. Private and quarantined communities are not supported, and post results do not include the complete comment tree.

Call \`GET ${ORIGIN}/api/extract\` with the Reddit page in the \`url\` parameter.
`,
  '/shopify/': `# Shopify extraction with extractor.sh

> Turn public Shopify products, collections, and storefront catalogs into clean Markdown or normalized JSON.

Submit an ordinary storefront page. Product pages return one product entity; storefront and collection pages return a feed with up to 50 product entities.

Call \`GET ${ORIGIN}/api/extract\` with the storefront page in the \`url\` parameter.
`,
  '/soundcloud/': `# SoundCloud extraction with extractor.sh

> Turn a public SoundCloud track, playlist, set, or profile into clean Markdown or normalized JSON.

Results contain public metadata rather than audio, transcripts, comments, or media downloads.

Call \`GET ${ORIGIN}/api/extract\` with the SoundCloud page in the \`url\` parameter.
`,
  '/spotify/': `# Spotify extraction with extractor.sh

> Turn a public Spotify music or podcast link into clean Markdown or normalized JSON.

Tracks, albums, artists, playlists, shows, and episodes are supported. Lyrics, transcripts, playback data, audio analysis, and media downloads are not included.

Call \`GET ${ORIGIN}/api/extract\` with the Spotify page in the \`url\` parameter.
`,
  '/tiktok/': `# TikTok extraction with extractor.sh

> Turn public TikTok video and photo posts or creator profiles into clean Markdown or normalized JSON.

Submit an ordinary public TikTok page or short link. Private, deleted, or age-restricted content, comments, transcripts, and media downloads are not supported.

Call \`GET ${ORIGIN}/api/extract\` with the TikTok page in the \`url\` parameter.
`,
  '/vimeo/': `# Vimeo extraction with extractor.sh

> Turn public Vimeo video metadata into clean Markdown or normalized JSON.

Results can include title, author, description, upload date, duration, thumbnail, and source URL. Transcripts, captions, comments, and media downloads are not included.

Call \`GET ${ORIGIN}/api/extract\` with the Vimeo video page in the \`url\` parameter.
`,
  '/x/': `# X extraction with extractor.sh

> Convert one public X or Twitter status URL into clean Markdown or normalized JSON.

Submit a public \`x.com\` or legacy \`twitter.com\` status URL. Private, deleted, and age-gated posts are not supported.

Call \`GET ${ORIGIN}/api/extract\` with the post page in the \`url\` parameter.
`,
  '/youtube/': `# YouTube extraction with extractor.sh

> Extract public YouTube video metadata, channels, and playlists into clean Markdown or normalized JSON.

Submit a normal public watch, Shorts, channel, handle, user, or playlist page such as \`https://www.youtube.com/@Cloudflare\`. Transcripts, captions, and media downloads are not provided.

Call \`GET ${ORIGIN}/api/extract\` with the YouTube page in the \`url\` parameter.
`,
  '/docs/': `# extractor.sh developer documentation

> Send a normal public webpage URL to one GET endpoint and receive Markdown or normalized JSON.

${apiExample}

## Documentation

- [Quickstart](${ORIGIN}/docs/quickstart/)
- [Hosted MCP server](${ORIGIN}/docs/mcp/)
- [API reference](${ORIGIN}/docs/api/)
- [JSON schema](${ORIGIN}/docs/schema/)
- [Supported sources](${ORIGIN}/docs/sources/)
- [Limits and caching](${ORIGIN}/docs/limits/)
- [Limitations](${ORIGIN}/docs/limitations/)
`,
  '/docs/quickstart/': `# extractor.sh quickstart

Call \`GET ${ORIGIN}/api/extract\` with a required public \`url\` and optional \`format\` of \`json\` or \`markdown\`.

${apiExample}

Always submit an ordinary public page URL a person could open in a browser.
`,
  '/docs/mcp/': `# extractor.sh hosted MCP server

Connect an MCP-compatible client to the public stateless Streamable HTTP endpoint at \`${ORIGIN}/mcp\`. No account, API key, or OAuth flow is required.

## Tool: extract_public_url

- \`url\`: required absolute public HTTP or HTTPS page URL.
- \`format\`: optional \`markdown\` (default) or \`json\`.

Markdown is best for reading and summarizing. JSON follows extractor.sh schema version 1. The MCP server and \`GET ${ORIGIN}/api/extract\` share the same Cloudflare cache and rate limits, including the lower browser-rendering limit. Do not send credentials, cookies, private URLs, or private data.

- [MCP Server Card](${ORIGIN}/.well-known/mcp/server-card.json)
- [Limits and caching](${ORIGIN}/docs/limits/)
`,
  '/docs/api/': `# extractor.sh API reference

## GET /api/extract

- \`url\`: required absolute public HTTP or HTTPS URL, up to 2,048 characters.
- \`format\`: optional \`json\` (default) or \`markdown\`.

JSON responses use schema version \`1\` and contain the shared fields \`type\`, \`source\`, \`id\`, \`url\`, \`title\`, \`author\`, \`publishedAt\`, \`content\`, \`media\`, and \`attributes\`. The semantic \`type\` is \`document\`, \`article\`, \`product\`, \`post\`, \`profile\`, \`video\`, \`audio\`, or \`feed\`. Feed and profile responses also contain \`items\`. Errors use an \`error\` object with \`code\` and \`message\`.

See the [schema guide](${ORIGIN}/docs/schema/), [JSON Schema](${ORIGIN}/schemas/extraction-v1.json), and [OpenAPI 3.1 document](${ORIGIN}/openapi.json) for the machine-readable contract for \`GET ${ORIGIN}/api/extract\`.
`,
  '/docs/schema/': `# extractor.sh JSON response schema

Every successful JSON response uses \`schemaVersion: 1\` and a semantic \`type\`: \`document\`, \`article\`, \`product\`, \`post\`, \`profile\`, \`video\`, \`audio\`, or \`feed\`.

The schema applies to successful JSON responses from \`GET ${ORIGIN}/api/extract\`.

The common fields are \`source\`, \`id\`, \`url\`, \`title\`, \`author\`, \`publishedAt\`, \`content\`, \`media\`, and \`attributes\`. Content is Markdown. Common nullable fields are present with \`null\` when unavailable; optional type-specific attributes are omitted. Feed and profile entities include \`items\`, whose entries use the same entity shape.

Product \`attributes.price\` and variant \`price\` values are non-negative integers in the currency's minor unit. For example, \`1999\` with \`EUR\` means €19.99. \`priceDisplay\` is presentation text.

- [JSON Schema Draft 2020-12](${ORIGIN}/schemas/extraction-v1.json)
- [OpenAPI 3.1](${ORIGIN}/openapi.json)
`,
  '/docs/sources/': `# Supported extractor.sh sources

Submit normal public browser URLs to \`GET ${ORIGIN}/api/extract\`.

- Web: public HTTP and HTTPS content pages.
- Amazon: public product detail pages and search results pages. Search feeds contain up to 20 products; results may be cached for up to one hour.
- Bluesky: public profile feeds and individual public post pages.
- Google News: public search, topic, and top-stories pages. Feeds contain up to 50 article entities.
- Instagram: public post, reel, and profile pages. Profile results include recent public posts when available.
- Mastodon: public status pages on compatible instances.
- Shopify: public product pages, collections, and storefront homepages. Submit the normal storefront URL; catalog feeds contain up to 50 products.
- SoundCloud: public tracks, playlists, sets, and creator profiles.
- Spotify: public tracks, albums, artists, playlists, podcast shows, and episodes.
- TikTok: public video posts, photo posts, short links, and creator profile pages.
- Vimeo: public video pages, including supported channel, group, showcase, and On Demand links.
- Reddit: public post, subreddit, community, and user profile pages.
- X: public x.com and twitter.com status pages.
- YouTube: public video, Shorts, channel, handle, user, and playlist pages.

Private sources, credentials, stories, transcripts, media downloads, Bluesky reply threads, and complete Reddit comment trees are not supported.
`,
  '/docs/limits/': `# extractor.sh limits and caching

The \`GET ${ORIGIN}/api/extract\` endpoint allows 30 extraction requests per client per 60 seconds and 5 browser-heavy fallbacks per client per 60 seconds.

- Single entities and pages may be cached at the edge for up to 30 days.
- Products, profiles, and feeds may be cached for up to 1 hour.
- Errors are not cached.
- URLs may contain up to 2,048 characters.
- Extracted results may contain up to 2 MB.
- Only public HTTP and HTTPS URLs are accepted.
`,
  '/docs/limitations/': `# extractor.sh limitations

extractor.sh is designed for straightforward extraction of public content through \`GET ${ORIGIN}/api/extract\`.

- CAPTCHAs are not bypassed or solved.
- Login walls, private pages, paywalls, age gates, and other access controls are not bypassed.
- Callers cannot select a server, country, region, or request location. Cloudflare selects the infrastructure location automatically.
- Cookies, authorization headers, custom request headers, and browser sessions cannot be supplied.
- Highly interactive, protected, or region-locked pages may return incomplete content or fail.
- Reddit comment trees, YouTube transcripts or media, and private or deleted X posts are not provided.
`,
  '/pricing/': `# extractor.sh pricing

> Simple pay-as-you-go pricing: €0.99 / 10,000 extractions.

There are no subscriptions, tiers, or monthly commitments. Checkout is coming soon and is not currently available. API usage is documented at \`GET ${ORIGIN}/api/extract\`.
`,
};

pages['/blog/'] = `# extractor.sh blog

> ${CURRENT_YEAR} guides for extracting public web data into AI-ready Markdown and normalized JSON.

${platformArticles.map((article) => `- [How to scrape data from ${article.platform} in ${CURRENT_YEAR}](${ORIGIN}/blog/${article.slug}/): ${article.description}`).join('\n')}

Every guide uses the public \`GET ${ORIGIN}/api/extract\` endpoint.
`;

for (const article of platformArticles) {
  pages[`/blog/${article.slug}/`] = `# How to scrape data from ${article.platform} in ${CURRENT_YEAR}

> ${article.description}

${article.introduction}

## Available public data

${article.extracts.map((item) => `- ${item}`).join('\n')}

## Boundaries

${article.boundaries.map((item) => `- ${item}`).join('\n')}

Call \`GET ${ORIGIN}/api/extract\` with the ordinary public ${article.platform} page in the \`url\` parameter. Use \`format=markdown\` for AI and RAG input or \`format=json\` for normalized fields.
`;
}

pages['/alternatives/'] = `# extractor.sh alternatives

> Compare a focused public URL-to-Markdown API with broader proxy, browser, crawling, and automation providers.

${alternativePages.map((page) => `- [extractor.sh vs. ${page.provider}](${ORIGIN}/alternatives/${page.slug}/): ${page.description}`).join('\n')}

Try the public \`GET ${ORIGIN}/api/extract\` endpoint without an account or API key.
`;

for (const alternative of alternativePages) {
  pages[`/alternatives/${alternative.slug}/`] = `# extractor.sh vs. ${alternative.provider}

> ${alternative.description}

${alternative.providerStrength}

## Choose ${alternative.provider} when

${alternative.chooseProvider.map((item) => `- ${item}`).join('\n')}

## Choose extractor.sh when

${alternative.chooseExtractor.map((item) => `- ${item}`).join('\n')}

extractor.sh uses one cacheable \`GET ${ORIGIN}/api/extract\` request and returns clean Markdown or normalized JSON.
`;
}

export function getSiteMarkdown(pathname: string): string | null {
  const normalized = pathname === '/' ? '/' : `${pathname.replace(/\/+$/, '')}/`;
  return pages[normalized] ?? null;
}
