import { describe, expect, it } from 'vitest';
import { assertNoAccessInterstitial, isAccessInterstitialHtml } from './access-interstitial';

describe('access interstitial detection', () => {
  it('detects a full-page challenge with a successful HTTP-style document', () => {
    const html = `<!doctype html><html><head><title>Just a moment...</title>
      <script>window._cf_chl_opt = { cType: 'managed' };</script></head>
      <body><main id="challenge-form">Verify you are human. Enable JavaScript and cookies to continue.</main>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;

    expect(isAccessInterstitialHtml(html)).toBe(true);
    expect(() => assertNoAccessInterstitial(html)).toThrow(expect.objectContaining({
      code: 'source_blocked',
      status: 502,
    }));
  });

  it('detects a short generic access-denied interstitial', () => {
    expect(isAccessInterstitialHtml(`
      <html><head><title>Access Denied</title></head><body>
      <form id="challenge-form">Your request has been blocked.</form>
      </body></html>
    `)).toBe(true);
  });

  it('does not block an article discussing challenge pages', () => {
    expect(isAccessInterstitialHtml(`
      <html><head><title>How access verification works</title></head><body><article>
      <h1>Understanding browser verification</h1>
      <p>This article explains why a visitor may see “Just a moment” or be asked to verify they are human.</p>
      <p>It contains normal editorial content and no full-page verification form or platform script.</p>
      </article></body></html>
    `)).toBe(false);
  });

  it('does not treat an embedded verification widget as a full-page block', () => {
    expect(isAccessInterstitialHtml(`
      <html><head><title>Contact Example</title></head><body><main>
      <h1>Contact us</h1><p>Our public office details and support documentation remain readable.</p>
      <form><label>Message<textarea></textarea></label><div class="cf-turnstile" data-sitekey="public"></div></form>
      </main></body></html>
    `)).toBe(false);
  });
});
