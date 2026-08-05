import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ExtractionError,
  normalizeChoice,
  normalizeSearchQuery,
  runPublicImageSearch,
  toExtractionError,
  type OutputFormat,
  type ImageOrientation,
  type ImageUsage,
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
  const query = url.searchParams.get('q') ?? '';
  const formatValue = url.searchParams.get('format') ?? 'json';
  const limitValue = url.searchParams.get('limit');
  if (formatValue !== 'json' && formatValue !== 'markdown') {
    return errorResponse(new ExtractionError('invalid_request', 'Format must be json or markdown.', 400));
  }

  let limit: number | undefined;
  if (limitValue !== null) {
    limit = Number(limitValue);
    if (!/^\d+$/.test(limitValue) || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      return errorResponse(new ExtractionError('invalid_request', 'Limit must be an integer from 1 to 20.', 400));
    }
  }

  let normalizedQuery: string;
  let usage: ImageUsage;
  let orientation: ImageOrientation;
  try {
    normalizedQuery = normalizeSearchQuery(query);
    usage = normalizeChoice(
      url.searchParams.get('usage') ?? undefined,
      ['all', 'commercial', 'modify', 'commercial-and-modify'] as const,
      'all',
      'Usage',
    );
    orientation = normalizeChoice(
      url.searchParams.get('orientation') ?? undefined,
      ['any', 'landscape', 'portrait', 'square'] as const,
      'any',
      'Orientation',
    );
  } catch (error) {
    return errorResponse(error);
  }

  const format = formatValue as OutputFormat;
  const resultUrl = new URL('/api/images', 'https://extractor.sh');
  resultUrl.searchParams.set('q', normalizedQuery);
  if (limit !== undefined) resultUrl.searchParams.set('limit', String(limit));
  if (usage !== 'all') resultUrl.searchParams.set('usage', usage);
  if (orientation !== 'any') resultUrl.searchParams.set('orientation', orientation);
  resultUrl.searchParams.set('format', format);

  try {
    const search = await runPublicImageSearch(
      normalizedQuery,
      request.headers.get('cf-connecting-ip') || 'local-development',
      env,
      { ...(limit === undefined ? {} : { limit }), resultUrl: resultUrl.toString(), usage, orientation },
    );
    if (format === 'markdown') {
      return new Response(search.result.content, { headers: successHeaders(search.ttl, 'text/markdown; charset=utf-8') });
    }
    return new Response(JSON.stringify(search.result), { headers: successHeaders(search.ttl, 'application/json; charset=utf-8') });
  } catch (error) {
    return errorResponse(error);
  }
};

export const ALL: APIRoute = () => new Response(
  JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET /api/images.' } }),
  { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } },
);
