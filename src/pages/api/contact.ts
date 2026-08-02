import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ContactError, submitContact } from '../../features/contact/contact';

export const prerender = false;

const MAX_BODY_BYTES = 16_384;

function responseHeaders(contentType: string): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  };
}

function wantsJson(request: Request): boolean {
  return request.headers.get('accept')?.includes('application/json') ?? false;
}

function errorResponse(request: Request, error: ContactError): Response {
  if (!wantsJson(request)) {
    return Response.redirect(new URL(`/contact/?error=${error.code}`, request.url), 303);
  }

  return Response.json(
    { ok: false, error: { code: error.code, message: error.message } },
    { status: error.status, headers: responseHeaders('application/json; charset=utf-8') },
  );
}

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return errorResponse(request, new ContactError('invalid_request', 'This form must be submitted from extractor.sh.', 403));
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(request, new ContactError('invalid_request', 'The message is too large.', 413));
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded') && !contentType.startsWith('multipart/form-data')) {
    return errorResponse(request, new ContactError('invalid_request', 'Submit the contact form using standard form data.', 415));
  }

  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return errorResponse(request, new ContactError('invalid_request', 'The message is too large.', 413));
    }
    const form = await new Request(request, { body }).formData();
    const submission = Object.fromEntries(form.entries());
    const clientKey = request.headers.get('cf-connecting-ip') || 'local-development';
    await submitContact(submission, clientKey, {
      email: env.CONTACT_EMAIL,
      rateLimiter: env.CONTACT_RATE_LIMITER,
    });

    if (wantsJson(request)) {
      return Response.json(
        { ok: true },
        { headers: responseHeaders('application/json; charset=utf-8') },
      );
    }
    return Response.redirect(new URL('/contact/?sent=1', request.url), 303);
  } catch (error) {
    if (error instanceof ContactError) return errorResponse(request, error);
    return errorResponse(request, new ContactError('invalid_request', 'The form could not be read.', 400));
  }
};

export const ALL: APIRoute = () => new Response(
  JSON.stringify({ ok: false, error: { code: 'method_not_allowed', message: 'Use POST /api/contact.' } }),
  {
    status: 405,
    headers: { ...responseHeaders('application/json; charset=utf-8'), Allow: 'POST' },
  },
);
