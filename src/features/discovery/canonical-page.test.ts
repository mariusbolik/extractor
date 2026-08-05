import { describe, expect, it } from 'vitest';
import { canonicalPageRedirectUrl } from './canonical-page';

function target(path: string, method = 'GET'): string | null {
  return canonicalPageRedirectUrl(new Request(`https://extractor.sh${path}`, { method }))?.toString() ?? null;
}

describe('canonical page URLs', () => {
  it.each([
    ['/contact', 'https://extractor.sh/contact/'],
    ['/docs', 'https://extractor.sh/docs/'],
    ['/docs/finance', 'https://extractor.sh/docs/finance/'],
    ['/blog/web-search-api-for-ai-agents', 'https://extractor.sh/blog/web-search-api-for-ai-agents/'],
    ['/alternatives/firecrawl', 'https://extractor.sh/alternatives/firecrawl/'],
    ['/legal', 'https://extractor.sh/legal/'],
    ['/login', 'https://extractor.sh/login/'],
    ['/dashboard', 'https://extractor.sh/dashboard/'],
  ])('adds a trailing slash to %s', (input, expected) => {
    expect(target(input)).toBe(expected);
    expect(target(input, 'HEAD')).toBe(expected);
  });

  it('preserves the query string while canonicalizing the path', () => {
    expect(target('/contact?sent=1&utm_source=test')).toBe('https://extractor.sh/contact/?sent=1&utm_source=test');
  });

  it.each([
    '/',
    '/contact/',
    '/api/contact',
    '/api/finance?symbol=AAPL',
    '/mcp',
    '/openapi.json',
    '/.well-known/api-catalog',
    '/favicon.svg',
    '/not-a-real-page',
  ])('does not rewrite non-page URL %s', (input) => {
    expect(target(input)).toBeNull();
  });

  it('does not redirect non-idempotent page requests', () => {
    expect(target('/contact', 'POST')).toBeNull();
  });
});
