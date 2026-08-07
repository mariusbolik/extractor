export const API_CACHE_VERSION = '2026-08-rendered-roots-v15';
const SEARCH_CACHE_VERSION = '2026-08-search-context-v11';
const NEWS_CACHE_VERSION = '2026-08-news-locales-timeframe-v3';
const IMAGE_CACHE_VERSION = '2026-08-image-filters-v2';
const VIDEO_CACHE_VERSION = '2026-08-video-search-v7';
const PLACE_CACHE_VERSION = '2026-08-place-filters-v3';
const FINANCE_CACHE_VERSION = '2026-08-finance-quote-v2';
const FINANCE_SEARCH_CACHE_VERSION = '2026-08-finance-search-v2';
const FINANCE_MOVERS_CACHE_VERSION = '2026-08-finance-movers-v1';

function normalizedQuery(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function language(value: string | null, fallback: string): string {
  if (value === null) return fallback;
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? value.trim();
  } catch {
    return value.trim();
  }
}

function coordinate(value: string | null): string | null {
  if (value === null || !value.trim()) return value;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value.trim();
}

/**
 * Only successful route responses carrying an explicit positive internal TTL
 * may enter caches.default. Error responses remain uncacheable even if a
 * future route accidentally attaches a TTL header to one.
 */
export function cacheTtlForResponse(response: Response): number | null {
  if (!response.ok) return null;
  const ttl = Number(response.headers.get('X-Extractor-Cache-TTL'));
  return Number.isFinite(ttl) && ttl > 0 ? ttl : null;
}

/**
 * Keep Cloudflare Cache API keys independent from the browser-visible URL.
 * Bump the version when a deployment must stop reusing older response shapes.
 */
export function apiCacheKey(request: Request): Request {
  const url = new URL(request.url);
  // /api/maps is retained only as a compatibility alias. Canonicalize it
  // before selecting controls and versions so either public URL warms the
  // same place-search entry and can never duplicate upstream work.
  if (url.pathname === '/api/maps') url.pathname = '/api/places';
  const input = new URLSearchParams(url.search);
  const output = new URLSearchParams();
  const format = input.get('format') || 'json';

  if (url.pathname === '/api/extract' || url.pathname === '/mcp-cache') {
    output.set('url', input.get('url')?.trim() ?? '');
    output.set('format', format);
    const focus = input.get('focus')?.trim();
    if (focus) output.set('focus', focus);
  }
  if (url.pathname === '/api/search') {
    // Canonicalize defaults and whitespace before touching caches.default.
    // This lets HTTP and MCP callers share entries even when one omits an
    // optional default or uses different whitespace in the same query.
    output.set('q', normalizedQuery(input.get('q')));
    output.set('format', format);
    output.set('limit', input.get('limit') || '10');
    output.set('language', language(input.get('language'), 'en-US'));
    output.set('country', (input.get('country') || 'US').trim().toUpperCase());
    if (input.has('site')) {
      const site = input.get('site')?.trim().toLowerCase().replace(/\.$/, '') ?? '';
      // Preserve an explicitly empty/invalid known control so it cannot hit
      // the cache entry for the valid omitted default before route validation.
      output.set('site', site);
    }
  }
  if (url.pathname === '/api/news') {
    output.set('q', normalizedQuery(input.get('q')));
    output.set('format', format);
    output.set('limit', input.get('limit') || '10');
    output.set('language', language(input.get('language'), 'en-US'));
    output.set('country', (input.get('country') || 'US').trim().toUpperCase());
    output.set('timeframe', input.get('timeframe') || 'any');
  }
  if (url.pathname === '/api/images') {
    output.set('q', normalizedQuery(input.get('q')));
    output.set('format', format);
    output.set('limit', input.get('limit') || '10');
    output.set('usage', input.get('usage') || 'all');
    output.set('orientation', input.get('orientation') || 'any');
  }
  if (url.pathname === '/api/videos') {
    output.set('q', normalizedQuery(input.get('q')));
    output.set('format', format);
    output.set('limit', input.get('limit') || '10');
    output.set('language', language(input.get('language'), 'en-US'));
    output.set('country', (input.get('country') || 'US').trim().toUpperCase());
    output.set('platform', input.get('platform') || 'any');
    output.set('sort', input.get('sort') || 'relevance');
    if (input.has('creator')) {
      const creator = input.get('creator')?.replace(/\s+/g, ' ').trim() ?? '';
      output.set('creator', creator);
    }
  }
  if (url.pathname === '/api/places') {
    output.set('q', normalizedQuery(input.get('q')));
    output.set('format', format);
    output.set('limit', input.get('limit') || '5');
    output.set('language', language(input.get('language'), 'en'));
    const country = input.get('country')?.trim();
    if (country) output.set('country', country.toUpperCase());
    const latitude = coordinate(input.get('lat'));
    const longitude = coordinate(input.get('lon'));
    if (latitude !== null) output.set('lat', latitude);
    if (longitude !== null) output.set('lon', longitude);
    output.set('type', input.get('type') || 'any');
  }
  if (url.pathname === '/api/finance') {
    output.set('symbol', (input.get('symbol') ?? '').trim().toUpperCase());
    output.set('format', format);
    output.set('timeframe', input.get('timeframe') || '1mo');
    const quote = input.get('quote')?.trim();
    if (quote) output.set('quote', quote.toUpperCase());
  }
  if (url.pathname === '/api/finance/search') {
    output.set('q', normalizedQuery(input.get('q')));
    output.set('format', format);
    output.set('limit', input.get('limit') || '10');
    output.set('instrument', input.get('instrument') || 'equity');
  }
  if (url.pathname === '/api/finance/movers') {
    output.set('format', format);
    output.set('limit', input.get('limit') || '10');
    output.set('list', input.get('list') || 'gainers');
  }
  url.search = output.toString();
  // Search uses an independent version so ranking fixes can immediately evict
  // polluted result sets without invalidating the much larger extraction cache.
  url.searchParams.set(
    '__extractor_cache',
    url.pathname === '/api/search'
      ? SEARCH_CACHE_VERSION
      : url.pathname === '/api/news'
        ? NEWS_CACHE_VERSION
        : url.pathname === '/api/images'
          ? IMAGE_CACHE_VERSION
          : url.pathname === '/api/videos'
            ? VIDEO_CACHE_VERSION
            : url.pathname === '/api/places'
              ? PLACE_CACHE_VERSION
            : url.pathname === '/api/finance/movers'
              ? FINANCE_MOVERS_CACHE_VERSION
            : url.pathname === '/api/finance/search'
              ? FINANCE_SEARCH_CACHE_VERSION
              : url.pathname === '/api/finance'
              ? FINANCE_CACHE_VERSION
            : API_CACHE_VERSION,
  );
  return new Request(url.toString(), { method: 'GET' });
}
