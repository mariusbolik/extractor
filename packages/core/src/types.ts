import { ExtractionError } from './errors';
import { entityTypes, extractionSources, ExtractionResponseSchema } from './schema';

export type ExtractionSource = typeof extractionSources[number];
export type EntityType = typeof entityTypes[number];
export type ExtractionMethod =
  | 'native-markdown'
  | 'linkedom'
  | 'metadata'
  | 'blog-list-html'
  | 'product-list-html'
  | 'product-jsonld'
  | 'browser'
  | 'amazon-html'
  | 'amazon-search-html'
  | 'amazon-list-html'
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
  | 'tiktok-profile-embed'
  | 'tiktok-oembed'
  | 'vimeo-oembed'
  | 'x-oembed'
  | 'react-tweet'
  | 'finance-search-json'
  | 'finance-movers-json'
  | 'yahoo-finance-chart'
  | 'youtube-atom'
  | 'youtube-oembed'
  | 'web-search-rss'
  | 'web-search-html'
  | 'image-search-openverse'
  | 'image-search-wikimedia'
  | 'video-search-json'
  | 'video-search-html'
  | 'place-search-photon'
  | 'woocommerce-json';

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
  sku?: string;
  gtin?: string;
  price?: number;
  currency?: string;
  priceDisplay?: string;
  compareAtPrice?: number;
  compareAtPriceDisplay?: string;
  available?: boolean;
}

export interface MarketHistoryPoint {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjustedClose?: number;
  volume?: number;
}

export type FinanceTimeframe = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y' | 'max';
export type FinanceInterval = '5m' | '15m' | '1d' | '1wk' | '1mo';

export interface MarketEvent {
  type: 'dividend' | 'split';
  timestamp: string;
  amount?: number;
  numerator?: number;
  denominator?: number;
  splitRatio?: string;
}

export type ImageUsage = 'all' | 'commercial' | 'modify' | 'commercial-and-modify';
export type ImageOrientation = 'any' | 'landscape' | 'portrait' | 'square';
export type VideoPlatform = 'any' | 'youtube';
export type VideoSort = 'relevance' | 'date';
export type FinanceMoverList = 'gainers' | 'losers' | 'active';
export type PlaceType = 'any' | 'house' | 'street' | 'locality' | 'city' | 'county' | 'state' | 'country' | 'other';
export type NewsTimeframe = 'any' | '1h' | '1d' | '7d' | '30d';

export interface EntityAttributes {
  productType?: 'physical' | 'software' | 'service';
  brand?: string;
  seller?: string;
  category?: string;
  sku?: string;
  gtin?: string;
  tags?: string[];
  price?: number;
  currency?: string;
  priceDisplay?: string;
  compareAtPrice?: number;
  compareAtPriceDisplay?: string;
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
  authorImageUrl?: string;
  contentWarning?: string;
  mediaType?: 'text' | 'image' | 'video' | 'audio' | 'carousel' | 'mixed';
  durationSeconds?: number;
  publishedAtDisplay?: string;
  biography?: string;
  verified?: boolean;
  pronouns?: string[];
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  totalLikeCount?: number;
  feedType?: string;
  query?: string;
  description?: string;
  language?: string;
  modifiedAt?: string;
  wordCount?: number;
  country?: string;
  videoPlatform?: VideoPlatform;
  videoSort?: VideoSort;
  videoCreator?: string;
  financeMoverList?: FinanceMoverList;
  site?: string;
  timeframe?: NewsTimeframe;
  usage?: ImageUsage;
  orientation?: ImageOrientation;
  placeType?: PlaceType;
  resultCount?: number;
  license?: string;
  licenseUrl?: string;
  creatorUrl?: string;
  fileType?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  locality?: string;
  region?: string;
  boundingBox?: [number, number, number, number];
  website?: string;
  phoneNumber?: string;
  openingHours?: string;
  countryCode?: string;
  attribution?: string;
  tickerSymbol?: string;
  exchange?: string;
  instrumentType?: string;
  sector?: string;
  industry?: string;
  listingCurrency?: string;
  quoteCurrency?: string;
  exchangeRate?: number;
  exchangeRateTimestamp?: string;
  marketPrice?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  volume?: number;
  timezone?: string;
  historyTimeframe?: FinanceTimeframe;
  historyInterval?: FinanceInterval;
  marketState?: string;
  history?: MarketHistoryPoint[];
  events?: MarketEvent[];
  hashtags?: string[];
  coauthors?: string[];
  locationName?: string;
  sponsored?: boolean;
  edited?: boolean;
  sensitive?: boolean;
  inReplyToUrl?: string;
  quotedPostUrl?: string;
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  shareCount?: number;
  quoteCount?: number;
  viewCount?: number;
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
  /** Optional host transport for the exact Google News RSS request only. */
  googleNewsFetcher?: typeof fetch;
  /** Optional high-cost renderer supplied by the hosting application. */
  renderPageHtml?: (url: URL) => Promise<string>;
  allowBrowser?: () => Promise<boolean>;
  /** Optional topic used by agent tools to select a relevant page section. */
  focus?: string;
}

export interface SearchDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned feed. */
  resultUrl?: string;
  /** Search results are ordered by relevance and capped at ten. */
  limit?: number;
  language?: string;
  country?: string;
  /** Optional hostname constraint such as linkedin.com. */
  site?: string;
}

export interface ImageSearchDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned feed. */
  resultUrl?: string;
  /** Image results are capped to keep responses and upstream work bounded. */
  limit?: number;
  usage?: ImageUsage;
  orientation?: ImageOrientation;
}

export interface VideoSearchDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned feed. */
  resultUrl?: string;
  /** Video results are capped at twenty and use the requested ordering. */
  limit?: number;
  language?: string;
  country?: string;
  platform?: VideoPlatform;
  sort?: VideoSort;
  /** Restrict returned items to an exact public creator name. */
  creator?: string;
}

export interface PlaceSearchDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned feed. */
  resultUrl?: string;
  /** Place results are capped to avoid autocomplete-style upstream traffic. */
  limit?: number;
  language?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  type?: PlaceType;
}

export interface FinanceDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned document. */
  resultUrl?: string;
  timeframe?: FinanceTimeframe;
  /** Optional ISO-style quote currency for converted monetary values. */
  quoteCurrency?: string;
}

export interface FinanceSearchDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned feed. */
  resultUrl?: string;
  /** Finance matches are relevance ordered and capped at ten. */
  limit?: number;
  /** Defaults to equities so existing clients retain their current result set. */
  instrument?: 'equity' | 'crypto';
}

export interface FinanceMoversDependencies {
  fetcher?: typeof fetch;
  /** Public, provider-neutral URL represented by the returned feed. */
  resultUrl?: string;
  /** Daily market lists are capped at ten equities. */
  limit?: number;
  /** Defaults to the largest daily percentage gainers. */
  list?: FinanceMoverList;
}

export type OutputFormat = 'json' | 'markdown';
