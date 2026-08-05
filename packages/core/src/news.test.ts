import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from './schema';
import { searchNews } from './news';
import { toPublicExtractionResult } from './types';

function item(index: number): string {
  return `<item>
    <title>AI infrastructure story ${index}</title>
    <link>https://news.google.com/rss/articles/story-${index}</link>
    <guid>story-${index}</guid>
    <pubDate>Sat, 02 Aug 2026 10:0${index}:00 GMT</pubDate>
    <description>&lt;p&gt;Current public news summary ${index}.&lt;/p&gt;</description>
    <source url="https://publisher.example/">Example Publisher</source>
  </item>`;
}

const fixture = `<?xml version="1.0"?><rss><channel>
  <title>Google News - AI infrastructure</title>
  <description>Current coverage</description>
  ${item(1)}${item(2)}${item(3)}
</channel></rss>`;

describe('news search', () => {
  it('returns a limited provider-neutral schema-v1 article feed', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.toString()).toBe('https://news.google.com/rss/search?q=AI+infrastructure&hl=en-US&gl=US&ceid=US%3Aen');
      return new Response(fixture, { headers: { 'Content-Type': 'application/rss+xml' } });
    });

    const publicResult = toPublicExtractionResult(await searchNews(' AI  infrastructure ', {
      fetcher,
      limit: 2,
      resultUrl: 'https://extractor.sh/api/news?q=AI+infrastructure&limit=2&format=json',
    }));

    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      source: 'google-news',
      id: 'AI infrastructure',
      title: 'News results for AI infrastructure',
      attributes: { feedType: 'news-search', query: 'AI infrastructure' },
    });
    expect(publicResult.items).toHaveLength(2);
    expect(publicResult.items?.every((entry) => entry.type === 'article' && entry.source === 'google-news')).toBe(true);
    expect(publicResult.content).toContain('# News results for AI infrastructure');
    expect(publicResult).not.toHaveProperty('method');
  });

  it('rejects empty queries and limits outside 1 to 50', async () => {
    await expect(searchNews('   ')).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchNews('AI', { limit: 0 })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchNews('AI', { limit: 51 })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
  });

  it('applies canonical locale controls and an inclusive recent cutoff after retrieval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
    const localized = `<?xml version="1.0"?><rss><channel>
      <item><title>AI at cutoff</title><link>https://example.com/cutoff</link><guid>cutoff</guid><pubDate>Tue, 04 Aug 2026 12:00:00 GMT</pubDate></item>
      <item><title>AI too old</title><link>https://example.com/old</link><guid>old</guid><pubDate>Tue, 04 Aug 2026 11:59:59 GMT</pubDate></item>
      <item><title>AI undated</title><link>https://example.com/undated</link><guid>undated</guid></item>
    </channel></rss>`;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('hl')).toBe('de-DE');
      expect(url.searchParams.get('gl')).toBe('DE');
      expect(url.searchParams.get('ceid')).toBe('DE:de');
      return new Response(localized, { headers: { 'Content-Type': 'application/rss+xml' } });
    });
    try {
      const result = toPublicExtractionResult(await searchNews('AI', {
        fetcher,
        language: 'de-de',
        country: 'de',
        timeframe: '1d',
      }));
      expect(result.items?.map((entry) => entry.id)).toEqual(['cutoff']);
      expect(result.attributes).toMatchObject({ language: 'de-DE', country: 'DE', timeframe: '1d', resultCount: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an HTTP-compatible empty feed when a timeframe filters every article', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
    try {
      const result = await searchNews('AI', {
        fetcher: async () => new Response(fixture, { headers: { 'Content-Type': 'application/rss+xml' } }),
        timeframe: '1h',
      });
      expect(result.items).toEqual([]);
      expect(result.attributes.resultCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
