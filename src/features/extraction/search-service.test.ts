import { describe, expect, it, vi } from 'vitest';
import { runPublicSearch } from './search-service';

const rss = `<?xml version="1.0"?><rss><channel><item>
  <title>Example search result</title>
  <link>https://example.com/</link>
  <description>Useful public page.</description>
</item></channel></rss>`;

describe('runPublicSearch', () => {
  it('charges one standard request on a cache miss and returns a one-hour schema feed', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: key === 'client-1' }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(rss, {
      headers: { 'Content-Type': 'application/rss+xml' },
    }));

    const search = await runPublicSearch('example search', 'client-1', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, { fetcher, resultUrl: 'https://extractor.sh/api/search?q=example+search' });

    expect(limit).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(search.ttl).toBe(3_600);
    expect(search.result).toMatchObject({ schemaVersion: 1, source: 'web-search', type: 'feed' });
    expect(search.result).not.toHaveProperty('method');
  });

  it('stops before upstream work when the shared quota is exhausted', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runPublicSearch('example', 'client-2', {
      EXTRACT_RATE_LIMITER: {
        limit: vi.fn(async () => ({ success: false })),
      } as unknown as RateLimit,
    }, { fetcher })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
