import { parseHTML } from 'linkedom';
import { ExtractionError } from './errors';
import { fetchPublicJsonPost, fetchPublicPage } from './fetch';
import { escapeMarkdown } from './markdown';
import { normalizeChoice, normalizeCountryCode, normalizeLanguageTag } from './options';
import { normalizeSearchQuery } from './search';
import type { ExtractedItem, ExtractionResult, VideoPlatform, VideoSearchDependencies, VideoSort } from './types';

const MAX_RESULTS = 20;
const VIDEO_PLATFORMS = ['any', 'youtube'] as const;
const VIDEO_SORTS = ['relevance', 'date'] as const;
const YOUTUBE_SEARCH_FILTERS: Record<VideoSort, string> = {
  relevance: 'EgIQAfABAQ==',
  // Sort field 1 = upload date (value 2) while retaining the existing video-only
  // filter and the web client's short-form exclusion flag.
  date: 'CAISAhAB8AEB',
};
const YOUTUBE_WEB_CLIENT_VERSION = '2.20260708.00.00';
const GOOGLE_ARC_ID_LIFETIME_MS = 60 * 60 * 1_000;
const GOOGLE_ARC_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'for', 'from', 'how', 'in', 'is', 'of', 'on', 'or',
  'the', 'to', 'what', 'where', 'who', 'why', 'with',
  'das', 'der', 'die', 'ein', 'eine', 'ist', 'und', 'von', 'was', 'wer', 'wie',
  'wo', 'zu',
]);

let googleArcId: { generatedAt: number; value: string } | undefined;

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new ExtractionError('invalid_request', `Limit must be an integer from 1 to ${MAX_RESULTS}.`, 400);
  }
  return value;
}

function publicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function plainText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function durationSeconds(value: string): number | undefined {
  const parts = value.trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return undefined;
  if (parts.slice(1).some((part) => part > 59)) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function absolutePublishedAt(value: string): string | null {
  const candidate = plainText(value);
  if (!candidate || /\b(?:ago|yesterday|today|hour|minute|week|month)\b/i.test(candidate)) return null;
  const timestamp = Date.parse(/^[A-Za-z]+\s+\d{1,2},\s+\d{4}$/.test(candidate)
    ? `${candidate} 00:00:00 UTC`
    : candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function displayedAgeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/,/g, '').trim();
  if (/\bjust now\b/.test(normalized)) return 0;
  if (/\btoday\b/.test(normalized)) return 12 * 60 * 60 * 1_000;
  if (/\byesterday\b/.test(normalized)) return 24 * 60 * 60 * 1_000;
  const match = normalized.match(/(\d+(?:\.\d+)?)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]!;
  const unitMs: Record<string, number> = {
    second: 1_000,
    minute: 60 * 1_000,
    hour: 60 * 60 * 1_000,
    day: 24 * 60 * 60 * 1_000,
    week: 7 * 24 * 60 * 60 * 1_000,
    month: 30 * 24 * 60 * 60 * 1_000,
    year: 365 * 24 * 60 * 60 * 1_000,
  };
  return Number.isFinite(amount) ? amount * unitMs[unit]! : null;
}

function newestFirst(items: ExtractedItem[]): ExtractedItem[] {
  return items
    .map((item, index) => {
      const timestamp = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
      const age = Number.isFinite(timestamp)
        ? Math.max(0, Date.now() - timestamp)
        : displayedAgeMs(item.attributes.publishedAtDisplay);
      return { item, index, age };
    })
    .sort((left, right) => {
      if (left.age === null && right.age === null) return left.index - right.index;
      if (left.age === null) return 1;
      if (right.age === null) return -1;
      return left.age - right.age || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function normalizeVideoCreator(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const creator = value.replace(/\s+/g, ' ').trim();
  if (!creator || creator.length > 80) {
    throw new ExtractionError('invalid_request', 'Creator must contain 1 to 80 characters.', 400);
  }
  return creator;
}

function creatorKey(value: string): string {
  return value.normalize('NFKC').replace(/^@/, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchesCreator(item: ExtractedItem, creator: string | undefined): boolean {
  return creator === undefined || (item.author !== null && creatorKey(item.author) === creatorKey(creator));
}

function queryTerms(query: string, language: string): string[] {
  const words = query.toLocaleLowerCase(language).match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = words.filter((word) => !QUERY_STOP_WORDS.has(word));
  return [...new Set(meaningful.length > 0 ? meaningful : words)];
}

function isRelevant(item: ExtractedItem, query: string, language: string): boolean {
  const terms = queryTerms(query, language);
  if (terms.length === 0) return false;
  const words = `${item.title ?? ''} ${item.author ?? ''} ${item.url} ${item.content}`
    .toLocaleLowerCase(language)
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const haystack = new Set(words);
  const matched = terms.filter((term) => haystack.has(term)).length;
  return matched >= Math.floor(terms.length / 2) + 1;
}

function matchesPlatform(item: ExtractedItem, platform: VideoPlatform): boolean {
  if (platform === 'any') return true;
  try {
    const hostname = new URL(item.url).hostname.toLowerCase();
    return hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rendererText(value: unknown): string {
  const source = record(value);
  if (!source) return '';
  if (typeof source.simpleText === 'string') return plainText(source.simpleText);
  if (!Array.isArray(source.runs)) return '';
  return plainText(source.runs.map((run) => {
    const item = record(run);
    return typeof item?.text === 'string' ? item.text : '';
  }).join(''));
}

function exactViewCount(value: string): number | undefined {
  const normalized = plainText(value);
  if (!normalized || /\d[.,]\d+\s*[KMB]\b/i.test(normalized) || /^no\s+views?\b/i.test(normalized)) {
    return /^no\s+views?\b/i.test(normalized) ? 0 : undefined;
  }
  const match = normalized.match(/^(\d{1,3}(?:[,.\s\u00a0\u202f]\d{3})*|\d+)(?:\D|$)/u);
  if (!match) return undefined;
  const parsed = Number(match[1]!.replace(/\D/g, ''));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function collectVideoRenderers(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectVideoRenderers(child, output);
    return;
  }
  const source = record(value);
  if (!source) return;
  const renderer = record(source.videoRenderer);
  if (renderer) output.push(renderer);
  for (const [key, child] of Object.entries(source)) {
    if (key !== 'videoRenderer') collectVideoRenderers(child, output);
  }
}

function parseYoutubeItems(body: string): ExtractedItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ExtractionError('upstream_error', 'The video index returned malformed data.', 502);
  }

  const renderers: Record<string, unknown>[] = [];
  collectVideoRenderers(payload, renderers);
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  for (const renderer of renderers) {
    const id = typeof renderer.videoId === 'string' && /^[\w-]{11}$/.test(renderer.videoId)
      ? renderer.videoId
      : null;
    const title = rendererText(renderer.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);

    const detailed = Array.isArray(renderer.detailedMetadataSnippets)
      ? record(renderer.detailedMetadataSnippets[0])
      : null;
    const description = rendererText(renderer.descriptionSnippet)
      || rendererText(detailed?.snippetText);
    const duration = durationSeconds(rendererText(renderer.lengthText));
    const viewCount = exactViewCount(rendererText(renderer.viewCountText));
    const publishedAtDisplay = rendererText(renderer.publishedTimeText);
    const thumbnails = record(renderer.thumbnail)?.thumbnails;
    const thumbnail = Array.isArray(thumbnails)
      ? [...thumbnails].reverse().map((candidate) => {
        const value = record(candidate)?.url;
        return publicUrl(typeof value === 'string' ? value : null);
      }).find(Boolean) ?? null
      : null;

    items.push({
      type: 'video',
      source: 'video-search',
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title,
      author: rendererText(renderer.ownerText) || rendererText(renderer.shortBylineText) || null,
      publishedAt: absolutePublishedAt(publishedAtDisplay),
      content: description,
      media: thumbnail ? [{ type: 'image', url: thumbnail, alt: title }] : [],
      attributes: {
        ...(duration === undefined ? {} : { durationSeconds: duration }),
        ...(viewCount === undefined ? {} : { viewCount }),
        ...(publishedAtDisplay ? { publishedAtDisplay } : {}),
      },
    });
  }
  return items;
}

async function fetchYoutubeItems(
  query: string,
  language: string,
  country: string,
  sort: VideoSort,
  fetcher: typeof fetch | undefined,
): Promise<ExtractedItem[]> {
  const endpoint = new URL('https://www.youtube.com/youtubei/v1/search');
  endpoint.searchParams.set('prettyPrint', 'false');
  const response = await fetchPublicJsonPost(endpoint, {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: YOUTUBE_WEB_CLIENT_VERSION,
        hl: language.split('-')[0],
        gl: country,
        platform: 'DESKTOP',
      },
    },
    query,
    params: YOUTUBE_SEARCH_FILTERS[sort],
  }, fetcher, { 'Accept-Language': language });
  if (!/(?:application|text)\/json/i.test(response.contentType)) {
    throw new ExtractionError('upstream_error', 'The video index did not return search results.', 502);
  }
  return parseYoutubeItems(response.body);
}

function currentGoogleArcId(): string {
  const now = Date.now();
  if (googleArcId && now - googleArcId.generatedAt < GOOGLE_ARC_ID_LIFETIME_MS) return googleArcId.value;
  const bytes = crypto.getRandomValues(new Uint8Array(23));
  const random = [...bytes].map((value) => GOOGLE_ARC_ID_ALPHABET[value % GOOGLE_ARC_ID_ALPHABET.length]).join('');
  googleArcId = { generatedAt: now, value: `srp_${random}_100` };
  return googleArcId.value;
}

function googleVideoEndpoint(query: string, language: string, country: string, sort: VideoSort): URL {
  const baseLanguage = language.split('-')[0]!;
  const endpoint = new URL('https://www.google.com/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('tbm', 'vid');
  endpoint.searchParams.set('start', '0');
  endpoint.searchParams.set('hl', baseLanguage);
  endpoint.searchParams.set('lr', `lang_${baseLanguage}`);
  endpoint.searchParams.set('cr', `country${country}`);
  endpoint.searchParams.set('ie', 'utf8');
  endpoint.searchParams.set('oe', 'utf8');
  endpoint.searchParams.set('asearch', 'arc');
  endpoint.searchParams.set('async', `arc_id:${currentGoogleArcId()},use_ac:true,_fmt:prog`);
  endpoint.searchParams.set('safe', 'high');
  if (sort === 'date') endpoint.searchParams.set('tbs', 'sbd:1');
  return endpoint;
}

function googleResultUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('/url?')) {
    const redirect = new URL(value, 'https://www.google.com');
    return publicUrl(redirect.searchParams.get('q'));
  }
  return publicUrl(value);
}

function youtubeIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
      const id = url.searchParams.get('v');
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch {
    // Invalid candidates are skipped by the caller.
  }
  return null;
}

function parseGoogleVideoItems(body: string, query: string, language: string, platform: VideoPlatform): ExtractedItem[] {
  const { document } = parseHTML(body);
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();

  for (const result of document.querySelectorAll('.MjjYud')) {
    const anchor = result.querySelector<HTMLAnchorElement>('a[jsname="UWckNb"][href], a[href^="/url?q="]');
    const url = googleResultUrl(anchor?.getAttribute('href') ?? null);
    const title = plainText(
      result.querySelector('h3.LC20lb, [role="heading"]')?.textContent,
    );
    if (!url || !title || seen.has(url)) continue;

    const sourceVideoId = result.querySelector('[jscontroller="rTuANe"][data-vid]')?.getAttribute('data-vid');
    const videoId = sourceVideoId && /^[\w-]{11}$/.test(sourceVideoId)
      ? sourceVideoId
      : youtubeIdFromUrl(url);
    const imageValue = result.querySelector('img[src]')?.getAttribute('src') ?? null;
    const thumbnail = publicUrl(imageValue)
      ?? (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);
    const duration = durationSeconds(plainText(result.querySelector('.k1U36b')?.textContent));
    const item: ExtractedItem = {
      type: 'video',
      source: 'video-search',
      id: videoId,
      url,
      title,
      author: plainText(result.querySelector('.gqF9jc, .WRu9Cd')?.textContent) || null,
      publishedAt: null,
      content: plainText(result.querySelector('.ITZIwc')?.textContent),
      media: thumbnail ? [{ type: 'image', url: thumbnail, alt: title }] : [],
      attributes: { ...(duration === undefined ? {} : { durationSeconds: duration }) },
    };
    if (!isRelevant(item, query, language) || !matchesPlatform(item, platform)) continue;
    seen.add(url);
    items.push(item);
  }
  return items;
}

async function fetchGoogleVideoItems(
  query: string,
  language: string,
  country: string,
  platform: VideoPlatform,
  sort: VideoSort,
  fetcher: typeof fetch | undefined,
): Promise<ExtractedItem[]> {
  const discoveryQuery = platform === 'youtube' ? `site:youtube.com ${query}` : query;
  const response = await fetchPublicPage(
    googleVideoEndpoint(discoveryQuery, language, country, sort),
    fetcher,
    'text/plain, text/html;q=0.9',
    {
      'Accept-Language': `${language},${language.split('-')[0]};q=0.9`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0',
    },
  );
  if (new URL(response.url).hostname === 'sorry.google.com'
    || (response.body.length < 5_000 && response.body.includes('/sorry/'))) {
    throw new ExtractionError('upstream_error', 'The video index is temporarily unavailable.', 502);
  }
  if (!/(?:text\/plain|text\/html)/i.test(response.contentType)) {
    throw new ExtractionError('upstream_error', 'The video index did not return search results.', 502);
  }
  return parseGoogleVideoItems(response.body, query, language, platform);
}

function markdown(query: string, items: ExtractedItem[]): string {
  const rows = items.map((item, index) => {
    const details = [
      item.author,
      item.attributes.durationSeconds === undefined ? null : `${item.attributes.durationSeconds}s`,
      item.attributes.viewCount === undefined ? null : `${item.attributes.viewCount.toLocaleString('en-US')} views`,
      item.publishedAt ?? item.attributes.publishedAtDisplay,
    ].filter(Boolean).join(' · ');
    const metadata = details ? ` — ${escapeMarkdown(details)}` : '';
    const snippet = item.content ? `\n\n   ${escapeMarkdown(item.content)}` : '';
    return `${index + 1}. [${escapeMarkdown(item.title ?? item.url)}](${item.url})${metadata}${snippet}`;
  });
  return [`# Video results for ${escapeMarkdown(query)}`, ...rows].join('\n\n');
}

/** Search public video pages through a cache-first, strictly sequential chain. */
export async function searchVideos(
  rawQuery: string,
  dependencies: VideoSearchDependencies = {},
): Promise<ExtractionResult> {
  const query = normalizeSearchQuery(rawQuery);
  const limit = normalizedLimit(dependencies.limit);
  const language = normalizeLanguageTag(dependencies.language, 'en-US');
  const country = normalizeCountryCode(dependencies.country, 'US')!;
  const platform = normalizeChoice(dependencies.platform, VIDEO_PLATFORMS, 'any', 'Platform');
  const sort = normalizeChoice(dependencies.sort, VIDEO_SORTS, 'relevance', 'Sort');
  const creator = normalizeVideoCreator(dependencies.creator);
  const discoveryQuery = creator && !creatorKey(query).includes(creatorKey(creator))
    ? `${query} ${creator}`
    : query;
  let primarySucceeded = false;
  let primaryFailure: unknown;
  let fallbackSucceeded = false;
  let fallbackFailure: unknown;
  let items: ExtractedItem[] = [];
  let method: 'video-search-json' | 'video-search-html' = 'video-search-json';

  // Stop after the first usable result set. A normal request therefore makes
  // exactly one upstream request; the fallback is reached only on failure or
  // a valid empty primary response.
  try {
    const primaryItems = await fetchYoutubeItems(discoveryQuery, language, country, sort, dependencies.fetcher);
    const matchingItems = primaryItems.filter((item) => matchesCreator(item, creator));
    items = (sort === 'date' ? newestFirst(matchingItems) : matchingItems).slice(0, limit);
    primarySucceeded = true;
  } catch (error) {
    primaryFailure = error;
  }

  if (items.length === 0) {
    try {
      const fallbackItems = await fetchGoogleVideoItems(discoveryQuery, language, country, platform, sort, dependencies.fetcher);
      const matchingItems = fallbackItems.filter((item) => matchesCreator(item, creator));
      items = (sort === 'date' ? newestFirst(matchingItems) : matchingItems).slice(0, limit);
      fallbackSucceeded = true;
      if (items.length > 0) method = 'video-search-html';
    } catch (error) {
      fallbackFailure = error;
    }
  }

  if (!primarySucceeded && !fallbackSucceeded && items.length === 0) {
    throw primaryFailure instanceof Error
      ? primaryFailure
      : fallbackFailure instanceof Error
        ? fallbackFailure
        : new ExtractionError('upstream_error', 'The video index did not return search results.', 502);
  }

  const resultUrl = publicUrl(dependencies.resultUrl)
    ?? `https://extractor.sh/api/videos?q=${encodeURIComponent(query)}`;
  return {
    type: 'feed',
    source: 'video-search',
    id: query,
    url: resultUrl,
    title: `Video results for ${query}`,
    author: null,
    publishedAt: null,
    content: markdown(query, items),
    media: [],
    attributes: {
      feedType: 'video-search', query, language, country, videoPlatform: platform, videoSort: sort,
      ...(creator ? { videoCreator: creator } : {}),
      resultCount: items.length,
    },
    items,
    method,
  };
}
