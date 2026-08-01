import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  ExtractionError,
  runPublicExtraction,
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
  const rawUrl = url.searchParams.get('url')?.trim() ?? '';
  const formatValue = url.searchParams.get('format') ?? 'json';

  if (!rawUrl) return errorResponse(new ExtractionError('invalid_request', 'The url query parameter is required.', 400));
  if (formatValue !== 'json' && formatValue !== 'markdown') {
    return new Response(
      JSON.stringify({ error: { code: 'invalid_request', message: 'Format must be json or markdown.' } }),
      {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
      },
    );
  }

  const format = formatValue as OutputFormat;
  const clientKey = request.headers.get('cf-connecting-ip') || 'local-development';

  try {
    const { result, ttl } = await runPublicExtraction(rawUrl, clientKey, env);
    if (format === 'markdown') {
      return new Response(result.content, {
        headers: successHeaders(ttl, 'text/markdown; charset=utf-8'),
      });
    }

    return new Response(JSON.stringify(result), {
      headers: successHeaders(ttl, 'application/json; charset=utf-8'),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const ALL: APIRoute = () => new Response(
  JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET /api/extract.' } }),
  {
    status: 405,
    headers: {
      Allow: 'GET',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);
