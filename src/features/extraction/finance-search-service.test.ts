import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from '@extractor/core';
import { runPublicStockSearch } from './finance-search-service';

describe('runPublicStockSearch', () => {
  it('uses the standard limiter and returns a one-hour schema feed', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      quotes: [{ symbol: 'AAPL', quoteType: 'EQUITY', longname: 'Apple Inc.', currency: 'USD' }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    const search = await runPublicStockSearch('Apple', 'client-stock', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, { fetcher });

    expect(limit).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(search.ttl).toBe(3_600);
    expect(ExtractionResponseSchema.parse(search.result)).toEqual(search.result);
    expect(search.result).toMatchObject({ source: 'finance', type: 'feed', attributes: { resultCount: 1 } });
  });

  it('does no upstream work after the standard limiter rejects the request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runPublicStockSearch('Apple', 'client-stock', {
      EXTRACT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit,
    }, { fetcher })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
