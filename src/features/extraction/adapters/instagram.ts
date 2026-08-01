import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isoFromSeconds(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function profileUsername(url: URL): string | null {
  return url.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/)?.[1] ?? null;
}

function postParts(url: URL): { shortcode: string; canonicalUrl: string } | null {
  const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/i);
  if (!match) return null;
  return {
    shortcode: match[2],
    canonicalUrl: `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`,
  };
}

function captionFromNode(node: UnknownRecord): string {
  const caption = record(node.edge_media_to_caption);
  const edges = Array.isArray(caption?.edges) ? caption.edges : [];
  return text(record(record(edges[0])?.node)?.text);
}

function contextFromEmbedHtml(html: string): UnknownRecord | null {
  // The public embed document serializes its post model as a JSON string named
  // contextJSON. Decode the outer JS string and then the nested JSON object;
  // no page scripts are evaluated.
  const match = html.match(/"contextJSON":("(?:\\.|[^"\\])*")/);
  if (!match?.[1]) return null;

  try {
    return record(JSON.parse(JSON.parse(match[1])));
  } catch {
    return null;
  }
}

function mediaNodeFromEmbedHtml(html: string): UnknownRecord | null {
  return record(record(contextFromEmbedHtml(html)?.gql_data)?.shortcode_media);
}

function extractInstagramPostNode(
  node: UnknownRecord,
  canonicalUrl: string,
): ExtractionResult | null {
  const owner = record(node.owner);
  const username = text(owner?.username);
  const caption = captionFromNode(node);
  if (!username && !caption) return null;

  const author = username ? `@${username}` : null;
  const type = text(node.__typename);
  const children = Array.isArray(record(node.edge_sidecar_to_children)?.edges)
    ? record(node.edge_sidecar_to_children)!.edges as unknown[]
    : [];
  const mediaDescription = type === 'GraphSidecar'
    ? `Media: ${children.length || 'multiple'} carousel items`
    : type === 'GraphVideo' ? 'Media: video' : type === 'GraphImage' ? 'Media: image' : '';

  const content = [
    `# Instagram post${author ? ` by ${escapeMarkdown(author)}` : ''}`,
    caption ? escapeMarkdown(caption) : '',
    mediaDescription,
    `[View on Instagram](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    url: canonicalUrl,
    source: 'instagram',
    kind: 'document',
    title: author ? `Instagram post by ${author}` : 'Instagram post',
    author,
    publishedAt: isoFromSeconds(node.taken_at_timestamp ?? node.taken_at),
    content,
    items: [],
    method: 'instagram-embed',
  };
}

async function extractInstagramPost(
  url: URL,
  fetcher: typeof fetch,
): Promise<ExtractionResult> {
  const parts = postParts(url);
  if (!parts) throw new ExtractionError('invalid_url', 'Use a public Instagram post or reel URL.', 400);

  try {
    const embedUrl = new URL(`${parts.canonicalUrl}embed/captioned/`);
    const embed = await fetchPublicPage(embedUrl, fetcher, 'text/html, application/xhtml+xml;q=0.9');
    const node = mediaNodeFromEmbedHtml(embed.body);
    const result = node && extractInstagramPostNode(node, parts.canonicalUrl);
    if (result) return result;
  } catch (error) {
    console.warn('Instagram embed document unavailable; trying oEmbed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  // Meta's tokenless endpoint is a stable availability fallback. Its current
  // response intentionally contains embed markup rather than caption fields.
  const endpoint = new URL('https://graph.facebook.com/v25.0/instagram_oembed');
  endpoint.searchParams.set('url', parts.canonicalUrl);
  const response = await fetchPublicPage(endpoint, fetcher, 'application/json');
  let data: UnknownRecord;
  try {
    data = JSON.parse(response.body) as UnknownRecord;
  } catch {
    throw new ExtractionError('upstream_error', 'Instagram returned invalid public metadata.', 502);
  }
  if (!text(data.html)) throw new ExtractionError('not_found', 'The Instagram post is unavailable.', 404);

  return {
    url: parts.canonicalUrl,
    source: 'instagram',
    kind: 'document',
    title: 'Instagram post',
    author: null,
    publishedAt: null,
    content: `# Instagram post\n\n[View on Instagram](${parts.canonicalUrl})`,
    items: [],
    method: 'instagram-embed',
  };
}

function profilePostItem(node: UnknownRecord, author: string): ExtractedItem | null {
  const shortcode = text(node.shortcode);
  if (!shortcode) return null;
  const caption = captionFromNode(node);
  const isVideo = node.is_video === true || text(node.__typename) === 'GraphVideo';
  const itemUrl = `https://www.instagram.com/${isVideo ? 'reel' : 'p'}/${shortcode}/`;
  const firstLine = caption.split('\n').find((line) => line.trim())?.trim() || '';

  return {
    url: itemUrl,
    title: firstLine ? firstLine.slice(0, 120) : null,
    author,
    publishedAt: isoFromSeconds(node.taken_at_timestamp),
    content: caption ? escapeMarkdown(caption) : `[View on Instagram](${itemUrl})`,
  };
}

interface InstagramProfileFields {
  handle: string;
  displayName: string;
  biography: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  nodes: UnknownRecord[];
}

function instagramProfileResult(fields: InstagramProfileFields): ExtractionResult {
  const { handle, displayName, biography, followers, following, posts, nodes } = fields;
  const author = displayName ? `${displayName} (@${handle})` : `@${handle}`;
  const canonicalUrl = `https://www.instagram.com/${handle}/`;
  const items = nodes
    .map((node) => profilePostItem(node, author))
    .filter((item): item is ExtractedItem => Boolean(item));
  const stats = [
    followers !== null ? `Followers: ${followers.toLocaleString('en-US')}` : '',
    following !== null ? `Following: ${following.toLocaleString('en-US')}` : '',
    posts !== null ? `Posts: ${posts.toLocaleString('en-US')}` : '',
  ].filter(Boolean).join(' · ');

  const content = [
    `# ${escapeMarkdown(author)}`,
    biography ? escapeMarkdown(biography) : '',
    stats,
    items.length ? '## Recent posts' : '',
    ...items.map((item) => [
      `### [${escapeMarkdown(item.title || 'Post')}](${item.url})`,
      item.publishedAt ? `Published ${item.publishedAt}` : '',
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].filter(Boolean).join('\n\n');

  return {
    url: canonicalUrl,
    source: 'instagram',
    kind: 'feed',
    title: displayName || `@${handle}`,
    author,
    publishedAt: items[0]?.publishedAt ?? null,
    content,
    items,
    method: 'instagram-profile',
  };
}

function profileFromEmbedHtml(html: string, fallbackUsername: string): ExtractionResult | null {
  const context = record(contextFromEmbedHtml(html)?.context);
  if (!context) return null;

  const handle = text(context.username) || fallbackUsername;
  const media = Array.isArray(context.graphql_media) ? context.graphql_media : [];
  const nodes = media
    .map((entry) => record(record(entry)?.shortcode_media))
    .filter((node): node is UnknownRecord => Boolean(node));

  return instagramProfileResult({
    handle,
    displayName: text(context.full_name),
    biography: '',
    followers: count(context.followers_count),
    following: null,
    posts: count(context.posts_count),
    nodes,
  });
}

async function extractInstagramProfile(
  username: string,
  fetcher: typeof fetch,
): Promise<ExtractionResult> {
  // The public profile embed is both cheaper and more reliable from Cloudflare
  // egress than Instagram's JSON endpoint. It currently exposes profile counts
  // and a small recent-post set in the same inert contextJSON format as posts.
  try {
    const embedUrl = new URL(`https://www.instagram.com/${encodeURIComponent(username)}/embed/`);
    const embed = await fetchPublicPage(embedUrl, fetcher, 'text/html, application/xhtml+xml;q=0.9');
    const result = profileFromEmbedHtml(embed.body, username);
    if (result) return result;
  } catch (error) {
    console.warn('Instagram profile embed unavailable; trying public profile data', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  const endpoint = new URL('https://www.instagram.com/api/v1/users/web_profile_info/');
  endpoint.searchParams.set('username', username);

  let response;
  try {
    response = await fetchPublicPage(endpoint, fetcher, 'application/json', {
      'X-IG-App-ID': '936619743392459',
      Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
    });
  } catch (error) {
    if (error instanceof ExtractionError && ['not_found', 'source_blocked', 'timeout'].includes(error.code)) {
      throw error;
    }
    throw new ExtractionError(
      'upstream_error',
      'Instagram did not expose public profile data for this account.',
      502,
    );
  }

  let user: UnknownRecord | null;
  try {
    user = record(record(record(JSON.parse(response.body))?.data)?.user);
  } catch {
    user = null;
  }
  if (!user || user.is_private === true) {
    throw new ExtractionError('not_found', 'The Instagram profile is private or unavailable.', 404);
  }

  const timeline = record(user.edge_owner_to_timeline_media);
  const edges = Array.isArray(timeline?.edges) ? timeline.edges : [];
  const nodes = edges
    .map((edge) => record(record(edge)?.node))
    .filter((node): node is UnknownRecord => Boolean(node));

  return instagramProfileResult({
    handle: text(user.username) || username,
    displayName: text(user.full_name),
    biography: text(user.biography),
    followers: count(record(user.edge_followed_by)?.count),
    following: count(record(user.edge_follow)?.count),
    posts: count(timeline?.count),
    nodes,
  });
}

export async function extractInstagram(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const username = profileUsername(url);
  return username
    ? extractInstagramProfile(username, fetcher)
    : extractInstagramPost(url, fetcher);
}
