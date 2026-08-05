import { describe, expect, it } from 'vitest';
import { ExtractionResponseSchema, extractionJsonSchema } from './schema';

const product = {
  schemaVersion: 1,
  type: 'product',
  source: 'amazon',
  id: 'B012345678',
  url: 'https://www.amazon.de/dp/B012345678',
  title: 'Example product',
  author: 'Example',
  publishedAt: null,
  content: '# Example product',
  media: [],
  attributes: {
    productType: 'physical',
    price: 1999,
    currency: 'EUR',
    priceDisplay: '19,99 €',
  },
} as const;

describe('global extraction schema', () => {
  it('accepts a structured product with an integer minor-unit price', () => {
    expect(ExtractionResponseSchema.parse(product)).toEqual(product);
  });

  it('accepts recursively typed feed items', () => {
    const { schemaVersion: _schemaVersion, ...productEntity } = product;
    const result = ExtractionResponseSchema.safeParse({
      schemaVersion: 1,
      type: 'feed',
      source: 'amazon',
      id: null,
      url: 'https://www.amazon.de/s?k=keyboard',
      title: 'Amazon search: keyboard',
      author: null,
      publishedAt: null,
      content: '# Amazon search: keyboard',
      media: [],
      attributes: { feedType: 'search', query: 'keyboard' },
      items: [productEntity],
    });
    expect(result.success).toBe(true);
  });

  it('rejects fractional prices and unknown public fields', () => {
    expect(ExtractionResponseSchema.safeParse({
      ...product,
      attributes: { ...product.attributes, price: 19.99 },
    }).success).toBe(false);
    expect(ExtractionResponseSchema.safeParse({ ...product, method: 'amazon-html' }).success).toBe(false);
  });

  it('accepts optional structured fields and rejects invalid counts', () => {
    expect(ExtractionResponseSchema.safeParse({
      ...product,
      attributes: {
        ...product.attributes,
        sku: 'EXAMPLE-1',
        gtin: '1234567890123',
        seller: 'Example Seller',
        tags: ['sale'],
        compareAtPrice: 2499,
        compareAtPriceDisplay: '24,99 €',
      },
    }).success).toBe(true);

    const post = {
      schemaVersion: 1,
      type: 'post',
      source: 'bluesky',
      id: '3abc',
      url: 'https://bsky.app/profile/example/post/3abc',
      title: 'A post',
      author: '@example',
      publishedAt: null,
      content: 'A post',
      media: [],
      attributes: {
        language: 'en', verified: true, edited: false, sensitive: false,
        hashtags: ['public'], coauthors: ['@collaborator'], locationName: 'Berlin', sponsored: true,
        inReplyToUrl: 'https://bsky.app/profile/example/post/parent',
        quotedPostUrl: 'https://bsky.app/profile/example/post/quote',
        likeCount: 1,
      },
    };
    expect(ExtractionResponseSchema.safeParse(post).success).toBe(true);
    expect(ExtractionResponseSchema.safeParse({
      ...post,
      attributes: { ...post.attributes, likeCount: -1 },
    }).success).toBe(false);
    expect(ExtractionResponseSchema.safeParse({
      ...post,
      attributes: { ...post.attributes, viewCount: 'many' },
    }).success).toBe(false);
  });

  it('accepts decimal market values without applying product price units', () => {
    const result = ExtractionResponseSchema.safeParse({
      schemaVersion: 1,
      type: 'document',
      source: 'yahoo-finance',
      id: 'AAPL',
      url: 'https://finance.yahoo.com/quote/AAPL/',
      title: 'Apple Inc. (AAPL)',
      author: null,
      publishedAt: '2026-07-31T20:00:01.000Z',
      content: '# Apple Inc. (AAPL)',
      media: [],
      attributes: {
        tickerSymbol: 'AAPL',
        currency: 'USD',
        marketPrice: 208.49,
        change: -1.26,
        changePercent: -0.6007,
        volume: 48_215_000,
        history: [{
          timestamp: '2026-07-31T13:30:00.000Z',
          open: 209.5,
          close: 208.49,
          volume: 48_000_000,
        }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional video view counts and rejects malformed or negative values', () => {
    const video = {
      schemaVersion: 1,
      type: 'video',
      source: 'video-search',
      id: 'H7Qe96fqg1M',
      url: 'https://www.youtube.com/watch?v=H7Qe96fqg1M',
      title: 'Example video',
      author: 'Example creator',
      publishedAt: null,
      content: 'Example description',
      media: [],
      attributes: { durationSeconds: 120, viewCount: 1_234 },
    };
    expect(ExtractionResponseSchema.safeParse(video).success).toBe(true);
    expect(ExtractionResponseSchema.safeParse({
      ...video,
      attributes: { ...video.attributes, viewCount: -1 },
    }).success).toBe(false);
    expect(ExtractionResponseSchema.safeParse({
      ...video,
      attributes: { ...video.attributes, viewCount: 'many' },
    }).success).toBe(false);
  });

  it('generates a strict Draft 2020-12 JSON Schema', () => {
    const schema = extractionJsonSchema();
    expect(schema).toMatchObject({
      $id: 'https://extractor.sh/schemas/extraction-v1.json',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
    expect(JSON.stringify(schema)).toContain('schemaVersion');
    expect(JSON.stringify(schema)).toContain('additionalProperties');
  });
});
