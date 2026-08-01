import { describe, expect, it } from 'vitest';
import { apiCacheKey, extractionTtl } from './cache';

describe('extraction cache policy', () => {
  it('versions internal cache keys without changing the public request', () => {
    const request = new Request('https://extractor.test/api/extract?url=https%3A%2F%2Fexample.com&format=json');
    const key = apiCacheKey(request);

    expect(new URL(key.url).searchParams.get('__extractor_cache')).toBe('2026-08-schema-v1');
    expect(new URL(request.url).searchParams.has('__extractor_cache')).toBe(false);
  });

  it('uses short lifetimes for changing collections and products', () => {
    expect(extractionTtl({ type: 'feed', items: [] })).toBe(3_600);
    expect(extractionTtl({ type: 'profile', items: [] })).toBe(3_600);
    expect(extractionTtl({ type: 'product' })).toBe(3_600);
    expect(extractionTtl({ type: 'article' })).toBe(2_592_000);
  });
});
