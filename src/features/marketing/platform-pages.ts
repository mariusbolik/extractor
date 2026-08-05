export interface PlatformCapability {
  name: string;
  description: string;
  output: string;
  exampleUrl?: string;
}

export interface PlatformPageConfig {
  slug: string;
  platform: string;
  eyebrow: string;
  title: string;
  headline: string;
  description: string;
  outcome: string;
  icon?: string;
  brandIcon?: 'amazon' | 'instagram' | 'woocommerce' | 'yahoo';
  capabilities: PlatformCapability[];
  includes: string[];
  limitations: string[];
  keywords: string[];
  related: string[];
}

const commonKeywords = (platform: string) => [
  `${platform} scraper API`,
  `${platform} to JSON`,
  `${platform} to Markdown`,
  `${platform} data for AI agents`,
  `${platform} data extraction`,
];

export const platformPageList: PlatformPageConfig[] = [
  {
    slug: 'amazon', platform: 'Amazon', eyebrow: 'Amazon extraction API',
    title: 'Free Amazon Scraper API – Products, Search & Lists | extractor.sh',
    headline: 'Amazon Scraper - Extract Products, Search & Lists',
    description: 'Extract public Amazon product details, search results, storefronts, and shared lists into clean Markdown or schema-versioned JSON.',
    outcome: 'One normalized product or a capped product feed.', brandIcon: 'amazon',
    capabilities: [
      { name: 'Product details', description: 'Titles, brand, pricing, ratings, availability, multiple images, variants, seller, category, and available specifications.', output: 'product', exampleUrl: 'https://www.amazon.de/echo-dot-2022/dp/B09B8X9RGM' },
      { name: 'Product search', description: 'Ordered public search results from a normal Amazon search URL.', output: 'feed', exampleUrl: 'https://www.amazon.com/s?k=mechanical+keyboard' },
      { name: 'Public lists', description: 'Products from exact public storefront, Idea List, and shared Wish List URLs.', output: 'feed' },
    ],
    includes: ['Supported Amazon country stores', 'Canonical product URLs and ASINs', 'Search feeds and exact public shared lists', 'Markdown and schema-versioned JSON'],
    limitations: ['No list discovery, category crawling, pagination, carts, accounts, reviews, or personalized offers', 'CAPTCHAs and verification pages are not bypassed', 'Price and availability vary by market and can change after a cached response'],
    keywords: commonKeywords('Amazon product'), related: ['shopify', 'woocommerce', 'app-store'],
  },
  {
    slug: 'app-store', platform: 'Apple App Store', eyebrow: 'App Store extraction API',
    title: 'Free Apple App Store Scraper API | extractor.sh',
    headline: 'App Store Scraper - Extract iOS App Data',
    description: 'Turn a public Apple App Store listing into clean Markdown or normalized software-product JSON with pricing, ratings, releases, icons, and screenshots.',
    outcome: 'A software product with stable app identity and current public metadata.', icon: 'logos:apple-app-store',
    capabilities: [
      { name: 'App details', description: 'Name, developer, description, category, version, release notes, and canonical URL.', output: 'product', exampleUrl: 'https://apps.apple.com/us/app/chatgpt/id6448311069' },
      { name: 'Pricing and ratings', description: 'Free or paid pricing in minor units, rating values, and rating counts.', output: 'product' },
      { name: 'App media', description: 'The real app icon and public screenshot URLs when available.', output: 'product' },
    ],
    includes: ['Public iPhone and iPad app pages', 'Localized App Store URLs with numeric app IDs', 'Version and release information', 'Icons, screenshots, Markdown, and JSON'],
    limitations: ['No App Store search, charts, reviews, accounts, or app downloads', 'Removed or country-restricted apps may be unavailable', 'Pricing and availability can vary by storefront'],
    keywords: commonKeywords('Apple App Store'), related: ['google-play', 'amazon', 'shopify'],
  },
  {
    slug: 'bluesky', platform: 'Bluesky', eyebrow: 'Bluesky extraction API',
    title: 'Free Bluesky Profile & Post Scraper API | extractor.sh',
    headline: 'Bluesky Scraper - Extract Profiles & Posts',
    description: 'Extract public Bluesky profiles and individual posts into clean Markdown or schema-versioned profile and post JSON.',
    outcome: 'A profile with recent posts or one source-linked post.', icon: 'logos:bluesky',
    capabilities: [
      { name: 'Profiles', description: 'Profile identity, description, avatar, counts, and recent public posts.', output: 'profile', exampleUrl: 'https://bsky.app/profile/bsky.app' },
      { name: 'Posts', description: 'Post text, author, timestamp, media references, and canonical link.', output: 'post', exampleUrl: 'https://bsky.app/profile/bsky.app/post/3mqcp5qjdfs26' },
    ],
    includes: ['Public profile pages', 'Individual public post pages', 'Recent profile posts', 'Source-linked Markdown and JSON'],
    limitations: ['No private or deleted content', 'Replies and parent threads are not included', 'Quoted or embedded content can be partial'],
    keywords: commonKeywords('Bluesky'), related: ['x', 'mastodon', 'reddit'],
  },
  {
    slug: 'google-news', platform: 'Google News', eyebrow: 'Google News extraction API',
    title: 'Free Google News Scraper API for AI | extractor.sh',
    headline: 'Google News Scraper - Extract News Results',
    description: 'Convert public Google News searches, topics, and top stories into a normalized article feed for research agents, monitoring, and RAG.',
    outcome: 'Up to 50 current article entities with publishers and source links.', icon: 'logos:google-icon',
    capabilities: [
      { name: 'News search', description: 'Current results for the query contained in a normal Google News URL.', output: 'feed', exampleUrl: 'https://news.google.com/search?q=Cloudflare&hl=en-US&gl=US&ceid=US%3Aen' },
      { name: 'Top stories', description: 'The public top-stories page as an ordered article feed.', output: 'feed', exampleUrl: 'https://news.google.com/home?hl=en-US&gl=US&ceid=US%3Aen' },
      { name: 'Topics', description: 'Public topic pages with titles, publishers, dates, summaries, and links.', output: 'feed' },
    ],
    includes: ['Public search, topic, and top-stories pages', 'Titles, publishers, dates, and summaries', 'Up to 50 article entities', 'Markdown and schema-versioned JSON'],
    limitations: ['No personalized For You results, Google Search, or Google Shopping', 'Results contain article metadata rather than full publisher bodies', 'Login walls, CAPTCHAs, and regional gates are not bypassed'],
    keywords: commonKeywords('Google News'), related: ['reddit', 'youtube', 'x'],
  },
  {
    slug: 'google-play', platform: 'Google Play', eyebrow: 'Google Play extraction API',
    title: 'Free Google Play Store Scraper API | extractor.sh',
    headline: 'Google Play Scraper - Extract Android App Data',
    description: 'Extract public Android app listings into clean Markdown or normalized software-product JSON with prices, ratings, icons, and screenshots.',
    outcome: 'A software product keyed by its stable Android package ID.', icon: 'logos:google-play-icon',
    capabilities: [
      { name: 'App details', description: 'Name, developer, description, category, content rating, and canonical URL.', output: 'product', exampleUrl: 'https://play.google.com/store/apps/details?id=com.openai.chatgpt' },
      { name: 'Pricing and ratings', description: 'Free or paid pricing in minor units, rating values, and review counts.', output: 'product' },
      { name: 'App media', description: 'App icon and public screenshots when exposed on the listing.', output: 'product' },
    ],
    includes: ['Public Android app detail pages', 'Localized links with language and country parameters', 'Integer minor-unit prices', 'Descriptions, icons, screenshots, and ratings'],
    limitations: ['No Google Play search, category browsing, reviews, accounts, or APK downloads', 'Removed, age-gated, or country-restricted apps may be unavailable', 'Pricing and availability can vary by market'],
    keywords: commonKeywords('Google Play Store'), related: ['app-store', 'amazon', 'shopify'],
  },
  {
    slug: 'instagram', platform: 'Instagram', eyebrow: 'Instagram extraction API',
    title: 'Free Instagram Post & Profile Scraper API | extractor.sh',
    headline: 'Instagram Scraper - Extract Posts, Reels & Profiles',
    description: 'Convert public Instagram posts, reels, and profiles into clean Markdown or normalized JSON for agents and content research.',
    outcome: 'One post or a profile with recent public post items.', brandIcon: 'instagram',
    capabilities: [
      { name: 'Posts and reels', description: 'Caption, author, complete exposed carousel media, dimensions, coauthors, location, partnership state, engagement, and canonical URL.', output: 'post', exampleUrl: 'https://www.instagram.com/p/DbbY9pdm6Q2/' },
      { name: 'Profiles', description: 'Public identity, verification, pronouns, counts, avatar, and recent exposed posts.', output: 'profile', exampleUrl: 'https://www.instagram.com/instagram/' },
    ],
    includes: ['Public post and reel pages', 'Public profile pages', 'Recent exposed profile posts', 'Markdown and normalized JSON'],
    limitations: ['No private, deleted, or login-only content', 'No stories, comments, transcripts, or media downloads', 'Profile feeds can contain only the most recent exposed posts'],
    keywords: commonKeywords('Instagram'), related: ['tiktok', 'x', 'youtube'],
  },
  {
    slug: 'mastodon', platform: 'Mastodon', eyebrow: 'Mastodon extraction API',
    title: 'Free Mastodon Post Scraper API | extractor.sh',
    headline: 'Mastodon Scraper - Extract Public Posts',
    description: 'Extract public Mastodon statuses from compatible instances into clean Markdown or normalized post JSON.',
    outcome: 'One source-linked post from a compatible public instance.', icon: 'logos:mastodon-icon',
    capabilities: [
      { name: 'Public posts', description: 'Text, author, date, content warning, media descriptions, and canonical URL.', output: 'post', exampleUrl: 'https://mastodon.social/@trwnh/99664077509711321' },
    ],
    includes: ['Public status pages on compatible instances', 'Local and federated public accounts', 'Content warnings and media descriptions', 'Markdown and normalized JSON'],
    limitations: ['No private, followers-only, deleted, or unavailable posts', 'No timelines, complete threads, replies, or media downloads', 'Instances can disable compatible public access'],
    keywords: commonKeywords('Mastodon'), related: ['bluesky', 'x', 'reddit'],
  },
  {
    slug: 'reddit', platform: 'Reddit', eyebrow: 'Reddit extraction API',
    title: 'Free Reddit Post & Subreddit Scraper API | extractor.sh',
    headline: 'Reddit Scraper - Extract Posts & Communities',
    description: 'Turn public Reddit posts, communities, and profiles into clean Markdown or normalized feeds and post JSON.',
    outcome: 'One post or an ordered feed for a community or profile.', icon: 'logos:reddit-icon',
    capabilities: [
      { name: 'Communities', description: 'Recent public posts from an ordinary subreddit or community page.', output: 'feed', exampleUrl: 'https://www.reddit.com/r/CloudFlare/' },
      { name: 'Posts', description: 'Title, body, author, timestamp, media references, and canonical URL.', output: 'post' },
      { name: 'Profiles', description: 'Recent public submissions from a normal Reddit user page.', output: 'feed', exampleUrl: 'https://www.reddit.com/user/spez/' },
    ],
    includes: ['Public post URLs', 'Public subreddit and community pages', 'Public user profile pages', 'Source-linked Markdown and JSON'],
    limitations: ['No private or quarantined communities', 'Post extraction does not include the complete comment tree', 'Deleted and restricted content remains unavailable'],
    keywords: commonKeywords('Reddit'), related: ['google-news', 'x', 'bluesky'],
  },
  {
    slug: 'shopify', platform: 'Shopify', eyebrow: 'Shopify extraction API',
    title: 'Free Shopify Product & Catalog Scraper API | extractor.sh',
    headline: 'Shopify Scraper - Extract Product & Catalog Data',
    description: 'Extract public Shopify products, collections, and storefront catalogs into clean Markdown or normalized commerce JSON.',
    outcome: 'One product or a feed containing up to 50 products.', icon: 'logos:shopify',
    capabilities: [
      { name: 'Product details', description: 'Titles, descriptions, prices, variants, images, availability, and canonical URLs.', output: 'product', exampleUrl: 'https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole' },
      { name: 'Storefront catalogs', description: 'Public storefront products normalized into a capped feed.', output: 'feed', exampleUrl: 'https://www.allbirds.com/' },
      { name: 'Collections', description: 'Products from a normal public collection page.', output: 'feed', exampleUrl: 'https://www.goodamerican.com/collections/sweat-sets' },
    ],
    includes: ['Public storefront product pages', 'Public collection pages and storefront roots', 'Variants and integer minor-unit prices', 'Up to 50 product entities per feed'],
    limitations: ['Protected or disabled storefront data may be unavailable', 'No carts, accounts, checkout data, or order history', 'Blogs, policies, and content pages remain ordinary webpage extractions'],
    keywords: commonKeywords('Shopify'), related: ['woocommerce', 'amazon', 'app-store'],
  },
  {
    slug: 'woocommerce', platform: 'WooCommerce', eyebrow: 'WooCommerce extraction API',
    title: 'Free WooCommerce Product Scraper API | extractor.sh',
    headline: 'WooCommerce Scraper - Extract Product & Store Data',
    description: 'Extract public WooCommerce product pages, shops, categories, and store-scoped searches into clean Markdown or normalized commerce JSON.',
    outcome: 'One product or a capped feed of public store products.', brandIcon: 'woocommerce',
    capabilities: [
      { name: 'Product details', description: 'Titles, descriptions, prices, ratings, variants, images, stock state, and canonical URLs.', output: 'product', exampleUrl: 'https://muista.eu/shop/rugs/sunrise-rug/' },
      { name: 'Store search', description: 'Products matching a query submitted through the store’s normal public search page.', output: 'feed', exampleUrl: 'https://muista.eu/?s=chair&post_type=product' },
      { name: 'Shops and categories', description: 'Public shop roots and product categories normalized into product feeds.', output: 'feed' },
    ],
    includes: ['Ordinary public product and store URLs', 'Store-scoped product search pages', 'Integer minor-unit prices and variants', 'Up to 50 product entities per feed'],
    limitations: ['No cross-store product search, carts, accounts, checkout data, or orders', 'Protected catalogs and unavailable products remain inaccessible', 'Ordinary blog, policy, and content pages are treated as webpages'],
    keywords: commonKeywords('WooCommerce'), related: ['shopify', 'amazon', 'google-play'],
  },
  {
    slug: 'soundcloud', platform: 'SoundCloud', eyebrow: 'SoundCloud extraction API',
    title: 'Free SoundCloud Track & Profile Scraper API | extractor.sh',
    headline: 'SoundCloud Scraper - Extract Track & Profile Data',
    description: 'Extract public SoundCloud tracks, playlists, sets, and creator profiles into clean Markdown or normalized JSON.',
    outcome: 'A normalized audio item or creator profile.', icon: 'logos:soundcloud',
    capabilities: [
      { name: 'Tracks', description: 'Title, creator, description, artwork, content type, and canonical URL.', output: 'audio', exampleUrl: 'https://soundcloud.com/forss/flickermood' },
      { name: 'Playlists and sets', description: 'Public playlist and set metadata without active player markup.', output: 'audio' },
      { name: 'Creator profiles', description: 'Public creator identity and artwork when available.', output: 'profile' },
    ],
    includes: ['Public tracks', 'Public playlists and sets', 'Public creator profiles', 'Artwork, descriptions, Markdown, and JSON'],
    limitations: ['No private or deleted audio', 'No comments, waveform data, transcripts, or media downloads', 'The recording itself is not analyzed'],
    keywords: commonKeywords('SoundCloud'), related: ['spotify', 'vimeo', 'youtube'],
  },
  {
    slug: 'spotify', platform: 'Spotify', eyebrow: 'Spotify extraction API',
    title: 'Free Spotify Music & Podcast Scraper API | extractor.sh',
    headline: 'Spotify Scraper - Extract Music & Podcast Data',
    description: 'Normalize public Spotify tracks, albums, artists, playlists, shows, and podcast episodes as clean Markdown or JSON.',
    outcome: 'A clean audio entity or public artist profile.', icon: 'logos:spotify-icon',
    capabilities: [
      { name: 'Music', description: 'Public tracks, albums, artists, and playlists with titles, artwork, and canonical links.', output: 'audio', exampleUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' },
      { name: 'Podcasts', description: 'Public shows and episodes with titles, artwork, content type, and source links.', output: 'audio', exampleUrl: 'https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5' },
    ],
    includes: ['Public tracks, albums, artists, and playlists', 'Public podcast shows and episodes', 'Supported public short links', 'Clean Markdown and normalized JSON'],
    limitations: ['No private or unavailable content', 'No lyrics, transcripts, playback data, audio analysis, or downloads', 'Detail depth depends on the public metadata exposed for the URL'],
    keywords: commonKeywords('Spotify'), related: ['soundcloud', 'youtube', 'vimeo'],
  },
  {
    slug: 'tiktok', platform: 'TikTok', eyebrow: 'TikTok extraction API',
    title: 'Free TikTok Video & Profile Scraper API | extractor.sh',
    headline: 'TikTok Scraper - Extract Videos & Profiles',
    description: 'Turn public TikTok videos, photo posts, profiles, and supported short links into clean Markdown or normalized JSON.',
    outcome: 'One public post or a creator profile with up to ten recent posts.', icon: 'logos:tiktok-icon',
    capabilities: [
      { name: 'Video and photo posts', description: 'Caption, creator, date, hashtags, duration, sound details, and canonical URL.', output: 'post', exampleUrl: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' },
      { name: 'Creator profiles', description: 'Public identity, biography, avatar, verification, follower and total-like counts, plus up to ten recent posts.', output: 'profile', exampleUrl: 'https://www.tiktok.com/@scout2015' },
      { name: 'Short links', description: 'Supported public short links resolve to their final post or profile.', output: 'post' },
    ],
    includes: ['Public video and photo posts', 'Public creator profiles', 'Supported short links', 'Markdown and normalized JSON'],
    limitations: ['No private, deleted, or age-restricted content', 'No comments, transcripts, or media downloads', 'Profiles do not include a complete post history'],
    keywords: commonKeywords('TikTok'), related: ['instagram', 'youtube', 'x'],
  },
  {
    slug: 'vimeo', platform: 'Vimeo', eyebrow: 'Vimeo extraction API',
    title: 'Free Vimeo Video Metadata Scraper API | extractor.sh',
    headline: 'Vimeo Scraper - Extract Video Metadata',
    description: 'Extract public Vimeo video metadata into clean Markdown or normalized video JSON without player markup.',
    outcome: 'One source-linked video entity with public metadata.', icon: 'logos:vimeo-icon',
    capabilities: [
      { name: 'Public videos', description: 'Title, author, description, upload date, duration, thumbnail, and canonical URL.', output: 'video', exampleUrl: 'https://vimeo.com/286898202' },
      { name: 'Special video links', description: 'Supported channel, group, showcase, On Demand, and complete unlisted links.', output: 'video' },
    ],
    includes: ['Public Vimeo video URLs', 'Supported showcase and On Demand video links', 'Complete valid unlisted links', 'Markdown and normalized JSON'],
    limitations: ['No private or embed-disabled videos', 'No transcripts, captions, comments, or media downloads', 'Output contains metadata rather than video content'],
    keywords: commonKeywords('Vimeo'), related: ['youtube', 'soundcloud', 'spotify'],
  },
  {
    slug: 'x', platform: 'X', eyebrow: 'X post extraction API',
    title: 'Free X / Twitter Post Scraper API | extractor.sh',
    headline: 'X / Twitter Scraper - Extract Public Posts',
    description: 'Convert a public X or legacy Twitter status URL into clean Markdown or normalized post JSON through one cacheable GET request.',
    outcome: 'One normalized post with author, text, media, and source URL.', icon: 'logos:x',
    capabilities: [
      { name: 'Public posts', description: 'Text, author identity, verification, language, edit and reply context, quoted-post references, engagement, accessible media, and canonical URL.', output: 'post', exampleUrl: 'https://x.com/jack/status/20' },
    ],
    includes: ['Public x.com status URLs', 'Legacy twitter.com status URLs', 'Author profile images when available', 'Raw Markdown and normalized JSON'],
    limitations: ['No private, deleted, login-only, or age-gated posts', 'One public post is extracted per request', 'Complete threads, replies, and account timelines are not included'],
    keywords: commonKeywords('X Twitter post'), related: ['bluesky', 'mastodon', 'reddit'],
  },
  {
    slug: 'yahoo-finance', platform: 'Yahoo Finance', eyebrow: 'Yahoo Finance extraction API',
    title: 'Free Yahoo Finance Stock Scraper API | extractor.sh',
    headline: 'Yahoo Finance Scraper - Extract Stock Market Data',
    description: 'Get a market snapshot and configurable price history by symbol, while ordinary public Yahoo Finance quote URLs remain supported by the generic extractor.',
    outcome: 'One normalized market document in the native or requested quote currency with bounded OHLCV history.', brandIcon: 'yahoo',
    capabilities: [
      { name: 'Market snapshot', description: 'Symbol, exchange, currency, latest available price, change, trading ranges, volume, and market time.', output: 'document', exampleUrl: 'https://finance.yahoo.com/quote/AAPL/' },
      { name: 'Configurable price history', description: 'Choose from one day through maximum history with an automatically selected interval and at most 512 OHLCV points.', output: 'document', exampleUrl: 'https://finance.yahoo.com/quote/MSFT/history/' },
    ],
    includes: ['Company-name stock search, symbol-based finance requests, and ordinary public Yahoo Finance quote URLs', 'Stocks, ETFs, indices, currencies, and crypto symbols', 'Native or requested quote-currency values and configurable OHLCV history', 'Markdown and schema-versioned JSON'],
    limitations: ['No live streaming, order books, portfolios, trades, or investment recommendations', 'Market data may be delayed, incomplete, adjusted, or unavailable for some symbols', 'Results are cached for five minutes and should be verified at the source before financial decisions'],
    keywords: [...commonKeywords('Yahoo Finance'), 'free stock market data API', 'stock price to JSON'], related: ['google-news', 'amazon', 'reddit'],
  },
  {
    slug: 'youtube', platform: 'YouTube', eyebrow: 'YouTube extraction API',
    title: 'Free YouTube Video & Channel Scraper API | extractor.sh',
    headline: 'YouTube Scraper - Extract Videos & Channels',
    description: 'Extract public YouTube video metadata, channels, and playlists into clean Markdown or normalized JSON for agents and RAG.',
    outcome: 'One video entity or an ordered feed for a channel or playlist.', icon: 'logos:youtube-icon',
    capabilities: [
      { name: 'Videos and Shorts', description: 'Title, description, author, publication date, thumbnail, and canonical URL.', output: 'video', exampleUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { name: 'Channels', description: 'Public channel, handle, and legacy user pages as normalized feeds.', output: 'feed', exampleUrl: 'https://www.youtube.com/@Cloudflare' },
      { name: 'Playlists', description: 'Public playlist metadata and ordered public items.', output: 'feed' },
    ],
    includes: ['Public watch, Shorts, and youtu.be URLs', 'Public channels, handles, and legacy user pages', 'Public playlist pages', 'Markdown and schema-versioned JSON'],
    limitations: ['No transcripts, captions, comments, or media downloads', 'No private videos or unlisted channel discovery', 'Video output describes the page rather than spoken content'],
    keywords: commonKeywords('YouTube'), related: ['vimeo', 'tiktok', 'spotify'],
  },
];

export const platformPages = Object.fromEntries(
  platformPageList.map((page) => [page.slug, page]),
) as Record<string, PlatformPageConfig>;

export function platformFaq(page: PlatformPageConfig) {
  return [
    {
      question: `What ${page.platform} URLs can extractor.sh process?`,
      answer: page.capabilities.map((capability) => capability.name).join(', ') + '. Use an ordinary public URL from the platform.',
    },
    {
      question: `What does the ${page.platform} extraction API return?`,
      answer: `${page.outcome} Choose raw Markdown or schema-versioned JSON for every request.`,
    },
    {
      question: `What are the limits of ${page.platform} extraction?`,
      answer: page.limitations.join('. ') + '.',
    },
  ];
}

export function platformPageSchema(page: PlatformPageConfig) {
  const url = `https://extractor.sh/${page.slug}/`;
  const faq = platformFaq(page);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', '@id': `${url}#page`, url, name: page.title,
        description: page.description, about: { '@type': 'Thing', name: page.platform },
      },
      {
        '@type': 'SoftwareApplication', '@id': `${url}#software`, name: `extractor.sh for ${page.platform}`,
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Web', url,
        description: page.description, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@type': 'HowTo', '@id': `${url}#howto`, name: `How to extract ${page.platform} data`,
        description: page.description,
        step: [
          { '@type': 'HowToStep', position: 1, name: 'Choose a public URL', text: `Copy an ordinary supported ${page.platform} URL.` },
          { '@type': 'HowToStep', position: 2, name: 'Choose an output', text: 'Select Markdown or schema-versioned JSON.' },
          { '@type': 'HowToStep', position: 3, name: 'Run the extraction', text: 'Send one GET request and use the normalized result.' },
        ],
      },
      {
        '@type': 'FAQPage', '@id': `${url}#faq`,
        mainEntity: faq.map((item) => ({
          '@type': 'Question', name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
      {
        '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'extractor.sh', item: 'https://extractor.sh/' },
          { '@type': 'ListItem', position: 2, name: page.platform, item: url },
        ],
      },
    ],
  };
}
