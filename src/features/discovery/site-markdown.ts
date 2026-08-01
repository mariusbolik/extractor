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

- [Amazon](${ORIGIN}/amazon/): Public product detail pages from supported country stores.
- [Bluesky](${ORIGIN}/bluesky/): Public profile feeds and individual posts.
- [Instagram](${ORIGIN}/instagram/): Public posts, reels, profiles, and recent profile posts.
- [Reddit](${ORIGIN}/reddit/): Public posts, communities, and user profiles.
- [Shopify](${ORIGIN}/shopify/): Public products, collections, and storefront catalogs.
- [TikTok](${ORIGIN}/tiktok/): Public video and photo posts, short links, and creator profiles.
- [X](${ORIGIN}/x/): Public X and Twitter status URLs.
- [YouTube](${ORIGIN}/youtube/): Public videos, channels, and playlists.
- Web pages: Public HTTP and HTTPS pages.

## Documentation

- [Developer documentation](${ORIGIN}/docs/)
- [OpenAPI 3.1](${ORIGIN}/openapi.json)
- [API catalog](${ORIGIN}/.well-known/api-catalog)
- [Full agent documentation](${ORIGIN}/llms-full.txt)
- [Pricing](${ORIGIN}/pricing/)
`,
  '/amazon/': `# Amazon product extraction with extractor.sh

> Turn a public Amazon product detail page into clean Markdown or normalized JSON.

Submit an ordinary product URL containing an ASIN, such as \`https://www.amazon.de/echo-dot-2022/dp/B09B8X9RGM\`. Search results, carts, accounts, and personalized offers are not specialized sources. Price and availability can vary, and results may be cached for up to one hour.

Call \`GET ${ORIGIN}/api/extract\` with the product page in the \`url\` parameter.
`,
  '/bluesky/': `# Bluesky extraction with extractor.sh

> Turn public Bluesky profiles and individual posts into clean Markdown or normalized JSON.

Profile pages return recent public posts as a feed. Individual post pages return one document. Replies and parent threads are not included.

Call \`GET ${ORIGIN}/api/extract\` with the Bluesky page in the \`url\` parameter.
`,
  '/instagram/': `# Instagram extraction with extractor.sh

> Turn public Instagram posts, reels, and profiles into clean Markdown or normalized JSON.

Post and reel pages return one document. Public profile pages return profile details and recent public posts as a feed. Private content, stories, comments, transcripts, and media downloads are not supported.

Call \`GET ${ORIGIN}/api/extract\` with the ordinary Instagram page in the \`url\` parameter.
`,
  '/reddit/': `# Reddit extraction with extractor.sh

> Turn public Reddit posts, communities, and profiles into clean Markdown or normalized JSON.

Submit normal public Reddit page URLs such as \`https://www.reddit.com/r/CloudFlare/\`. Private and quarantined communities are not supported, and post results do not include the complete comment tree.

Call \`GET ${ORIGIN}/api/extract\` with the Reddit page in the \`url\` parameter.
`,
  '/shopify/': `# Shopify extraction with extractor.sh

> Turn public Shopify products, collections, and storefront catalogs into clean Markdown or normalized JSON.

Submit an ordinary storefront page. Product pages return one document; storefront and collection pages return up to 50 publicly listed products as a feed.

Call \`GET ${ORIGIN}/api/extract\` with the storefront page in the \`url\` parameter.
`,
  '/tiktok/': `# TikTok extraction with extractor.sh

> Turn public TikTok video and photo posts or creator profiles into clean Markdown or normalized JSON.

Submit an ordinary public TikTok page or short link. Private, deleted, or age-restricted content, comments, transcripts, and media downloads are not supported.

Call \`GET ${ORIGIN}/api/extract\` with the TikTok page in the \`url\` parameter.
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
- [API reference](${ORIGIN}/docs/api/)
- [Supported sources](${ORIGIN}/docs/sources/)
- [Limits and caching](${ORIGIN}/docs/limits/)
- [Limitations](${ORIGIN}/docs/limitations/)
`,
  '/docs/quickstart/': `# extractor.sh quickstart

Call \`GET ${ORIGIN}/api/extract\` with a required public \`url\` and optional \`format\` of \`json\` or \`markdown\`.

${apiExample}

Always submit an ordinary public page URL a person could open in a browser.
`,
  '/docs/api/': `# extractor.sh API reference

## GET /api/extract

- \`url\`: required absolute public HTTP or HTTPS URL, up to 2,048 characters.
- \`format\`: optional \`json\` (default) or \`markdown\`.

JSON responses contain \`url\`, \`source\`, \`kind\`, \`title\`, \`author\`, \`publishedAt\`, \`content\`, and \`items\`. Errors use an \`error\` object with \`code\` and \`message\`.

See the [OpenAPI 3.1 document](${ORIGIN}/openapi.json) for the machine-readable contract for \`GET ${ORIGIN}/api/extract\`.
`,
  '/docs/sources/': `# Supported extractor.sh sources

Submit normal public browser URLs to \`GET ${ORIGIN}/api/extract\`.

- Web: public HTTP and HTTPS content pages.
- Amazon: public product detail pages. Submit the ordinary product URL; results may be cached for up to one hour.
- Bluesky: public profile feeds and individual public post pages.
- Instagram: public post, reel, and profile pages. Profile results include recent public posts when available.
- Shopify: public product pages, collections, and storefront homepages. Submit the normal storefront URL; catalog feeds contain up to 50 products.
- TikTok: public video posts, photo posts, short links, and creator profile pages.
- Reddit: public post, subreddit, community, and user profile pages.
- X: public x.com and twitter.com status pages.
- YouTube: public video, Shorts, channel, handle, user, and playlist pages.

Private sources, credentials, stories, transcripts, media downloads, Bluesky reply threads, and complete Reddit comment trees are not supported.
`,
  '/docs/limits/': `# extractor.sh limits and caching

The \`GET ${ORIGIN}/api/extract\` endpoint allows 30 extraction requests per client per 60 seconds and 5 browser-heavy fallbacks per client per 60 seconds.

- Documents may be cached at the edge for up to 30 days.
- Amazon products may be cached for up to 1 hour.
- Collections may be cached for up to 1 hour.
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
