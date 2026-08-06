import { describe, expect, it } from 'vitest';
import { alignedBrowserUserAgent, normalizeBrowserRunError } from './browser';

describe('Browser Run normalization', () => {
  it('uses the managed Chromium version instead of a stale hard-coded version', () => {
    expect(alignedBrowserUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/138.0.0.0 Safari/537.36',
      'HeadlessChrome/142.0.7444.12',
    )).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.7444.12 Safari/537.36');
  });

  it('preserves the managed identity when its version cannot be determined', () => {
    const userAgent = 'ManagedBrowser/1.0';
    expect(alignedBrowserUserAgent(userAgent, 'unknown')).toBe(userAgent);
  });

  it('maps platform capacity exhaustion to a retryable high-cost limit', () => {
    expect(normalizeBrowserRunError(
      new Error('Unable to create new browser: code: 429: Browser time limit exceeded for today'),
      false,
    )).toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 20 });
  });

  it('keeps navigation and session failures distinct', () => {
    expect(normalizeBrowserRunError(new Error('net::ERR_NAME_NOT_RESOLVED'), true)).toMatchObject({
      code: 'upstream_error',
      status: 502,
      message: 'The source hostname could not be resolved.',
    });
    expect(normalizeBrowserRunError(new Error('Protocol error: Target closed'), true)).toMatchObject({
      code: 'upstream_error',
      status: 502,
      message: 'A required extraction service ended unexpectedly.',
    });
  });
});
