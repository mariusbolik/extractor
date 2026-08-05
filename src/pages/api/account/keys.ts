import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createApiKey, revokeApiKey } from '../../../features/billing/d1';
import { requireSameOrigin, validateHankoSession } from '../../../features/billing/hanko';

export const prerender = false;

async function authenticated(request: Request): Promise<
  { session: { userId: string; expiresAt: string | null } } | { error: Response }
> {
  if (!requireSameOrigin(request)) return { error: Response.json({ error: 'Invalid origin.' }, { status: 403 }) };
  const session = await validateHankoSession(request);
  return session ? { session } : { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticated(request);
  if ('error' in auth) return auth.error;
  const body = await request.json<{ name?: unknown }>();
  const name = String(body.name ?? 'API key').trim();
  if (!name || name.length > 50) return Response.json({ error: 'Name must be 1 to 50 characters.' }, { status: 400 });
  try {
    return Response.json(await createApiKey(env.DB, auth.session.userId, name), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create API key.' }, { status: 409 });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await authenticated(request);
  if ('error' in auth) return auth.error;
  const body = await request.json<{ id?: unknown }>();
  const revoked = await revokeApiKey(env.DB, auth.session.userId, String(body.id ?? ''));
  return revoked ? new Response(null, { status: 204 }) : Response.json({ error: 'API key not found.' }, { status: 404 });
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });
