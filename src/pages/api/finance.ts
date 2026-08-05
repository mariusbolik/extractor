import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ExtractionError,
  normalizeFinanceQuoteCurrency,
  normalizeFinanceSymbol,
  normalizeFinanceTimeframe,
  runPublicMarketData,
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
  return new Response(JSON.stringify({ error: { code: normalized.code, message: normalized.message } }), {
    status: normalized.status,
    headers,
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const rawSymbol = url.searchParams.get('symbol') ?? '';
  const formatValue = url.searchParams.get('format') ?? 'json';
  if (!rawSymbol.trim()) {
    return errorResponse(new ExtractionError('invalid_request', 'The symbol query parameter is required.', 400));
  }
  if (formatValue !== 'json' && formatValue !== 'markdown') {
    return errorResponse(new ExtractionError('invalid_request', 'Format must be json or markdown.', 400));
  }

  try {
    // Validate known controls before either shared limiter is touched.
    const symbol = normalizeFinanceSymbol(rawSymbol);
    const timeframe = normalizeFinanceTimeframe(url.searchParams.get('timeframe') ?? undefined);
    const quoteCurrency = normalizeFinanceQuoteCurrency(url.searchParams.has('quote')
      ? url.searchParams.get('quote') ?? ''
      : undefined);
    const format = formatValue as OutputFormat;
    const resultUrl = new URL('/api/finance', 'https://extractor.sh');
    resultUrl.searchParams.set('symbol', symbol);
    if (timeframe !== '1mo') resultUrl.searchParams.set('timeframe', timeframe);
    if (quoteCurrency) resultUrl.searchParams.set('quote', quoteCurrency);
    resultUrl.searchParams.set('format', format);

    const market = await runPublicMarketData(
      symbol,
      request.headers.get('cf-connecting-ip') || 'local-development',
      env,
      { timeframe, quoteCurrency, resultUrl: resultUrl.toString() },
    );
    if (format === 'markdown') {
      return new Response(market.result.content, {
        headers: successHeaders(market.ttl, 'text/markdown; charset=utf-8'),
      });
    }
    return new Response(JSON.stringify(market.result), {
      headers: successHeaders(market.ttl, 'application/json; charset=utf-8'),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const ALL: APIRoute = () => new Response(
  JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET /api/finance.' } }),
  { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } },
);
