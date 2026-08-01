import { handle } from '@astrojs/cloudflare/handler';
import { apiCacheKey } from './features/extraction';
import { getSiteMarkdown } from './features/discovery/site-markdown';
import { mcpHandler } from './features/mcp/server';

const DISCOVERY_LINKS = [
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</llms.txt>; rel="describedby"; type="text/markdown"',
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</schemas/extraction-v1.json>; rel="describedby"; type="application/schema+json"',
  '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
].join(', ');

function acceptsMarkdown(header: string | null): boolean {
  if (!header) return false;

  return header.split(',').some((entry) => {
    const [mediaType, ...parameters] = entry.trim().split(';');
    const refused = parameters.some((parameter) => /^\s*q=0(?:\.0*)?\s*$/i.test(parameter));
    return mediaType.toLowerCase() === 'text/markdown' && !refused;
  });
}

function addVary(headers: Headers, value: string): void {
  const values = new Set((headers.get('Vary') ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set('Vary', [...values].join(', '));
}

function publicApiResponse(response: Response, cacheStatus: 'HIT' | 'MISS'): Response {
  const output = new Response(response.body, response);
  output.headers.delete('X-Extractor-Cache-TTL');
  output.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  output.headers.set('Link', DISCOVERY_LINKS);
  output.headers.set('X-Extractor-Cache', cacheStatus);
  return output;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const markdown = getSiteMarkdown(url.pathname);

    if (url.pathname === '/mcp') {
      const response = await mcpHandler(request, env, context);
      const decorated = new Response(response.body, response);
      decorated.headers.set('Link', DISCOVERY_LINKS);
      return decorated;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && markdown && acceptsMarkdown(request.headers.get('Accept'))) {
      return new Response(request.method === 'HEAD' ? null : markdown, {
        headers: {
          'Cache-Control': 'public, max-age=300',
          'Cloudflare-CDN-Cache-Control': 'public, max-age=3600',
          'Content-Language': 'en',
          'Content-Type': 'text/markdown; charset=utf-8',
          Link: DISCOVERY_LINKS,
          Vary: 'Accept',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/extract') {
      const cache = (caches as CacheStorage & { default: Cache }).default;
      const cacheKey = apiCacheKey(request);
      const cached = await cache.match(cacheKey);
      if (cached) return publicApiResponse(cached, 'HIT');

      const response = await handle(request, env, context);
      const ttl = Number(response.headers.get('X-Extractor-Cache-TTL'));
      if (response.ok && Number.isFinite(ttl) && ttl > 0) {
        const stored = new Response(response.clone().body, response);
        stored.headers.set('Cache-Control', `public, max-age=${ttl}`);
        // Cache writes should not delay the caller. Errors and rate-limit
        // responses never carry a storage TTL and therefore are never stored.
        context.waitUntil(cache.put(cacheKey, stored));
        return publicApiResponse(response, 'MISS');
      }
      return publicApiResponse(response, 'MISS');
    }

    const response = await handle(request, env, context);
    const decorated = new Response(response.body, response);
    decorated.headers.set('Link', DISCOVERY_LINKS);
    if (markdown) addVary(decorated.headers, 'Accept');
    return decorated;
  },
} satisfies ExportedHandler<Env>;
