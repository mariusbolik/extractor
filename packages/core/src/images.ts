import { parseHTML } from 'linkedom';
import { ExtractionError } from './errors';
import { fetchPublicPage } from './fetch';
import { escapeMarkdown } from './markdown';
import { normalizeChoice } from './options';
import { normalizeSearchQuery } from './search';
import type { ExtractedItem, ExtractionResult, ImageOrientation, ImageSearchDependencies, ImageUsage } from './types';

const MAX_RESULTS = 20;
const IMAGE_USAGES = ['all', 'commercial', 'modify', 'commercial-and-modify'] as const;
const IMAGE_ORIENTATIONS = ['any', 'landscape', 'portrait', 'square'] as const;

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new ExtractionError('invalid_request', `Limit must be an integer from 1 to ${MAX_RESULTS}.`, 400);
  }
  return value;
}

function publicHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function plainText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const { document } = parseHTML(`<html><body>${String(value)}</body></html>`);
  return (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value.flatMap((entry) => {
    if (typeof entry === 'string') return [plainText(entry)];
    if (entry && typeof entry === 'object') return [plainText((entry as Record<string, unknown>).name)];
    return [];
  }).filter(Boolean);
  return [...new Set(tags)].slice(0, 50);
}

function imageOrientation(width: number | undefined, height: number | undefined): Exclude<ImageOrientation, 'any'> | undefined {
  if (!width || !height) return undefined;
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function fileType(value: unknown, imageUrl: string): string | undefined {
  const explicit = plainText(value).toLowerCase();
  if (explicit) return explicit.slice(0, 100);
  const extension = new URL(imageUrl).pathname.match(/\.([a-z0-9]{2,8})$/i)?.[1];
  return extension?.toLowerCase();
}

function imageItem(input: {
  id: string | null;
  url: string;
  title: string;
  creator: string | null;
  description: string;
  imageUrl: string;
  width?: number;
  height?: number;
  license?: string;
  licenseUrl?: string;
  creatorUrl?: string;
  fileType?: string;
  tags?: string[];
}): ExtractedItem {
  const author = input.creator || null;
  const licenseLine = input.license
    ? input.licenseUrl
      ? `License: [${escapeMarkdown(input.license)}](${input.licenseUrl})`
      : `License: ${escapeMarkdown(input.license)}`
    : '';
  const content = [
    `## ${escapeMarkdown(input.title)}`,
    author ? `Creator: ${escapeMarkdown(author)}` : '',
    licenseLine,
    input.description ? escapeMarkdown(input.description) : '',
    `![${escapeMarkdown(input.title)}](${input.imageUrl})`,
    `[View image source](${input.url})`,
  ].filter(Boolean).join('\n\n');
  const orientation = imageOrientation(input.width, input.height);

  return {
    type: 'document',
    source: 'image-search',
    id: input.id,
    url: input.url,
    title: input.title,
    author,
    publishedAt: null,
    content,
    media: [{
      type: 'image',
      url: input.imageUrl,
      alt: input.title,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    }],
    attributes: {
      ...(input.description ? { description: input.description } : {}),
      ...(input.license ? { license: input.license } : {}),
      ...(input.licenseUrl ? { licenseUrl: input.licenseUrl } : {}),
      ...(input.creatorUrl ? { creatorUrl: input.creatorUrl } : {}),
      ...(input.fileType ? { fileType: input.fileType } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(orientation ? { orientation } : {}),
    },
  };
}

function openverseEndpoint(query: string, limit: number, usage: ImageUsage, orientation: ImageOrientation): URL {
  const endpoint = new URL('https://api.openverse.org/v1/images/');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('page_size', String(limit));
  endpoint.searchParams.set('mature', 'false');
  if (usage !== 'all') {
    endpoint.searchParams.set('license_type', usage === 'commercial-and-modify'
      ? 'commercial,modification'
      : usage === 'modify' ? 'modification' : 'commercial');
  }
  if (orientation !== 'any') {
    endpoint.searchParams.set('aspect_ratio', orientation === 'landscape'
      ? 'wide'
      : orientation === 'portrait' ? 'tall' : 'square');
  }
  return endpoint;
}

function parseOpenverse(body: string): ExtractedItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ExtractionError('upstream_error', 'Image search returned malformed data.', 502);
  }

  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) {
    throw new ExtractionError('upstream_error', 'Image search returned an unexpected response.', 502);
  }

  const items: ExtractedItem[] = [];
  for (const value of results) {
    if (!value || typeof value !== 'object') continue;
    const image = value as Record<string, unknown>;
    const imageUrl = publicHttpUrl(image.url);
    if (!imageUrl) continue;
    const pageUrl = publicHttpUrl(image.foreign_landing_url) ?? imageUrl;
    const title = plainText(image.title) || 'Untitled image';
    const creator = plainText(image.creator) || null;
    const creatorUrl = publicHttpUrl(image.creator_url) ?? undefined;
    const description = plainText(image.description);
    const licenseName = plainText(image.license).toUpperCase();
    const licenseVersion = plainText(image.license_version);
    const license = [licenseName, licenseVersion].filter(Boolean).join(' ');
    const licenseUrl = publicHttpUrl(image.license_url) ?? undefined;

    items.push(imageItem({
      id: typeof image.id === 'string' ? image.id : null,
      url: pageUrl,
      title,
      creator,
      description,
      imageUrl,
      width: positiveInteger(image.width),
      height: positiveInteger(image.height),
      ...(license ? { license } : {}),
      ...(licenseUrl ? { licenseUrl } : {}),
      ...(creatorUrl ? { creatorUrl } : {}),
      ...(fileType(image.filetype, imageUrl) ? { fileType: fileType(image.filetype, imageUrl) } : {}),
      ...(cleanTags(image.tags).length ? { tags: cleanTags(image.tags) } : {}),
    }));
  }
  return items;
}

function wikimediaEndpoint(query: string, limit: number): URL {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('generator', 'search');
  endpoint.searchParams.set('gsrsearch', query);
  endpoint.searchParams.set('gsrnamespace', '6');
  endpoint.searchParams.set('gsrlimit', String(limit));
  endpoint.searchParams.set('prop', 'imageinfo');
  endpoint.searchParams.set('iiprop', 'url|extmetadata|mime');
  endpoint.searchParams.set('iiurlwidth', '1600');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('formatversion', '2');
  endpoint.searchParams.set('origin', '*');
  return endpoint;
}

function metadataValue(metadata: unknown, key: string): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const value = (metadata as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object') return '';
  return plainText((value as Record<string, unknown>).value);
}

function metadataUrl(metadata: unknown, key: string, base: string): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>).value;
  if (typeof raw !== 'string') return undefined;
  const { document } = parseHTML(`<html><body>${raw}</body></html>`);
  return publicHttpUrl(document.querySelector('a[href]')?.getAttribute('href'), base) ?? undefined;
}

function parseWikimedia(body: string): ExtractedItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ExtractionError('upstream_error', 'Image search returned malformed data.', 502);
  }

  const pages = (payload as { query?: { pages?: unknown } })?.query?.pages;
  if (pages === undefined) return [];
  if (!Array.isArray(pages)) {
    throw new ExtractionError('upstream_error', 'Image search returned an unexpected response.', 502);
  }

  const items: ExtractedItem[] = [];
  for (const value of pages) {
    if (!value || typeof value !== 'object') continue;
    const page = value as Record<string, unknown>;
    const info = Array.isArray(page.imageinfo) && page.imageinfo[0] && typeof page.imageinfo[0] === 'object'
      ? page.imageinfo[0] as Record<string, unknown>
      : null;
    if (!info) continue;
    const imageUrl = publicHttpUrl(info.thumburl) ?? publicHttpUrl(info.url);
    const pageUrl = publicHttpUrl(info.descriptionurl);
    if (!imageUrl || !pageUrl) continue;
    const rawTitle = plainText(page.title).replace(/^File:/i, '').trim();
    const title = rawTitle || 'Untitled image';
    const metadata = info.extmetadata;
    const creator = metadataValue(metadata, 'Artist') || null;
    const creatorUrl = metadataUrl(metadata, 'Artist', 'https://commons.wikimedia.org') ?? undefined;
    const description = metadataValue(metadata, 'ImageDescription');
    const license = metadataValue(metadata, 'LicenseShortName');
    const licenseUrl = publicHttpUrl(metadataValue(metadata, 'LicenseUrl')) ?? undefined;

    items.push(imageItem({
      id: page.pageid !== undefined ? String(page.pageid) : null,
      url: pageUrl,
      title,
      creator,
      description,
      imageUrl,
      width: positiveInteger(info.thumbwidth ?? info.width),
      height: positiveInteger(info.thumbheight ?? info.height),
      ...(license ? { license } : {}),
      ...(licenseUrl ? { licenseUrl } : {}),
      ...(creatorUrl ? { creatorUrl } : {}),
      ...(fileType(info.mime, imageUrl) ? { fileType: fileType(info.mime, imageUrl) } : {}),
    }));
  }
  return items;
}

function resultFeed(
  query: string,
  resultUrl: string,
  items: ExtractedItem[],
  method: 'image-search-openverse' | 'image-search-wikimedia',
  usage: ImageUsage,
  orientation: ImageOrientation,
): ExtractionResult {
  const title = `Image results for ${query}`;
  return {
    type: 'feed',
    source: 'image-search',
    id: query,
    url: resultUrl,
    title,
    author: null,
    publishedAt: null,
    content: [`# ${escapeMarkdown(title)}`, ...items.map((item) => item.content)].join('\n\n---\n\n'),
    media: [],
    attributes: { feedType: 'image-search', query, usage, orientation, resultCount: items.length },
    items,
    method,
  };
}

function licenseCapabilities(item: ExtractedItem): { commercial: boolean; modify: boolean } {
  const license = `${item.attributes.license ?? ''} ${item.attributes.licenseUrl ?? ''}`.toLowerCase();
  if (!license) return { commercial: false, modify: false };
  const publicDomain = /(?:cc0|pdm|public[ -]domain)/.test(license);
  return {
    commercial: publicDomain || !/(?:by-?nc|licenses\/[^/]*nc)/.test(license),
    modify: publicDomain || !/(?:by-?nd|licenses\/[^/]*nd)/.test(license),
  };
}

function matchesFilters(item: ExtractedItem, usage: ImageUsage, orientation: ImageOrientation): boolean {
  if (orientation !== 'any' && item.attributes.orientation !== orientation) return false;
  if (usage === 'all') return true;
  const capabilities = licenseCapabilities(item);
  if (usage === 'commercial') return capabilities.commercial;
  if (usage === 'modify') return capabilities.modify;
  return capabilities.commercial && capabilities.modify;
}

/**
 * Search openly licensed images without launching a browser or accepting an
 * arbitrary upstream URL. The first public catalog usually supplies richer
 * cross-provider results; the second public catalog is only contacted when the
 * first source fails or returns no usable images.
 */
export async function searchImages(
  rawQuery: string,
  dependencies: ImageSearchDependencies = {},
): Promise<ExtractionResult> {
  const query = normalizeSearchQuery(rawQuery);
  const limit = normalizedLimit(dependencies.limit);
  const usage = normalizeChoice(dependencies.usage, IMAGE_USAGES, 'all', 'Usage');
  const orientation = normalizeChoice(dependencies.orientation, IMAGE_ORIENTATIONS, 'any', 'Orientation');
  const resultUrl = publicHttpUrl(dependencies.resultUrl)
    ?? `https://extractor.sh/api/images?q=${encodeURIComponent(query)}`;
  let primaryWasValid = false;

  try {
    const response = await fetchPublicPage(
      openverseEndpoint(query, limit, usage, orientation),
      dependencies.fetcher,
      'application/json',
    );
    if (!/application\/json/i.test(response.contentType)) {
      throw new ExtractionError('upstream_error', 'Image search returned an unexpected response.', 502);
    }
    const items = parseOpenverse(response.body).filter((item) => matchesFilters(item, usage, orientation)).slice(0, limit);
    primaryWasValid = true;
    if (items.length > 0) return resultFeed(query, resultUrl, items, 'image-search-openverse', usage, orientation);
  } catch {
    // A second independent, public image catalog provides a cheap fallback.
  }

  try {
    const response = await fetchPublicPage(
      wikimediaEndpoint(query, limit),
      dependencies.fetcher,
      'application/json',
    );
    if (!/application\/json/i.test(response.contentType)) {
      throw new ExtractionError('upstream_error', 'Image search returned an unexpected response.', 502);
    }
    return resultFeed(
      query,
      resultUrl,
      parseWikimedia(response.body).filter((item) => matchesFilters(item, usage, orientation)).slice(0, limit),
      'image-search-wikimedia',
      usage,
      orientation,
    );
  } catch {
    if (primaryWasValid) {
      return resultFeed(query, resultUrl, [], 'image-search-openverse', usage, orientation);
    }
    throw new ExtractionError('upstream_error', 'Image search is temporarily unavailable.', 502);
  }
}
