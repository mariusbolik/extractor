import { describe, expect, it, vi } from 'vitest';
import { runPublicPlaceSearch } from './place-search-service';

describe('runPublicPlaceSearch', () => {
  it('charges the standard limiter and returns a one-hour schema feed', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ features: [] }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const search = await runPublicPlaceSearch('Berlin', 'client-1', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, { fetcher, resultUrl: 'https://extractor.sh/api/places?q=Berlin' });

    expect(limit).toHaveBeenCalledOnce();
    expect(search.ttl).toBe(3_600);
    expect(search.result).toMatchObject({ schemaVersion: 1, source: 'place-search', type: 'feed' });
    expect(search.result).not.toHaveProperty('method');
  });
});
