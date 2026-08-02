import { parseHTML } from 'linkedom';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
import type { ExtractedMedia, ExtractionDependencies, ExtractionResult } from '../types';
import { appStoreTrackId } from '../url';

interface AppStoreLookupResult {
  trackId?: number;
  trackName?: string;
  trackViewUrl?: string;
  artistName?: string;
  artistViewUrl?: string;
  sellerUrl?: string;
  bundleId?: string;
  description?: string;
  releaseNotes?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  price?: number;
  formattedPrice?: string;
  currency?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  version?: string;
  minimumOsVersion?: string;
  contentAdvisoryRating?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  operatingSystem?: string;
}

interface AppleChartResult {
  artistName?: string;
  id?: string;
  name?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  url?: string;
}

type JsonObject = Record<string, unknown>;

const APPLE_API_HEADERS = {
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
  // Apple intermittently rejects Cloudflare Worker requests that identify as a
  // bot. This is the same browser-compatible API identity used by ClickYourApp.
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
};

// Apple asks larger Search API consumers to cache lookups. Cache successful
// app metadata at the Cloudflare subrequest layer so different extractor URLs
// and formats do not repeatedly consume Apple's small global request budget.
const APPLE_APP_CACHE: RequestInitCfProperties = {
  cacheEverything: true,
  cacheTtl: 60 * 60 * 24 * 7,
  cacheTtlByStatus: { '200-299': 60 * 60 * 24 * 7, '300-599': 0 },
};

const APPLE_CHART_CACHE: RequestInitCfProperties = {
  cacheEverything: true,
  cacheTtl: 60 * 60,
  cacheTtlByStatus: { '200-299': 60 * 60, '300-599': 0 },
};

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
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
  const types = Array.isArray(object['@type']) ? object['@type'] : [object['@type']];
  if (types.includes('SoftwareApplication') || types.includes('MobileApplication')) return object;
  return findSoftwareApplication(object['@graph']);
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function minorUnitPrice(value: unknown, currency: string | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown currency codes use the common two-decimal convention.
  }
  const price = Math.round(value * (10 ** digits));
  return Number.isSafeInteger(price) ? price : null;
}

function appStoreCountry(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return segment && /^[a-z]{2}$/.test(segment) ? segment : 'us';
}

function appStoreSearchTerms(url: URL): string[] {
  const segments = url.pathname.split('/').filter(Boolean);
  const idIndex = segments.findIndex((segment) => /^id\d{5,20}$/i.test(segment));
  if (idIndex < 1) return [];

  let slug = segments[idIndex - 1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Keep the encoded slug; normalization below will still make it safe.
  }

  const fullTerm = slug
    .replace(/[-_.+]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!fullTerm) return [];

  // A shorter title-shaped query helps when Apple's search ranking treats a
  // long SEO slug as too specific. Results still must match the numeric ID.
  const shortTerm = fullTerm.split(' ').slice(0, 3).join(' ');
  return [...new Set([fullTerm, shortTerm].filter((term) => term.length > 0))];
}

async function fetchAppleResults(
  endpoint: URL,
  dependencies: ExtractionDependencies,
): Promise<AppStoreLookupResult[]> {
  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'application/json',
    APPLE_API_HEADERS,
    APPLE_APP_CACHE,
  );

  try {
    const payload = JSON.parse(response.body) as { results?: AppStoreLookupResult[] };
    if (!Array.isArray(payload.results)) throw new Error('Missing results');
    return payload.results;
  } catch {
    throw new ExtractionError('extraction_failed', 'Apple returned an invalid app API response.', 502);
  }
}

function appleRateLimited(error: unknown): boolean {
  return error instanceof ExtractionError
    && error.code === 'upstream_error'
    && error.message.includes('HTTP 429');
}

function formattedPrice(value: number, currency: string, locale: string): string | undefined {
  if (value === 0) return 'Free';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return undefined;
  }
}

async function fetchAppleHtmlResult(
  url: URL,
  trackId: string,
  dependencies: ExtractionDependencies,
): Promise<AppStoreLookupResult | undefined> {
  const endpoint = new URL(url.toString());
  endpoint.search = '';
  endpoint.hash = '';
  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'text/html, application/xhtml+xml;q=0.9',
    APPLE_API_HEADERS,
    APPLE_APP_CACHE,
  );
  const { document } = parseHTML(response.body);
  let app: JsonObject | null = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      app = findSoftwareApplication(JSON.parse(script.textContent || ''));
      if (app) break;
    } catch {
      // Ignore unrelated malformed JSON-LD and continue to the app block.
    }
  }
  if (!app) return undefined;

  const author = objectValue(app.author);
  const rating = objectValue(app.aggregateRating);
  const offers = (Array.isArray(app.offers) ? app.offers : [app.offers])
    .map(objectValue)
    .find(Boolean) ?? null;
  const price = numberValue(offers?.price);
  const currency = textValue(offers?.priceCurrency)?.toUpperCase();
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? endpoint.toString();
  try {
    if (appStoreTrackId(new URL(canonical, endpoint)) !== trackId) return undefined;
  } catch {
    return undefined;
  }

  return {
    trackId: Number(trackId),
    trackName: textValue(app.name) ?? undefined,
    trackViewUrl: canonical,
    artistName: textValue(author?.name) ?? undefined,
    artistViewUrl: textValue(author?.url) ?? undefined,
    description: textValue(app.description) ?? undefined,
    artworkUrl512: textValue(app.image) ?? undefined,
    price: price ?? undefined,
    currency,
    formattedPrice: price !== null && currency
      ? formattedPrice(price, currency, appStoreCountry(url))
      : undefined,
    averageUserRating: numberValue(rating?.ratingValue) ?? undefined,
    userRatingCount: numberValue(rating?.reviewCount) ?? undefined,
    version: textValue(app.softwareVersion) ?? undefined,
    contentAdvisoryRating: textValue(app.contentRating) ?? undefined,
    primaryGenreName: textValue(app.applicationSubCategory) ?? textValue(app.applicationCategory) ?? undefined,
    releaseDate: textValue(app.datePublished) ?? undefined,
    operatingSystem: textValue(app.operatingSystem) ?? undefined,
  };
}

async function fetchAppleChartResult(
  country: string,
  trackId: string,
  dependencies: ExtractionDependencies,
): Promise<AppStoreLookupResult | undefined> {
  for (const chart of ['top-free', 'top-paid']) {
    const endpoint = new URL(`https://rss.marketingtools.apple.com/api/v2/${country}/apps/${chart}/100/apps.json`);
    try {
      const response = await fetchPublicPage(
        endpoint,
        dependencies.fetcher ?? fetch,
        'application/json',
        APPLE_API_HEADERS,
        APPLE_CHART_CACHE,
      );
      const payload = JSON.parse(response.body) as { feed?: { results?: AppleChartResult[] } };
      const item = payload.feed?.results?.find((entry) => entry.id === trackId);
      if (!item?.name) continue;
      return {
        trackId: Number(trackId),
        trackName: item.name,
        trackViewUrl: item.url,
        artistName: item.artistName,
        artworkUrl100: item.artworkUrl100,
        releaseDate: item.releaseDate,
        ...(chart === 'top-free' ? { price: 0, formattedPrice: 'Free' } : {}),
      };
    } catch {
      // Chart metadata is a final cheap rescue path; preserve the more useful
      // Lookup/Search/HTML error if this feed is unavailable too.
    }
  }
  return undefined;
}

function canonicalAppUrl(value: unknown, fallback: URL): string {
  const publicValue = publicUrl(value);
  const canonical = new URL(publicValue ?? fallback.toString());
  canonical.search = '';
  canonical.hash = '';
  return canonical.toString();
}

export async function extractAppStoreApp(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const trackId = appStoreTrackId(url);
  if (!trackId) throw new ExtractionError('invalid_url', 'Enter a complete Apple App Store app URL.', 400);

  // The numeric ID in every normal App Store app URL maps directly to Apple's
  // public lookup response, avoiding a large storefront page and any browser run.
  const endpoint = new URL('https://itunes.apple.com/lookup');
  endpoint.searchParams.set('id', trackId);
  endpoint.searchParams.set('country', appStoreCountry(url));
  endpoint.searchParams.set('entity', 'software');
  let result: AppStoreLookupResult | undefined;
  let lookupError: unknown;
  let receivedAppleResponse = false;
  let method: ExtractionResult['method'] = 'app-store-lookup';
  try {
    const results = await fetchAppleResults(endpoint, dependencies);
    receivedAppleResponse = true;
    result = results.find((item) => String(item.trackId) === trackId);
  } catch (error) {
    lookupError = error;
  }

  // Apple sometimes returns 403 to Lookup API calls from Cloudflare Workers.
  // Its public Search API remains available, so use the human-readable app slug
  // and accept only an exact numeric ID match. Users always submit the normal
  // apps.apple.com page; this fallback stays entirely internal.
  if (!result && !appleRateLimited(lookupError)) {
    for (const term of appStoreSearchTerms(url)) {
      const searchEndpoint = new URL('https://itunes.apple.com/search');
      searchEndpoint.searchParams.set('term', term);
      searchEndpoint.searchParams.set('entity', 'software');
      searchEndpoint.searchParams.set('country', appStoreCountry(url));
      searchEndpoint.searchParams.set('limit', '25');

      try {
        const results = await fetchAppleResults(searchEndpoint, dependencies);
        receivedAppleResponse = true;
        result = results.find((item) => String(item.trackId) === trackId);
        if (result) break;
      } catch (error) {
        lookupError = error;
        if (appleRateLimited(error)) break;
      }
    }
  }

  // The normal App Store page publishes localized SoftwareApplication JSON-LD.
  // It is independent from the tightly limited Search API and retains useful
  // metadata even while lookup requests are returning 429.
  if (!result) {
    try {
      result = await fetchAppleHtmlResult(url, trackId, dependencies);
      if (result) {
        receivedAppleResponse = true;
        method = 'app-store-html';
      }
    } catch (error) {
      lookupError = error;
    }
  }

  // Apple's public Marketing Tools chart feeds are small and separately
  // cached. They provide a basic product result for ranked apps if both the
  // lookup service and the storefront page are temporarily blocked.
  if (!result) {
    result = await fetchAppleChartResult(appStoreCountry(url), trackId, dependencies);
    if (result) {
      receivedAppleResponse = true;
      method = 'app-store-chart';
    }
  }

  const title = result?.trackName?.trim();
  if (!result || !title) {
    if (!receivedAppleResponse && lookupError instanceof ExtractionError) throw lookupError;
    throw new ExtractionError('not_found', 'Apple did not return an app for this App Store URL.', 404);
  }

  const canonicalUrl = canonicalAppUrl(result.trackViewUrl, url);
  const author = result.artistName?.trim() || null;
  const description = result.description?.trim() || '';
  const currency = result.currency?.toUpperCase();
  const price = minorUnitPrice(result.price, currency);
  const icon = publicUrl(result.artworkUrl512) ?? publicUrl(result.artworkUrl100);
  const screenshots = [...(result.screenshotUrls ?? []), ...(result.ipadScreenshotUrls ?? [])]
    .map(publicUrl)
    .filter((item): item is string => Boolean(item));
  const media: ExtractedMedia[] = [
    ...(icon ? [{ type: 'image' as const, url: icon, alt: `${title} app icon` }] : []),
    ...[...new Set(screenshots)].slice(0, 20).map((screenshot, index) => ({
      type: 'image' as const,
      url: screenshot,
      alt: `${title} screenshot ${index + 1}`,
    })),
  ];
  const details = [
    `# ${escapeMarkdown(title)}`,
    author ? `Developer: ${escapeMarkdown(author)}` : '',
    result.formattedPrice ? `Price: ${escapeMarkdown(result.formattedPrice)}` : '',
    result.primaryGenreName ? `Category: ${escapeMarkdown(result.primaryGenreName)}` : '',
    result.version ? `Version: ${escapeMarkdown(result.version)}` : '',
    description,
    result.releaseNotes?.trim() ? `## What's new\n\n${result.releaseNotes.trim()}` : '',
  ].filter(Boolean).join('\n\n');
  const developerUrl = publicUrl(result.sellerUrl) ?? publicUrl(result.artistViewUrl);

  return {
    type: 'product',
    source: 'app-store',
    id: trackId,
    url: canonicalUrl,
    title,
    author,
    publishedAt: isoDate(result.releaseDate),
    content: details,
    media,
    attributes: {
      productType: 'software',
      ...(author ? { brand: author } : {}),
      ...(result.primaryGenreName ? { category: result.primaryGenreName } : {}),
      ...(price !== null ? { price, ...(currency ? { currency } : {}) } : {}),
      ...(result.formattedPrice ? { priceDisplay: result.formattedPrice } : {}),
      availability: 'available',
      ...(typeof result.averageUserRating === 'number' ? { rating: result.averageUserRating, ratingScale: 5 } : {}),
      ...(Number.isSafeInteger(result.userRatingCount) && result.userRatingCount! >= 0 ? { reviewCount: result.userRatingCount } : {}),
      ...(result.version ? { softwareVersion: result.version } : {}),
      ...(result.operatingSystem
        ? { operatingSystem: result.operatingSystem }
        : result.minimumOsVersion ? { operatingSystem: `iOS ${result.minimumOsVersion} or later` } : {}),
      ...(result.contentAdvisoryRating ? { contentRating: result.contentAdvisoryRating } : {}),
      ...(developerUrl ? { developerUrl } : {}),
    },
    method,
  };
}
