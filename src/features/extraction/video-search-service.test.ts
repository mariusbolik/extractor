import { describe, expect, it, vi } from 'vitest';
import { runPublicVideoSearch } from './video-search-service';

describe('runPublicVideoSearch', () => {
  it('charges the standard limiter and returns a one-hour schema feed', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      contents: { sectionListRenderer: { contents: [{ videoRenderer: {
        videoId: 'H7Qe96fqg1M',
        title: { simpleText: 'Impossible query video' },
      } }] } },
    }), { headers: { 'Content-Type': 'application/json' } }));
    const search = await runPublicVideoSearch('impossible query', 'client-1', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, {
      fetcher,
      resultUrl: 'https://extractor.sh/api/videos?q=impossible+query',
    });

    expect(limit).toHaveBeenCalledOnce();
    expect(search.ttl).toBe(3_600);
    expect(search.result).toMatchObject({ schemaVersion: 1, source: 'video-search', type: 'feed' });
    expect(search.result).not.toHaveProperty('method');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
