import { hmacSha256, randomId, timingSafeEqual } from './crypto';

const COOKIE_NAME = 'auth_access';
const ACCESS_TTL_SECONDS = 10 * 60;

function cookieValue(request: Request, name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request.headers.get('Cookie') ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}

function decodeBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createAuthAccessCookie(secret: string, now = Date.now()): Promise<string> {
  const payload = encodeBase64Url(`${Math.floor(now / 1_000) + ACCESS_TTL_SECONDS}.${randomId()}`);
  const signature = await hmacSha256(secret, `auth_access:${payload}`);
  return `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${signature}`)}; Max-Age=${ACCESS_TTL_SECONDS}; Path=/login/; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasAuthAccess(request: Request, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!secret) return false;
  const value = cookieValue(request, COOKIE_NAME);
  if (!value) return false;
  const separator = value.lastIndexOf('.');
  if (separator < 1) return false;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = await hmacSha256(secret, `auth_access:${payload}`);
  if (!timingSafeEqual(signature, expected)) return false;
  const decoded = decodeBase64Url(payload);
  const expiresAt = Number(decoded?.split('.')[0]);
  return Number.isSafeInteger(expiresAt) && expiresAt >= Math.floor(now / 1_000);
}

export async function verifyTurnstile(token: string, secret: string, remoteIp?: string): Promise<boolean> {
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!response.ok) return false;
  const result = await response.json<{ success?: boolean }>();
  return result.success === true;
}
