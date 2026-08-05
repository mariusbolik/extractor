import { describe, expect, it } from 'vitest';
import { extractionTtl } from './cache';

describe('extraction cache policy', () => {
  it('uses short lifetimes for changing collections and products', () => {
    expect(extractionTtl({ type: 'feed', source: 'reddit', items: [] })).toBe(3_600);
    expect(extractionTtl({ type: 'profile', source: 'bluesky', items: [] })).toBe(3_600);
    expect(extractionTtl({ type: 'product', source: 'amazon' })).toBe(3_600);
    expect(extractionTtl({ type: 'article', source: 'web' })).toBe(2_592_000);
    expect(extractionTtl({ type: 'document', source: 'yahoo-finance' })).toBe(300);
  });
});
