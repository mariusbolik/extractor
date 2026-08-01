import { XMLParser } from 'fast-xml-parser';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
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
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return text((value as Record<string, unknown>)['#text']);
  return '';
}

function entryUrl(entry: Record<string, unknown>): string {
  const links = list(entry.link as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const alternate = links.find((link) => link['@_rel'] === 'alternate') ?? links[0];
  return text(alternate?.['@_href']);
}

function makeRssUrl(url: URL): URL {
  let path = url.pathname.replace(/\/+$/, '').replace(/\.rss$/i, '');
  if (!path) path = '/';
  const suffix = path === '/' ? '.rss' : `${path}/.rss`;
  return new URL(`https://www.reddit.com${suffix}`);
}

export async function extractReddit(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const isPost = /\/comments\/[a-z0-9]+/i.test(url.pathname);
  const rssUrl = makeRssUrl(url);
  const response = await fetchPublicPage(
    rssUrl,
    dependencies.fetcher ?? fetch,
    'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9',
  );

  let feed: Record<string, unknown>;
  try {
    feed = parser.parse(response.body).feed as Record<string, unknown>;
  } catch {
    throw new ExtractionError('upstream_error', 'Reddit returned an invalid public response.', 502);
  }

  if (!feed) throw new ExtractionError('not_found', 'No public Reddit content was found.', 404);
  const entries = list(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);
  if (!entries.length) throw new ExtractionError('not_found', 'The Reddit page contains no public posts.', 404);

  const items: ExtractedItem[] = entries.map((entry) => {
    const permalink = entryUrl(entry) || url.toString();
    const bodyHtml = text(entry.content);
    const author = text((entry.author as Record<string, unknown> | undefined)?.name).trim() || null;
    return {
      type: 'post',
      source: 'reddit',
      id: permalink.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? null,
      url: permalink,
      title: text(entry.title).trim() || null,
      author,
      publishedAt: text(entry.updated).trim() || text(entry.published).trim() || null,
      content: htmlFragmentToMarkdown(bodyHtml, permalink),
      media: [],
      attributes: author ? { handle: author } : {},
    };
  });

  if (isPost) {
    const item = items[0];
    const content = [
      item.title ? `# ${escapeMarkdown(item.title)}` : '# Reddit post',
      item.content,
      `[View on Reddit](${item.url})`,
    ].filter(Boolean).join('\n\n');
    return {
      ...item,
      content,
      method: 'reddit-rss',
    };
  }

  const title = text(feed.title).trim() || 'Reddit feed';
  const content = [
    `# ${escapeMarkdown(title)}`,
    ...items.map((item) => [
      `## [${escapeMarkdown(item.title || 'Untitled post')}](${item.url})`,
      item.author ? `By ${escapeMarkdown(item.author)}` : '',
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].join('\n\n---\n\n');

  return {
    type: 'feed',
    url: url.toString(),
    source: 'reddit',
    id: url.pathname.match(/^\/(?:r|u|user)\/([^/]+)/i)?.[1] ?? null,
    title,
    author: null,
    publishedAt: text(feed.updated).trim() || null,
    content,
    media: [],
    attributes: { feedType: /\/r\//i.test(url.pathname) ? 'community' : 'profile' },
    items,
    method: 'reddit-rss',
  };
}
