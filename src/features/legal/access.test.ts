import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createLegalAccessCookie,
  hasLegalAccess,
  normalizeLegalPath,
  verifyLegalTurnstile,
} from './access';

describe('legal page access gate', () => {
  it('accepts only signed, unexpired access cookies', async () => {
    const secret = 'fixture-secret';
    const setCookie = await createLegalAccessCookie(secret);
    const cookie = setCookie.split(';', 1)[0];
    expect(await hasLegalAccess(new Request('https://extractor.sh/privacy/', {
      headers: { Cookie: cookie },
    }), secret)).toBe(true);
    const tamperedCookie = `${cookie.slice(0, -1)}${cookie.endsWith('x') ? 'y' : 'x'}`;
    expect(await hasLegalAccess(new Request('https://extractor.sh/privacy/', {
      headers: { Cookie: tamperedCookie },
    }), secret)).toBe(false);
  });

  it('keeps redirect targets inside the legal route allowlist', () => {
    expect(normalizeLegalPath('/terms/')).toBe('/terms/');
    expect(normalizeLegalPath('https://example.com/')).toBe('/privacy/');
  });

  it('validates the Turnstile action and production hostname', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'legal_access',
      hostname: 'extractor.sh',
    }), { status: 200 }));
    expect(await verifyLegalTurnstile('token', '203.0.113.7', 'secret', 'extractor.sh', fetchImpl)).toBe(true);
    expect(await verifyLegalTurnstile('token', null, 'secret', 'other.example', fetchImpl)).toBe(false);
    const requestBody = fetchImpl.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(requestBody.get('secret')).toBe('secret');
    expect(requestBody.get('response')).toBe('token');
    expect(requestBody.get('remoteip')).toBe('203.0.113.7');
  });

  it('opens protected content from the Turnstile callback without a Continue button', () => {
    const source = readFileSync(new URL('../../components/LegalPage.astro', import.meta.url), 'utf8');
    expect(source).toContain('data-callback="onLegalAccessVerified"');
    expect(source).toContain('form.requestSubmit()');
    expect(source).not.toContain('type="submit">Continue</button>');
    expect(source).toContain('<SecurityCheckLoader id="legal-gate-status" />');
    expect(source).not.toContain('Checking automatically');
    const loader = readFileSync(new URL('../../components/SecurityCheckLoader.astro', import.meta.url), 'utf8');
    const animation = readFileSync(new URL('../../components/SecurityCheckAnimation.astro', import.meta.url), 'utf8');
    expect(loader).toContain('Running security check...');
    expect(loader).toContain('w-[clamp(70px,14vw,95px)]');
    expect(animation.match(/<circle/g)).toHaveLength(5);
  });
});
