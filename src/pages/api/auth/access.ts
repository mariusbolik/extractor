import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { createAuthAccessCookie, verifyTurnstile } from '../../../features/billing/auth-gate';
import { requireSameOrigin } from '../../../features/billing/hanko';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!requireSameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  const secret = getSecret('TURNSTILE_SECRET_KEY');
  if (!secret) return Response.json({ error: 'Authentication gate is unavailable.' }, { status: 503 });
  const contentType = request.headers.get('Content-Type') ?? '';
  const token = contentType.includes('application/json')
    ? String((await request.json<{ token?: unknown }>()).token ?? '')
    : String((await request.formData()).get('cf-turnstile-response') ?? '');
  if (!token || !await verifyTurnstile(token, secret, request.headers.get('cf-connecting-ip') ?? undefined)) {
    return Response.json({ error: 'Challenge verification failed.' }, { status: 400 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'private, no-store',
      'Set-Cookie': await createAuthAccessCookie(secret),
    },
  });
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
