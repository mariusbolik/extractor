import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';
import { validateTargetUrl } from '../url';
import { isLikelyBlogListingUrl } from './blog-listing';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
});

const MAX_INFERRED_FEED_REQUESTS = 4;
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.8, application/json;q=0.7';
const CONTENT_SECTION_SEGMENTS = new Set([
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
const KNOWN_PUBLISHER_FEEDS: Readonly<Record<string, readonly string[]>> = {
  'openai.com': ['https://openai.com/news/rss.xml'],
  'www.openai.com': ['https://openai.com/news/rss.xml'],
};

interface DiscoveryCandidate {
  href: string;
  type: string;
}

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return text((value as Record<string, unknown>)['#text']);
  }
  return '';
}

function isoDate(value: unknown): string | null {
  const timestamp = Date.parse(text(value));
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function safeDiscoveredUrl(href: string, pageUrl: string): URL | null {
  try {
    // Discovered endpoints are untrusted input too. Run them through the same
    // target policy before issuing any follow-up request.
    return validateTargetUrl(new URL(href, pageUrl).toString());
  } catch {
    return null;
  }
}

function linkHref(entry: Record<string, unknown>): string {
  const links = list(entry.link as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const alternate = links.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate') || links[0];
  return text(alternate?.['@_href'] || alternate || entry.guid).trim();
}

function xmlFeedResult(body: string, pageUrl: string): ExtractionResult | null {
  const parsed = parser.parse(body) as Record<string, unknown>;
  const rssChannel = (parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const atomFeed = parsed.feed as Record<string, unknown> | undefined;
  const feed = rssChannel || atomFeed;
  if (!feed) return null;

  const entries = rssChannel
    ? list(feed.item as Record<string, unknown> | Record<string, unknown>[] | undefined)
    : list(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const items: ExtractedItem[] = entries.slice(0, 50).map((entry) => {
    const rawContent = text(entry['content:encoded'] || entry.content || entry.description || entry.summary);
    const itemUrl = rssChannel ? text(entry.link).trim() || text(entry.guid).trim() : linkHref(entry);
    const authorValue = entry.author as Record<string, unknown> | string | undefined;
    return {
      type: 'article',
      source: 'web',
      id: text(entry.guid).trim() || null,
      url: itemUrl || pageUrl,
      title: text(entry.title).trim() || null,
      author: text(typeof authorValue === 'object' ? authorValue?.name : authorValue).trim() || null,
      publishedAt: isoDate(entry.pubDate || entry.published || entry.updated),
      content: htmlFragmentToMarkdown(rawContent, itemUrl || pageUrl) || escapeMarkdown(rawContent),
      media: [],
      attributes: {},
    };
  });
  if (!items.length) return null;

  const title = text(feed.title).trim() || null;
  const content = [
    title ? `# ${escapeMarkdown(title)}` : '',
    ...items.map((item) => [
      `## [${escapeMarkdown(item.title || 'Entry')}](${item.url})`,
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].filter(Boolean).join('\n\n---\n\n');

  return {
    type: 'feed',
    url: pageUrl,
    source: 'web',
    id: null,
    title,
    author: null,
    publishedAt: items[0]?.publishedAt ?? null,
    content,
    media: [],
    attributes: {
      feedType: 'publisher',
      ...(text(feed.description).trim() ? { description: text(feed.description).trim() } : {}),
    },
    items,
    method: 'discovered-feed',
  };
}

function jsonFeedResult(body: string, pageUrl: string): ExtractionResult | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!String(data.version || '').startsWith('https://jsonfeed.org/version/')) return null;

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: ExtractedItem[] = rawItems.slice(0, 50).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const entry = value as Record<string, unknown>;
    const itemUrl = typeof entry.url === 'string'
      ? entry.url
      : typeof entry.external_url === 'string'
        ? entry.external_url
        : pageUrl;
    const rawContent = typeof entry.content_html === 'string'
      ? entry.content_html
      : typeof entry.content_text === 'string'
        ? entry.content_text
        : typeof entry.summary === 'string'
          ? entry.summary
          : '';
    const authors = Array.isArray(entry.authors) ? entry.authors : entry.author ? [entry.author] : [];
    const firstAuthor = authors[0] && typeof authors[0] === 'object'
      ? authors[0] as Record<string, unknown>
      : null;
    return [{
      type: 'article',
      source: 'web',
      id: typeof entry.id === 'string' ? entry.id : null,
      url: itemUrl,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : null,
      author: typeof firstAuthor?.name === 'string' && firstAuthor.name.trim() ? firstAuthor.name.trim() : null,
      publishedAt: isoDate(entry.date_published || entry.date_modified),
      content: typeof entry.content_html === 'string'
        ? htmlFragmentToMarkdown(rawContent, itemUrl)
        : escapeMarkdown(rawContent),
      media: [],
      attributes: {},
    } satisfies ExtractedItem];
  });
  if (!items.length) return null;

  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const content = [
    title ? `# ${escapeMarkdown(title)}` : '',
    ...items.map((item) => [
      `## [${escapeMarkdown(item.title || 'Entry')}](${item.url})`,
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].filter(Boolean).join('\n\n---\n\n');

  return {
    type: 'feed',
    url: pageUrl,
    source: 'web',
    id: null,
    title,
    author: null,
    publishedAt: items[0]?.publishedAt ?? null,
    content,
    media: [],
    attributes: {
      feedType: 'publisher',
      ...(description ? { description } : {}),
    },
    items,
    method: 'discovered-feed',
  };
}

function feedResult(body: string, pageUrl: string): ExtractionResult | null {
  const firstCharacter = body.trimStart()[0];
  return firstCharacter === '{' || firstCharacter === '['
    ? jsonFeedResult(body, pageUrl)
    : xmlFeedResult(body, pageUrl);
}

function oembedResult(body: string, pageUrl: string): ExtractionResult | null {
  const data = JSON.parse(body) as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const author = typeof data.author_name === 'string' ? data.author_name.trim() : '';
  const html = typeof data.html === 'string' ? data.html : '';
  const thumbnail = typeof data.thumbnail_url === 'string' ? data.thumbnail_url : '';
  const contentBody = htmlFragmentToMarkdown(html, pageUrl);
  const content = [
    title ? `# ${escapeMarkdown(title)}` : '',
    contentBody,
    thumbnail ? `![${escapeMarkdown(title || 'Preview')}](${thumbnail})` : '',
    `[View source](${pageUrl})`,
  ].filter(Boolean).join('\n\n');
  if (!contentBody && !title && !thumbnail) return null;

  return {
    type: 'document',
    url: pageUrl,
    source: 'web',
    id: null,
    title: title || null,
    author: author || null,
    publishedAt: null,
    content,
    media: thumbnail ? [{ type: 'image', url: thumbnail, alt: title || 'Preview' }] : [],
    attributes: {},
    method: 'oembed',
  };
}

function wordpressResult(body: string, pageUrl: string): ExtractionResult | null {
  const data = JSON.parse(body) as Record<string, unknown>;
  const rendered = (value: unknown): string => {
    if (!value || typeof value !== 'object') return '';
    const output = (value as Record<string, unknown>).rendered;
    return typeof output === 'string' ? output : '';
  };
  const title = htmlFragmentToMarkdown(rendered(data.title), pageUrl).replace(/^#+\s*/, '').trim();
  const bodyMarkdown = htmlFragmentToMarkdown(rendered(data.content), pageUrl);
  if (!bodyMarkdown) return null;
  const canonicalUrl = typeof data.link === 'string' ? data.link : pageUrl;

  return {
    type: 'article',
    url: canonicalUrl,
    source: 'web',
    id: typeof data.id === 'number' || typeof data.id === 'string' ? String(data.id) : null,
    title: title || null,
    author: null,
    publishedAt: isoDate(data.date_gmt || data.date),
    content: [title ? `# ${title}` : '', bodyMarkdown].filter(Boolean).join('\n\n'),
    media: [],
    attributes: {},
    method: 'wordpress-json',
  };
}

function httpLinkCandidates(header: string | null | undefined): DiscoveryCandidate[] {
  if (!header) return [];
  const candidates: DiscoveryCandidate[] = [];
  for (const match of header.matchAll(/<([^>]+)>([^,]*)(?:,|$)/g)) {
    const parameters = match[2] || '';
    const relation = parameters.match(/;\s*rel\s*=\s*"?([^";]+)"?/i)?.[1] || '';
    if (!relation.toLowerCase().split(/\s+/).includes('alternate')) continue;
    const type = parameters.match(/;\s*type\s*=\s*"?([^";,\s]+)"?/i)?.[1]?.toLowerCase() || '';
    candidates.push({ href: match[1] || '', type });
  }
  return candidates;
}

function isFeedCandidate({ href, type }: DiscoveryCandidate): boolean {
  return type === 'application/rss+xml'
    || type === 'application/atom+xml'
    || type === 'application/feed+json'
    || (type === 'application/json' && /(?:^|[/.?_-])feed(?:[/.?_-]|$)/i.test(href));
}

function normalizedCanonicalUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return `${url.host.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function matchingFeedItem(feed: ExtractionResult, requestedUrl: string): ExtractionResult | null {
  const target = normalizedCanonicalUrl(requestedUrl, requestedUrl);
  if (!target) return null;
  const item = feed.items?.find((candidate) => normalizedCanonicalUrl(candidate.url, requestedUrl) === target);
  if (!item) return null;
  return {
    ...item,
    method: 'discovered-feed',
  };
}

function inferredFeedCandidates(url: URL): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  const add = (href: string, type = '') => {
    const absolute = new URL(href, url.origin).toString();
    if (seen.has(absolute)) return;
    seen.add(absolute);
    candidates.push({ href: absolute, type });
  };

  for (const href of KNOWN_PUBLISHER_FEEDS[url.hostname.toLowerCase()] || []) add(href);

  const firstSegment = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
  const sectionLike = CONTENT_SECTION_SEGMENTS.has(firstSegment);
  const publisherHost = /^(?:blog|news|press)\./i.test(url.hostname);
  if (sectionLike) {
    add(`/${firstSegment}/rss.xml`);
    add(`/${firstSegment}/feed`);
  }
  if (sectionLike || publisherHost) {
    add('/feed');
    add('/rss.xml');
    add('/feed.xml');
    add('/atom.xml');
    add('/feed.json');
  }
  return candidates;
}

export async function extractDiscoveredAlternative(
  html: string,
  pageUrl: string,
  dependencies: ExtractionDependencies,
  linkHeader?: string | null,
): Promise<ExtractionResult | null> {
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll('link[rel~="alternate"][href]')];
  const candidates: DiscoveryCandidate[] = links.map((link) => ({
    href: link.getAttribute('href') || '',
    type: (link.getAttribute('type') || '').toLowerCase().split(';', 1)[0],
  })).concat(httpLinkCandidates(linkHeader));
  const wordpress = candidates.find(({ href, type }) => type === 'application/json' && /\/wp-json\/wp\/v2\/(?:posts|pages)\//i.test(href));
  const oembed = candidates.find(({ type }) => type === 'application/json+oembed' || type === 'text/json+oembed');
  const feed = candidates.find(isFeedCandidate);

  // These are rescue paths, not extra enrichment calls. Try at most one URL of
  // each advertised type, and stop as soon as useful public content is found.
  for (const candidate of [wordpress, oembed, feed]) {
    if (!candidate) continue;
    const endpoint = safeDiscoveredUrl(candidate.href, pageUrl);
    if (!endpoint) continue;
    try {
      const response = await fetchPublicPage(endpoint, dependencies.fetcher ?? fetch);
      if (candidate === wordpress) {
        const result = wordpressResult(response.body, pageUrl);
        if (result) return result;
      } else if (candidate === oembed) {
        const result = oembedResult(response.body, pageUrl);
        if (result) return result;
      } else {
        const result = feedResult(response.body, pageUrl);
        if (result) return result;
      }
    } catch (error) {
      console.warn('Advertised extraction endpoint failed', {
        type: candidate.type,
        name: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  return null;
}

export async function extractInferredFeedAlternative(
  pageUrl: string,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult | null> {
  const url = new URL(pageUrl);
  const listingPage = isLikelyBlogListingUrl(url);
  const candidates = inferredFeedCandidates(url).slice(0, MAX_INFERRED_FEED_REQUESTS);
  for (const candidate of candidates) {
    const endpoint = safeDiscoveredUrl(candidate.href, pageUrl);
    if (!endpoint) continue;
    try {
      const response = await fetchPublicPage(
        endpoint,
        dependencies.fetcher ?? fetch,
        FEED_ACCEPT,
      );
      const feed = feedResult(response.body, pageUrl);
      if (!feed) continue;
      if (listingPage) return feed;
      const match = matchingFeedItem(feed, pageUrl);
      if (match) return match;
    } catch {
      // Inferred endpoints are optional and bounded. Preserve the original
      // page error when a guess is absent, invalid, or unavailable.
    }
  }
  return null;
}
