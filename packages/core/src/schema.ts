import { z } from 'zod/v4';

export const extractionSources = [
  'web', 'web-search', 'image-search', 'video-search', 'place-search', 'finance', 'amazon', 'app-store', 'bluesky', 'google-news', 'google-play',
  'instagram', 'mastodon', 'reddit', 'shopify', 'woocommerce', 'soundcloud', 'spotify', 'tiktok', 'vimeo', 'x', 'yahoo-finance', 'youtube',
] as const;

export const entityTypes = [
  'document', 'article', 'product', 'post', 'profile', 'video', 'audio', 'feed',
] as const;

const nullableText = z.string().nullable();
const nullableDate = z.iso.datetime({ offset: true }).nullable();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

export const MediaSchema = z.strictObject({
  type: z.enum(['image', 'video', 'audio']),
  url: z.url(),
  alt: z.string().optional(),
  width: positiveInteger.optional(),
  height: positiveInteger.optional(),
});

const ProductVariantSchema = z.strictObject({
  id: z.string().optional(),
  title: z.string(),
  sku: z.string().optional(),
  gtin: z.string().optional(),
  price: nonNegativeInteger.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceDisplay: z.string().optional(),
  compareAtPrice: nonNegativeInteger.optional(),
  compareAtPriceDisplay: z.string().optional(),
  available: z.boolean().optional(),
});

const MarketHistoryPointSchema = z.strictObject({
  timestamp: z.iso.datetime({ offset: true }),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number().optional(),
  adjustedClose: z.number().optional(),
  volume: nonNegativeInteger.optional(),
});

const MarketEventSchema = z.strictObject({
  type: z.enum(['dividend', 'split']),
  timestamp: z.iso.datetime({ offset: true }),
  amount: z.number().nonnegative().optional(),
  numerator: z.number().positive().optional(),
  denominator: z.number().positive().optional(),
  splitRatio: z.string().optional(),
});

const genericPageFields = {
  language: z.string().optional(),
  modifiedAt: z.iso.datetime({ offset: true }).optional(),
  wordCount: nonNegativeInteger.optional(),
};

const DocumentAttributesSchema = z.strictObject({
  ...genericPageFields,
  description: z.string().optional(),
  license: z.string().optional(),
  licenseUrl: z.url().optional(),
  creatorUrl: z.url().optional(),
  fileType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().optional(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  postalCode: z.string().optional(),
  locality: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  boundingBox: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]).optional(),
  category: z.string().optional(),
  website: z.url().optional(),
  phoneNumber: z.string().optional(),
  openingHours: z.string().optional(),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  tickerSymbol: z.string().optional(),
  exchange: z.string().optional(),
  // Market listings can use an exchange-specific subunit marker such as GBp.
  // Product and variant currencies remain strict uppercase codes.
  currency: z.string().regex(/^[A-Za-z0-9._-]{1,12}$/).optional(),
  instrumentType: z.string().optional(),
  sector: z.string().optional(),
  industry: z.string().optional(),
  listingCurrency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  quoteCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  exchangeRate: z.number().positive().optional(),
  exchangeRateTimestamp: z.iso.datetime().optional(),
  marketPrice: z.number().optional(),
  previousClose: z.number().optional(),
  change: z.number().optional(),
  changePercent: z.number().optional(),
  dayHigh: z.number().optional(),
  dayLow: z.number().optional(),
  fiftyTwoWeekHigh: z.number().optional(),
  fiftyTwoWeekLow: z.number().optional(),
  volume: nonNegativeInteger.optional(),
  timezone: z.string().optional(),
  historyTimeframe: z.enum(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max']).optional(),
  historyInterval: z.enum(['5m', '15m', '1d', '1wk', '1mo']).optional(),
  marketState: z.string().optional(),
  history: z.array(MarketHistoryPointSchema).max(512).optional(),
  events: z.array(MarketEventSchema).max(128).optional(),
});
const ArticleAttributesSchema = z.strictObject({
  ...genericPageFields,
  publisher: z.string().optional(),
  publisherUrl: z.url().optional(),
  description: z.string().optional(),
});
const ProductAttributesSchema = z.strictObject({
  productType: z.enum(['physical', 'software', 'service']).optional(),
  brand: z.string().optional(),
  seller: z.string().optional(),
  category: z.string().optional(),
  sku: z.string().optional(),
  gtin: z.string().optional(),
  tags: z.array(z.string()).optional(),
  price: nonNegativeInteger.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceDisplay: z.string().optional(),
  compareAtPrice: nonNegativeInteger.optional(),
  compareAtPriceDisplay: z.string().optional(),
  availability: z.string().optional(),
  rating: z.number().nonnegative().optional(),
  ratingScale: z.number().positive().optional(),
  reviewCount: nonNegativeInteger.optional(),
  features: z.array(z.string()).optional(),
  variants: z.array(ProductVariantSchema).optional(),
  softwareVersion: z.string().optional(),
  operatingSystem: z.string().optional(),
  contentRating: z.string().optional(),
  developerUrl: z.url().optional(),
});
const PostAttributesSchema = z.strictObject({
  handle: z.string().optional(),
  authorImageUrl: z.url().optional(),
  language: z.string().optional(),
  verified: z.boolean().optional(),
  contentWarning: z.string().optional(),
  mediaType: z.enum(['text', 'image', 'video', 'audio', 'carousel', 'mixed']).optional(),
  durationSeconds: nonNegativeInteger.optional(),
  hashtags: z.array(z.string()).optional(),
  coauthors: z.array(z.string()).optional(),
  locationName: z.string().optional(),
  sponsored: z.boolean().optional(),
  edited: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  inReplyToUrl: z.url().optional(),
  quotedPostUrl: z.url().optional(),
  likeCount: nonNegativeInteger.optional(),
  replyCount: nonNegativeInteger.optional(),
  repostCount: nonNegativeInteger.optional(),
  shareCount: nonNegativeInteger.optional(),
  quoteCount: nonNegativeInteger.optional(),
  viewCount: nonNegativeInteger.optional(),
});
const ProfileAttributesSchema = z.strictObject({
  handle: z.string().optional(),
  biography: z.string().optional(),
  verified: z.boolean().optional(),
  pronouns: z.array(z.string()).optional(),
  followerCount: nonNegativeInteger.optional(),
  followingCount: nonNegativeInteger.optional(),
  postCount: nonNegativeInteger.optional(),
  totalLikeCount: nonNegativeInteger.optional(),
});
const TimedMediaAttributesSchema = z.strictObject({
  durationSeconds: nonNegativeInteger.optional(),
  viewCount: nonNegativeInteger.optional(),
  publishedAtDisplay: z.string().optional(),
});
const FeedAttributesSchema = z.strictObject({
  feedType: z.string().optional(),
  query: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  timeframe: z.enum(['any', '1h', '1d', '7d', '30d']).optional(),
  usage: z.enum(['all', 'commercial', 'modify', 'commercial-and-modify']).optional(),
  orientation: z.enum(['any', 'landscape', 'portrait', 'square']).optional(),
  videoPlatform: z.enum(['any', 'youtube']).optional(),
  videoSort: z.enum(['relevance', 'date']).optional(),
  videoCreator: z.string().optional(),
  financeMoverList: z.enum(['gainers', 'losers', 'active']).optional(),
  site: z.string().optional(),
  placeType: z.enum(['any', 'house', 'street', 'locality', 'city', 'county', 'state', 'country', 'other']).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  resultCount: nonNegativeInteger.optional(),
  attribution: z.string().optional(),
});

const commonShape = {
  source: z.enum(extractionSources),
  id: nullableText,
  url: z.url(),
  title: nullableText,
  author: nullableText,
  publishedAt: nullableDate,
  content: z.string(),
  media: z.array(MediaSchema),
};

const documentShape = { ...commonShape, type: z.literal('document'), attributes: DocumentAttributesSchema };
const articleShape = { ...commonShape, type: z.literal('article'), attributes: ArticleAttributesSchema };
const productShape = { ...commonShape, type: z.literal('product'), attributes: ProductAttributesSchema };
const postShape = { ...commonShape, type: z.literal('post'), attributes: PostAttributesSchema };
const videoShape = { ...commonShape, type: z.literal('video'), attributes: TimedMediaAttributesSchema };
const audioShape = { ...commonShape, type: z.literal('audio'), attributes: TimedMediaAttributesSchema };

let entitySchema: z.ZodType;
const nestedEntitySchema = z.lazy(() => entitySchema);
const profileShape = {
  ...commonShape,
  type: z.literal('profile'),
  attributes: ProfileAttributesSchema,
  items: z.array(nestedEntitySchema),
};
const feedShape = {
  ...commonShape,
  type: z.literal('feed'),
  attributes: FeedAttributesSchema,
  items: z.array(nestedEntitySchema),
};

entitySchema = z.discriminatedUnion('type', [
  z.strictObject(documentShape),
  z.strictObject(articleShape),
  z.strictObject(productShape),
  z.strictObject(postShape),
  z.strictObject(profileShape),
  z.strictObject(videoShape),
  z.strictObject(audioShape),
  z.strictObject(feedShape),
]);

export const ExtractionEntitySchema = entitySchema;

const versioned = <Shape extends z.ZodRawShape>(shape: Shape) => z.strictObject({
  schemaVersion: z.literal(1),
  ...shape,
});

export const ExtractionResponseSchema = z.discriminatedUnion('type', [
  versioned(documentShape),
  versioned(articleShape),
  versioned(productShape),
  versioned(postShape),
  versioned(profileShape),
  versioned(videoShape),
  versioned(audioShape),
  versioned(feedShape),
]);

export function extractionJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://extractor.sh/schemas/extraction-v1.json',
    ...z.toJSONSchema(ExtractionResponseSchema, {
      target: 'draft-2020-12',
      cycles: 'ref',
      reused: 'ref',
    }),
  };
}
