import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from '@extractor/core';
import { runPublicNewsSearch } from './news-service';

const rss = `<?xml version="1.0"?><rss><channel>
  <title>Google News - AI</title>
  <item>
    <title>Current AI story</title>
    <link>https://news.google.com/rss/articles/current-ai-story</link>
    <guid>current-ai-story</guid>
    <pubDate>Sat, 02 Aug 2026 10:00:00 GMT</pubDate>
    <description>Current public summary.</description>
    <source url="https://publisher.example/">Example Publisher</source>
  </item>
</channel></rss>`;

describe('runPublicNewsSearch', () => {
  it('uses the standard quota and returns a one-hour public schema feed', async () => {
    const standardLimit = vi.fn(async () => ({ success: true }));
    const browserLimit = vi.fn(async () => ({ success: true }));
    const news = await runPublicNewsSearch('AI', 'client-1', {
      EXTRACT_RATE_LIMITER: { limit: standardLimit } as unknown as RateLimit,
      BROWSER_RATE_LIMITER: { limit: browserLimit } as unknown as RateLimit,
    }, {
      fetcher: async () => new Response(rss, { headers: { 'Content-Type': 'application/rss+xml' } }),
      resultUrl: 'https://extractor.sh/api/news?q=AI&format=json',
    });

    expect(standardLimit).toHaveBeenCalledOnce();
    expect(browserLimit).not.toHaveBeenCalled();
    expect(news.ttl).toBe(3_600);
    expect(ExtractionResponseSchema.parse(news.result)).toEqual(news.result);
    expect(news.result).toMatchObject({ schemaVersion: 1, type: 'feed', source: 'google-news' });
    expect(news.result).not.toHaveProperty('method');
  });

  it('stops before upstream work when the standard quota is exhausted', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runPublicNewsSearch('AI', 'client-2', {
      EXTRACT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit,
      BROWSER_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit,
    }, { fetcher })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
