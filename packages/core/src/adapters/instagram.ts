import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
import type { ExtractedItem, ExtractedMedia, ExtractionDependencies, ExtractionResult } from '../types';

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
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))].slice(0, 20) : [];
}

function publicUrl(value: unknown): string {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function hashtags(value: string): string[] {
  return [...new Set([...value.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1]).filter(Boolean))].slice(0, 50);
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

function mediaFromNode(node: UnknownRecord, fallbackAlt: string): ExtractedMedia[] {
  const edges = Array.isArray(record(node.edge_sidecar_to_children)?.edges)
    ? record(node.edge_sidecar_to_children)!.edges as unknown[]
    : [];
  const nodes = edges.length
    ? edges.map((edge) => record(record(edge)?.node)).filter((child): child is UnknownRecord => child !== null)
    : [node];
  const seen = new Set<string>();
  return nodes.flatMap((child) => {
    const url = publicUrl(child.display_url ?? child.thumbnail_src);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const dimensions = record(child.dimensions);
    const width = count(dimensions?.width);
    const height = count(dimensions?.height);
    return [{
      type: 'image' as const,
      url,
      alt: text(child.accessibility_caption) || fallbackAlt,
      ...(width && width > 0 ? { width } : {}),
      ...(height && height > 0 ? { height } : {}),
    }];
  }).slice(0, 20);
}

function coauthors(node: UnknownRecord): string[] {
  const values = Array.isArray(node.coauthor_producers) ? node.coauthor_producers : [];
  return [...new Set(values.map((value) => text(record(value)?.username)).filter(Boolean).map((value) => `@${value}`))].slice(0, 20);
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
  const media = mediaFromNode(node, caption || 'Instagram post');
  const postHashtags = hashtags(caption);
  const likeCount = count(record(node.edge_media_preview_like)?.count ?? record(node.edge_liked_by)?.count);
  const replyCount = count(record(node.edge_media_to_parent_comment)?.count ?? record(node.edge_media_to_comment)?.count);
  const viewCount = count(node.video_view_count ?? node.video_play_count);
  const verified = boolean(owner?.is_verified ?? owner?.verified);
  const postCoauthors = coauthors(node);
  const locationName = text(record(node.location)?.name);
  const sponsored = boolean(node.is_paid_partnership);

  const content = [
    `# Instagram post${author ? ` by ${escapeMarkdown(author)}` : ''}`,
    caption ? escapeMarkdown(caption) : '',
    mediaDescription,
    `[View on Instagram](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'post',
    url: canonicalUrl,
    source: 'instagram',
    id: canonicalUrl.match(/\/(?:p|reel)\/([^/]+)/i)?.[1] ?? null,
    title: author ? `Instagram post by ${author}` : 'Instagram post',
    author,
    publishedAt: isoFromSeconds(node.taken_at_timestamp ?? node.taken_at),
    content,
    media,
    attributes: {
      ...(username ? { handle: `@${username}` } : {}),
      ...(verified !== null ? { verified } : {}),
      ...(type === 'GraphSidecar' ? { mediaType: 'carousel' as const }
        : type === 'GraphVideo' ? { mediaType: 'video' as const }
          : type === 'GraphImage' ? { mediaType: 'image' as const } : {}),
      ...(postHashtags.length ? { hashtags: postHashtags } : {}),
      ...(postCoauthors.length ? { coauthors: postCoauthors } : {}),
      ...(locationName ? { locationName } : {}),
      ...(sponsored !== null ? { sponsored } : {}),
      ...(likeCount !== null ? { likeCount } : {}),
      ...(replyCount !== null ? { replyCount } : {}),
      ...(viewCount !== null ? { viewCount } : {}),
    },
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
    type: 'post',
    url: parts.canonicalUrl,
    source: 'instagram',
    id: parts.shortcode,
    title: 'Instagram post',
    author: null,
    publishedAt: null,
    content: `# Instagram post\n\n[View on Instagram](${parts.canonicalUrl})`,
    media: [],
    attributes: {},
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
  const postHashtags = hashtags(caption);
  const likeCount = count(record(node.edge_media_preview_like)?.count ?? record(node.edge_liked_by)?.count);
  const replyCount = count(record(node.edge_media_to_parent_comment)?.count ?? record(node.edge_media_to_comment)?.count);
  const viewCount = count(node.video_view_count ?? node.video_play_count);
  const owner = record(node.owner);
  const verified = boolean(owner?.is_verified ?? owner?.verified);
  const postCoauthors = coauthors(node);
  const locationName = text(record(node.location)?.name);
  const sponsored = boolean(node.is_paid_partnership);

  return {
    type: 'post',
    source: 'instagram',
    id: shortcode,
    url: itemUrl,
    title: firstLine ? firstLine.slice(0, 120) : null,
    author,
    publishedAt: isoFromSeconds(node.taken_at_timestamp),
    content: caption ? escapeMarkdown(caption) : `[View on Instagram](${itemUrl})`,
    media: mediaFromNode(node, caption || 'Instagram post'),
    attributes: {
      handle: author.match(/@[^)\s]+/)?.[0] || author,
      ...(verified !== null ? { verified } : {}),
      mediaType: isVideo ? 'video' : 'image',
      ...(postHashtags.length ? { hashtags: postHashtags } : {}),
      ...(postCoauthors.length ? { coauthors: postCoauthors } : {}),
      ...(locationName ? { locationName } : {}),
      ...(sponsored !== null ? { sponsored } : {}),
      ...(likeCount !== null ? { likeCount } : {}),
      ...(replyCount !== null ? { replyCount } : {}),
      ...(viewCount !== null ? { viewCount } : {}),
    },
  };
}

interface InstagramProfileFields {
  handle: string;
  displayName: string;
  biography: string;
  avatar: string;
  verified: boolean | null;
  pronouns: string[];
  followers: number | null;
  following: number | null;
  posts: number | null;
  nodes: UnknownRecord[];
}

function instagramProfileResult(fields: InstagramProfileFields): ExtractionResult {
  const { handle, displayName, biography, avatar, verified, pronouns, followers, following, posts, nodes } = fields;
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
    type: 'profile',
    url: canonicalUrl,
    source: 'instagram',
    id: handle,
    title: displayName || `@${handle}`,
    author,
    publishedAt: items[0]?.publishedAt ?? null,
    content,
    media: avatar ? [{ type: 'image', url: avatar, alt: author }] : [],
    attributes: {
      handle: `@${handle}`,
      ...(biography ? { biography } : {}),
      ...(verified !== null ? { verified } : {}),
      ...(pronouns.length ? { pronouns } : {}),
      ...(followers !== null ? { followerCount: followers } : {}),
      ...(following !== null ? { followingCount: following } : {}),
      ...(posts !== null ? { postCount: posts } : {}),
    },
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
    avatar: publicUrl(context.profile_pic_url),
    verified: boolean(context.verified ?? context.is_verified),
    pronouns: stringList(context.pronouns),
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

  throw new ExtractionError(
    'not_found',
    'The Instagram profile is unavailable, private, or has public embedding disabled.',
    404,
  );
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
