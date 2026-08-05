import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAuthAccessCookie, hasAuthAccess } from './auth-gate';
import {
  ANONYMOUS_DAILY_LIMIT,
  creditsForAmount,
  isValidAutoTopUp,
  isValidPurchaseAmount,
  MAX_PURCHASE_CENTS,
  MIN_PURCHASE_CENTS,
  PURCHASE_PRESETS_CENTS,
  WELCOME_CREDIT_GRANT,
} from './constants';
import { generateApiKey, hashApiKey } from './crypto';
import { anonymousQuotaKey } from './quota-client';
import { buildDodoAuthorizationRequest, buildDodoCheckoutRequest } from './dodo';

describe('prepaid amount conversion', () => {
  it('converts exact cent amounts using the documented floor rule', () => {
    expect(creditsForAmount(10_000)).toBe(204_081);
    expect(creditsForAmount(1_000)).toBe(20_408);
    expect(creditsForAmount(2_000)).toBe(40_816);
  });

  it('enforces purchase bounds and cent integers', () => {
    expect(isValidPurchaseAmount(MIN_PURCHASE_CENTS)).toBe(true);
    expect(isValidPurchaseAmount(MAX_PURCHASE_CENTS)).toBe(true);
    expect(isValidPurchaseAmount(999)).toBe(false);
    expect(isValidPurchaseAmount(490_001)).toBe(false);
    expect(isValidPurchaseAmount(1_000.5)).toBe(false);
    expect(() => creditsForAmount(999)).toThrow(RangeError);
    expect(PURCHASE_PRESETS_CENTS).toEqual([1_000, 2_000, 5_000, 10_000, 20_000]);
  });
});

describe('API key storage', () => {
  it('generates the public prefix but hashes the complete secret deterministically', async () => {
    const key = generateApiKey();
    expect(key).toMatch(/^ext_live_[A-Za-z0-9_-]{20,}$/);
    expect(await hashApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashApiKey(key)).not.toContain(key);
  });
});

describe('anonymous quota privacy and reset', () => {
  it('changes the privacy-preserving identifier at the UTC date boundary', async () => {
    const before = await anonymousQuotaKey('203.0.113.4', 'test-secret', new Date('2026-08-03T23:59:59Z'));
    const after = await anonymousQuotaKey('203.0.113.4', 'test-secret', new Date('2026-08-04T00:00:00Z'));
    expect(before).not.toBe(after);
    expect(before).not.toContain('203.0.113.4');
  });

  it('uses the documented anonymous limit and one-time welcome grant', () => {
    expect(ANONYMOUS_DAILY_LIMIT).toBe(10);
    expect(WELCOME_CREDIT_GRANT).toBe(1_000);
  });
});

describe('Hanko Turnstile isolation gate', () => {
  it('accepts only an unexpired signed auth_access cookie', async () => {
    const now = Date.parse('2026-08-03T12:00:00Z');
    const cookie = await createAuthAccessCookie('turnstile-secret', now);
    const request = new Request('https://extractor.sh/login/', { headers: { Cookie: cookie.split(';')[0]! } });
    expect(await hasAuthAccess(request, 'turnstile-secret', now + 9 * 60_000)).toBe(true);
    expect(await hasAuthAccess(request, 'wrong-secret', now + 9 * 60_000)).toBe(false);
    expect(await hasAuthAccess(request, 'turnstile-secret', now + 11 * 60_000)).toBe(false);
  });

  it('keeps the locked branch free of the component, bundle registration, and tenant URL', () => {
    const source = readFileSync(new URL('../../pages/login.astro', import.meta.url), 'utf8');
    const lockedBranch = source.match(/: \(\n\s*<div data-auth-gate>[\s\S]*?\n\s*\)\n\s*}/)?.[0] ?? '';
    expect(lockedBranch).not.toContain('hanko-auth');
    expect(lockedBranch).not.toContain('@teamhanko');
    expect(lockedBranch).not.toContain('auth.extractor.sh');
  });

  it('submits Turnstile verification automatically and declares the neo-brutalist Hanko theme', () => {
    const login = readFileSync(new URL('../../pages/login.astro', import.meta.url), 'utf8');
    const globalStyles = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(login).toContain('data-callback="onAuthAccessVerified"');
    expect(login).toContain('window.onAuthAccessVerified = async (token) =>');
    expect(login).not.toContain('type="submit">Continue</button>');
    expect(login).not.toContain('>Sign in</h1>');
    expect(login).toContain('<SecurityCheckLoader id="auth-gate-status" />');
    expect(login).not.toContain('Checking automatically');
    expect(login).toContain('border-width: 2px 5px 5px 2px !important');
    expect(globalStyles).toContain('--border-radius: 0');
    expect(globalStyles).toContain('--brand-color: #000');
    expect(globalStyles).toContain('button:not(:disabled)');
  });
});

describe('dashboard loading', () => {
  it('defers the logout SDK and batches independent D1 reads', () => {
    const dashboard = readFileSync(new URL('../../pages/dashboard.astro', import.meta.url), 'utf8');
    const d1 = readFileSync(new URL('./d1.ts', import.meta.url), 'utf8');
    expect(dashboard).not.toContain("import { register } from '@teamhanko/hanko-elements'");
    expect(dashboard).toContain("await import('@teamhanko/hanko-frontend-sdk')");
    expect(dashboard).toContain('getDashboardData(env.DB, session.userId, autoTopUpPeriod())');
    expect(dashboard).toContain('data-copy-api-key');
    expect(dashboard).toContain('navigator.clipboard.writeText(apiKey)');
    expect(dashboard).not.toContain('name="consent"');
    expect(dashboard).not.toContain('I authorize Dodo Payments to charge');
    expect(dashboard).toContain('>Auto top-up</h2>');
    expect(dashboard).toContain("'Save auto top-up' : 'Enable auto top-up'");
    expect(dashboard).toContain('Spend cap / UTC month');
    expect(d1).toContain('export async function getDashboardData(');
    expect(d1).toContain('await db.batch([');
  });
});

describe('Dodo Payments contract', () => {
  it('creates a hosted one-time checkout with exact ad-hoc pricing', () => {
    const params = buildDodoCheckoutRequest({
      userId: 'user_test', amountCents: 10_000, origin: 'https://extractor.sh',
      productId: 'prod_topup', intentId: 'checkout_test',
    });
    expect(params.product_cart).toEqual([{ product_id: 'prod_topup', quantity: 1, amount: 10_000 }]);
    expect(params.metadata).toMatchObject({ credits: 204_081, funding_kind: 'top_up' });
    expect(params.customization).toMatchObject({ theme: 'light' });
    expect(params.feature_flags).toMatchObject({ allow_discount_code: false, allow_currency_selection: false });
  });

  it('reuses an existing Dodo customer for a later PAYG top-up', () => {
    const params = buildDodoCheckoutRequest({
      userId: 'user_test', customerId: 'cus_test', amountCents: 2_000,
      origin: 'https://extractor.sh', productId: 'prod_topup', intentId: 'checkout_topup',
    });
    expect(params.customer).toEqual({ customer_id: 'cus_test' });
    expect(params.metadata).toMatchObject({ credits: 40_816, funding_kind: 'top_up' });
  });

  it('uses a hosted mandate checkout before any automatic charges', () => {
    const params = buildDodoAuthorizationRequest({
      userId: 'user_test', customerId: 'cus_test', origin: 'https://extractor.sh',
      productId: 'prod_on_demand', authorizationId: 'auto_auth_test',
    });
    expect(params.customer).toEqual({ customer_id: 'cus_test' });
    expect(params.subscription_data).toEqual({ on_demand: { mandate_only: true } });
    expect(params.metadata).toMatchObject({
      auto_topup_authorization_id: 'auto_auth_test',
      funding_kind: 'auto_top_up_authorization',
    });
  });

  it('requires a hard monthly authorization cap', () => {
    expect(isValidAutoTopUp({ triggerCredits: 2_000, amountCents: 2_000, monthlyLimitCents: 10_000 })).toBe(true);
    expect(isValidAutoTopUp({ triggerCredits: 2_000, amountCents: 2_000, monthlyLimitCents: 1_000 })).toBe(false);
  });
});

describe('pricing tiers', () => {
  it('shows anonymous access, the welcome bonus, and the simplified checkout CTA', () => {
    const pricing = readFileSync(new URL('../../pages/pricing.astro', import.meta.url), 'utf8');
    expect(pricing).toContain('10</p>');
    expect(pricing).toContain('requests / day');
    expect(pricing).toContain('1,000</p>');
    expect(pricing).toContain('welcome credits');
    expect(pricing).toContain('>No account</strong>');
    expect(pricing).toContain('>Free account</strong>');
    expect(pricing).toContain('items-baseline gap-3 whitespace-nowrap');
    expect(pricing).toContain('/ 1,000 credits');
    expect(pricing).toContain('Each extraction, web search, news search, image search, video search, place or map search, or finance request counts as one credit.');
    expect(pricing).toContain('<li>Extract data from any supported source</li>');
    expect(pricing).not.toContain('/ 1,000 extractions');
    expect(pricing).toContain('<li>Credits never expire</li>\n          <li>60 API calls per minute</li>\n        </ul>');
    expect(pricing).toContain('Get started');
    expect(pricing).toContain('name="heroicons:arrow-up-right"');
    expect(pricing).toContain('[&_path]:[stroke-width:2.25]');
    expect(pricing).not.toMatch(/Top up exactly|Secure checkout|100 successful uncached operations/);
    expect(pricing.indexOf('Get started')).toBeLessThan(pricing.indexOf('Please test extractor.sh'));
    expect(pricing).toContain('Please test extractor.sh with your intended URLs before adding credits.');
    expect(pricing).not.toContain('Contact us if you need help evaluating a specific use case.');
    expect(pricing).toContain('data-pricing-faq');
    expect(pricing).toContain('name="pricing-faq"');
    expect(pricing).toContain("question: 'Do you charge for failed requests?'");
    expect(pricing).toContain('released when the request fails');
    expect(pricing).toContain("question: 'Is there a monthly plan?'");
    expect(pricing).toContain("question: 'Do all endpoints and features cost the same?'");
    expect(pricing).not.toContain("question: 'When should I contact you?'");
    expect(pricing).toContain('The standard limit is 60 uncached requests per client per minute');
    expect(pricing.match(/question:/g)).toHaveLength(10);
  });
});

describe('request rate limits', () => {
  it('configures the shared uncached API limiter for 60 requests per minute', () => {
    const wrangler = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(wrangler).toMatch(
      /"name": "EXTRACT_RATE_LIMITER"[\s\S]*?"simple": \{\s*"limit": 60,\s*"period": 60\s*\}/,
    );
  });
});

describe('website and API caching', () => {
  it('bypasses the Worker front-cache for pages and assets while preserving the internal API result cache', () => {
    const wrangler = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
    const worker = readFileSync(new URL('../../worker.ts', import.meta.url), 'utf8');
    const staticHeaders = readFileSync(new URL('../../../public/_headers', import.meta.url), 'utf8');
    expect(wrangler).toMatch(/"cache": \{\s*"enabled": false\s*\}/);
    expect(staticHeaders).toMatch(/\/\*\s+[\s\S]*?Cache-Control: no-store/);
    expect(staticHeaders).not.toMatch(/Cache-Control: public/);
    expect(worker).not.toContain('PUBLIC_EDGE_CACHE_CONTROL');
    expect(worker).not.toContain("decorated.headers.set('Cloudflare-CDN-Cache-Control'");
    expect(worker).toContain("decorated.headers.delete('Cloudflare-CDN-Cache-Control')");
    expect(worker).toContain("decorated.headers.set('Cache-Control', 'no-store')");
    expect(worker).toContain('const cache = (caches as CacheStorage & { default: Cache }).default');
    expect(worker).toContain('const cached = await cache.match(cacheKey)');
    expect(worker).toContain('context.waitUntil(cache.put(cacheKey, stored))');
    expect(worker).toContain("if (url.pathname.startsWith('/api/'))");
    expect(worker).toContain("if (url.pathname === '/mcp')");
    expect(worker).toContain("decorated.headers.set('Cache-Control', 'private, no-store')");
  });
});

describe('first-party account metering', () => {
  it('sends the Hanko session cookie from the homepage and platform playgrounds', () => {
    const homepageForm = readFileSync(new URL('../../components/ExtractorForm.astro', import.meta.url), 'utf8');
    const platformPlayground = readFileSync(new URL('../../components/PlatformPlayground.astro', import.meta.url), 'utf8');
    const worker = readFileSync(new URL('../../worker.ts', import.meta.url), 'utf8');
    expect(homepageForm).toContain("credentials: 'same-origin'");
    expect(homepageForm).toContain("'X-Extractor-Web-Client': '1'");
    expect(platformPlayground).toContain("credentials: 'same-origin'");
    expect(platformPlayground).toContain("'X-Extractor-Web-Client': '1'");
    expect(worker).toContain("apiRequest.headers.get('X-Extractor-Web-Client') === '1'");
    expect(worker).toContain('useWebsiteSession ? await validateHankoSession(apiRequest) : null');
    expect(worker).toContain('session?.userId ?? null');
  });
});

describe('usage alert delivery', () => {
  it('uses the direct authenticated top-up link and all three thresholds', () => {
    const source = readFileSync(new URL('./email.ts', import.meta.url), 'utf8');
    expect(source).toContain('https://extractor.sh/dashboard/?topup=1#add-credits');
    expect(source).toContain("percent: 80 | 90 | 100");
    expect(source).toContain('input.email.send');
  });
});
