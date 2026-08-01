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

  it('generates a strict Draft 2020-12 JSON Schema', () => {
    const schema = extractionJsonSchema();
    expect(schema).toMatchObject({
      $id: 'https://extractor.mcb-software.workers.dev/schemas/extraction-v1.json',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
    expect(JSON.stringify(schema)).toContain('schemaVersion');
    expect(JSON.stringify(schema)).toContain('additionalProperties');
  });
});
