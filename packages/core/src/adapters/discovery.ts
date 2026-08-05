import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';
import { validateTargetUrl } from '../url';

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

function feedResult(body: string, pageUrl: string): ExtractionResult | null {
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

export async function extractDiscoveredAlternative(
  html: string,
  pageUrl: string,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult | null> {
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll('link[rel~="alternate"][href]')];
  const candidates = links.map((link) => ({
    href: link.getAttribute('href') || '',
    type: (link.getAttribute('type') || '').toLowerCase().split(';', 1)[0],
  }));
  const wordpress = candidates.find(({ href, type }) => type === 'application/json' && /\/wp-json\/wp\/v2\/(?:posts|pages)\//i.test(href));
  const oembed = candidates.find(({ type }) => type === 'application/json+oembed' || type === 'text/json+oembed');
  const feed = candidates.find(({ type }) => type === 'application/rss+xml' || type === 'application/atom+xml');

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
