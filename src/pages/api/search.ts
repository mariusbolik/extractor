import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ExtractionError,
  normalizeCountryCode,
  normalizeLanguageTag,
  normalizeSearchQuery,
  normalizeSearchSite,
  runPublicSearch,
  toExtractionError,
  type OutputFormat,
} from '../../features/extraction';

export const prerender = false;

function successHeaders(ttl: number, contentType: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Cache-Tag': 'extractor-api',
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
  return new Response(
    JSON.stringify({ error: { code: normalized.code, message: normalized.message } }),
    { status: normalized.status, headers },
  );
}

export const GET: APIRoute = async ({ request, url }) => {
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
  let country: string;
  let site: string | undefined;
  try {
    normalizedQuery = normalizeSearchQuery(query);
    language = normalizeLanguageTag(url.searchParams.get('language') ?? undefined, 'en-US');
    country = normalizeCountryCode(url.searchParams.get('country') ?? undefined, 'US')!;
    site = normalizeSearchSite(url.searchParams.get('site') ?? undefined);
  } catch (error) {
    return errorResponse(error);
  }

  const format = formatValue as OutputFormat;
  const clientKey = request.headers.get('cf-connecting-ip') || 'local-development';
  // Store a stable extractor.sh URL in the public feed. The upstream search
  // provider is an implementation detail and must never appear in schema data.
  const resultUrl = new URL('/api/search', 'https://extractor.sh');
  resultUrl.searchParams.set('q', normalizedQuery);
  if (limit !== undefined) resultUrl.searchParams.set('limit', String(limit));
  if (language !== 'en-US') resultUrl.searchParams.set('language', language);
  if (country !== 'US') resultUrl.searchParams.set('country', country);
  if (site) resultUrl.searchParams.set('site', site);
  resultUrl.searchParams.set('format', format);

  try {
    // The Worker performs cache lookup before Astro reaches this route. Only a
    // genuine miss reaches runPublicSearch and consumes rate-limit capacity.
    const search = await runPublicSearch(normalizedQuery, clientKey, env, {
      ...(limit === undefined ? {} : { limit }),
      resultUrl: resultUrl.toString(),
      language,
      country,
      ...(site ? { site } : {}),
    });
    if (format === 'markdown') {
      return new Response(search.result.content, {
        headers: successHeaders(search.ttl, 'text/markdown; charset=utf-8'),
      });
    }
    return new Response(JSON.stringify(search.result), {
      headers: successHeaders(search.ttl, 'application/json; charset=utf-8'),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const ALL: APIRoute = () => new Response(
  JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET /api/search.' } }),
  {
    status: 405,
    headers: {
      Allow: 'GET',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);
