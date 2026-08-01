import { z } from 'zod/v4';

export const extractionSources = [
  'web', 'amazon', 'bluesky', 'google-news', 'instagram', 'mastodon', 'reddit',
  'shopify', 'soundcloud', 'spotify', 'tiktok', 'vimeo', 'x', 'youtube',
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
  price: nonNegativeInteger.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceDisplay: z.string().optional(),
  available: z.boolean().optional(),
});

const DocumentAttributesSchema = z.strictObject({});
const ArticleAttributesSchema = z.strictObject({
  publisher: z.string().optional(),
  publisherUrl: z.url().optional(),
});
const ProductAttributesSchema = z.strictObject({
  productType: z.enum(['physical', 'software', 'service']).optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  price: nonNegativeInteger.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceDisplay: z.string().optional(),
  availability: z.string().optional(),
  rating: z.number().nonnegative().optional(),
  ratingScale: z.number().positive().optional(),
  reviewCount: nonNegativeInteger.optional(),
  features: z.array(z.string()).optional(),
  variants: z.array(ProductVariantSchema).optional(),
});
const PostAttributesSchema = z.strictObject({
  handle: z.string().optional(),
  contentWarning: z.string().optional(),
  mediaType: z.enum(['text', 'image', 'video', 'audio', 'carousel', 'mixed']).optional(),
  durationSeconds: nonNegativeInteger.optional(),
});
const ProfileAttributesSchema = z.strictObject({
  handle: z.string().optional(),
  biography: z.string().optional(),
  followerCount: nonNegativeInteger.optional(),
  followingCount: nonNegativeInteger.optional(),
  postCount: nonNegativeInteger.optional(),
});
const TimedMediaAttributesSchema = z.strictObject({
  durationSeconds: nonNegativeInteger.optional(),
});
const FeedAttributesSchema = z.strictObject({
  feedType: z.string().optional(),
  query: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
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
    $id: 'https://extractor.mcb-software.workers.dev/schemas/extraction-v1.json',
    ...z.toJSONSchema(ExtractionResponseSchema, {
      target: 'draft-2020-12',
      cycles: 'ref',
      reused: 'ref',
    }),
  };
}
