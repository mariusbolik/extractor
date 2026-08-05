import { XMLParser } from 'fast-xml-parser';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
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

function videoId(url: URL): string | null {
  if (url.hostname.toLowerCase() === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/)?.[1] ?? null;
}

async function extractVideo(
  id: string,
  fetcher: typeof fetch,
): Promise<ExtractionResult> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${id}`;
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', canonicalUrl);
  endpoint.searchParams.set('format', 'json');
  const response = await fetchPublicPage(endpoint, fetcher, 'application/json');

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new ExtractionError('upstream_error', 'YouTube returned invalid video metadata.', 502);
  }

  const title = text(data.title).trim() || 'YouTube video';
  const author = text(data.author_name).trim() || null;
  const thumbnail = text(data.thumbnail_url).trim();
  const content = [
    `# ${escapeMarkdown(title)}`,
    author ? `By ${escapeMarkdown(author)}` : '',
    thumbnail ? `![Video thumbnail](${thumbnail})` : '',
    `[Watch on YouTube](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'video',
    url: canonicalUrl,
    source: 'youtube',
    id,
    title,
    author,
    publishedAt: null,
    content,
    media: thumbnail ? [{ type: 'image', url: thumbnail, alt: 'Video thumbnail' }] : [],
    attributes: {},
    method: 'youtube-oembed',
  };
}

async function resolveFeedUrl(url: URL, fetcher: typeof fetch): Promise<URL> {
  const playlist = url.searchParams.get('list');
  if (playlist) return new URL(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist)}`);

  const channelId = url.pathname.match(/^\/channel\/([^/]+)/)?.[1];
  if (channelId) return new URL(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);

  const legacyUser = url.pathname.match(/^\/user\/([^/]+)/)?.[1];
  if (legacyUser) return new URL(`https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(legacyUser)}`);

  if (/^\/@[^/]+/.test(url.pathname)) {
    const page = await fetchPublicPage(url, fetcher, 'text/html');
    const discovered = page.body.match(/"channelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/)?.[1]
      ?? page.body.match(/itemprop="channelId"\s+content="(UC[A-Za-z0-9_-]+)"/)?.[1]
      ?? page.body.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/)?.[1]
      ?? page.body.match(/"browseId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/)?.[1];
    if (discovered) return new URL(`https://www.youtube.com/feeds/videos.xml?channel_id=${discovered}`);
  }

  throw new ExtractionError('invalid_url', 'Use a YouTube video, playlist, channel, user, or handle URL.', 400);
}

export async function extractYouTube(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const id = videoId(url);
  if (id) return extractVideo(id, fetcher);

  const feedUrl = await resolveFeedUrl(url, fetcher);
  const response = await fetchPublicPage(
    feedUrl,
    fetcher,
    'application/atom+xml, application/xml, text/xml;q=0.9',
  );

  let feed: Record<string, unknown>;
  try {
    feed = parser.parse(response.body).feed as Record<string, unknown>;
  } catch {
    throw new ExtractionError('upstream_error', 'YouTube returned an invalid public response.', 502);
  }

  if (!feed) throw new ExtractionError('not_found', 'No public YouTube content was found.', 404);
  const entries = list(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);
  if (!entries.length) throw new ExtractionError('not_found', 'The YouTube page contains no public videos.', 404);

  const items: ExtractedItem[] = entries.map((entry) => {
    const media = (entry['media:group'] ?? {}) as Record<string, unknown>;
    const linkNodes = list(entry.link as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const link = linkNodes.find((candidate) => candidate['@_rel'] === 'alternate') ?? linkNodes[0];
    const itemUrl = text(link?.['@_href']) || `https://www.youtube.com/watch?v=${text(entry['yt:videoId'])}`;
    const itemTitle = text(media['media:title']).trim() || text(entry.title).trim() || null;
    const itemAuthor = text((entry.author as Record<string, unknown> | undefined)?.name).trim() || null;
    const description = text(media['media:description']).trim();
    const thumbnailNode = list(media['media:thumbnail'] as Record<string, unknown> | Record<string, unknown>[] | undefined)[0];
    const thumbnail = text(thumbnailNode?.['@_url']);
    return {
      type: 'video',
      source: 'youtube',
      id: text(entry['yt:videoId']) || itemUrl.match(/[?&]v=([^&]+)/)?.[1] || null,
      url: itemUrl,
      title: itemTitle,
      author: itemAuthor,
      publishedAt: text(entry.published).trim() || null,
      content: [
        description ? escapeMarkdown(description) : '',
        thumbnail ? `![Video thumbnail](${thumbnail})` : '',
      ].filter(Boolean).join('\n\n'),
      media: thumbnail ? [{ type: 'image', url: thumbnail, alt: itemTitle || 'Video thumbnail' }] : [],
      attributes: {},
    };
  });

  const title = text(feed.title).trim() || 'YouTube feed';
  const author = text((feed.author as Record<string, unknown> | undefined)?.name).trim() || null;
  const content = [
    `# ${escapeMarkdown(title)}`,
    ...items.map((item) => [
      `## [${escapeMarkdown(item.title || 'Untitled video')}](${item.url})`,
      item.author ? `By ${escapeMarkdown(item.author)}` : '',
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].join('\n\n---\n\n');

  return {
    type: 'feed',
    url: url.toString(),
    source: 'youtube',
    id: url.searchParams.get('list') || url.pathname.match(/^\/(?:channel|user)\/([^/]+)/)?.[1] || null,
    title,
    author,
    publishedAt: text(feed.updated).trim() || null,
    content,
    media: [],
    attributes: {
      feedType: url.searchParams.get('list') ? 'playlist' : 'channel',
    },
    items,
    method: 'youtube-atom',
  };
}
