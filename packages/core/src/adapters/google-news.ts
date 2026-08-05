import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import { normalizeCountryCode, normalizeLanguageTag } from '../options';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
});

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object' && '#text' in value) {
    return text((value as Record<string, unknown>)['#text']);
  }
  return '';
}

function isoDate(value: unknown): string | null {
  const timestamp = Date.parse(text(value));
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function locale(url: URL): { language: string; country: string; edition: string } {
  let language = 'en-US';
  let country = 'US';
  try {
    language = normalizeLanguageTag(url.searchParams.get('hl') ?? undefined, 'en-US');
    country = normalizeCountryCode(url.searchParams.get('gl') ?? undefined, 'US')!;
  } catch {
    // Ordinary submitted News URLs retain the historical English/US default
    // when their locale query parameters are not valid public controls.
  }
  const requestedEdition = url.searchParams.get('ceid') || '';
  const edition = /^[A-Z]{2}:[a-z]{2,3}$/.test(requestedEdition)
    ? requestedEdition
    : `${country}:${language.split('-', 1)[0].toLowerCase()}`;
  return { language, country, edition };
}

function endpoints(url: URL): {
  canonical: URL;
  rss: URL;
  feedType: 'search' | 'topic' | 'top_stories';
  query?: string;
  id: string | null;
} {
  const settings = locale(url);
  const canonical = new URL('/', url.origin);
  const rss = new URL('/rss', url.origin);
  let feedType: 'search' | 'topic' | 'top_stories' = 'top_stories';
  let query: string | undefined;
  let id: string | null = null;

  if (/^\/search\/?$/i.test(url.pathname)) {
    query = url.searchParams.get('q')?.replace(/\s+/g, ' ').trim();
    if (!query) throw new ExtractionError('invalid_url', 'Use a Google News search URL containing a query.', 400);
    feedType = 'search';
    canonical.pathname = '/search';
    rss.pathname = '/rss/search';
    canonical.searchParams.set('q', query);
    rss.searchParams.set('q', query);
    id = query;
  } else {
    const topicId = url.pathname.match(/^\/topics\/([A-Za-z0-9_-]+)\/?$/i)?.[1];
    if (topicId) {
      feedType = 'topic';
      canonical.pathname = `/topics/${topicId}`;
      rss.pathname = `/rss/topics/${topicId}`;
      id = topicId;
    }
  }

  for (const [key, value] of [
    ['hl', settings.language], ['gl', settings.country], ['ceid', settings.edition],
  ] as const) {
    canonical.searchParams.set(key, value);
    rss.searchParams.set(key, value);
  }
  return { canonical, rss, feedType, query, id };
}

function htmlItems(body: string, pageUrl: string): ExtractedItem[] {
  const { document } = parseHTML(body);
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];

  // The public results page repeats article links in accessibility and visual
  // controls. JtKRv is the headline link; deduplication protects the public
  // feed if Google's surrounding markup changes or repeats a story cluster.
  for (const link of document.querySelectorAll('a.JtKRv[href]')) {
    const rawUrl = link.getAttribute('href');
    const title = text(link.textContent) || null;
    if (!rawUrl || !title) continue;
    let articleUrl: string;
    try {
      articleUrl = new URL(rawUrl, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(articleUrl)) continue;

    const container = link.closest('c-wiz');
    const publisher = text(container?.querySelector('.vr1PYe')?.textContent) || null;
    const publishedAt = isoDate(container?.querySelector('time[datetime]')?.getAttribute('datetime'));
    const imageValue = container?.querySelector('img[src]')?.getAttribute('src');
    const image = imageValue ? safeUrl(new URL(imageValue, pageUrl).toString()) : null;
    const content = [
      `# ${escapeMarkdown(title)}`,
      publisher ? `Publisher: ${escapeMarkdown(publisher)}` : '',
      `[Read article](${articleUrl})`,
    ].filter(Boolean).join('\n\n');

    seen.add(articleUrl);
    items.push({
      type: 'article',
      source: 'google-news',
      id: new URL(articleUrl).pathname.split('/').filter(Boolean).at(-1) || articleUrl,
      url: articleUrl,
      title,
      author: publisher,
      publishedAt,
      content,
      media: image ? [{ type: 'image', url: image, alt: title }] : [],
      attributes: publisher ? { publisher } : {},
    });
    if (items.length === 50) break;
  }
  return items;
}

function feedResult(
  canonical: URL,
  feedType: 'search' | 'topic' | 'top_stories',
  query: string | undefined,
  id: string | null,
  title: string,
  description: string,
  items: ExtractedItem[],
  method: 'google-news-rss' | 'google-news-html' | 'google-news-browser',
): ExtractionResult {
  const content = [
    `# ${escapeMarkdown(title)}`,
    ...items.map((item) => [
      `## [${escapeMarkdown(item.title || 'News article')}](${item.url})`,
      item.author ? `Publisher: ${escapeMarkdown(item.author)}` : '',
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].join('\n\n---\n\n');
  const settings = locale(canonical);

  return {
    type: 'feed',
    source: 'google-news',
    id,
    url: canonical.toString(),
    title,
    author: null,
    publishedAt: items[0]?.publishedAt || null,
    content,
    media: [],
    attributes: {
      feedType,
      ...(query ? { query } : {}),
      ...(description ? { description } : {}),
      language: settings.language,
      country: settings.country,
    },
    items,
    method,
  };
}

export async function extractGoogleNews(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const { canonical, rss, feedType, query, id } = endpoints(url);
  const fetcher = dependencies.fetcher ?? fetch;
  const rssFetcher = dependencies.googleNewsFetcher ?? fetcher;
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'Accept-Language': locale(canonical).language,
    Referer: canonical.toString(),
  };
  const htmlEndpoint = new URL(canonical);
  // Google uses this public continuation flag after its regional consent page.
  // It avoids parsing the consent interstitial while keeping the user's
  // canonical News URL unchanged in the response.
  htmlEndpoint.searchParams.set('ucbcb', '1');
  let response;
  try {
    response = await fetchPublicPage(
      rss,
      rssFetcher,
      'application/rss+xml, application/xml, text/xml;q=0.9',
      browserHeaders,
      undefined,
      // Some data-center edges leave the feed connection open without sending
      // data. Fail over quickly to ordinary HTML instead of making callers wait
      // for the generic ten-second document timeout or paying for a browser.
      3_000,
    );
  } catch (error) {
    if (!(error instanceof ExtractionError) || !['timeout', 'upstream_error', 'source_blocked'].includes(error.code)) throw error;

    // Some source edges decline their RSS representation from data-center
    // networks. The ordinary public HTML page remains an HTTP-only fallback,
    // which is considerably cheaper than launching Browser Rendering.
    let htmlBody: string;
    let htmlUrl = canonical.toString();
    let method: 'google-news-html' | 'google-news-browser' = 'google-news-html';
    try {
      const html = await fetchPublicPage(
        htmlEndpoint,
        fetcher,
        'text/html, application/xhtml+xml;q=0.9',
        browserHeaders,
      );
      htmlBody = html.body;
      htmlUrl = html.url || htmlUrl;
    } catch (htmlError) {
      if (!dependencies.renderPageHtml) throw htmlError;
      if (dependencies.allowBrowser && !(await dependencies.allowBrowser())) {
        throw new ExtractionError('rate_limited', 'High-cost extraction rate limit exceeded.', 429, 60);
      }
      // Browser Rendering is deliberately third and last: one RSS request and
      // one regular HTML request must both fail before this billable fallback.
      htmlBody = await dependencies.renderPageHtml(htmlEndpoint);
      method = 'google-news-browser';
    }
    const items = htmlItems(htmlBody, htmlUrl);
    if (!items.length) throw new ExtractionError('not_found', 'The Google News page contains no public articles.', 404);
    return feedResult(
      canonical,
      feedType,
      query,
      id,
      query ? `Google News search: ${query}` : 'Google News',
      '',
      items,
      method,
    );
  }

  let channel: Record<string, unknown> | undefined;
  try {
    const parsed = parser.parse(response.body) as Record<string, unknown>;
    channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  } catch {
    throw new ExtractionError('upstream_error', 'Google News returned invalid public article data.', 502);
  }
  if (!channel) throw new ExtractionError('not_found', 'No public Google News content was found.', 404);

  const entries = list(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined).slice(0, 50);
  const items: ExtractedItem[] = entries.flatMap((entry) => {
    const itemUrl = safeUrl(entry.link) || safeUrl(entry.guid);
    const title = text(entry.title) || null;
    if (!itemUrl || !title) return [];
    const source = entry.source as Record<string, unknown> | string | undefined;
    const publisher = text(source) || null;
    const publisherUrl = source && typeof source === 'object' ? safeUrl(source['@_url']) : null;
    const rawDescription = text(entry.description);
    return [{
      type: 'article',
      source: 'google-news',
      id: text(entry.guid) || itemUrl,
      url: itemUrl,
      title,
      author: publisher,
      publishedAt: isoDate(entry.pubDate),
      content: htmlFragmentToMarkdown(rawDescription, itemUrl) || escapeMarkdown(rawDescription),
      media: [],
      attributes: {
        ...(publisher ? { publisher } : {}),
        ...(publisherUrl ? { publisherUrl } : {}),
      },
    }];
  });
  if (!items.length) throw new ExtractionError('not_found', 'The Google News page contains no public articles.', 404);

  const title = text(channel.title) || (query ? `Google News search: ${query}` : 'Google News');
  const description = text(channel.description);
  const result = feedResult(canonical, feedType, query, id, title, description, items, 'google-news-rss');
  result.publishedAt = isoDate(channel.lastBuildDate) || result.publishedAt;
  return result;
}
