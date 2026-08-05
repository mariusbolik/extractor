import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';
import { isTikTokUrl } from '../url';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isoFromSeconds(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function count(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function hydrationScope(html: string): UnknownRecord | null {
  // TikTok places the page model in one JSON script. Parsing only that script
  // keeps this adapter cheap and avoids executing page JavaScript in Chrome.
  const match = html.match(
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) return null;

  try {
    return record(record(JSON.parse(match[1]))?.__DEFAULT_SCOPE__);
  } catch {
    return null;
  }
}

function creatorEmbedModel(html: string): UnknownRecord | null {
  const match = html.match(
    /<script[^>]+id=["']__FRONTITY_CONNECT_STATE__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) return null;
  try {
    const state = record(JSON.parse(match[1]));
    const data = record(record(state?.source)?.data);
    if (!data) return null;
    return Object.values(data).map(record).find((value) => value && record(value.userInfo) && Array.isArray(value.videoList)) ?? null;
  } catch {
    return null;
  }
}

function profileUsername(url: URL): string | null {
  return url.pathname.match(/^\/@([^/]+)\/?$/i)?.[1] ?? null;
}

function creatorProfileFromEmbed(html: string, fallbackUsername: string): ExtractionResult | null {
  const model = creatorEmbedModel(html);
  const user = record(model?.userInfo);
  if (!model || !user) return null;
  const username = text(user.uniqueId) || fallbackUsername;
  if (!username) return null;
  const displayName = text(user.nickname);
  const author = displayName ? `${displayName} (@${username})` : `@${username}`;
  const canonicalUrl = `https://www.tiktok.com/@${username}`;
  const biography = text(user.signature);
  const items: ExtractedItem[] = (Array.isArray(model.videoList) ? model.videoList : []).flatMap((value) => {
    const video = record(value);
    const id = text(video?.id);
    if (!video || !id) return [];
    const description = text(video.desc);
    const itemUrl = `https://www.tiktok.com/@${username}/video/${id}`;
    const cover = text(video.coverUrl) || text(video.originCoverUrl) || text(video.dynamicCoverUrl);
    const width = count(video.width);
    const height = count(video.height);
    const viewCount = count(video.playCount);
    return [{
      type: 'post' as const,
      source: 'tiktok' as const,
      id,
      url: itemUrl,
      title: description.split('\n').find(Boolean)?.slice(0, 120) || `TikTok post by @${username}`,
      author,
      publishedAt: null,
      content: [description ? escapeMarkdown(description) : '', `[View on TikTok](${itemUrl})`].filter(Boolean).join('\n\n'),
      media: cover ? [{
        type: 'image' as const,
        url: cover,
        alt: description || 'TikTok post',
        ...(width && width > 0 ? { width } : {}),
        ...(height && height > 0 ? { height } : {}),
      }] : [],
      attributes: {
        handle: `@${username}`,
        mediaType: 'video' as const,
        ...(viewCount !== null ? { viewCount } : {}),
      },
    }];
  }).slice(0, 10);
  const followerCount = count(user.followerCount);
  const followingCount = count(user.followingCount);
  const totalLikeCount = count(user.heartCount);
  const postCount = count(user.videoCount);
  const verified = typeof user.verified === 'boolean' ? user.verified : null;
  const avatar = text(user.avatarThumbUrl);
  const stats = [
    followerCount !== null ? `Followers: ${followerCount.toLocaleString('en-US')}` : '',
    followingCount !== null ? `Following: ${followingCount.toLocaleString('en-US')}` : '',
    totalLikeCount !== null ? `Likes: ${totalLikeCount.toLocaleString('en-US')}` : '',
    postCount !== null ? `Posts: ${postCount.toLocaleString('en-US')}` : '',
  ].filter(Boolean).join(' · ');
  const content = [
    `# ${escapeMarkdown(author)}`,
    biography ? escapeMarkdown(biography) : '',
    stats,
    items.length ? '## Recent posts' : '',
    ...items.map((item) => `### [${escapeMarkdown(item.title || 'Post')}](${item.url})\n\n${item.content}`),
  ].filter(Boolean).join('\n\n');

  return {
    type: 'profile',
    url: canonicalUrl,
    source: 'tiktok',
    id: text(user.id) || username,
    title: displayName || `@${username}`,
    author,
    publishedAt: null,
    content,
    media: avatar ? [{ type: 'image', url: avatar, alt: author }] : [],
    attributes: {
      handle: `@${username}`,
      ...(biography ? { biography } : {}),
      ...(verified !== null ? { verified } : {}),
      ...(followerCount !== null ? { followerCount } : {}),
      ...(followingCount !== null ? { followingCount } : {}),
      ...(postCount !== null ? { postCount } : {}),
      ...(totalLikeCount !== null ? { totalLikeCount } : {}),
    },
    items,
    method: 'tiktok-profile-embed',
  };
}

function hashtagNames(item: UnknownRecord): string[] {
  const values = new Set<string>();
  const challenges = Array.isArray(item.challenges) ? item.challenges : [];
  for (const challenge of challenges) {
    const name = text(record(challenge)?.title);
    if (name) values.add(name);
  }

  const extras = Array.isArray(item.textExtra) ? item.textExtra : [];
  for (const extra of extras) {
    const name = text(record(extra)?.hashtagName);
    if (name) values.add(name);
  }
  return [...values];
}

function videoFromHydration(scope: UnknownRecord, pageUrl: URL): ExtractionResult | null {
  const detail = record(scope['webapp.video-detail']);
  const item = record(record(detail?.itemInfo)?.itemStruct);
  if (!item) return null;

  const id = text(item.id);
  const authorData = record(item.author);
  const username = text(authorData?.uniqueId);
  if (!id || !username) return null;

  const displayName = text(authorData?.nickname);
  const author = displayName ? `${displayName} (@${username})` : `@${username}`;
  // Preserve photo-post URLs; TikTok uses the same item model for videos and
  // photo posts, so the hydration payload alone does not reliably distinguish them.
  const postType = new RegExp(`/photo/${id}/?$`, 'i').test(pageUrl.pathname) ? 'photo' : 'video';
  const canonicalUrl = `https://www.tiktok.com/@${username}/${postType}/${id}`;
  const description = text(item.desc);
  const video = record(item.video);
  const music = record(item.music);
  const musicTitle = text(music?.title);
  const musicAuthor = text(music?.authorName);
  const hashtags = hashtagNames(item);
  const stats = record(item.stats) ?? record(item.statsV2);
  const likeCount = count(stats?.diggCount);
  const replyCount = count(stats?.commentCount);
  const shareCount = count(stats?.shareCount);
  const viewCount = count(stats?.playCount);
  const duration = Number(video?.duration);
  const cover = text(video?.cover) || text(video?.originCover) || text(video?.dynamicCover);

  const content = [
    `# TikTok post by ${escapeMarkdown(author)}`,
    description ? escapeMarkdown(description) : '',
    Number.isFinite(duration) && duration > 0 ? `Duration: ${duration} seconds` : '',
    musicTitle ? `Sound: ${escapeMarkdown([musicTitle, musicAuthor].filter(Boolean).join(' — '))}` : '',
    hashtags.length ? `Hashtags: ${hashtags.map((name) => `#${escapeMarkdown(name)}`).join(', ')}` : '',
    `[View on TikTok](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'post',
    url: canonicalUrl,
    source: 'tiktok',
    id,
    title: `TikTok post by @${username}`,
    author,
    publishedAt: isoFromSeconds(item.createTime),
    content,
    media: cover ? [{ type: 'image', url: cover, alt: description || 'TikTok post' }] : [],
    attributes: {
      handle: `@${username}`,
      mediaType: postType === 'photo' ? 'image' : 'video',
      ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: Math.round(duration) } : {}),
      ...(hashtags.length ? { hashtags } : {}),
      ...(likeCount !== null ? { likeCount } : {}),
      ...(replyCount !== null ? { replyCount } : {}),
      ...(shareCount !== null ? { shareCount } : {}),
      ...(viewCount !== null ? { viewCount } : {}),
    },
    method: 'tiktok-hydration',
  };
}

function profileFromHydration(scope: UnknownRecord): ExtractionResult | null {
  const detail = record(scope['webapp.user-detail']);
  const userInfo = record(detail?.userInfo);
  const user = record(userInfo?.user);
  const stats = record(userInfo?.stats);
  if (!user) return null;

  const username = text(user.uniqueId);
  if (!username) return null;
  const displayName = text(user.nickname);
  const author = displayName ? `${displayName} (@${username})` : `@${username}`;
  const canonicalUrl = `https://www.tiktok.com/@${username}`;
  const biography = text(user.signature);
  const bioLink = text(record(user.bioLink)?.link);

  const content = [
    `# ${escapeMarkdown(author)}`,
    biography ? escapeMarkdown(biography) : '',
    bioLink && /^https?:\/\//i.test(bioLink) ? `[Profile link](${bioLink})` : '',
    `[View on TikTok](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'profile',
    url: canonicalUrl,
    source: 'tiktok',
    id: text(user.id) || username,
    title: displayName || `@${username}`,
    author,
    publishedAt: null,
    content,
    media: text(user.avatarLarger) ? [{ type: 'image', url: text(user.avatarLarger), alt: author }] : [],
    attributes: {
      handle: `@${username}`,
      ...(biography ? { biography } : {}),
      ...(Number.isFinite(Number(stats?.followerCount)) ? { followerCount: Number(stats?.followerCount) } : {}),
      ...(Number.isFinite(Number(stats?.followingCount)) ? { followingCount: Number(stats?.followingCount) } : {}),
      ...(Number.isFinite(Number(stats?.videoCount)) ? { postCount: Number(stats?.videoCount) } : {}),
    },
    items: [],
    method: 'tiktok-hydration',
  };
}

async function extractOembed(url: URL, fetcher: typeof fetch): Promise<ExtractionResult> {
  const endpoint = new URL('https://www.tiktok.com/oembed');
  endpoint.searchParams.set('url', url.toString());
  const response = await fetchPublicPage(endpoint, fetcher, 'application/json');

  let data: UnknownRecord;
  try {
    data = JSON.parse(response.body) as UnknownRecord;
  } catch {
    throw new ExtractionError('upstream_error', 'TikTok returned invalid public metadata.', 502);
  }

  const title = text(data.title) || 'TikTok post';
  const authorName = text(data.author_name);
  const canonicalUrl = url.toString();
  const html = text(data.html);
  const representation = html ? htmlFragmentToMarkdown(html, canonicalUrl) : '';
  if (!representation && !authorName) {
    throw new ExtractionError('not_found', 'The TikTok post or profile is unavailable.', 404);
  }

  const profile = /^\/@[^/]+\/?$/i.test(url.pathname);
  return {
    type: profile ? 'profile' : 'post',
    url: canonicalUrl,
    source: 'tiktok',
    id: url.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? (profile ? url.pathname.slice(2).replace(/\/$/, '') : null),
    title,
    author: authorName || null,
    publishedAt: null,
    content: [
      `# ${escapeMarkdown(title)}`,
      representation,
      `[View on TikTok](${canonicalUrl})`,
    ].filter(Boolean).join('\n\n'),
    media: text(data.thumbnail_url) ? [{ type: 'image', url: text(data.thumbnail_url), alt: title }] : [],
    attributes: authorName ? { handle: authorName } : {},
    ...(profile ? { items: [] } : {}),
    method: 'tiktok-oembed',
  };
}

export async function extractTikTok(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const username = profileUsername(url);
  if (username) {
    try {
      const endpoint = new URL(`https://www.tiktok.com/embed/@${encodeURIComponent(username)}`);
      endpoint.searchParams.set('lang', 'en-US');
      const embed = await fetchPublicPage(endpoint, fetcher, 'text/html, application/xhtml+xml;q=0.9');
      const profile = creatorProfileFromEmbed(embed.body, username);
      if (profile) return profile;
    } catch (error) {
      console.warn('TikTok creator embed unavailable; trying public profile page', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  try {
    const page = await fetchPublicPage(url, fetcher, 'text/html, application/xhtml+xml;q=0.9');
    const resolvedUrl = new URL(page.url);
    if (!isTikTokUrl(resolvedUrl)) {
      throw new ExtractionError('invalid_url', 'Use a public TikTok video or profile URL.', 400);
    }
    const scope = hydrationScope(page.body);
    const hydrated = scope && (videoFromHydration(scope, resolvedUrl) ?? profileFromHydration(scope));
    if (hydrated) return hydrated;

    return await extractOembed(resolvedUrl, fetcher);
  } catch (error) {
    if (error instanceof ExtractionError && error.code === 'invalid_url') throw error;
    // The official GET endpoint remains available when the normal page is
    // withheld or its internal JSON shape changes.
    try {
      return await extractOembed(url, fetcher);
    } catch (oembedError) {
      if (oembedError instanceof ExtractionError) throw oembedError;
      throw new ExtractionError('upstream_error', 'TikTok could not return that public URL.', 502);
    }
  }
}
