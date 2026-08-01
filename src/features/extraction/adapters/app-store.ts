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
  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'application/json',
  );

  let result: AppStoreLookupResult | undefined;
  try {
    const payload = JSON.parse(response.body) as { results?: AppStoreLookupResult[] };
    result = payload.results?.find((item) => String(item.trackId) === trackId);
  } catch {
    throw new ExtractionError('extraction_failed', 'Apple returned an invalid app lookup response.', 502);
  }

  const title = result?.trackName?.trim();
  if (!result || !title) {
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
      ...(price !== null && currency ? { price, currency } : {}),
      ...(result.formattedPrice ? { priceDisplay: result.formattedPrice } : {}),
      availability: 'available',
      ...(typeof result.averageUserRating === 'number' ? { rating: result.averageUserRating, ratingScale: 5 } : {}),
      ...(Number.isSafeInteger(result.userRatingCount) && result.userRatingCount! >= 0 ? { reviewCount: result.userRatingCount } : {}),
      ...(result.version ? { softwareVersion: result.version } : {}),
      ...(result.minimumOsVersion ? { operatingSystem: `iOS ${result.minimumOsVersion} or later` } : {}),
      ...(result.contentAdvisoryRating ? { contentRating: result.contentAdvisoryRating } : {}),
      ...(developerUrl ? { developerUrl } : {}),
    },
    method: 'app-store-lookup',
  };
}
