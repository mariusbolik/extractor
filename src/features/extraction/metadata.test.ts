import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractPageMetadataFromDocument, extractPreviewMedia } from './metadata';

describe('extractPreviewMedia', () => {
  it('prefers a publisher social image and preserves its useful metadata', () => {
    const media = extractPreviewMedia(`
      <meta property="og:image" content="/images/story.jpg">
      <meta property="og:image:alt" content="The story cover">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
    `, 'https://example.com/posts/story', 'The story');

    expect(media).toEqual([{
      type: 'image',
      url: 'https://example.com/images/story.jpg',
      alt: 'The story cover',
      width: 1200,
      height: 630,
    }]);
  });

  it('rejects a favicon-shaped OG image and selects the title-matched article hero', () => {
    const title = 'Dr. Jasmin Last über die Perimenopause';
    const media = extractPreviewMedia(`
      <html><head><meta property="og:image" content="/favicon.ico"></head><body>
        <nav><img src="/brand-wordmark.png" alt="Publisher" width="240" height="60"></nav>
        <section>
          <h1>${title}</h1>
          <img
            src="https://cdn.example.net/article-cover?width=792&amp;height=412&amp;format=webp"
            alt="${title}"
            width="792"
            height="412"
          >
          <p>This useful article contains enough readable content for extraction.</p>
        </section>
      </body></html>
    `, 'https://example.com/magazin/perimenopause', title);

    expect(media).toEqual([{
      type: 'image',
      url: 'https://cdn.example.net/article-cover?width=792&height=412&format=webp',
      alt: title,
      width: 792,
      height: 412,
    }]);
  });

  it('ignores unsafe and non-public media URLs', () => {
    expect(extractPreviewMedia(
      '<meta property="og:image" content="http://127.0.0.1/private.png">',
      'https://example.com/article',
    )).toEqual([]);
  });
});

describe('extractPageMetadataFromDocument', () => {
  it('normalizes useful deep-page dates and non-URL authors', () => {
    const { document } = parseHTML(`<html><head>
      <meta property="og:title" content="A structured article">
      <meta property="og:description" content="A sufficiently detailed publisher summary that provides useful context when the body itself cannot be read.">
      <meta property="article:published_time" content="2026-07-30T12:15:00+02:00">
      <meta name="author" content="Ada Example">
    </head></html>`);

    expect(extractPageMetadataFromDocument(
      document as unknown as Document,
      'https://example.com/articles/structured',
    )).toEqual({
      title: 'A structured article',
      author: 'Ada Example',
      publishedAt: '2026-07-30T10:15:00.000Z',
      description: 'A sufficiently detailed publisher summary that provides useful context when the body itself cannot be read.',
    });
  });

  it('rejects misleading homepage dates and URL-shaped authors', () => {
    const { document } = parseHTML(`<html><head>
      <meta property="og:title" content="Example homepage">
      <meta property="article:published_time" content="2020-01-01T00:00:00Z">
      <meta name="author" content="https://example.com/about/">
    </head></html>`);

    expect(extractPageMetadataFromDocument(
      document as unknown as Document,
      'https://example.com/',
    )).toMatchObject({ author: null, publishedAt: null });
  });
});
