import { describe, expect, it } from 'vitest';
import { ExtractionError } from './errors';
import { amazonProductAsin, amazonSearchQuery, isBlueskyProfileUrl, isInstagramUrl, isPossibleMastodonStatusUrl, isRedditUrl, isSoundCloudUrl, isSpotifyUrl, isTikTokUrl, isVimeoUrl, isXUrl, isYouTubeUrl, validateTargetUrl } from './url';

describe('validateTargetUrl', () => {
  it('accepts and normalizes public HTTP URLs', () => {
    expect(validateTargetUrl('https://example.com/article#section').toString()).toBe('https://example.com/article');
  });

  it.each([
    'ftp://example.com/file',
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://printer.test/',
    'http://service.onion/',
    'https://bad_host.example.com/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'https://metadata.google.internal/',
    'https://extractor.mcb-software.workers.dev/api/extract',
    'https://extractor.mcb-software.workers.dev./api/extract',
  ])('blocks unsafe target %s', (target) => {
    expect(() => validateTargetUrl(target)).toThrow(ExtractionError);
  });

  it.each([
    ['https://example.com./article#section', 'https://example.com/article'],
    ['https://project.github.io/docs', 'https://project.github.io/docs'],
    ['https://bücher.de/', 'https://xn--bcher-kva.de/'],
  ])('accepts and canonicalizes public domain %s', (target, expected) => {
    expect(validateTargetUrl(target).toString()).toBe(expected);
  });

  it.each([
    ['http://127.0.0.1/', 'unsafe_url'],
    ['https://bad_host.example.com/', 'invalid_url'],
  ])('returns the precise error class for %s', (target, code) => {
    try {
      validateTargetUrl(target);
      throw new Error('Expected URL validation to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code, status: 400 });
    }
  });
});

describe('source URL detection', () => {
  it('recognizes supported platforms without matching lookalike hosts', () => {
    expect(isXUrl(new URL('https://x.com/user/status/123'))).toBe(true);
    expect(isXUrl(new URL('https://x.com.example.org/user/status/123'))).toBe(false);
    expect(isRedditUrl(new URL('https://old.reddit.com/r/webdev/'))).toBe(true);
    expect(isYouTubeUrl(new URL('https://youtu.be/abc123'))).toBe(true);
    expect(isBlueskyProfileUrl(new URL('https://bsky.app/profile/bsky.app'))).toBe(true);
    expect(isBlueskyProfileUrl(new URL('https://bsky.app/profile/bsky.app/post/abc123'))).toBe(false);
    expect(isBlueskyProfileUrl(new URL('https://bsky.app/'))).toBe(false);
    expect(isTikTokUrl(new URL('https://www.tiktok.com/@scout2015/video/6718335390845095173'))).toBe(true);
    expect(isTikTokUrl(new URL('https://vm.tiktok.com/abc123/'))).toBe(true);
    expect(isTikTokUrl(new URL('https://tiktok.com.example.org/@user'))).toBe(false);
    expect(isInstagramUrl(new URL('https://www.instagram.com/p/DbbY9pdm6Q2/'))).toBe(true);
    expect(isInstagramUrl(new URL('https://www.instagram.com/instagram/'))).toBe(true);
    expect(isInstagramUrl(new URL('https://www.instagram.com/explore/'))).toBe(false);
    expect(isInstagramUrl(new URL('https://instagram.com.example.org/p/abc/'))).toBe(false);
  });

  it('recognizes public oEmbed provider URLs without accepting lookalike hosts', () => {
    expect(isVimeoUrl(new URL('https://vimeo.com/286898202'))).toBe(true);
    expect(isVimeoUrl(new URL('https://vimeo.com.example/video/286898202'))).toBe(false);
    expect(isSoundCloudUrl(new URL('https://soundcloud.com/forss/flickermood'))).toBe(true);
    expect(isSoundCloudUrl(new URL('https://soundcloud.com/search?q=test'))).toBe(false);
    expect(isSpotifyUrl(new URL('https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5'))).toBe(true);
    expect(isSpotifyUrl(new URL('https://open.spotify.example/track/abc'))).toBe(false);
    expect(isPossibleMastodonStatusUrl(new URL('https://mastodon.social/@trwnh/99664077509711321'))).toBe(true);
    expect(isPossibleMastodonStatusUrl(new URL('https://example.com/article/123'))).toBe(false);
  });

  it.each([
    ['https://www.amazon.de/echo-dot/dp/B09B8X9RGM?th=1', 'B09B8X9RGM'],
    ['https://amazon.com/gp/product/b09b2sbhqk/', 'B09B2SBHQK'],
    ['https://www.amazon.co.uk/gp/aw/d/B012345678', 'B012345678'],
    ['https://www.amazon.fr/gp/offer-listing/B012345678', 'B012345678'],
  ])('finds the ASIN in an Amazon product URL %s', (target, asin) => {
    expect(amazonProductAsin(new URL(target))).toBe(asin);
  });

  it.each([
    'https://www.amazon.de/s?k=headphones',
    'https://amazon.com.example.org/dp/B012345678',
    'https://example.com/dp/B012345678',
  ])('does not treat %s as an exact Amazon product', (target) => {
    expect(amazonProductAsin(new URL(target))).toBeNull();
  });

  it.each([
    ['https://www.amazon.de/s?k=mechanical+keyboard', 'mechanical keyboard'],
    ['https://www.amazon.com/headphones/s?k=noise+cancelling', 'noise cancelling'],
    ['https://www.amazon.co.uk/-/en/s?k=coffee%20grinder', 'coffee grinder'],
  ])('finds the query in an Amazon search URL %s', (target, query) => {
    expect(amazonSearchQuery(new URL(target))).toBe(query);
  });

  it.each([
    'https://www.amazon.de/s',
    'https://www.amazon.de/dp/B012345678',
    'https://amazon.com.example.org/s?k=headphones',
  ])('does not treat %s as an Amazon search', (target) => {
    expect(amazonSearchQuery(new URL(target))).toBeNull();
  });
});
