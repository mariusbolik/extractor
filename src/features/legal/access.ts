const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ACCESS_COOKIE = '__Host-extractor_legal_access';
const ACCESS_SECONDS = 30 * 60;
const TEST_SECRET = '1x0000000000000000000000000000000AA';
const SIGNATURE_CONTEXT = 'extractor.sh/legal-access/v1';

const encoder = new TextEncoder();

export const LEGAL_PATHS = ['/legal/', '/privacy/', '/terms/'] as const;
export type LegalPath = typeof LEGAL_PATHS[number];

interface TurnstileVerification {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): ArrayBuffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    // Reject alternate base64url spellings whose unused trailing bits decode
    // to the same bytes. Signatures have one canonical cookie representation.
    if (encodeBase64Url(bytes) !== value) return null;
    return bytes.buffer;
  } catch {
    return null;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  // Derive a purpose-specific key instead of using the Turnstile secret
  // directly as an HMAC key shared with another protocol.
  const derived = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${SIGNATURE_CONTEXT}:${secret}`),
  );
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signExpiry(expiresAt: number, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(`${SIGNATURE_CONTEXT}:${expiresAt}`),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

export function normalizeLegalPath(value: unknown): LegalPath {
  return typeof value === 'string' && LEGAL_PATHS.includes(value as LegalPath)
    ? value as LegalPath
    : '/privacy/';
}

/**
 * Checks the short-lived signed access cookie without persisting a session.
 * The cookie contains only an expiry timestamp and its HMAC signature.
 */
export async function hasLegalAccess(request: Request, secret: string): Promise<boolean> {
  if (!secret) return false;
  const value = readCookie(request, ACCESS_COOKIE);
  if (!value) return false;
  const [expiryText, signature, extra] = value.split('.');
  if (!expiryText || !signature || extra) return false;

  const expiresAt = Number(expiryText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + ACCESS_SECONDS) return false;
  const signatureBytes = decodeBase64Url(signature);
  if (!signatureBytes) return false;
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    signatureBytes,
    encoder.encode(`${SIGNATURE_CONTEXT}:${expiresAt}`),
  );
}

export async function createLegalAccessCookie(secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_SECONDS;
  const signature = await signExpiry(expiresAt, secret);
  return `${ACCESS_COOKIE}=${expiresAt}.${signature}; Path=/; Max-Age=${ACCESS_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * Redeems the single-use Turnstile token on Cloudflare's server endpoint.
 * Tokens are rejected unless they were issued for this exact gate and host.
 */
export async function verifyLegalTurnstile(
  token: unknown,
  remoteIp: string | null,
  secret: string,
  requestHostname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 1 || token.length > 2_048 || !secret) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const result = await response.json() as TurnstileVerification;
    if (!result.success) return false;
    // Cloudflare's published test secret returns a synthetic hostname. It is
    // used only by the native local preview and reports the action as `test`;
    // production tokens must match both our action and serving hostname.
    if (secret === TEST_SECRET) return true;
    return result.action === 'legal_access' && result.hostname === requestHostname;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
