import { HANKO_AUTH_DOMAIN } from 'astro:env/client';

export interface HankoSession {
  userId: string;
  expiresAt: string | null;
}

export async function validateHankoSession(request: Request): Promise<HankoSession | null> {
  const cookie = request.headers.get('Cookie') ?? '';
  if (!/(?:^|;\s*)hanko=/.test(cookie)) return null;
  try {
    const response = await fetch(`${HANKO_AUTH_DOMAIN.replace(/\/$/, '')}/sessions/validate`, {
      headers: { Cookie: cookie },
    });
    if (!response.ok) return null;
    const result = await response.json<{
      is_valid?: boolean;
      user_id?: string;
      expiration_time?: string;
      claims?: { subject?: string; expiration?: string };
    }>();
    const userId = result.claims?.subject ?? result.user_id;
    if (!result.is_valid || !userId) return null;
    return { userId, expiresAt: result.claims?.expiration ?? result.expiration_time ?? null };
  } catch {
    return null;
  }
}

export function requireSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin === new URL(request.url).origin;
}
