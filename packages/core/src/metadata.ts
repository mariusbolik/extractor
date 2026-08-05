import { parseHTML } from 'linkedom';
import { normalizeLanguageTag } from './options';
import type { ExtractedMedia } from './types';
import { validateTargetUrl } from './url';

interface ImageCandidate extends ExtractedMedia {
  score: number;
  order: number;
}

export interface PageMetadata {
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  description: string | null;
  language: string | null;
  modifiedAt: string | null;
}

function positiveInteger(value: string | null | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function publicMediaUrl(value: string | null | undefined, pageUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return validateTargetUrl(new URL(value.trim(), pageUrl).toString()).toString();
  } catch {
    return undefined;
  }
}

function dimensions(
  url: string,
  widthValue?: string | null,
  heightValue?: string | null,
): { width?: number; height?: number } {
  const parsed = new URL(url);
  const width = positiveInteger(widthValue)
    ?? positiveInteger(parsed.searchParams.get('width'))
    ?? positiveInteger(parsed.searchParams.get('w'));
  const height = positiveInteger(heightValue)
    ?? positiveInteger(parsed.searchParams.get('height'))
    ?? positiveInteger(parsed.searchParams.get('h'));
  return { width, height };
}

function isLikelyIcon(candidate: Pick<ImageCandidate, 'height' | 'url' | 'width'>): boolean {
  const path = new URL(candidate.url).pathname.toLowerCase();
  if (/\.(?:ico|svg)$/.test(path) || /(?:^|[/_.-])(?:favicon|logo|icon)(?:[/_.-]|$)/.test(path)) return true;
  return Boolean(candidate.width && candidate.height && candidate.width <= 128 && candidate.height <= 128);
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanMetadataText(value: unknown, maximumLength = 4_000): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || ['null', 'undefined'].includes(normalized.toLowerCase())) return null;
  return normalized.slice(0, maximumLength);
}

function structuredObjects(value: unknown, output: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || output.length >= 100 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => structuredObjects(item, output, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  output.push(object);
  Object.values(object).forEach((item) => structuredObjects(item, output, depth + 1));
}

function jsonLdObjects(document: Document): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    const source = script.textContent?.trim() ?? '';
    if (!source || source.length > 500_000) return;
    try {
      structuredObjects(JSON.parse(source), objects);
    } catch {
      // Invalid publisher metadata should not make readable HTML fail.
    }
  });
  return objects.sort((left, right) => {
    const score = (object: Record<string, unknown>) => /(?:article|blogposting|newsarticle)/i.test(String(object['@type'] ?? '')) ? 1 : 0;
    return score(right) - score(left);
  });
}

function structuredAuthor(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map((item) => structuredAuthor(item)).filter(Boolean).join(', ') || null;
  }
  if (value && typeof value === 'object') {
    return cleanMetadataText((value as Record<string, unknown>).name, 300);
  }
  return cleanMetadataText(value, 300);
}

function publishedDate(value: string | null, pageUrl: string): string | null {
  if (!value || new URL(pageUrl).pathname === '/') return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.valueOf() > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

function metadataDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.valueOf() > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

function pageLanguage(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizeLanguageTag(value.replace('_', '-'), 'en');
  } catch {
    return null;
  }
}

/** Extract safe page metadata while reusing an already parsed LinkeDOM tree. */
export function extractPageMetadataFromDocument(document: Document, pageUrl: string): PageMetadata {
  const objects = jsonLdObjects(document);
  const meta = (...selectors: string[]) => {
    for (const selector of selectors) {
      const value = cleanMetadataText(document.querySelector(selector)?.getAttribute('content'));
      if (value) return value;
    }
    return null;
  };
  const structured = (key: string) => {
    for (const object of objects) {
      const value = cleanMetadataText(object[key]);
      if (value) return value;
    }
    return null;
  };

  const rawAuthor = meta('meta[name="author"]', 'meta[property="article:author"]')
    ?? objects.map((object) => structuredAuthor(object.author ?? object.creator)).find(Boolean)
    ?? null;
  const author = rawAuthor && !/^https?:\/\//i.test(rawAuthor) ? rawAuthor : null;
  const rawDate = meta(
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="datePublished"]',
    'meta[itemprop="datePublished"]',
  ) ?? document.querySelector('time[itemprop="datePublished"][datetime]')?.getAttribute('datetime')
    ?? structured('datePublished');
  const rawModified = meta(
    'meta[property="article:modified_time"]',
    'meta[name="dateModified"]',
    'meta[itemprop="dateModified"]',
  ) ?? document.querySelector('time[itemprop="dateModified"][datetime]')?.getAttribute('datetime')
    ?? structured('dateModified');
  const rawLanguage = cleanMetadataText(document.documentElement?.getAttribute('lang'), 100)
    ?? meta('meta[http-equiv="content-language"]', 'meta[property="og:locale"]')
    ?? structured('inLanguage');

  return {
    title: meta('meta[property="og:title"]', 'meta[name="twitter:title"]')
      ?? structured('headline')
      ?? structured('name')
      ?? cleanMetadataText(document.querySelector('title')?.textContent, 500),
    author,
    publishedAt: publishedDate(cleanMetadataText(rawDate), pageUrl),
    description: meta(
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ) ?? structured('description'),
    language: pageLanguage(rawLanguage),
    modifiedAt: metadataDate(cleanMetadataText(rawModified)),
  };
}

function jsonLdImages(value: unknown, output: unknown[], depth = 0): void {
  if (depth > 8 || output.length >= 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => jsonLdImages(item, output, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  const object = value as Record<string, unknown>;
  for (const key of ['image', 'thumbnailUrl']) {
    const image = object[key];
    if (typeof image === 'string') output.push(image);
    else if (Array.isArray(image)) image.forEach((item) => output.push(item));
    else if (image && typeof image === 'object') {
      const imageObject = image as Record<string, unknown>;
      output.push(imageObject.contentUrl ?? imageObject.url);
    }
  }
  Object.values(object).forEach((item) => jsonLdImages(item, output, depth + 1));
}

/**
 * Return one useful visual preview without fetching another resource. Social
 * metadata wins when it points at real artwork. If a publisher advertises only
 * a favicon, use the strongest large in-page image instead (usually the article
 * hero selected by its placement, dimensions, and title-matching alt text).
 */
export function extractPreviewMedia(
  html: string,
  pageUrl: string,
  title?: string | null,
): ExtractedMedia[] {
  const { document } = parseHTML(html);
  return extractPreviewMediaFromDocument(document as unknown as Document, pageUrl, title);
}

/** Same selection logic for callers that already paid to parse the page. */
export function extractPreviewMediaFromDocument(
  document: Document,
  pageUrl: string,
  title?: string | null,
): ExtractedMedia[] {
  const candidates: ImageCandidate[] = [];
  let order = 0;

  const add = (
    value: string | null | undefined,
    score: number,
    options: { alt?: string | null; width?: string | null; height?: string | null } = {},
  ) => {
    const url = publicMediaUrl(value, pageUrl);
    if (!url) return;
    const size = dimensions(url, options.width, options.height);
    const candidate: ImageCandidate = {
      type: 'image',
      url,
      ...(options.alt?.trim() ? { alt: options.alt.trim() } : {}),
      ...size,
      score,
      order: order++,
    };
    if (!isLikelyIcon(candidate)) candidates.push(candidate);
  };

  const metadata = [
    ['meta[property="og:image:secure_url"]', 500],
    ['meta[property="og:image"]', 490],
    ['meta[name="twitter:image:src"]', 480],
    ['meta[name="twitter:image"]', 470],
    ['link[rel="image_src"]', 460],
  ] as const;
  for (const [selector, score] of metadata) {
    document.querySelectorAll(selector).forEach((element) => add(
      element.getAttribute('content') ?? element.getAttribute('href'),
      score,
      {
        alt: document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content'),
        width: document.querySelector('meta[property="og:image:width"]')?.getAttribute('content'),
        height: document.querySelector('meta[property="og:image:height"]')?.getAttribute('content'),
      },
    ));
  }

  const structuredImages: unknown[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    const source = script.textContent?.trim() ?? '';
    if (!source || source.length > 500_000) return;
    try {
      jsonLdImages(JSON.parse(source), structuredImages);
    } catch {
      // Invalid publisher metadata should not make otherwise readable HTML fail.
    }
  });
  structuredImages.forEach((value) => {
    if (typeof value === 'string') add(value, 440);
    else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      add(
        typeof object.contentUrl === 'string' ? object.contentUrl : typeof object.url === 'string' ? object.url : undefined,
        440,
        {
          width: typeof object.width === 'number' ? String(object.width) : undefined,
          height: typeof object.height === 'number' ? String(object.height) : undefined,
        },
      );
    }
  });

  const normalizedTitle = normalizedText(title);
  [...document.querySelectorAll('img')].slice(0, 150).forEach((image, index) => {
    const alt = image.getAttribute('alt');
    const imageUrl = image.getAttribute('src')
      ?? image.getAttribute('data-src')
      ?? image.getAttribute('data-lazy-src');
    let score = Math.max(0, 100 - index);
    if (image.closest('article, main, [role="main"]')) score += 180;
    const normalizedAlt = normalizedText(alt);
    if (normalizedTitle && normalizedAlt) {
      if (normalizedAlt === normalizedTitle) score += 350;
      else if (normalizedTitle.includes(normalizedAlt) || normalizedAlt.includes(normalizedTitle)) score += 180;
    }
    const width = positiveInteger(image.getAttribute('width'));
    const height = positiveInteger(image.getAttribute('height'));
    if (width && height && width >= 300 && height >= 180) score += 140;
    add(imageUrl, score, {
      alt,
      width: image.getAttribute('width'),
      height: image.getAttribute('height'),
    });
  });

  const best = candidates.sort((left, right) => right.score - left.score || left.order - right.order)[0];
  if (!best) return [];
  const { score: _score, order: _order, ...media } = best;
  return [media];
}
