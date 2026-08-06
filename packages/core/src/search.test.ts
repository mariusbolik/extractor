import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from './schema';
import { normalizeSearchQuery, normalizeSearchSite, searchWeb } from './search';
import { toPublicExtractionResult } from './types';

const fixture = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>Search: clean web data</title>
  <item>
    <title>Clean web data documentation</title>
    <link>https://example.com/docs</link>
    <description>Public &lt;b&gt;documentation&lt;/b&gt; for agents.</description>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Second clean data result</title>
    <link>https://example.org/second</link>
    <description>Another useful result.</description>
  </item>
  <item><title>Unsafe result</title><link>javascript:alert(1)</link></item>
  <item><title>Duplicate</title><link>https://example.com/docs</link></item>
</channel></rss>`;

const unrelatedRss = `<?xml version="1.0"?><rss><channel><item>
  <title>Unrelated discussion</title>
  <link>https://www.reddit.com/r/unrelated/</link>
  <description>Nothing about the requested company.</description>
</item></channel></rss>`;

const googleFixture = `<!doctype html><html><body>
  <div class="MjjYud">
    <a jsname="UWckNb" href="https://llmbase.ai/">
      <h3 class="LC20lb">LLMBase AI platform</h3>
    </a>
    <div class="VwiC3b">European AI models in one platform.</div>
  </div>
  <div class="MjjYud">
    <a href="/url?q=https%3A%2F%2Fexample.net%2Funrelated&amp;sa=U">
      <div role="heading">Another topic</div>
    </a>
  </div>
</body></html>`;

const braveFixture = `<!doctype html><html><body>
  <div class="snippet" data-type="web">
    <a href="https://llmbase.ai/"><div class="title">LLMBase AI platform</div></a>
    <div class="generic-snippet">European AI models in one platform.</div>
  </div>
</body></html>`;

describe('web search', () => {
  it('normalizes queries and rejects missing or oversized input', () => {
    expect(normalizeSearchQuery('  clean\n web   data ')).toBe('clean web data');
    expect(() => normalizeSearchQuery('   ')).toThrow('q query parameter is required');
    expect(() => normalizeSearchQuery('x'.repeat(201))).toThrow('200 characters or fewer');
  });

  it('normalizes a hostname-only site constraint', () => {
    expect(normalizeSearchSite(' LinkedIn.COM. ')).toBe('linkedin.com');
    expect(() => normalizeSearchSite('https://linkedin.com/in/example')).toThrow('hostname');
    expect(() => normalizeSearchSite('linkedin')).toThrow('hostname');
  });

  it('returns an ordered provider-neutral feed after one successful primary request', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://www.bing.com/search');
      expect(url.searchParams.get('q')).toBe('clean web data');
      expect(url.searchParams.get('format')).toBe('rss');
      expect(init?.method).toBe('GET');
      return new Response(fixture, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
    });

    const result = await searchWeb('clean web data', {
      fetcher,
      limit: 2,
      resultUrl: 'https://extractor.sh/api/search?q=clean+web+data&format=json',
    });
    const publicResult = toPublicExtractionResult(result);

    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      source: 'web-search',
      attributes: { feedType: 'web-search', query: 'clean web data', resultCount: 2 },
    });
    expect(publicResult.items?.[0]).toMatchObject({
      type: 'document',
      source: 'web-search',
      title: 'Clean web data documentation',
      url: 'https://example.com/docs',
      publishedAt: null,
      content: 'Public documentation for agents.',
    });
    expect(publicResult.content).toContain('1. [Clean web data documentation](https://example.com/docs)');
    expect(publicResult).not.toHaveProperty('method');
    expect(JSON.stringify(publicResult)).not.toMatch(/bing|google/i);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('removes leading stop words from private discovery while preserving ten public results', async () => {
    const items = Array.from({ length: 10 }, (_, index) => `
      <item>
        <title>White House result ${index + 1}</title>
        <link>https://example.com/white-house/${index + 1}</link>
        <description>Public White House information number ${index + 1}.</description>
      </item>`).join('');
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('q')).toBe('white house');
      return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
        headers: { 'Content-Type': 'application/rss+xml' },
      });
    });

    const result = toPublicExtractionResult(await searchWeb('the white house', { fetcher }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      attributes: { query: 'the white house', resultCount: 10 },
    });
    expect(result.items).toHaveLength(10);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('canonicalizes locale controls and keeps strict safe search enabled', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('setlang')).toBe('de-DE');
      expect(url.searchParams.get('cc')).toBe('DE');
      expect(url.searchParams.get('adlt')).toBe('strict');
      return new Response(fixture, { headers: { 'Content-Type': 'application/rss+xml' } });
    });
    const result = toPublicExtractionResult(await searchWeb('clean web data', {
      fetcher,
      language: 'de-de',
      country: 'de',
    }));
    expect(result.attributes).toMatchObject({ language: 'de-DE', country: 'DE', resultCount: 2 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('restricts discovery and returned URLs to one site in the same upstream request', async () => {
    const siteFixture = `<?xml version="1.0"?><rss><channel>
      <item><title>Sam Altman LinkedIn profile</title><link>https://www.linkedin.com/in/sam-altman/</link><description>Sam Altman public profile.</description></item>
      <item><title>Sam Altman elsewhere</title><link>https://example.com/sam-altman</link><description>Sam Altman biography.</description></item>
    </channel></rss>`;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('q')).toBe('Sam Altman site:linkedin.com');
      return new Response(siteFixture, { headers: { 'Content-Type': 'application/rss+xml' } });
    });

    const result = toPublicExtractionResult(await searchWeb('Sam Altman', { fetcher, site: 'LinkedIn.com' }));
    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result.attributes).toMatchObject({ site: 'linkedin.com', resultCount: 1 });
    expect(result.items?.map((item) => item.url)).toEqual(['https://www.linkedin.com/in/sam-altman/']);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('filters irrelevant primary results without making a suggestion request', async () => {
    const pollutedResults = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>LLMBase: European AI platform</title>
        <link>https://llmbase.ai/</link>
        <description>Access leading AI models in one place.</description>
      </item>
      <item>
        <title>Unrelated explicit Reddit discussion</title>
        <link>https://www.reddit.com/r/unrelated/comments/example/</link>
        <description>Content unrelated to the requested business.</description>
      </item>
    </channel></rss>`;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe('www.bing.com');
      expect(url.searchParams.get('q')).toBe('llmbase');
      return new Response(pollutedResults, { headers: { 'Content-Type': 'text/xml' } });
    });

    const result = toPublicExtractionResult(await searchWeb('llmbase', { fetcher }));
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0]).toMatchObject({ title: 'LLMBase: European AI platform', url: 'https://llmbase.ai/' });
    expect(JSON.stringify(result)).not.toContain('reddit.com');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requests Google only after Bing and the lightweight rescue return no relevant results', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.hostname);
      if (url.hostname === 'www.bing.com') {
        return new Response(unrelatedRss, { headers: { 'Content-Type': 'application/rss+xml' } });
      }
      if (url.hostname === 'search.brave.com') {
        expect(url.searchParams.get('safesearch')).toBe('strict');
        return new Response('<!doctype html><html><body></body></html>', { headers: { 'Content-Type': 'text/html' } });
      }

      expect(init?.method).toBe('GET');
      expect(url.origin + url.pathname).toBe('https://www.google.com/search');
      expect(url.searchParams.get('q')).toBe('llmbase');
      expect(url.searchParams.get('hl')).toBe('de');
      expect(url.searchParams.get('lr')).toBe('lang_de');
      expect(url.searchParams.get('cr')).toBe('countryDE');
      expect(url.searchParams.get('safe')).toBe('high');
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);
      return new Response(googleFixture, { headers: { 'Content-Type': 'text/html' } });
    });

    const result = await searchWeb('llmbase', { fetcher, language: 'de-DE', country: 'DE' });
    const publicResult = toPublicExtractionResult(result);

    expect(calls).toEqual(['www.bing.com', 'search.brave.com', 'www.google.com']);
    expect(result.method).toBe('web-search-html');
    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult.items).toHaveLength(1);
    expect(publicResult.items?.[0]).toMatchObject({
      title: 'LLMBase AI platform',
      url: 'https://llmbase.ai/',
      content: 'European AI models in one platform.',
    });
    expect(JSON.stringify(publicResult)).not.toMatch(/bing|google/i);
  });

  it('stops after the lightweight rescue succeeds and does not request Google', async () => {
    const calls: string[] = [];
    const result = await searchWeb('llmbase', {
      fetcher: async (input) => {
        const url = new URL(String(input));
        calls.push(url.hostname);
        return url.hostname === 'www.bing.com'
          ? new Response(unrelatedRss, { headers: { 'Content-Type': 'application/rss+xml' } })
          : new Response(braveFixture, { headers: { 'Content-Type': 'text/html' } });
      },
    });

    expect(calls).toEqual(['www.bing.com', 'search.brave.com']);
    expect(result.items?.[0]?.url).toBe('https://llmbase.ai/');
  });

  it('uses Google after a Bing error and returns an empty feed after a valid empty chain', async () => {
    const rescued = await searchWeb('llmbase', {
      fetcher: async (input) => new URL(String(input)).hostname === 'www.bing.com'
        ? new Response('temporarily unavailable', { status: 503 })
        : new Response(googleFixture, { headers: { 'Content-Type': 'text/html' } }),
    });
    expect(rescued.items?.[0]?.url).toBe('https://llmbase.ai/');

    const calls: string[] = [];
    const empty = toPublicExtractionResult(await searchWeb('tavily ai search', {
      fetcher: async (input) => {
        const url = new URL(String(input));
        calls.push(url.hostname);
        return url.hostname === 'www.bing.com'
          ? new Response(unrelatedRss, { headers: { 'Content-Type': 'application/rss+xml' } })
          : new Response('<!doctype html><html><body></body></html>', { headers: { 'Content-Type': 'text/html' } });
      },
    }));
    expect(calls).toEqual(['www.bing.com', 'search.brave.com', 'www.google.com']);
    expect(empty.items).toEqual([]);
    expect(empty.content).toBe('# Search results for tavily ai search');
  });

  it('rejects invalid controls before requests and errors only when both sources fail', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(searchWeb('query', { fetcher, limit: 11 })).rejects.toThrow('integer from 1 to 10');
    await expect(searchWeb('query', { fetcher, language: 'not_a_locale' })).rejects.toMatchObject({ status: 400 });
    await expect(searchWeb('query', { fetcher, country: 'Germany' })).rejects.toMatchObject({ status: 400 });
    await expect(searchWeb('query', { fetcher, site: 'https://example.com/path' })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();

    const unavailable = vi.fn<typeof fetch>(async () => new Response('temporarily unavailable', { status: 503 }));
    await expect(searchWeb('query', { fetcher: unavailable })).rejects.toMatchObject({
      code: 'upstream_error',
      status: 502,
    });
    expect(unavailable).toHaveBeenCalledTimes(3);
  });
});
