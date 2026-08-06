import { describe, expect, it } from 'vitest';
import { apiCacheKey, cacheTtlForResponse } from './cache';

describe('apiCacheKey', () => {
  it('versions internal cache keys without changing the public request', () => {
    const request = new Request('https://extractor.test/api/extract?url=https%3A%2F%2Fexample.com&format=json');
    const key = apiCacheKey(request);

    expect(new URL(key.url).searchParams.get('__extractor_cache')).toBe('2026-08-publisher-feeds-v11');
    expect(new URL(request.url).searchParams.has('__extractor_cache')).toBe(false);
  });

  it('never caches error responses even when they accidentally carry a TTL', () => {
    const blocked = new Response(JSON.stringify({ error: { code: 'source_blocked' } }), {
      status: 502,
      headers: { 'X-Extractor-Cache-TTL': '2592000' },
    });
    const success = new Response('{}', {
      status: 200,
      headers: { 'X-Extractor-Cache-TTL': '3600' },
    });

    expect(cacheTtlForResponse(blocked)).toBeNull();
    expect(cacheTtlForResponse(success)).toBe(3600);
    expect(cacheTtlForResponse(new Response('{}', { status: 200 }))).toBeNull();
  });

  it('shares canonical search keys across omitted defaults and whitespace', () => {
    const concise = apiCacheKey(new Request('https://extractor.test/api/search?q=clean+web+data'));
    const explicit = apiCacheKey(new Request('https://extractor.test/api/search?q=%20clean%20%20web%0Adata%20&format=json&limit=10'));

    expect(concise.url).toBe(explicit.url);
    expect(new URL(concise.url).searchParams.get('__extractor_cache')).toBe('2026-08-search-site-v7');
    const siteRestricted = apiCacheKey(new Request('https://extractor.test/api/search?q=clean+web+data&site=%20LinkedIn.com.%20&unknown=1'));
    expect(new URL(siteRestricted.url).searchParams.get('site')).toBe('linkedin.com');
    expect(new URL(siteRestricted.url).searchParams.has('unknown')).toBe(false);
    expect(siteRestricted.url).not.toBe(concise.url);
    expect(apiCacheKey(new Request('https://extractor.test/api/search?q=clean+web+data&site=')).url).not.toBe(concise.url);
  });

  it('canonicalizes and independently versions news search keys', () => {
    const concise = apiCacheKey(new Request('https://extractor.test/api/news?q=AI+infrastructure'));
    const explicit = apiCacheKey(new Request('https://extractor.test/api/news?q=%20AI%20%20infrastructure%20&format=json&limit=10'));

    expect(concise.url).toBe(explicit.url);
    expect(new URL(concise.url).searchParams.get('__extractor_cache')).toBe('2026-08-news-locales-timeframe-v3');
  });

  it('canonicalizes image, video, and place searches with their own defaults', () => {
    const imageConcise = apiCacheKey(new Request('https://extractor.test/api/images?q=coral+reef'));
    const imageExplicit = apiCacheKey(new Request('https://extractor.test/api/images?q=%20coral%20%20reef%20&format=json&limit=10'));
    expect(imageConcise.url).toBe(imageExplicit.url);
    expect(new URL(imageConcise.url).searchParams.get('__extractor_cache')).toBe('2026-08-image-filters-v2');

    const videoConcise = apiCacheKey(new Request('https://extractor.test/api/videos?q=cloudflare+workers'));
    const videoExplicit = apiCacheKey(new Request('https://extractor.test/api/videos?q=%20cloudflare%20%20workers%20&format=json&limit=10&language=en-US&country=us&platform=any&sort=relevance&junk=1'));
    expect(videoConcise.url).toBe(videoExplicit.url);
    expect(new URL(videoConcise.url).searchParams.get('__extractor_cache')).toBe('2026-08-video-search-v7');
    expect(new URL(videoExplicit.url).searchParams.has('junk')).toBe(false);
    const youtubeVideo = apiCacheKey(new Request('https://extractor.test/api/videos?q=cloudflare+workers&platform=youtube'));
    expect(youtubeVideo.url).not.toBe(videoConcise.url);
    const latestVideo = apiCacheKey(new Request('https://extractor.test/api/videos?q=cloudflare+workers&sort=date'));
    expect(latestVideo.url).not.toBe(videoConcise.url);
    const creatorVideo = apiCacheKey(new Request('https://extractor.test/api/videos?q=cloudflare+workers&creator=%20Cloudflare%20%20Developers%20'));
    expect(new URL(creatorVideo.url).searchParams.get('creator')).toBe('Cloudflare Developers');
    expect(creatorVideo.url).not.toBe(videoConcise.url);
    expect(apiCacheKey(new Request('https://extractor.test/api/videos?q=cloudflare+workers&creator=%20%20')).url).not.toBe(videoConcise.url);

    const placeConcise = apiCacheKey(new Request('https://extractor.test/api/places?q=Brandenburg+Gate'));
    const placeExplicit = apiCacheKey(new Request('https://extractor.test/api/places?q=%20Brandenburg%20%20Gate%20&format=json&limit=5'));
    expect(placeConcise.url).toBe(placeExplicit.url);
    expect(new URL(placeConcise.url).searchParams.get('__extractor_cache')).toBe('2026-08-place-filters-v3');

    const mapConcise = apiCacheKey(new Request('https://extractor.test/api/maps?q=coffee+Berlin'));
    const mapExplicit = apiCacheKey(new Request('https://extractor.test/api/maps?q=%20coffee%20%20Berlin%20&format=json&limit=5&language=en&type=any&ignored=1'));
    expect(mapConcise.url).toBe(mapExplicit.url);
    expect(new URL(mapConcise.url).pathname).toBe('/api/places');
    expect(new URL(mapConcise.url).searchParams.get('__extractor_cache')).toBe('2026-08-place-filters-v3');
    expect(new URL(mapExplicit.url).searchParams.has('ignored')).toBe(false);

    const canonicalMapQuery = apiCacheKey(new Request('https://extractor.test/api/places?q=coffee+Berlin'));
    expect(mapConcise.url).toBe(canonicalMapQuery.url);
  });

  it('removes unknown parameters while preserving effective controls', () => {
    const concise = apiCacheKey(new Request('https://extractor.test/api/search?q=cloudflare&language=de-de&country=de'));
    const noisy = apiCacheKey(new Request('https://extractor.test/api/search?unknown=1&q=cloudflare&country=DE&language=de-DE&tracking=x'));
    const otherLocale = apiCacheKey(new Request('https://extractor.test/api/search?q=cloudflare&language=en-US&country=US'));

    expect(concise.url).toBe(noisy.url);
    expect(concise.url).not.toBe(otherLocale.url);
    expect(new URL(noisy.url).searchParams.has('unknown')).toBe(false);
  });

  it('canonicalizes focus, filters, coordinates, and finance defaults', () => {
    const focused = apiCacheKey(new Request('https://extractor.test/api/extract?url=https://example.com&focus=%20pricing%20&junk=1'));
    expect(new URL(focused.url).searchParams.get('focus')).toBe('pricing');
    expect(new URL(focused.url).searchParams.has('junk')).toBe(false);

    const imageDefault = apiCacheKey(new Request('https://extractor.test/api/images?q=reef'));
    const imageExplicit = apiCacheKey(new Request('https://extractor.test/api/images?q=reef&usage=all&orientation=any&format=json&limit=10'));
    expect(imageDefault.url).toBe(imageExplicit.url);

    const place = apiCacheKey(new Request('https://extractor.test/api/places?q=Berlin&lat=52.5200&lon=13.4050'));
    expect(new URL(place.url).searchParams.get('lat')).toBe('52.52');

    const financeDefault = apiCacheKey(new Request('https://extractor.test/api/finance?symbol=aapl'));
    const financeExplicit = apiCacheKey(new Request('https://extractor.test/api/finance?symbol=AAPL&timeframe=1mo&format=json&unused=1'));
    expect(financeDefault.url).toBe(financeExplicit.url);
    expect(new URL(financeDefault.url).searchParams.get('__extractor_cache')).toBe('2026-08-finance-quote-v2');

    const financeEur = apiCacheKey(new Request('https://extractor.test/api/finance?symbol=aapl&quote=eur&unknown=1'));
    const financeEurExplicit = apiCacheKey(new Request('https://extractor.test/api/finance?symbol=AAPL&quote=EUR&timeframe=1mo&format=json'));
    expect(financeEur.url).toBe(financeEurExplicit.url);
    expect(financeEur.url).not.toBe(financeDefault.url);
    expect(new URL(financeEur.url).searchParams.has('unknown')).toBe(false);

    const stocksDefault = apiCacheKey(new Request('https://extractor.test/api/finance/search?q=Apple'));
    const stocksExplicit = apiCacheKey(new Request('https://extractor.test/api/finance/search?q=%20Apple%20&limit=10&instrument=equity&format=json&junk=1'));
    expect(stocksDefault.url).toBe(stocksExplicit.url);
    expect(new URL(stocksDefault.url).searchParams.get('__extractor_cache')).toBe('2026-08-finance-search-v2');
    const crypto = apiCacheKey(new Request('https://extractor.test/api/finance/search?q=Apple&instrument=crypto'));
    expect(crypto.url).not.toBe(stocksDefault.url);
  });
});
