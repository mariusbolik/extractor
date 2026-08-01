import { parseHTML } from 'linkedom';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedMedia, ExtractionDependencies, ExtractionResult } from '../types';
import { googlePlayPackageId } from '../url';

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function publicUrl(value: unknown, base?: string): string | null {
  const text = textValue(value);
  if (!text) return null;
  try {
    const url = new URL(text, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageUrl(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageUrl(item);
      if (url) return url;
    }
    return null;
  }
  const object = objectValue(value);
  return object
    ? publicUrl(object.contentUrl) ?? publicUrl(object.url)
    : publicUrl(value);
}

function findSoftwareApplication(value: unknown): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findSoftwareApplication(item);
      if (match) return match;
    }
    return null;
  }
  const object = objectValue(value);
  if (!object) return null;
  const type = Array.isArray(object['@type']) ? object['@type'] : [object['@type']];
  if (type.includes('SoftwareApplication') || type.includes('MobileApplication')) return object;
  return findSoftwareApplication(object['@graph']);
}

function parseStructuredApp(document: Document): JsonObject | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const app = findSoftwareApplication(JSON.parse(script.textContent || ''));
      if (app) return app;
    } catch {
      // Ignore unrelated malformed JSON-LD blocks and continue looking.
    }
  }
  return null;
}

function currencyPrice(value: number, currency: string): number | null {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown currency codes use the common two-decimal convention.
  }
  const price = Math.round(value * (10 ** digits));
  return Number.isSafeInteger(price) ? price : null;
}

function formattedPrice(value: number, currency: string, locale: string): string | null {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function extractGooglePlayApp(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const packageId = googlePlayPackageId(url);
  if (!packageId) throw new ExtractionError('invalid_url', 'Enter a complete Google Play app URL.', 400);

  // Keep only app identity and locale controls. Tracking parameters should not
  // fragment the upstream response or the canonical product representation.
  const endpoint = new URL('https://play.google.com/store/apps/details');
  endpoint.searchParams.set('id', packageId);
  const locale = url.searchParams.get('hl')?.trim() || 'en';
  const country = url.searchParams.get('gl')?.trim().toUpperCase();
  endpoint.searchParams.set('hl', locale);
  if (country && /^[A-Z]{2}$/.test(country)) endpoint.searchParams.set('gl', country);

  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'text/html, application/xhtml+xml;q=0.9',
  );
  const { document } = parseHTML(response.body);
  const app = parseStructuredApp(document as unknown as Document);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute('content')?.trim() || null;
  const title = textValue(app?.name)
    ?? meta('meta[property="og:title"]')?.replace(/\s+-\s+Apps on Google Play$/i, '').trim()
    ?? null;

  if (!title || !app) {
    throw new ExtractionError(
      'extraction_failed',
      'Google Play returned the app page, but no usable app details were found.',
      422,
    );
  }

  const authorObject = objectValue(app.author);
  const developerLink = document.querySelector('a[href*="/store/apps/dev"]');
  const author = textValue(authorObject?.name) ?? textValue(developerLink?.textContent);
  const descriptionNode = document.querySelector('[data-g-id="description"]');
  const description = descriptionNode
    ? htmlFragmentToMarkdown(descriptionNode.innerHTML, endpoint.toString())
    : textValue(app.description) ?? meta('meta[property="og:description"]') ?? '';
  const rating = objectValue(app.aggregateRating);
  const offers = (Array.isArray(app.offers) ? app.offers : [app.offers])
    .map(objectValue)
    .find(Boolean) ?? null;
  const majorPrice = numberValue(offers?.price);
  const currency = textValue(offers?.priceCurrency)?.toUpperCase() ?? null;
  const price = majorPrice !== null && currency ? currencyPrice(majorPrice, currency) : null;
  const priceDisplay = majorPrice === 0
    ? 'Free'
    : majorPrice !== null && currency ? formattedPrice(majorPrice, currency, locale) : null;
  const developerUrl = publicUrl(developerLink?.getAttribute('href'), endpoint.origin)
    ?? publicUrl(authorObject?.url, endpoint.origin);
  const icon = imageUrl(app.image) ?? publicUrl(meta('meta[property="og:image"]'));
  const screenshots = [...document.querySelectorAll('img[alt="Screenshot image"]')]
    .map((image) => publicUrl(image.getAttribute('src')))
    .filter((item): item is string => Boolean(item));
  const media: ExtractedMedia[] = [
    ...(icon ? [{ type: 'image' as const, url: icon, alt: `${title} app icon` }] : []),
    ...[...new Set(screenshots)].slice(0, 20).map((screenshot, index) => ({
      type: 'image' as const,
      url: screenshot,
      alt: `${title} screenshot ${index + 1}`,
    })),
  ];
  const availabilityUrl = textValue(offers?.availability);
  const availability = availabilityUrl?.split('/').pop() ?? null;
  const category = textValue(app.applicationCategory);
  const operatingSystem = textValue(app.operatingSystem);
  const contentRating = textValue(app.contentRating);
  const details = [
    `# ${escapeMarkdown(title)}`,
    author ? `Developer: ${escapeMarkdown(author)}` : '',
    priceDisplay ? `Price: ${escapeMarkdown(priceDisplay)}` : '',
    category ? `Category: ${escapeMarkdown(category)}` : '',
    description,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'product',
    source: 'google-play',
    id: packageId,
    url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}`,
    title,
    author,
    publishedAt: isoDate(app.datePublished),
    content: details,
    media,
    attributes: {
      productType: 'software',
      ...(author ? { brand: author } : {}),
      ...(category ? { category } : {}),
      ...(price !== null && currency ? { price, currency } : {}),
      ...(priceDisplay ? { priceDisplay } : {}),
      ...(availability ? { availability } : {}),
      ...(numberValue(rating?.ratingValue) !== null ? { rating: numberValue(rating?.ratingValue)!, ratingScale: 5 } : {}),
      ...(Number.isSafeInteger(numberValue(rating?.ratingCount)) ? { reviewCount: numberValue(rating?.ratingCount)! } : {}),
      ...(textValue(app.softwareVersion) ? { softwareVersion: textValue(app.softwareVersion)! } : {}),
      ...(operatingSystem ? { operatingSystem } : {}),
      ...(contentRating ? { contentRating } : {}),
      ...(developerUrl ? { developerUrl } : {}),
    },
    method: 'google-play-html',
  };
}
