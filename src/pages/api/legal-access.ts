import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  createLegalAccessCookie,
  normalizeLegalPath,
  verifyLegalTurnstile,
} from '../../features/legal/access';

export const prerender = false;

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export const POST: APIRoute = async ({ request }) => {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== requestUrl.origin) {
    return new Response('Invalid request origin.', { status: 403, headers: responseHeaders });
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded') && !contentType.startsWith('multipart/form-data')) {
    return new Response('Submit the verification form.', { status: 415, headers: responseHeaders });
  }

  const rate = await env.EXTRACT_RATE_LIMITER.limit({
    key: `legal:${request.headers.get('cf-connecting-ip') || 'local-development'}`,
  });
  if (!rate.success) {
    return new Response('Too many verification attempts. Please wait a minute.', {
      status: 429,
      headers: { ...responseHeaders, 'Retry-After': '60' },
    });
  }

  const form = await request.formData();
  const next = normalizeLegalPath(form.get('next'));
  const valid = await verifyLegalTurnstile(
    form.get('cf-turnstile-response'),
    request.headers.get('cf-connecting-ip'),
    env.TURNSTILE_SECRET_KEY,
    requestUrl.hostname,
  );
  if (!valid) {
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders,
        Location: new URL(`${next}?gate=failed`, requestUrl.origin).toString(),
      },
    });
  }

  return new Response(null, {
    status: 303,
    headers: {
      ...responseHeaders,
      Location: new URL(next, requestUrl.origin).toString(),
      'Set-Cookie': await createLegalAccessCookie(env.TURNSTILE_SECRET_KEY),
    },
  });
};

export const ALL: APIRoute = () => new Response('Method not allowed.', {
  status: 405,
  headers: { ...responseHeaders, Allow: 'POST' },
});
