import { parseHTML } from 'linkedom';
import { escapeMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionResult } from '../types';

const BLOG_SECTION_SEGMENTS = new Set([
  'articles',
  'blog',
  'insights',
  'journal',
  'marketing',
  'news',
  'press',
  'resources',
  'sales',
  'service',
  'updates',
  'website',
]);
const LISTING_SEGMENTS = new Set(['category', 'page', 'tag', 'topics']);

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function publicUrl(value: string | null | undefined, pageUrl: URL, sameHost = true): URL | null {
  if (!value || /^(?:javascript:|mailto:|tel:|#)/i.test(value.trim())) return null;
  try {
    const url = new URL(value, pageUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (sameHost && url.hostname.toLowerCase() !== pageUrl.hostname.toLowerCase()) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function isoDate(value: string | null | undefined): string | null {
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

/** Restrict generic listing parsing to recognizable blog and publisher routes. */
export function isLikelyBlogListingUrl(url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  const publisherHost = /^(?:blog|news|press)\./i.test(url.hostname);
  if (segments.length === 0) return publisherHost;
  if (segments.length === 1) return BLOG_SECTION_SEGMENTS.has(segments[0]!)
    || (publisherHost && LISTING_SEGMENTS.has(segments[0]!));
  if (segments.length === 2 && publisherHost && LISTING_SEGMENTS.has(segments[0]!)) return true;
  return segments.length === 3
    && BLOG_SECTION_SEGMENTS.has(segments[0]!)
    && segments[1] === 'page'
    && /^\d+$/.test(segments[2]!);
}

function itemFromHeading(heading: Element, pageUrl: URL): ExtractedItem | null {
  const anchor = heading.matches('a[href]') ? heading : heading.querySelector('a[href]');
  const url = publicUrl(anchor?.getAttribute('href'), pageUrl);
  if (!anchor || !url || url.toString() === pageUrl.toString()) return null;

  const title = clean(anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent);
  if (title.length < 8 || /^(?:learn more|read more|view all|see all|more)$/i.test(title)) return null;

  const container = anchor.closest('article, li, [itemtype$="/Article"], [itemtype$="/BlogPosting"]')
    || heading.parentElement?.parentElement
    || heading.parentElement
    || heading;
  const description = clean(
    container.querySelector('[itemprop="description"], [class*="description"], [class*="excerpt"], [class*="summary"]')?.textContent,
  );
  const author = clean(
    container.querySelector('[rel="author"], [itemprop="author"], [class*="author"]')?.textContent,
  ) || null;
  const publishedAt = isoDate(
    container.querySelector('time[datetime]')?.getAttribute('datetime')
      || container.querySelector('[itemprop="datePublished"]')?.getAttribute('content'),
  );
  const image = container.querySelector('img[src], img[data-src]');
  const imageUrl = publicUrl(image?.getAttribute('src') || image?.getAttribute('data-src'), pageUrl, false);
  const width = Number(image?.getAttribute('width'));
  const height = Number(image?.getAttribute('height'));
  const media = imageUrl ? [{
    type: 'image' as const,
    url: imageUrl.toString(),
    alt: clean(image?.getAttribute('alt')) || title,
    ...(Number.isSafeInteger(width) && width > 0 ? { width } : {}),
    ...(Number.isSafeInteger(height) && height > 0 ? { height } : {}),
  }] : [];
  const content = [
    `# ${escapeMarkdown(title)}`,
    description ? escapeMarkdown(description) : '',
    `[Read article](${url})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'article',
    source: 'web',
    id: url.pathname.split('/').filter(Boolean).at(-1) || null,
    url: url.toString(),
    title,
    author,
    publishedAt,
    content,
    media,
    attributes: description ? { description } : {},
  };
}

/** Normalize repeated, server-rendered blog cards without another request. */
export function extractBlogListingFromHtml(html: string, pageUrl: URL): ExtractionResult | null {
  if (!isLikelyBlogListingUrl(pageUrl)) return null;
  const { document } = parseHTML(html);
  const scope = document.querySelector('main') || document;
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];

  for (const heading of scope.querySelectorAll('h2, h3, h4, [itemprop="headline"]')) {
    const item = itemFromHeading(heading, pageUrl);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
    if (items.length === 50) break;
  }
  // Multiple unique cards distinguish a listing from a single article whose
  // body happens to contain a related-story heading.
  if (items.length < 2) return null;

  const title = clean(document.querySelector('main h1, h1')?.textContent)
    || clean(document.title)
    || 'Blog posts';
  return {
    type: 'feed',
    source: 'web',
    id: null,
    url: pageUrl.toString(),
    title,
    author: null,
    publishedAt: items.find((item) => item.publishedAt)?.publishedAt ?? null,
    content: [`# ${escapeMarkdown(title)}`, ...items.map((item) => item.content)].join('\n\n---\n\n'),
    media: [],
    attributes: { feedType: 'publisher', resultCount: items.length },
    items,
    method: 'blog-list-html',
  };
}
