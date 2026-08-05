import { handle } from '@astrojs/cloudflare/handler';
import { apiCacheKey } from './features/extraction';
import { getSiteMarkdown } from './features/discovery/site-markdown';
import { canonicalPageRedirectUrl } from './features/discovery/canonical-page';
import { mcpHandler } from './features/mcp/server';
import { DODOPAYMENTS_ENVIRONMENT, getSecret } from 'astro:env/server';
import { AccountCredits, AnonymousQuota } from './features/billing/durable-objects';
import {
  finishRequestMeter,
  MeteringError,
  meteringErrorResponse,
  reserveRequestMeter,
} from './features/billing/metering';
import { sendUsageAlert } from './features/billing/email';
import { validateHankoSession } from './features/billing/hanko';
import { maybeTriggerAutoTopUp } from './features/billing/auto-top-up';
import { dodoEnvironment } from './features/billing/dodo';
import { authenticateServiceRequest } from './features/billing/service-auth';

export { AccountCredits, AnonymousQuota };

const DISCOVERY_LINKS = [
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</llms.txt>; rel="describedby"; type="text/markdown"',
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</schemas/extraction-v1.json>; rel="describedby"; type="application/schema+json"',
  '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
].join(', ');

const NOINDEX_PATHS = new Set(['/legal/', '/privacy/', '/terms/', '/login/', '/dashboard/']);

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
  output.headers.set('Cache-Control', response.ok
    ? 'public, max-age=0, must-revalidate'
    : 'private, no-store');
  output.headers.set('Link', DISCOVERY_LINKS);
  output.headers.set('X-Extractor-Cache', cacheStatus);
  return output;
}

function addMeterHeaders(response: Response, kind: Awaited<ReturnType<typeof finishRequestMeter>>['kind'], remaining: number): Response {
  const output = new Response(response.body, response);
  output.headers.set('Cache-Control', 'private, no-store');
  if (kind === 'paid') {
    output.headers.set('X-Extractor-Credits-Used', response.ok ? '1' : '0');
    output.headers.set('X-Extractor-Credits-Remaining', String(remaining));
  } else if (kind === 'anonymous') {
    output.headers.set('X-Extractor-Free-Remaining', String(remaining));
  }
  return output;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const canonicalPageUrl = canonicalPageRedirectUrl(request);
    if (canonicalPageUrl) {
      return new Response(null, {
        status: 308,
        headers: {
          'Cache-Control': 'public, max-age=86400',
          Link: DISCOVERY_LINKS,
          Location: canonicalPageUrl.toString(),
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const markdown = getSiteMarkdown(url.pathname);

    if (url.pathname === '/mcp') {
      const response = await mcpHandler(request, env, context);
      const decorated = new Response(response.body, response);
      decorated.headers.set('Cache-Control', 'private, no-store');
      decorated.headers.set('Link', DISCOVERY_LINKS);
      return decorated;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && markdown && acceptsMarkdown(request.headers.get('Accept'))) {
      return new Response(request.method === 'HEAD' ? null : markdown, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Language': 'en',
          'Content-Type': 'text/markdown; charset=utf-8',
          Link: DISCOVERY_LINKS,
          Vary: 'Accept',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // Public GET APIs use the same versioned cache lifecycle. Paths normally
    // remain distinct; the deprecated /api/maps alias intentionally resolves
    // to the /api/places key. Format and normalized controls remain separate.
    if (request.method === 'GET' && ['/api/extract', '/api/search', '/api/news', '/api/images', '/api/videos', '/api/places', '/api/maps', '/api/finance', '/api/finance/search', '/api/finance/movers'].includes(url.pathname)) {
      // A service marker makes authentication mandatory even when the result
      // is already cached, preventing a stale/bad deployment secret from
      // appearing healthy because an anonymous caller warmed the same URL.
      const serviceAuth = await authenticateServiceRequest(
        request,
        getSecret('LLMBASE_SERVICE_TOKEN'),
      );
      if (serviceAuth.kind === 'invalid') return publicApiResponse(serviceAuth.response, 'MISS');

      // Route-level rate limiters normally key on the connecting IP. Replace it
      // only for authenticated service traffic so different LLMBase accounts
      // retain independent limits without exposing their raw account ids.
      const apiRequest = serviceAuth.kind === 'service'
        ? new Request(request, {
            headers: (() => {
              const headers = new Headers(request.headers);
              headers.set('cf-connecting-ip', serviceAuth.limiterKey);
              return headers;
            })(),
          })
        : request;
      const cache = (caches as CacheStorage & { default: Cache }).default;
      const cacheKey = apiCacheKey(apiRequest);
      const cached = await cache.match(cacheKey);
      if (cached) return publicApiResponse(cached, 'HIT');

      let reservation;
      try {
        // Same-origin website tools send the HttpOnly Hanko cookie. Validate
        // it at the Worker boundary so their uncached requests use the account
        // allowance without exposing an API key to browser JavaScript.
        const useWebsiteSession = serviceAuth.kind === 'public'
          && !apiRequest.headers.has('Authorization')
          && apiRequest.headers.get('X-Extractor-Web-Client') === '1';
        const session = useWebsiteSession ? await validateHankoSession(apiRequest) : null;
        reservation = await reserveRequestMeter(
          apiRequest,
          env,
          getSecret('ANONYMOUS_QUOTA_HMAC_SECRET'),
          session?.userId ?? null,
          serviceAuth.kind === 'service' ? serviceAuth.limiterKey : null,
        );
      } catch (error) {
        if (error instanceof MeteringError) return publicApiResponse(meteringErrorResponse(error), 'MISS');
        throw error;
      }

      let response: Response;
      try {
        response = await handle(apiRequest, env, context);
      } catch (error) {
        await finishRequestMeter(reservation, env, false);
        throw error;
      }
      const ttl = Number(response.headers.get('X-Extractor-Cache-TTL'));
      const commit = response.ok && Number.isFinite(ttl) && ttl > 0;
      const finish = await finishRequestMeter(reservation, env, commit);
      if (commit && reservation.kind === 'paid') {
        const dodoApiKey = getSecret('DODOPAYMENTS_API_KEY');
        if (dodoApiKey && finish.alertPercent && finish.alertEpoch !== undefined && env.ACCOUNT_EMAIL) {
          context.waitUntil(sendUsageAlert({
            db: env.DB,
            email: env.ACCOUNT_EMAIL,
            dodoApiKey,
            dodoEnvironment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
            userId: reservation.userId,
            percent: finish.alertPercent,
            epoch: finish.alertEpoch,
            remaining: finish.remaining,
          }));
        }
        if (dodoApiKey) {
          context.waitUntil(maybeTriggerAutoTopUp({
            db: env.DB,
            env,
            apiKey: dodoApiKey,
            environment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
            userId: reservation.userId,
            remainingCredits: finish.remaining,
          }).catch((error) => console.error('Automatic credit top-up failed', error)));
        }
      }
      if (commit) {
        const stored = new Response(response.clone().body, response);
        stored.headers.set('Cache-Control', `public, max-age=${ttl}`);
        stored.headers.delete('Authorization');
        stored.headers.delete('X-Extractor-Credits-Used');
        stored.headers.delete('X-Extractor-Credits-Remaining');
        stored.headers.delete('X-Extractor-Free-Remaining');
        // Cache writes should not delay the caller. Errors and rate-limit
        // responses never carry a storage TTL and therefore are never stored.
        context.waitUntil(cache.put(cacheKey, stored));
        return addMeterHeaders(publicApiResponse(response, 'MISS'), finish.kind, finish.remaining);
      }
      return addMeterHeaders(publicApiResponse(response, 'MISS'), finish.kind, finish.remaining);
    }

    const response = await handle(request, env, context);
    const decorated = new Response(response.body, response);
    decorated.headers.set('Link', DISCOVERY_LINKS);
    decorated.headers.delete('CDN-Cache-Control');
    decorated.headers.delete('Cloudflare-CDN-Cache-Control');
    if (url.pathname.startsWith('/api/')) {
      decorated.headers.set('Cache-Control', 'private, no-store');
    } else {
      // Website HTML, agent-readable representations, and static assets must
      // always be fetched from the current deployment by both browsers and
      // intermediaries. API result reuse remains isolated in caches.default.
      decorated.headers.set('Cache-Control', 'no-store');
    }
    // Legal pages remain directly available to people through the footer but
    // are intentionally excluded from search indexes and public discovery.
    if (NOINDEX_PATHS.has(url.pathname)) {
      // Never let an unlocked response enter a shared cache or the browser's
      // page cache; access is evaluated independently on every navigation.
      decorated.headers.set('Cache-Control', 'private, no-store');
      decorated.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    if (markdown) addVary(decorated.headers, 'Accept');
    return decorated;
  },
} satisfies ExportedHandler<Env>;
