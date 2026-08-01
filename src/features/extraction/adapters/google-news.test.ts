import { describe, expect, it, vi } from 'vitest';
import { extractUrl } from '../extract';

const renderPageHtmlMock = vi.hoisted(() => vi.fn());
vi.mock('./browser', () => ({ renderPageHtml: renderPageHtmlMock }));

function rss(items: string, title = 'Google News - Cloudflare'): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>${title}</title><description>Public news results</description>
    <lastBuildDate>Fri, 01 Aug 2026 12:00:00 GMT</lastBuildDate>${items}
  </channel></rss>`;
}

function item(index = 1): string {
  return `<item>
    <title>Cloudflare story ${index}</title>
    <link>https://news.google.com/rss/articles/story-${index}</link>
    <guid>story-${index}</guid>
    <pubDate>Fri, 01 Aug 2026 11:00:00 GMT</pubDate>
    <description>&lt;p&gt;A useful public news summary ${index}.&lt;/p&gt;</description>
    <source url="https://publisher.example/">Example Publisher</source>
  </item>`;
}

describe('Google News adapter', () => {
  it('maps a normal search page to a typed article feed', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toBe('https://news.google.com/rss/search?q=Cloudflare&hl=de&gl=DE&ceid=DE%3Ade');
      return new Response(rss(item()), { headers: { 'Content-Type': 'application/xml' } });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://news.google.com/search?q=Cloudflare&hl=de&gl=DE&ceid=DE%3Ade', { fetcher });

    expect(result).toMatchObject({
      type: 'feed',
      source: 'google-news',
      method: 'google-news-rss',
      attributes: { feedType: 'search', query: 'Cloudflare', language: 'de', country: 'DE' },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items![0]).toMatchObject({
      type: 'article',
      source: 'google-news',
      author: 'Example Publisher',
      attributes: { publisher: 'Example Publisher', publisherUrl: 'https://publisher.example/' },
    });
  });

  it('maps topics and top stories to their public feeds', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const value = input.toString();
      expect(value === 'https://news.google.com/rss/topics/TOPIC123?hl=en-US&gl=US&ceid=US%3Aen'
        || value === 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US%3Aen').toBe(true);
      return new Response(rss(item()), { headers: { 'Content-Type': 'application/xml' } });
    }) as unknown as typeof fetch;

    const topic = await extractUrl('https://news.google.com/topics/TOPIC123', { fetcher });
    const topStories = await extractUrl('https://news.google.com/topstories', { fetcher });
    expect(topic.attributes.feedType).toBe('topic');
    expect(topStories.attributes.feedType).toBe('top_stories');
  });

  it('caps a Google News feed at 50 articles', async () => {
    const body = rss(Array.from({ length: 55 }, (_, index) => item(index + 1)).join(''));
    const result = await extractUrl('https://news.google.com/search?q=Cloudflare', {
      fetcher: vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/xml' } })) as unknown as typeof fetch,
    });
    expect(result.items).toHaveLength(50);
  });

  it('uses the public HTML page when a source edge declines RSS', async () => {
    const html = `<html><body><c-wiz>
      <div class="vr1PYe">Example Publisher</div>
      <a class="JtKRv" href="./read/story-one">HTML fallback story</a>
      <time datetime="2026-08-01T11:00:00Z">Today</time>
    </c-wiz></body></html>`;
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('Unavailable', { status: 503 })
        : new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://news.google.com/search?q=Cloudflare', { fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      type: 'feed',
      source: 'google-news',
      method: 'google-news-html',
    });
    expect(result.items?.[0]).toMatchObject({
      type: 'article',
      title: 'HTML fallback story',
      author: 'Example Publisher',
    });
  });

  it('uses the rate-limited browser only after both cheap Google News requests fail', async () => {
    const html = `<html><body><c-wiz>
      <div class="vr1PYe">Browser Publisher</div>
      <a class="JtKRv" href="./read/browser-story">Browser fallback story</a>
      <time datetime="2026-08-01T11:00:00Z">Today</time>
    </c-wiz></body></html>`;
    renderPageHtmlMock.mockResolvedValueOnce(html);
    const fetcher = vi.fn(async () => new Response('Unavailable', { status: 503 })) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);

    const result = await extractUrl('https://news.google.com/search?q=Cloudflare', {
      fetcher,
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(allowBrowser).toHaveBeenCalledOnce();
    expect(renderPageHtmlMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ method: 'google-news-browser', type: 'feed', source: 'google-news' });
  });

  it('reports malformed public feed data precisely', async () => {
    await expect(extractUrl('https://news.google.com/', {
      fetcher: vi.fn(async () => new Response('<rss><broken>', { headers: { 'Content-Type': 'application/xml' } })) as unknown as typeof fetch,
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
