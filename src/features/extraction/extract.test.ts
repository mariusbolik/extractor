import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchTweetMock, renderPageHtmlMock } = vi.hoisted(() => ({
  fetchTweetMock: vi.fn(),
  renderPageHtmlMock: vi.fn(),
}));

vi.mock('react-tweet/api', () => ({ fetchTweet: fetchTweetMock }));
vi.mock('./adapters/browser', () => ({ renderPageHtml: renderPageHtmlMock }));

import { extractUrl } from './extract';
import { toPublicExtractionResult } from './types';

function mockFetch(body: string, contentType: string, status = 200): typeof fetch {
  return vi.fn(async () => new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  })) as unknown as typeof fetch;
}

describe('extractUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses native text/markdown first', async () => {
    const content = '# Native page\n\nThis Markdown came directly from the origin and is long enough to use.';
    const result = await extractUrl('https://example.com/post', {
      fetcher: mockFetch(content, 'text/markdown; charset=utf-8'),
    });

    expect(result.method).toBe('native-markdown');
    expect(result.content).toBe(content);
    expect(result.type).toBe('document');
  });

  it('returns useful plain text without launching a browser', async () => {
    const content = 'This plain-text page contains enough useful content to return directly without browser rendering.';
    const result = await extractUrl('https://example.com/readme.txt', {
      fetcher: mockFetch(content, 'text/plain; charset=utf-8'),
    });

    expect(result.method).toBe('native-markdown');
    expect(result.content).toBe(content);
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported media without wasting a browser launch', async () => {
    await expect(extractUrl('https://example.com/image.png', {
      fetcher: mockFetch('PNG bytes would be here', 'image/png'),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({
      code: 'unsupported_content_type',
      status: 415,
      message: expect.stringContaining('image/png'),
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('falls back to Browser Run after unusable HTML', async () => {
    renderPageHtmlMock.mockResolvedValue(`
      <html><head><title>Rendered</title></head><body><main>
      <h1>Rendered page</h1><p>This useful content appeared after JavaScript rendered the page for the visitor.</p>
      <p>There is enough material here to pass the readable-content threshold safely.</p>
      </main></body></html>`);

    const result = await extractUrl('https://example.com/app', {
      fetcher: mockFetch('<html><body><div id="app"></div><script src="/app.js"></script></body></html>', 'text/html'),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    });

    expect(result.method).toBe('browser');
    expect(result.content).toContain('Rendered page');
  });

  it('does not launch a browser for a direct upstream failure', async () => {
    await expect(extractUrl('https://example.com/unavailable', {
      fetcher: mockFetch('Unavailable', 'text/html', 503),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'The source returned HTTP 503, so it is currently unavailable.',
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('does not launch a browser for an empty static HTML page', async () => {
    await expect(extractUrl('https://example.com/empty-static', {
      fetcher: mockFetch('<html><body><main></main></body></html>', 'text/html'),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({
      code: 'extraction_failed',
      message: 'No useful page content was found.',
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('does not launch a browser for a source access block', async () => {
    await expect(extractUrl('https://example.com/blocked', {
      fetcher: mockFetch('Forbidden', 'text/html', 403),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({ code: 'source_blocked', status: 502 });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('does not spend a browser launch on a source that already timed out', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('Timed out', 'TimeoutError');
    }) as unknown as typeof fetch;

    await expect(extractUrl('https://example.com/slow', {
      fetcher,
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({
      code: 'timeout',
      status: 504,
      message: 'The source did not respond within 10 seconds.',
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('returns a normalized Reddit feed', async () => {
    const atom = `<?xml version="1.0"?><feed>
      <title>r/example</title><updated>2026-07-31T10:00:00Z</updated>
      <entry><title>First post</title><updated>2026-07-31T09:00:00Z</updated>
      <author><name>u/example</name></author>
      <link rel="alternate" href="https://www.reddit.com/r/example/comments/abc/first/" />
      <content type="html"><![CDATA[<p>A public Reddit post body.</p>]]></content></entry>
    </feed>`;
    const result = await extractUrl('https://www.reddit.com/r/example/', {
      fetcher: mockFetch(atom, 'application/atom+xml'),
    });

    expect(result.source).toBe('reddit');
    expect(result.type).toBe('feed');
    expect(result.items![0].title).toBe('First post');
    expect(result.method).toBe('reddit-rss');
  });

  it('returns a normalized Bluesky profile feed without browser rendering', async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel>
        <title>@alice.example - Bluesky</title>
        <description>A public profile.</description>
        <link>https://bsky.app/profile/alice.example</link>
        <item>
          <link>https://bsky.app/profile/alice.example/post/3abc</link>
          <description>Hello from Bluesky.&#xA;&#xA;Second line.</description>
          <pubDate>31 Jul 2026 19:00 +0000</pubDate>
          <guid isPermaLink="false">at://did:plc:alice/app.bsky.feed.post/3abc</guid>
        </item>
      </channel></rss>`;

    const result = await extractUrl('https://bsky.app/profile/alice.example', {
      fetcher: mockFetch(rss, 'application/xml; charset=UTF-8'),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    });

    expect(result).toMatchObject({
      source: 'bluesky',
      type: 'profile',
      method: 'bluesky-rss',
      author: '@alice.example',
      publishedAt: '2026-07-31T19:00:00.000Z',
    });
    expect(result.items![0]).toMatchObject({
      url: 'https://bsky.app/profile/alice.example/post/3abc',
      content: 'Hello from Bluesky.\n\nSecond line.',
    });
    expect(result.items![0].content).not.toContain('&#xA;');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('returns one Bluesky post from the public API without replies', async () => {
    const fetcher = mockFetch(JSON.stringify({
      thread: {
        post: {
          author: { handle: 'alice.example', displayName: 'Alice' },
          record: { text: 'A public Bluesky post.', createdAt: '2026-07-31T19:00:00Z' },
          embed: { external: { uri: 'https://example.com/story', title: 'A story' } },
        },
        replies: [{ post: { record: { text: 'This reply must not be returned.' } } }],
      },
    }), 'application/json');

    const result = await extractUrl('https://bsky.app/profile/alice.example/post/3abc', {
      fetcher,
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    });

    expect(result).toMatchObject({
      source: 'bluesky',
      type: 'post',
      method: 'bluesky-api',
      author: 'Alice (@alice.example)',
      publishedAt: '2026-07-31T19:00:00.000Z',
    });
    expect(result.content).toContain('A public Bluesky post.');
    expect(result.content).toContain('[A story](https://example.com/story)');
    expect(result.content).not.toContain('This reply must not be returned.');
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'public.api.bsky.app' }),
      expect.any(Object),
    );
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('returns normalized YouTube oEmbed video metadata', async () => {
    const result = await extractUrl('https://youtu.be/abcdefghijk', {
      fetcher: mockFetch(JSON.stringify({
        title: 'A video',
        author_name: 'A creator',
        thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      }), 'application/json'),
    });

    expect(result.source).toBe('youtube');
    expect(result.type).toBe('video');
    expect(result.title).toBe('A video');
    expect(result.method).toBe('youtube-oembed');
  });

  it('resolves a YouTube handle through the public channel page', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://www.youtube.com/@Cloudflare') {
        return new Response(
          '<html><head><link rel="canonical" href="https://www.youtube.com/channel/UCgv3xMy6kECn0boYP9d2o-g"></head></html>',
          { headers: { 'Content-Type': 'text/html' } },
        );
      }

      return new Response(`<?xml version="1.0"?><feed>
        <title>Cloudflare</title><updated>2026-07-31T10:00:00Z</updated>
        <entry><title>One useful video</title><published>2026-07-31T09:00:00Z</published>
        <author><name>Cloudflare</name></author>
        <link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk" />
        <media:group><media:title>One useful video</media:title><media:description>A description.</media:description></media:group>
        </entry></feed>`, { headers: { 'Content-Type': 'text/xml' } });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://www.youtube.com/@Cloudflare', { fetcher });

    expect(result.source).toBe('youtube');
    expect(result.type).toBe('feed');
    expect(result.title).toBe('Cloudflare');
    expect(result.method).toBe('youtube-atom');
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL('https://www.youtube.com/feeds/videos.xml?channel_id=UCgv3xMy6kECn0boYP9d2o-g'),
      expect.any(Object),
    );
  });

  it('normalizes a public X post through the official oEmbed endpoint', async () => {
    const fetcher = mockFetch(JSON.stringify({
      author_name: 'jack',
      author_url: 'https://x.com/jack',
      html: '<blockquote><p>just setting up my twttr</p>— jack (@jack)</blockquote>',
    }), 'application/json');

    const result = await extractUrl('https://x.com/jack/status/20', { fetcher });
    expect(result.source).toBe('x');
    expect(result.author).toBe('jack (@jack)');
    expect(result.content).toContain('just setting up my twttr');
    expect(result.method).toBe('x-oembed');
    expect(fetchTweetMock).not.toHaveBeenCalled();
  });

  it('keeps the server-side X adapter as an oEmbed fallback', async () => {
    fetchTweetMock.mockResolvedValue({
      data: {
        __typename: 'Tweet',
        id_str: '20',
        text: 'just setting up my twttr',
        created_at: '2006-03-21T20:50:14.000Z',
        user: { name: 'jack', screen_name: 'jack' },
      },
    });

    const result = await extractUrl('https://x.com/jack/status/20', {
      fetcher: mockFetch('Not found', 'text/plain', 404),
    });
    expect(result.source).toBe('x');
    expect(result.author).toBe('jack (@jack)');
    expect(result.content).toContain('just setting up my twttr');
    expect(result.method).toBe('react-tweet');
  });

  it('uses an advertised WordPress post endpoint before Browser Rendering', async () => {
    const html = '<html><head><link rel="alternate" type="application/json" href="https://example.com/wp-json/wp/v2/posts/42"></head><body><div id="app"></div><script src="/app.js"></script></body></html>';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().includes('/wp-json/')) {
        return new Response(JSON.stringify({
          link: 'https://example.com/post',
          title: { rendered: 'Structured story' },
          content: { rendered: '<p>This useful article came from the publisher advertised WordPress endpoint.</p>' },
          date_gmt: '2026-07-31T18:00:00',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://example.com/post', {
      fetcher,
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    });

    expect(result.method).toBe('wordpress-json');
    expect(result.title).toBe('Structured story');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('uses an advertised feed only when the HTML itself has no useful content', async () => {
    const html = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body></body></html>';
    const rss = '<?xml version="1.0"?><rss><channel><title>Example feed</title><item><title>Story</title><link>https://example.com/story</link><description>A useful story summary.</description></item></channel></rss>';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(
      input.toString().endsWith('/feed.xml') ? rss : html,
      { headers: { 'Content-Type': input.toString().endsWith('/feed.xml') ? 'application/rss+xml' : 'text/html' } },
    )) as unknown as typeof fetch;

    const result = await extractUrl('https://example.com/', { fetcher });
    expect(result.method).toBe('discovered-feed');
    expect(result.type).toBe('feed');
    expect(result.items![0].title).toBe('Story');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('uses Shopify product JSON for an exact storefront product page', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/products/black-shirt.js')) {
        return new Response(JSON.stringify({
          title: 'Black shirt',
          handle: 'black-shirt',
          vendor: 'Example Store',
          description: '<p>A durable black shirt with a useful product description.</p>',
          featured_image: '//cdn.shopify.com/s/files/black-shirt.jpg',
          published_at: '2026-07-31T18:00:00Z',
          variants: [{ title: 'Medium', price: 2499, available: true }],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('<html><body><main><h1>Theme product</h1><p>This readable theme content would normally be extracted.</p></main><script>Shopify.theme = { id: 1 };</script></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://store.example.com/products/black-shirt', { fetcher });

    expect(result).toMatchObject({
      source: 'shopify',
      type: 'product',
      title: 'Black shirt',
      method: 'shopify-json',
      author: 'Example Store',
    });
    expect(result.content).toContain('Price: 24.99');
    expect(result.content).toContain('https://cdn.shopify.com/s/files/black-shirt.jpg');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('returns a Shopify storefront products.json catalog as a feed', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === 'https://store.example.com/products.json?limit=50') {
        return new Response(JSON.stringify({ products: [{
          title: 'One product',
          handle: 'one-product',
          vendor: 'Example Store',
          body_html: '<p>A product description.</p>',
          variants: [{ title: 'Default', price: '19.00' }],
        }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('<html><head><link href="//cdn.shopify.com/shop.css"></head><body></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://store.example.com/', { fetcher });

    expect(result).toMatchObject({ source: 'shopify', type: 'feed', method: 'shopify-json' });
    expect(result.items![0]).toMatchObject({
      title: 'One product',
      url: 'https://store.example.com/products/one-product',
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'localized product',
      target: 'https://store.example.com/de-de/products/black-shirt?variant=123',
      endpoint: 'https://store.example.com/de-de/products/black-shirt.js',
      type: 'product',
      feedType: undefined,
    },
    {
      name: 'collection-nested product',
      target: 'https://store.example.com/collections/shirts/products/black-shirt',
      endpoint: 'https://store.example.com/products/black-shirt.js',
      type: 'product',
      feedType: undefined,
    },
    {
      name: 'localized collection-nested product',
      target: 'https://store.example.com/fr-fr/collections/shirts/products/black-shirt',
      endpoint: 'https://store.example.com/fr-fr/products/black-shirt.js',
      type: 'product',
      feedType: undefined,
    },
    {
      name: 'collection',
      target: 'https://store.example.com/collections/shirts?sort_by=best-selling',
      endpoint: 'https://store.example.com/collections/shirts/products.json?limit=50',
      type: 'feed',
      feedType: 'collection',
    },
    {
      name: 'legacy tagged collection',
      target: 'https://store.example.com/en/collections/shirts/summer',
      endpoint: 'https://store.example.com/en/collections/shirts/products.json?limit=50',
      type: 'feed',
      feedType: 'collection',
    },
    {
      name: 'localized storefront',
      target: 'https://store.example.com/de',
      endpoint: 'https://store.example.com/de/products.json?limit=50',
      type: 'feed',
      feedType: 'catalog',
    },
    {
      name: 'localized collection index',
      target: 'https://store.example.com/fr/collections',
      endpoint: 'https://store.example.com/fr/products.json?limit=50',
      type: 'feed',
      feedType: 'catalog',
    },
  ])('selects the correct Shopify endpoint for a $name route', async ({ target, endpoint, type, feedType }) => {
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === endpoint) {
        const product = {
          id: 123,
          title: 'Black shirt',
          handle: 'black-shirt',
          vendor: 'Example Store',
          body_html: '<p>A durable shirt.</p>',
          variants: [{ id: 456, title: 'Medium', price: type === 'product' ? 2499 : '24.99', available: true }],
        };
        return new Response(JSON.stringify(type === 'product' ? product : { products: [product] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('<html><body><main><h1>Shop</h1></main><script>Shopify.theme = { id: 1 };</script></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const fetcher = fetcherMock as unknown as typeof fetch;

    const result = await extractUrl(target, { fetcher });
    const publicResult = toPublicExtractionResult(result);

    expect(fetcherMock).toHaveBeenCalledTimes(2);
    expect(fetcherMock.mock.calls[1][0].toString()).toBe(endpoint);
    expect(result).toMatchObject({ source: 'shopify', type, method: 'shopify-json' });
    if (feedType) expect(result.attributes.feedType).toBe(feedType);
    expect(publicResult).toMatchObject({ schemaVersion: 1, source: 'shopify', type });
    expect(publicResult).not.toHaveProperty('method');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it.each([
    '/blogs/news',
    '/pages/about-us',
    '/policies/privacy-policy',
    '/search?q=shirt',
  ])('keeps Shopify content route %s as an ordinary web document', async (path) => {
    const fetcher = vi.fn(async () => new Response(`
      <html><body><main><h1>Store information</h1>
      <p>This useful Shopify content page should remain a document instead of becoming a product catalog.</p>
      </main><script>Shopify.theme = { id: 1 };</script></body></html>
    `, { headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch;

    const result = await extractUrl(`https://store.example.com${path}`, { fetcher });
    const publicResult = toPublicExtractionResult(result);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: 'web', type: 'article', method: 'linkedom' });
    expect(result.content).toContain('Store information');
    expect(publicResult).toMatchObject({ schemaVersion: 1, source: 'web', type: 'article' });
    expect(publicResult).not.toHaveProperty('method');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('recognizes a myshopify.com storefront without requiring theme fingerprints', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === 'https://example-store.myshopify.com/products.json?limit=50') {
        return new Response(JSON.stringify({ products: [{
          title: 'Store product',
          handle: 'store-product',
          variants: [{ title: 'Default', price: '10.00' }],
        }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('<html><body><main><h1>Minimal storefront</h1></main></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://example-store.myshopify.com/', { fetcher });
    const publicResult = toPublicExtractionResult(result);

    expect(result).toMatchObject({ source: 'shopify', type: 'feed', method: 'shopify-json' });
    expect(publicResult).toMatchObject({ schemaVersion: 1, source: 'shopify', type: 'feed' });
    expect(publicResult).not.toHaveProperty('method');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('falls back to the submitted Shopify HTML when its structured endpoint is unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(
      input.toString().endsWith('/products/unavailable.js')
        ? 'Too many requests'
        : '<html><body><main><h1>Theme product</h1><p>This product description remains useful when the public Shopify JSON route is unavailable.</p></main><script>Shopify.theme = { id: 1 };</script></body></html>',
      input.toString().endsWith('/products/unavailable.js')
        ? { status: 429, headers: { 'Content-Type': 'text/plain' } }
        : { headers: { 'Content-Type': 'text/html' } },
    )) as unknown as typeof fetch;

    const result = await extractUrl('https://store.example.com/products/unavailable', { fetcher });
    const publicResult = toPublicExtractionResult(result);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ source: 'web', type: 'article', method: 'linkedom' });
    expect(result.content).toContain('Theme product');
    expect(publicResult).toMatchObject({ schemaVersion: 1, source: 'web', type: 'article' });
    expect(publicResult).not.toHaveProperty('method');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('extracts a normal Amazon product URL through its compact product page', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toBe('https://www.amazon.de/gp/aw/d/B012345678');
      expect(init).toMatchObject({ method: 'GET' });
      return new Response(`<!doctype html><html><head>
        <meta property="og:title" content="Fallback title">
      </head><body>
        <h1><span id="productTitle">Example coffee grinder</span></h1>
        <a id="bylineInfo">Marke: Example</a>
        <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">€19.99</span></span></div>
        <div id="averageCustomerReviews">
          <span id="acrPopover" title="4.7 out of 5 stars">4.7</span>
          <span id="acrCustomerReviewText">123 ratings</span>
        </div>
        <div id="availability"><span class="a-color-success">In stock</span></div>
        <div id="feature-bullets"><ul>
          <li><span class="a-list-item">Compact stainless steel body.</span></li>
          <li><span class="a-list-item">Adjustable grind settings.</span></li>
        </ul></div>
        <img id="landingImage" data-old-hires="https://images.example.com/grinder.jpg">
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://www.amazon.de/example-product/dp/B012345678?th=1', {
      fetcher,
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    });

    expect(result).toMatchObject({
      url: 'https://www.amazon.de/dp/B012345678',
      source: 'amazon',
      type: 'product',
      title: 'Example coffee grinder',
      author: 'Example',
      method: 'amazon-html',
    });
    expect(result.content).toContain('Price: €19.99');
    expect(result.attributes).toMatchObject({ price: 1999, currency: 'EUR', priceDisplay: '€19.99' });
    expect(result.content).toContain('Rating: 4.7 out of 5 stars — 123 ratings');
    expect(result.content).toContain('- Adjustable grind settings.');
    expect(result.content).toContain('https://images.example.com/grinder.jpg');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('reports an Amazon verification page precisely without launching a browser', async () => {
    await expect(extractUrl('https://www.amazon.com/dp/B012345678', {
      fetcher: mockFetch(
        '<html><body>Sorry, we just need to make sure you are not a robot. Enter the characters you see below.</body></html>',
        'text/html',
      ),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({
      code: 'source_blocked',
      status: 502,
      message: 'Amazon returned a verification page instead of the requested product.',
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('extracts an Amazon search URL as a product feed without launching a browser', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toBe('https://www.amazon.de/gp/aw/s?k=mechanical+keyboard');
      expect(init).toMatchObject({ method: 'GET' });
      return new Response(`<!doctype html><html><body>
        <div data-component-type="s-search-result" data-asin="B012345678">
          <h2><span>Compact mechanical keyboard</span></h2>
          <span class="a-price"><span class="a-offscreen">€49.99</span></span>
          <span class="a-icon-alt">4.6 out of 5 stars</span>
          <div data-cy="reviews-block"><span class="s-underline-text">231</span></div>
          <img class="s-image" src="https://images.example.com/keyboard.jpg">
        </div>
        <div data-component-type="s-search-result" data-asin="B087654321">
          <h2><span>Full-size mechanical keyboard</span></h2>
          <span class="a-price"><span class="a-offscreen">€79.00</span></span>
        </div>
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://www.amazon.de/keyboards/s?k=mechanical+keyboard&ref=tracked', {
      fetcher,
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    });

    expect(result).toMatchObject({
      url: 'https://www.amazon.de/s?k=mechanical+keyboard',
      source: 'amazon',
      type: 'feed',
      title: 'Amazon search: mechanical keyboard',
      method: 'amazon-search-html',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items![0]).toMatchObject({
      url: 'https://www.amazon.de/dp/B012345678',
      title: 'Compact mechanical keyboard',
    });
    expect(result.content).toContain('Price: €49.99');
    expect(result.content).toContain('Rating: 4.6 out of 5 stars');
    expect(result.content).toContain('Review count: 231');
    expect(result.items![0].attributes).toMatchObject({ price: 4999, currency: 'EUR', reviewCount: 231 });
    expect(result.content).toContain('https://images.example.com/keyboard.jpg');
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('reports an Amazon search verification page precisely without launching a browser', async () => {
    await expect(extractUrl('https://www.amazon.com/s?k=headphones', {
      fetcher: mockFetch(
        '<html><body>Sorry, we just need to make sure you are not a robot.</body></html>',
        'text/html',
      ),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => true,
    })).rejects.toMatchObject({
      code: 'source_blocked',
      status: 502,
      message: 'Amazon returned a verification page instead of search results.',
    });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });

  it('does not expose the internal extraction method publicly', async () => {
    const result = await extractUrl('https://example.com/post', {
      fetcher: mockFetch('# Public page\n\nUseful content that is long enough for native extraction.', 'text/markdown'),
    });

    expect(result.method).toBe('native-markdown');
    expect(toPublicExtractionResult(result)).not.toHaveProperty('method');
  });

  it('does not launch the browser when its limit is exhausted', async () => {
    await expect(extractUrl('https://example.com/empty', {
      fetcher: mockFetch('<html><body><div id="app"></div><script src="/app.js"></script></body></html>', 'text/html'),
      browser: { fetch: vi.fn() } as unknown as BrowserRun,
      allowBrowser: async () => false,
    })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(renderPageHtmlMock).not.toHaveBeenCalled();
  });
});
