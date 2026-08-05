import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ExtractionError,
  normalizeChoice,
  normalizeCoordinate,
  normalizeCountryCode,
  normalizeLanguageTag,
  normalizeSearchQuery,
  runPublicPlaceSearch,
  toExtractionError,
  type OutputFormat,
  type PlaceType,
} from '../../features/extraction';

export const prerender = false;

function successHeaders(ttl: number, contentType: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'X-Extractor-Cache-TTL': String(ttl),
  });
}

function errorResponse(error: unknown): Response {
  const normalized = toExtractionError(error);
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  if (normalized.retryAfter) headers.set('Retry-After', String(normalized.retryAfter));
  return new Response(JSON.stringify({ error: { code: normalized.code, message: normalized.message } }), {
    status: normalized.status,
    headers,
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  // /api/maps reuses this handler as a compatibility alias. Always represent
  // the canonical Places operation so both URLs have byte-identical cacheable
  // responses and share one Worker cache entry.
  const endpointPath = '/api/places';
  const query = url.searchParams.get('q') ?? '';
  const formatValue = url.searchParams.get('format') ?? 'json';
  const limitValue = url.searchParams.get('limit');
  if (formatValue !== 'json' && formatValue !== 'markdown') {
    return errorResponse(new ExtractionError('invalid_request', 'Format must be json or markdown.', 400));
  }

  let limit: number | undefined;
  if (limitValue !== null) {
    limit = Number(limitValue);
    if (!/^\d+$/.test(limitValue) || !Number.isInteger(limit) || limit < 1 || limit > 10) {
      return errorResponse(new ExtractionError('invalid_request', 'Limit must be an integer from 1 to 10.', 400));
    }
  }

  let normalizedQuery: string;
  let language: string;
  let country: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;
  let type: PlaceType;
  try {
    normalizedQuery = normalizeSearchQuery(query);
    language = normalizeLanguageTag(url.searchParams.get('language') ?? undefined, 'en');
    country = normalizeCountryCode(url.searchParams.get('country') ?? undefined);
    const latitudeValue = url.searchParams.get('lat');
    const longitudeValue = url.searchParams.get('lon');
    if ((latitudeValue === null) !== (longitudeValue === null)) {
      throw new ExtractionError('invalid_request', 'Latitude and longitude must be provided together.', 400);
    }
    if (latitudeValue !== null && longitudeValue !== null) {
      if (!latitudeValue.trim() || !longitudeValue.trim()) {
        throw new ExtractionError('invalid_request', 'Latitude and longitude must be valid numbers.', 400);
      }
      latitude = normalizeCoordinate(Number(latitudeValue), -90, 90, 'Latitude');
      longitude = normalizeCoordinate(Number(longitudeValue), -180, 180, 'Longitude');
    }
    type = normalizeChoice(
      url.searchParams.get('type') ?? undefined,
      ['any', 'house', 'street', 'locality', 'city', 'county', 'state', 'country', 'other'] as const,
      'any',
      'Type',
    );
  } catch (error) {
    return errorResponse(error);
  }

  const format = formatValue as OutputFormat;
  const resultUrl = new URL(endpointPath, 'https://extractor.sh');
  resultUrl.searchParams.set('q', normalizedQuery);
  if (limit !== undefined) resultUrl.searchParams.set('limit', String(limit));
  if (language !== 'en') resultUrl.searchParams.set('language', language);
  if (country) resultUrl.searchParams.set('country', country);
  if (latitude !== undefined && longitude !== undefined) {
    resultUrl.searchParams.set('lat', String(latitude));
    resultUrl.searchParams.set('lon', String(longitude));
  }
  if (type !== 'any') resultUrl.searchParams.set('type', type);
  resultUrl.searchParams.set('format', format);

  try {
    const search = await runPublicPlaceSearch(
      normalizedQuery,
      request.headers.get('cf-connecting-ip') || 'local-development',
      env,
      {
        ...(limit === undefined ? {} : { limit }),
        resultUrl: resultUrl.toString(),
        language,
        ...(country ? { country } : {}),
        ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
        type,
      },
    );
    if (format === 'markdown') {
      return new Response(search.result.content, { headers: successHeaders(search.ttl, 'text/markdown; charset=utf-8') });
    }
    return new Response(JSON.stringify(search.result), { headers: successHeaders(search.ttl, 'application/json; charset=utf-8') });
  } catch (error) {
    return errorResponse(error);
  }
};

export const ALL: APIRoute = () => {
  const endpointPath = '/api/places';
  return new Response(
    JSON.stringify({ error: { code: 'method_not_allowed', message: `Use GET ${endpointPath}.` } }),
    { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } },
  );
};
