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

function decodeNumericEntities(value: string): string {
  return value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (entity, hexadecimal, decimal) => {
    const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
    try {
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    } catch {
      return entity;
    }
  });
}

function text(value: unknown): string {
  if (typeof value === 'string') return decodeNumericEntities(value);
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return text((value as Record<string, unknown>)['#text']);
  }
  return '';
}

function isoDate(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function profileActor(url: URL): string {
  const encoded = url.pathname.match(/^\/profile\/([^/]+)\/?$/i)?.[1];
  if (!encoded) throw new ExtractionError('invalid_url', 'Use a public Bluesky profile URL.', 400);
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new ExtractionError('invalid_url', 'Use a valid public Bluesky profile URL.', 400);
  }
}

function rssUrl(actor: string): URL {
  return new URL(`https://bsky.app/profile/${encodeURIComponent(actor)}/rss`);
}

function postParts(url: URL): { actor: string; rkey: string } {
  const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/i);
  if (!match) throw new ExtractionError('invalid_url', 'Use a public Bluesky post URL.', 400);
  try {
    return { actor: decodeURIComponent(match[1]), rkey: decodeURIComponent(match[2]) };
  } catch {
    throw new ExtractionError('invalid_url', 'Use a valid public Bluesky post URL.', 400);
  }
}

function recordText(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const value = (record as Record<string, unknown>).text;
  return typeof value === 'string' ? value : '';
}

function nonNegativeCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function postHashtags(record: Record<string, unknown>): string[] {
  const values = new Set<string>();
  for (const tag of list(record.tags as string[] | undefined)) {
    if (typeof tag === 'string' && tag.trim()) values.add(tag.trim().replace(/^#/, ''));
  }
  for (const facet of list(record.facets as Record<string, unknown>[] | undefined)) {
    for (const feature of list(facet.features as Record<string, unknown>[] | undefined)) {
      const tag = typeof feature.tag === 'string' ? feature.tag.trim().replace(/^#/, '') : '';
      if (tag) values.add(tag);
    }
  }
  return [...values].slice(0, 50);
}

function embeddedSections(embed: unknown): string[] {
  if (!embed || typeof embed !== 'object') return [];
  const value = embed as Record<string, unknown>;
  const sections: string[] = [];

  const external = value.external as Record<string, unknown> | undefined;
  if (external && typeof external.uri === 'string') {
    const label = typeof external.title === 'string' && external.title.trim()
      ? external.title
      : external.uri;
    sections.push(`[${escapeMarkdown(label)}](${external.uri})`);
    if (typeof external.description === 'string' && external.description.trim()) {
      sections.push(escapeMarkdown(external.description));
    }
  }

  for (const image of list(value.images as Record<string, unknown>[] | undefined)) {
    const imageUrl = typeof image.fullsize === 'string' ? image.fullsize : image.thumb;
    if (typeof imageUrl === 'string') {
      sections.push(`![${escapeMarkdown(typeof image.alt === 'string' ? image.alt : 'Post image')}](${imageUrl})`);
    }
  }

  if (typeof value.playlist === 'string') sections.push(`[View attached video](${value.playlist})`);

  const quoted = value.record as Record<string, unknown> | undefined;
  const quotedPost = quoted?.record as Record<string, unknown> | undefined;
  const quotedBody = recordText(quotedPost?.value);
  if (quotedBody) {
    const quotedAuthor = quotedPost?.author as Record<string, unknown> | undefined;
    const handle = typeof quotedAuthor?.handle === 'string' ? `@${quotedAuthor.handle}` : 'Quoted post';
    sections.push(`> ${escapeMarkdown(handle)}: ${escapeMarkdown(quotedBody).replace(/\n/g, '\n> ')}`);
  }

  return sections;
}

export async function extractBlueskyPost(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const { actor, rkey } = postParts(url);
  const endpoint = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread');
  // The public AppView accepts a handle in the AT URI and resolves it itself.
  // depth=0 and parentHeight=0 deliberately exclude replies and parent posts.
  endpoint.searchParams.set('uri', `at://${actor}/app.bsky.feed.post/${rkey}`);
  endpoint.searchParams.set('depth', '0');
  endpoint.searchParams.set('parentHeight', '0');

  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'application/json',
  );

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new ExtractionError('upstream_error', 'Bluesky returned invalid post data.', 502);
  }

  const thread = payload.thread as Record<string, unknown> | undefined;
  const post = thread?.post as Record<string, unknown> | undefined;
  const record = post?.record as Record<string, unknown> | undefined;
  const authorData = post?.author as Record<string, unknown> | undefined;
  const body = recordText(record);
  const handle = typeof authorData?.handle === 'string' ? authorData.handle : actor;
  if (!post || !body) throw new ExtractionError('not_found', 'The Bluesky post is unavailable or deleted.', 404);

  const displayName = typeof authorData?.displayName === 'string' ? authorData.displayName.trim() : '';
  const author = displayName ? `${displayName} (@${handle})` : `@${handle}`;
  const canonicalUrl = `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`;
  const hashtags = record ? postHashtags(record) : [];
  const likeCount = nonNegativeCount(post.likeCount);
  const replyCount = nonNegativeCount(post.replyCount);
  const repostCount = nonNegativeCount(post.repostCount);
  const quoteCount = nonNegativeCount(post.quoteCount);
  const content = [
    `# Post by ${escapeMarkdown(author)}`,
    escapeMarkdown(body),
    ...embeddedSections(post.embed),
    `[View on Bluesky](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'post',
    url: canonicalUrl,
    source: 'bluesky',
    id: rkey,
    title: `Post by @${handle}`,
    author,
    publishedAt: isoDate(record?.createdAt),
    content,
    media: [],
    attributes: {
      handle: `@${handle}`,
      ...(hashtags.length ? { hashtags } : {}),
      ...(likeCount !== null ? { likeCount } : {}),
      ...(replyCount !== null ? { replyCount } : {}),
      ...(repostCount !== null ? { repostCount } : {}),
      ...(quoteCount !== null ? { quoteCount } : {}),
    },
    method: 'bluesky-api',
  };
}

export async function extractBlueskyProfile(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const actor = profileActor(url);
  // Bluesky advertises this RSS endpoint from public profile HTML. Fetching it
  // directly avoids loading the JavaScript application in Browser Rendering.
  const response = await fetchPublicPage(
    rssUrl(actor),
    dependencies.fetcher ?? fetch,
    'application/rss+xml, application/xml, text/xml;q=0.9',
  );

  let channel: Record<string, unknown> | undefined;
  try {
    const parsed = parser.parse(response.body) as Record<string, unknown>;
    channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  } catch {
    throw new ExtractionError('upstream_error', 'Bluesky returned invalid public profile data.', 502);
  }

  if (!channel) throw new ExtractionError('not_found', 'No public Bluesky profile was found.', 404);

  const title = text(channel.title).trim() || `@${actor} - Bluesky`;
  const author = title.match(/^(@.+?)\s+-\s+Bluesky$/i)?.[1] || `@${actor}`;
  const description = text(channel.description).trim();
  const entries = list(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const items: ExtractedItem[] = entries.map((entry) => {
    const itemUrl = text(entry.link).trim();
    return {
      type: 'post',
      source: 'bluesky',
      id: itemUrl.match(/\/post\/([^/?#]+)/)?.[1] ?? null,
      url: itemUrl || url.toString(),
      title: null,
      author,
      publishedAt: isoDate(entry.pubDate),
      content: escapeMarkdown(text(entry.description)),
      media: [],
      attributes: { handle: author },
    };
  });

  const header = [
    `# ${escapeMarkdown(title)}`,
    description ? escapeMarkdown(description) : '',
  ].filter(Boolean).join('\n\n');
  const content = [
    header,
    ...items.map((item) => [
      `## [Post](${item.url})`,
      item.publishedAt ? `Published ${item.publishedAt}` : '',
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].filter(Boolean).join('\n\n---\n\n');

  return {
    type: 'profile',
    url: url.toString(),
    source: 'bluesky',
    id: actor,
    title,
    author,
    publishedAt: items[0]?.publishedAt ?? null,
    content,
    media: [],
    attributes: {
      handle: author,
      ...(description ? { biography: description } : {}),
      postCount: items.length,
    },
    items,
    method: 'bluesky-rss',
  };
}
