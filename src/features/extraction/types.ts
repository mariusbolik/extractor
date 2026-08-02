import { ExtractionError } from './errors';
import { entityTypes, extractionSources, ExtractionResponseSchema } from './schema';

export type ExtractionSource = typeof extractionSources[number];
export type EntityType = typeof entityTypes[number];
export type ExtractionMethod =
  | 'native-markdown'
  | 'linkedom'
  | 'browser'
  | 'amazon-html'
  | 'amazon-search-html'
  | 'app-store-lookup'
  | 'app-store-html'
  | 'app-store-chart'
  | 'bluesky-api'
  | 'bluesky-rss'
  | 'discovered-feed'
  | 'google-news-rss'
  | 'google-news-html'
  | 'google-news-browser'
  | 'google-play-html'
  | 'instagram-embed'
  | 'instagram-profile'
  | 'mastodon-oembed'
  | 'oembed'
  | 'wordpress-json'
  | 'reddit-rss'
  | 'shopify-json'
  | 'soundcloud-oembed'
  | 'spotify-oembed'
  | 'tiktok-hydration'
  | 'tiktok-oembed'
  | 'vimeo-oembed'
  | 'x-oembed'
  | 'react-tweet'
  | 'youtube-atom'
  | 'youtube-oembed';

export interface ExtractedMedia {
  type: 'image' | 'video' | 'audio';
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface ProductVariant {
  id?: string;
  title: string;
  price?: number;
  currency?: string;
  priceDisplay?: string;
  available?: boolean;
}

export interface EntityAttributes {
  productType?: 'physical' | 'software' | 'service';
  brand?: string;
  category?: string;
  price?: number;
  currency?: string;
  priceDisplay?: string;
  availability?: string;
  rating?: number;
  ratingScale?: number;
  reviewCount?: number;
  features?: string[];
  variants?: ProductVariant[];
  softwareVersion?: string;
  operatingSystem?: string;
  contentRating?: string;
  developerUrl?: string;
  publisher?: string;
  publisherUrl?: string;
  handle?: string;
  contentWarning?: string;
  mediaType?: 'text' | 'image' | 'video' | 'audio' | 'carousel' | 'mixed';
  durationSeconds?: number;
  biography?: string;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  feedType?: string;
  query?: string;
  description?: string;
  language?: string;
  country?: string;
}

export interface ExtractedItem {
  type: EntityType;
  source: ExtractionSource;
  id: string | null;
  url: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  content: string;
  media: ExtractedMedia[];
  attributes: EntityAttributes;
  items?: ExtractedItem[];
}

export interface ExtractionResult extends ExtractedItem {
  method: ExtractionMethod;
}

export interface PublicExtractionResult extends ExtractedItem {
  schemaVersion: 1;
}

export function toPublicExtractionResult(result: ExtractionResult): PublicExtractionResult {
  const { method: _method, ...entity } = result;
  const parsed = ExtractionResponseSchema.safeParse({ schemaVersion: 1, ...entity });
  if (!parsed.success) {
    console.error('Extraction result failed schema validation', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    });
    throw new ExtractionError('extraction_failed', 'The extracted data did not match the response schema.', 500);
  }
  return parsed.data as PublicExtractionResult;
}

export interface ExtractionDependencies {
  fetcher?: typeof fetch;
  browser?: BrowserRun;
  allowBrowser?: () => Promise<boolean>;
  /** Optional topic used by agent tools to select a relevant page section. */
  focus?: string;
}

export type OutputFormat = 'json' | 'markdown';
