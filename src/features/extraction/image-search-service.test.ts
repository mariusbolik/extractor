import { describe, expect, it, vi } from 'vitest';
import { runPublicImageSearch } from './image-search-service';

describe('runPublicImageSearch', () => {
  it('charges the standard limiter and returns a one-hour schema feed', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const search = await runPublicImageSearch('coral', 'client-1', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, { fetcher, resultUrl: 'https://extractor.sh/api/images?q=coral' });

    expect(limit).toHaveBeenCalledOnce();
    expect(search.ttl).toBe(3_600);
    expect(search.result).toMatchObject({ schemaVersion: 1, source: 'image-search', type: 'feed' });
    expect(search.result).not.toHaveProperty('method');
  });
});
