import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ExtractionError,
  normalizeSearchQuery,
  runPublicStockSearch,
  toExtractionError,
  type OutputFormat,
} from '../../../features/extraction';

export const prerender = false;

function headers(ttl: number, contentType: string): Headers {
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
  const responseHeaders = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  if (normalized.retryAfter) responseHeaders.set('Retry-After', String(normalized.retryAfter));
  return new Response(JSON.stringify({ error: { code: normalized.code, message: normalized.message } }), {
    status: normalized.status,
    headers: responseHeaders,
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const formatValue = url.searchParams.get('format') ?? 'json';
  if (formatValue !== 'json' && formatValue !== 'markdown') {
    return errorResponse(new ExtractionError('invalid_request', 'Format must be json or markdown.', 400));
  }
  const limitValue = url.searchParams.get('limit');
  const instrumentValue = url.searchParams.get('instrument') ?? 'equity';
  if (instrumentValue !== 'equity' && instrumentValue !== 'crypto') {
    return errorResponse(new ExtractionError('invalid_request', 'Instrument must be equity or crypto.', 400));
  }
  let limit: number | undefined;
  if (limitValue !== null) {
    limit = Number(limitValue);
    if (!/^\d+$/.test(limitValue) || !Number.isInteger(limit) || limit < 1 || limit > 10) {
      return errorResponse(new ExtractionError('invalid_request', 'Limit must be an integer from 1 to 10.', 400));
    }
  }

  let query: string;
  try {
    query = normalizeSearchQuery(url.searchParams.get('q') ?? '');
  } catch (error) {
    return errorResponse(error);
  }
  const format = formatValue as OutputFormat;
  const resultUrl = new URL('/api/finance/search', 'https://extractor.sh');
  resultUrl.searchParams.set('q', query);
  if (limit !== undefined) resultUrl.searchParams.set('limit', String(limit));
  if (instrumentValue !== 'equity') resultUrl.searchParams.set('instrument', instrumentValue);
  resultUrl.searchParams.set('format', format);

  try {
    const search = await runPublicStockSearch(
      query,
      request.headers.get('cf-connecting-ip') || 'local-development',
      env,
      {
        ...(limit === undefined ? {} : { limit }),
        instrument: instrumentValue,
        resultUrl: resultUrl.toString(),
      },
    );
    const body = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
    return new Response(body, {
      headers: headers(search.ttl, format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8'),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const ALL: APIRoute = () => new Response(
  JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET /api/finance/search.' } }),
  { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } },
);
