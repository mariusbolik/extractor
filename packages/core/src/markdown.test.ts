import { describe, expect, it } from 'vitest';
import { extractMarkdownFromHtml, htmlFragmentToMarkdown } from './markdown';

describe('HTML to Markdown', () => {
  it('extracts readable content, strips noise, and resolves relative links', () => {
    const html = `
      <html>
        <head><title>A useful article</title><style>.bad{}</style></head>
        <body>
          <nav>Navigation noise</nav>
          <article>
            <h1>A useful article</h1>
            <p>This article contains enough meaningful words for the readability fallback to keep it.</p>
            <p><a href="/source">Read the original source</a> and continue learning from it.</p>
          </article>
          <script>alert('bad')</script>
        </body>
      </html>`;

    const result = extractMarkdownFromHtml(html, 'https://example.com/posts/one');
    expect(result.content).toContain('# A useful article');
    expect(result.content).toContain('https://example.com/source');
    expect(result.content).not.toContain('Navigation noise');
    expect(result.content).not.toContain('alert');
  });

  it('converts feed HTML fragments', () => {
    expect(htmlFragmentToMarkdown('<p>Hello <a href="/world">world</a>.</p>', 'https://example.com/base')).toBe(
      'Hello [world](https://example.com/world).',
    );
  });

  it('keeps inline image labels without serializing embedded data', () => {
    const markdown = htmlFragmentToMarkdown(
      '<p><img alt="Marketplace logo" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="></p><p>Useful listing details.</p>',
      'https://example.com/',
    );

    expect(markdown).toContain('Marketplace logo');
    expect(markdown).toContain('Useful listing details');
    expect(markdown).not.toContain('data:image');
    expect(markdown).not.toContain('PHN2');
  });

  it('selects a requested landing-page section instead of an unrelated code demo', () => {
    const html = `
      <html><head><title>Search API</title></head><body>
        <div id="demo"><h1>Search API</h1><pre>{ "organic": ["a very long API response"] }</pre></div>
        <div id="pricing">
          <h2>Simple pricing</h2>
          <h3>Starter</h3><p>$50 for 50,000 queries at $1.00 per 1,000.</p>
          <h3>Scale</h3><p>$1,250 for 2.5 million queries at $0.50 per 1,000.</p>
        </div>
      </body></html>`;

    const result = extractMarkdownFromHtml(html, 'https://example.com/', 'pricing');
    expect(result.content).toContain('Simple pricing');
    expect(result.content).toContain('$0.50 per 1,000');
    expect(result.content).not.toContain('organic');
  });

  it('ignores an oversized sales popup and keeps substantive pricing', () => {
    const html = `
      <html><head>
        <title>Proxy pricing</title>
        <meta name="description" content="Plans start at $2.99 per month for 100 proxies.">
      </head><body>
        <div class="pop-up_wrapper">
          <h2>Enterprise sales</h2>
          <p>This oversized dialog is intentionally long enough to look like the primary readable content.</p>
          <form><label>Name <input name="name"></label><button>Contact sales</button></form>
        </div>
        <main>
          <h1>Proxy pricing</h1>
          <section><h2>Free</h2><p>10 proxies with 1 GB monthly bandwidth for $0.</p></section>
          <section><h2>Starter</h2><p>100 proxies for $2.99 billed monthly.</p></section>
          <section><h2>Residential</h2><p>Residential traffic starts at $1.40 per GB.</p></section>
        </main>
      </body></html>`;

    const result = extractMarkdownFromHtml(html, 'https://example.com/pricing');
    expect(result.content).toContain('100 proxies for $2.99');
    expect(result.content).toContain('starts at $1.40 per GB');
    expect(result.content).not.toContain('Enterprise sales');
    expect(result.description).toBe('Plans start at $2.99 per month for 100 proxies.');
  });
});
