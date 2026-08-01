import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractionDependencies, ExtractionResult } from '../types';
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
  const duration = Number(video?.duration);

  const content = [
    `# TikTok post by ${escapeMarkdown(author)}`,
    description ? escapeMarkdown(description) : '',
    Number.isFinite(duration) && duration > 0 ? `Duration: ${duration} seconds` : '',
    musicTitle ? `Sound: ${escapeMarkdown([musicTitle, musicAuthor].filter(Boolean).join(' — '))}` : '',
    hashtags.length ? `Hashtags: ${hashtags.map((name) => `#${escapeMarkdown(name)}`).join(', ')}` : '',
    `[View on TikTok](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    url: canonicalUrl,
    source: 'tiktok',
    kind: 'document',
    title: `TikTok post by @${username}`,
    author,
    publishedAt: isoFromSeconds(item.createTime),
    content,
    items: [],
    method: 'tiktok-hydration',
  };
}

function profileFromHydration(scope: UnknownRecord): ExtractionResult | null {
  const detail = record(scope['webapp.user-detail']);
  const userInfo = record(detail?.userInfo);
  const user = record(userInfo?.user);
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
    url: canonicalUrl,
    source: 'tiktok',
    kind: 'document',
    title: displayName || `@${username}`,
    author,
    publishedAt: null,
    content,
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

  return {
    url: canonicalUrl,
    source: 'tiktok',
    kind: 'document',
    title,
    author: authorName || null,
    publishedAt: null,
    content: [
      `# ${escapeMarkdown(title)}`,
      representation,
      `[View on TikTok](${canonicalUrl})`,
    ].filter(Boolean).join('\n\n'),
    items: [],
    method: 'tiktok-oembed',
  };
}

export async function extractTikTok(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;

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
