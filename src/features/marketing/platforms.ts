export interface SupportedPlatform {
  name: string;
  detail: string;
  description: string;
  capabilities: string[];
  href: string;
  icon?: string;
  brandIcon?: 'amazon' | 'instagram';
}

export const supportedPlatforms: SupportedPlatform[] = [
  { name: 'Amazon', detail: 'Products + search', description: 'Extract useful public product details or search results without the surrounding storefront noise.', capabilities: ['Product Search', 'Product Details'], href: '/amazon/', brandIcon: 'amazon' },
  { name: 'App Store', detail: 'iPhone + iPad apps', description: 'Extract public app details, pricing, ratings, release information, icons, and screenshots.', capabilities: ['App Details', 'Pricing + Ratings', 'Releases + Media'], href: '/app-store/', icon: 'logos:apple-app-store' },
  { name: 'Bluesky', detail: 'Profiles + posts', description: 'Turn public profiles and individual posts into normalized feeds and documents.', capabilities: ['Profiles', 'Posts'], href: '/bluesky/', icon: 'logos:bluesky' },
  { name: 'Google News', detail: 'Search + topics', description: 'Turn public news searches, topics, and top stories into a normalized article feed.', capabilities: ['Search', 'Topics', 'Top Stories'], href: '/google-news/', icon: 'logos:google-icon' },
  { name: 'Google Play', detail: 'Android apps', description: 'Turn public app listings into normalized product data with prices, ratings, and media.', capabilities: ['App Details', 'Pricing + Ratings', 'Releases + Media'], href: '/google-play/', icon: 'logos:google-play-icon' },
  { name: 'Instagram', detail: 'Posts + profiles', description: 'Extract public posts, reels, profiles, and recent profile posts into reusable content.', capabilities: ['Posts', 'Reels', 'Profiles', 'Recent Profile Posts'], href: '/instagram/', brandIcon: 'instagram' },
  { name: 'Mastodon', detail: 'Public posts', description: 'Turn public posts from compatible Mastodon instances into clean, source-linked content.', capabilities: ['Public Posts'], href: '/mastodon/', icon: 'logos:mastodon-icon' },
  { name: 'Reddit', detail: 'Posts + communities', description: 'Turn public posts, communities, and profiles into clean, reusable content.', capabilities: ['Posts', 'Communities', 'Profiles'], href: '/reddit/', icon: 'logos:reddit-icon' },
  { name: 'Shopify', detail: 'Products + catalogs', description: 'Extract public products, collections, and storefront catalogs in one consistent format.', capabilities: ['Product Details', 'Collections', 'Storefront Catalogs'], href: '/shopify/', icon: 'logos:shopify' },
  { name: 'SoundCloud', detail: 'Audio + profiles', description: 'Extract public tracks, playlists, sets, and creator profiles as reusable metadata.', capabilities: ['Tracks', 'Playlists + Sets', 'Creator Profiles'], href: '/soundcloud/', icon: 'logos:soundcloud' },
  { name: 'Spotify', detail: 'Music + podcasts', description: 'Normalize public tracks, albums, artists, shows, episodes, and playlists.', capabilities: ['Tracks', 'Albums', 'Artists', 'Shows + Episodes', 'Playlists'], href: '/spotify/', icon: 'logos:spotify-icon' },
  { name: 'TikTok', detail: 'Posts + profiles', description: 'Turn public videos, photo posts, and creator profiles into clean Markdown and JSON.', capabilities: ['Video Posts', 'Photo Posts', 'Profiles'], href: '/tiktok/', icon: 'logos:tiktok-icon' },
  { name: 'Vimeo', detail: 'Public videos', description: 'Extract public Vimeo video metadata, descriptions, authors, dates, and duration.', capabilities: ['Public Videos', 'Creator Metadata'], href: '/vimeo/', icon: 'logos:vimeo-icon' },
  { name: 'X', detail: 'Public posts', description: 'Turn a public X or Twitter status URL into stable Markdown and JSON.', capabilities: ['Public Posts'], href: '/x/', icon: 'logos:x' },
  { name: 'YouTube', detail: 'Videos + channels', description: 'Extract public video metadata, channels, and playlists into a consistent format.', capabilities: ['Videos', 'Channels', 'Playlists'], href: '/youtube/', icon: 'logos:youtube-icon' },
];
