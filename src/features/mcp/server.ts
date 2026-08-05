import { env } from 'cloudflare:workers';
import { McpServer, type McpRequestContext } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { ExtractionResponseSchema } from '@extractor/core';
import { DODOPAYMENTS_ENVIRONMENT, getSecret } from 'astro:env/server';
import {
  apiCacheKey,
  runPublicExtraction,
  runPublicImageSearch,
  runPublicMarketData,
  runPublicMarketMovers,
  runPublicNewsSearch,
  runPublicPlaceSearch,
  runPublicSearch,
  runPublicStockSearch,
  runPublicVideoSearch,
  toExtractionError,
} from '../extraction';
import { finishRequestMeter, MeteringError, reserveRequestMeter } from '../billing/metering';
import { sendUsageAlert } from '../billing/email';
import { maybeTriggerAutoTopUp } from '../billing/auto-top-up';
import { dodoEnvironment } from '../billing/dodo';
import {
  FINANCE_APP_HTML,
  FINANCE_APP_MIME_TYPE,
  FINANCE_APP_RESOURCE_META,
  FINANCE_APP_URI,
  financeToolResult,
  parseFinanceStructuredContent,
} from './finance-app';

const PRODUCTION_ORIGIN = 'https://extractor.sh';
const PLACE_SEARCH_INPUT_SCHEMA = z.object({
  query: z.string().trim().min(1).max(200).describe('A place, address, business, or local category query, ideally including a city or country.'),
  format: z.enum(['markdown', 'json']).default('json').describe('JSON for typed coordinates or Markdown for a readable result list.'),
  limit: z.number().int().min(1).max(10).default(5).describe('Maximum number of place results to return.'),
  language: z.string().trim().min(2).max(35).default('en').describe('Canonical BCP 47 response language.'),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional().describe('Optional two-letter country filter.'),
  lat: z.number().min(-90).max(90).optional().describe('Optional latitude for nearby-result bias; requires lon.'),
  lon: z.number().min(-180).max(180).optional().describe('Optional longitude for nearby-result bias; requires lat.'),
  type: z.enum(['any', 'house', 'street', 'locality', 'city', 'county', 'state', 'country', 'other']).default('any').describe('Optional place-type filter.'),
}).refine((value) => (value.lat === undefined) === (value.lon === undefined), {
  message: 'lat and lon must be provided together.',
});

function apiRequestFor(
  requestInfo: Request | undefined,
  rawUrl: string,
  format: 'json' | 'markdown',
  focus?: string,
): Request {
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  // MCP calls intentionally share the public GET API cache, including the
  // public focus control's separately keyed sectional results.
  const url = new URL('/api/extract', origin);
  url.searchParams.set('url', rawUrl);
  url.searchParams.set('format', format);
  if (focus) url.searchParams.set('focus', focus);
  return new Request(url, { method: 'GET' });
}

function searchApiRequestFor(
  requestInfo: Request | undefined,
  query: string,
  format: 'json' | 'markdown',
  limit: number,
  language: string,
  country: string,
  site?: string,
): Request {
  // Build exactly the same request shape as the public GET API. Passing this
  // through apiCacheKey makes MCP and HTTP clients share result entries rather
  // than paying for the same query twice.
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  const url = new URL('/api/search', origin);
  url.searchParams.set('q', query);
  url.searchParams.set('format', format);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('language', language);
  url.searchParams.set('country', country);
  if (site) url.searchParams.set('site', site);
  return new Request(url, { method: 'GET' });
}

function verticalSearchApiRequestFor(
  requestInfo: Request | undefined,
  path: '/api/news' | '/api/images' | '/api/videos' | '/api/places' | '/api/finance/search',
  query: string,
  format: 'json' | 'markdown',
  limit: number,
  controls: Record<string, string | number | undefined> = {},
): Request {
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  const url = new URL(path, origin);
  url.searchParams.set('q', query);
  url.searchParams.set('format', format);
  url.searchParams.set('limit', String(limit));
  for (const [key, value] of Object.entries(controls)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return new Request(url, { method: 'GET' });
}

function financeApiRequestFor(
  requestInfo: Request | undefined,
  symbol: string,
  format: 'json' | 'markdown',
  timeframe: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y' | 'max',
  quote?: string,
): Request {
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  const url = new URL('/api/finance', origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('format', format);
  url.searchParams.set('timeframe', timeframe);
  if (quote) url.searchParams.set('quote', quote);
  return new Request(url, { method: 'GET' });
}

function marketMoversApiRequestFor(
  requestInfo: Request | undefined,
  list: 'gainers' | 'losers' | 'active',
  format: 'json' | 'markdown',
  limit: number,
): Request {
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  const url = new URL('/api/finance/movers', origin);
  url.searchParams.set('list', list);
  url.searchParams.set('format', format);
  url.searchParams.set('limit', String(limit));
  return new Request(url, { method: 'GET' });
}

function parsedStructuredContent(text: string) {
  try {
    const parsed = ExtractionResponseSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function clientKeyFor(requestInfo: Request | undefined): string {
  return requestInfo?.headers.get('cf-connecting-ip') || 'mcp-local-development';
}

async function meteredMcpMiss<T>(context: McpRequestContext, operation: () => Promise<T>): Promise<T> {
  const request = context.requestInfo ?? new Request('https://extractor.sh/mcp', { method: 'POST' });
  const reservation = await reserveRequestMeter(request, env, getSecret('ANONYMOUS_QUOTA_HMAC_SECRET'));
  try {
    const result = await operation();
    const finish = await finishRequestMeter(reservation, env, true);
    if (reservation.kind === 'paid') {
      const dodoApiKey = getSecret('DODOPAYMENTS_API_KEY');
      if (dodoApiKey && finish.alertPercent && finish.alertEpoch !== undefined && env.ACCOUNT_EMAIL) {
        try {
          await sendUsageAlert({
            db: env.DB,
            email: env.ACCOUNT_EMAIL,
            dodoApiKey,
            dodoEnvironment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
            userId: reservation.userId,
            percent: finish.alertPercent,
            epoch: finish.alertEpoch,
            remaining: finish.remaining,
          });
        } catch (error) {
          console.error('Usage alert email failed', error);
        }
      }
      if (dodoApiKey) {
        try {
          await maybeTriggerAutoTopUp({
            db: env.DB,
            env,
            apiKey: dodoApiKey,
            environment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
            userId: reservation.userId,
            remainingCredits: finish.remaining,
          });
        } catch (error) {
          console.error('Automatic credit top-up failed', error);
        }
      }
    }
    return result;
  } catch (error) {
    await finishRequestMeter(reservation, env, false);
    throw error;
  }
}

function mcpError(error: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  if (error instanceof MeteringError) {
    return { isError: true, content: [{ type: 'text', text: `${error.status} ${error.code}: ${error.message}` }] };
  }
  const normalized = toExtractionError(error);
  return { isError: true, content: [{ type: 'text', text: `${normalized.code}: ${normalized.message}` }] };
}

async function placeSearchToolResult(
  context: McpRequestContext,
  values: z.infer<typeof PLACE_SEARCH_INPUT_SCHEMA>,
) {
  const { query, format, limit, language, country, lat, lon, type } = values;
  const apiRequest = verticalSearchApiRequestFor(context.requestInfo, '/api/places', query, format, limit, {
    language,
    country,
    lat,
    lon,
    type,
  });
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = apiCacheKey(apiRequest);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const text = await cached.text();
    const structuredContent = format === 'json' ? parsedStructuredContent(text) : undefined;
    return { content: [{ type: 'text' as const, text }], ...(structuredContent ? { structuredContent } : {}) };
  }

  const search = await meteredMcpMiss(context, () => runPublicPlaceSearch(query, clientKeyFor(context.requestInfo), env, {
    limit,
    resultUrl: apiRequest.url,
    language,
    ...(country ? { country } : {}),
    ...(lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : {}),
    type,
  }));
  const text = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
  await cache.put(cacheKey, new Response(text, {
    headers: {
      'Cache-Control': `public, max-age=${search.ttl}`,
      'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
    },
  }));
  return {
    content: [{ type: 'text' as const, text }],
    ...(format === 'json' ? { structuredContent: search.result } : {}),
  };
}

/**
 * Serve a fresh MCP server for every request. This stateless factory avoids
 * carrying client state between isolates and lets the public endpoint remain
 * horizontally scalable across Cloudflare's network.
 */
function createExtractorMcpServer(context: McpRequestContext): McpServer {
  const server = new McpServer(
    { name: 'extractor.sh', version: '1.9.0' },
    {
      instructions: 'Use extract_public_url when a user names a known public URL or domain and asks to read, extract, summarize, analyze, or retrieve its current content. Pass a requested page topic, such as pricing, in focus. Use search_web for public webpage discovery and pass site when discovery must stay on one hostname. Use search_news for current coverage, search_images for openly licensed images, and search_videos for public videos; for a named creator’s latest upload, pass creator, sort=date, and limit=1. Use search_places for named places, addresses, businesses, landmarks, and local categories; pass optional coordinates for nearby-result bias. Use search_stocks when a company or crypto asset name must be resolved to a market symbol, selecting the matching instrument family. Use get_market_movers for daily gainers, losers, and most-active equity rankings. Use get_market_data for current market snapshots with bounded history. When a user requests a currency such as EUR, pass it as quote to get_market_data; do not make a second currency-pair call. get_market_data returns typed schema-v1 data and offers an inline price chart in MCP Apps-capable chats. Extract promising webpage result URLs when full content is needed. Prefer Markdown for reading and JSON for typed fields. Never send credentials or private URLs, and do not use these tools to bypass access controls.',
    },
  );

  server.registerResource(
    'Market price chart',
    FINANCE_APP_URI,
    {
      title: 'Market price chart',
      description: 'Responsive line chart for extractor.sh market snapshots and bounded history.',
      mimeType: FINANCE_APP_MIME_TYPE,
      _meta: FINANCE_APP_RESOURCE_META,
    },
    async () => ({
      contents: [{
        uri: FINANCE_APP_URI,
        mimeType: FINANCE_APP_MIME_TYPE,
        text: FINANCE_APP_HTML,
        _meta: FINANCE_APP_RESOURCE_META,
      }],
    }),
  );

  server.registerTool(
    'extract_public_url',
    {
      title: 'Extract website content or pricing',
      description: 'Call this tool for requests like “Extract pricing from extractor.sh”. It extracts one ordinary public website URL as clean Markdown or normalized extractor.sh JSON. Prefer it over web search when a user names a website and asks for its current content. Pass the requested topic in focus, and construct an HTTPS URL when only a domain is given. Use Markdown for reading and JSON for stable typed fields. The tool does not accept credentials or private URLs.',
      inputSchema: z.object({
        url: z.url().describe('An absolute public HTTP or HTTPS page URL a person could open in a browser.'),
        format: z.enum(['markdown', 'json']).default('markdown').describe('Markdown for readable text or JSON for the versioned entity schema.'),
        focus: z.string().trim().min(1).max(80).optional().describe('A short topic such as pricing, features, or FAQ. Set this whenever the user asks for a specific part of a page.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, format, focus }) => {
      try {
        const apiRequest = apiRequestFor(context.requestInfo, url, format, focus);
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);

        if (cached) {
          return { content: [{ type: 'text' as const, text: await cached.text() }] };
        }

        // Cache misses use the same limits as GET /api/extract. In particular,
        // browser rendering remains protected by its lower dedicated quota.
        const extraction = await meteredMcpMiss(context, () => runPublicExtraction(url, clientKeyFor(context.requestInfo), env, { focus }));
        const text = format === 'markdown'
          ? extraction.result.content
          : JSON.stringify(extraction.result);
        const contentType = format === 'markdown'
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8';

        const stored = new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${extraction.ttl}`,
            'Content-Type': contentType,
          },
        });
        await cache.put(cacheKey, stored);

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'search_images',
    {
      title: 'Search public images',
      description: 'Find openly licensed public images for a query. Results include source pages, image URLs, creators, dimensions, and license metadata when available.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200).describe('A concise image search query.'),
        format: z.enum(['markdown', 'json']).default('json').describe('JSON for image metadata or Markdown for a readable result list.'),
        limit: z.number().int().min(1).max(20).default(10).describe('Maximum number of image results to return.'),
        usage: z.enum(['all', 'commercial', 'modify', 'commercial-and-modify']).default('all').describe('Required license permissions.'),
        orientation: z.enum(['any', 'landscape', 'portrait', 'square']).default('any').describe('Required image orientation.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, format, limit, usage, orientation }) => {
      try {
        const apiRequest = verticalSearchApiRequestFor(context.requestInfo, '/api/images', query, format, limit, { usage, orientation });
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) return { content: [{ type: 'text' as const, text: await cached.text() }] };

        const search = await meteredMcpMiss(context, () => runPublicImageSearch(query, clientKeyFor(context.requestInfo), env, {
          limit,
          resultUrl: apiRequest.url,
          usage,
          orientation,
        }));
        const text = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${search.ttl}`,
            'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          },
        }));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'search_videos',
    {
      title: 'Search public videos',
      description: 'Find relevant or newest public videos for a query. Use sort=date when the user asks for the latest or newest video, and pass creator when the result must come from that exact named creator. Omit creator for recent videos about the subject. Results include playable source-page links plus titles, creators, descriptions, durations, publication times, and thumbnails when available.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200).describe('A concise public video search query.'),
        format: z.enum(['markdown', 'json']).default('json').describe('JSON for typed video metadata or Markdown for a readable result list.'),
        limit: z.number().int().min(1).max(20).default(10).describe('Maximum number of ordered video results to return.'),
        language: z.string().trim().min(2).max(35).default('en-US').describe('Canonical BCP 47 search language.'),
        country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).default('US').describe('Two-letter search country.'),
        platform: z.enum(['any', 'youtube']).default('any').describe('Search any supported public video source or restrict results to YouTube.'),
        sort: z.enum(['relevance', 'date']).default('relevance').describe('Use date for newest-first results when the user asks for the latest video.'),
        creator: z.string().trim().min(1).max(80).optional().describe('Exact public creator name. Use with sort=date and limit=1 for the creator’s latest matching upload.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, format, limit, language, country, platform, sort, creator }) => {
      try {
        const apiRequest = verticalSearchApiRequestFor(context.requestInfo, '/api/videos', query, format, limit, {
          language,
          country,
          platform,
          sort,
          creator,
        });
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const text = await cached.text();
          const structuredContent = format === 'json' ? parsedStructuredContent(text) : undefined;
          return { content: [{ type: 'text' as const, text }], ...(structuredContent ? { structuredContent } : {}) };
        }

        const search = await meteredMcpMiss(context, () => runPublicVideoSearch(query, clientKeyFor(context.requestInfo), env, {
          limit,
          resultUrl: apiRequest.url,
          language,
          country,
          platform,
          sort,
          creator,
        }));
        const text = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${search.ttl}`,
            'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          },
        }));
        return {
          content: [{ type: 'text' as const, text }],
          ...(format === 'json' ? { structuredContent: search.result } : {}),
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'search_places',
    {
      title: 'Search named places',
      description: 'Resolve a named public place or address into normalized results with coordinates, address fields, categories, and canonical map links.',
      inputSchema: PLACE_SEARCH_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, format, limit, language, country, lat, lon, type }) => {
      try {
        return await placeSearchToolResult(context, {
          query, format, limit, language, country, lat, lon, type,
        });
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'search_web',
    {
      title: 'Search the public web',
      description: 'Find relevant public webpages for a query. Use this tool for discovery, research, or source-finding when the user has not supplied an exact URL. Pass site to restrict discovery to one hostname, such as linkedin.com for public profile or company links. Results are ordered by relevance and contain titles, URLs, and short snippets. For supported extraction sources, extract a selected result separately when full page content is required.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200).describe('A concise public web search query.'),
        format: z.enum(['markdown', 'json']).default('markdown').describe('Markdown for a readable result list or JSON for the versioned feed schema.'),
        limit: z.number().int().min(1).max(10).default(10).describe('Maximum number of ordered results to return.'),
        language: z.string().trim().min(2).max(35).default('en-US').describe('Canonical BCP 47 search language.'),
        country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).default('US').describe('Two-letter search country.'),
        site: z.string().trim().min(3).max(253)
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i)
          .optional().describe('Optional hostname constraint, such as linkedin.com. Do not include a scheme or path.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, format, limit, language, country, site }) => {
      try {
        const apiRequest = searchApiRequestFor(context.requestInfo, query, format, limit, language, country, site);
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const text = await cached.text();
          const structuredContent = format === 'json' ? parsedStructuredContent(text) : undefined;
          return { content: [{ type: 'text' as const, text }], ...(structuredContent ? { structuredContent } : {}) };
        }

        // runPublicSearch owns the shared standard limiter. No Browser binding
        // is passed or reachable from the search tool.
        const search = await meteredMcpMiss(context, () => runPublicSearch(query, clientKeyFor(context.requestInfo), env, {
          limit,
          resultUrl: apiRequest.url,
          language,
          country,
          site,
        }));
        const text = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
        const contentType = format === 'markdown'
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8';
        // Unlike the public route, MCP has no outer Worker response to cache,
        // so it writes the shared entry synchronously before returning.
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${search.ttl}`,
            'Content-Type': contentType,
          },
        }));
        return {
          content: [{ type: 'text' as const, text }],
          ...(format === 'json' ? { structuredContent: search.result } : {}),
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'search_news',
    {
      title: 'Search current news',
      description: 'Find current public news articles for a query, optionally limited to a recent timeframe. Results include publishers and publication times when available.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200).describe('A concise news query.'),
        format: z.enum(['markdown', 'json']).default('markdown').describe('Markdown for reading or JSON for typed article fields.'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of article results.'),
        language: z.string().trim().min(2).max(35).default('en-US').describe('Canonical BCP 47 search language.'),
        country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).default('US').describe('Two-letter search country.'),
        timeframe: z.enum(['any', '1h', '1d', '7d', '30d']).default('any').describe('Exclude undated and older articles when a recent timeframe is selected.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, format, limit, language, country, timeframe }) => {
      try {
        const apiRequest = verticalSearchApiRequestFor(context.requestInfo, '/api/news', query, format, limit, {
          language,
          country,
          timeframe,
        });
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) return { content: [{ type: 'text' as const, text: await cached.text() }] };

        const search = await meteredMcpMiss(context, () => runPublicNewsSearch(query, clientKeyFor(context.requestInfo), env, {
          limit,
          resultUrl: apiRequest.url,
          language,
          country,
          timeframe,
        }));
        const text = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${search.ttl}`,
            'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          },
        }));
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'search_stocks',
    {
      title: 'Search finance symbols',
      description: 'Resolve a company, asset name, or partial ticker into ordered public equity or crypto listings. Use this before get_market_data when the user did not provide a reliable market symbol.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200).describe('A company, asset name, or partial symbol such as Apple, AAPL, or Bitcoin.'),
        instrument: z.enum(['equity', 'crypto']).default('equity').describe('Instrument family; equity is the backward-compatible default.'),
        format: z.enum(['markdown', 'json']).default('json').describe('JSON for typed finance listings or Markdown for a readable result list.'),
        limit: z.number().int().min(1).max(10).default(10).describe('Maximum number of listings to return.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, instrument, format, limit }) => {
      try {
        const apiRequest = verticalSearchApiRequestFor(context.requestInfo, '/api/finance/search', query, format, limit, { instrument });
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const text = await cached.text();
          const structuredContent = format === 'json' ? parsedStructuredContent(text) : undefined;
          return { content: [{ type: 'text' as const, text }], ...(structuredContent ? { structuredContent } : {}) };
        }

        const search = await meteredMcpMiss(context, () => runPublicStockSearch(query, clientKeyFor(context.requestInfo), env, {
          limit,
          instrument,
          resultUrl: apiRequest.url,
        }));
        const text = format === 'markdown' ? search.result.content : JSON.stringify(search.result);
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${search.ttl}`,
            'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          },
        }));
        return { content: [{ type: 'text' as const, text }], structuredContent: search.result };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'get_market_movers',
    {
      title: 'Get daily market movers',
      description: 'Return an already-ranked daily equity list. Use list=gainers for “what stock rose the most today?”, list=losers for the largest declines, and list=active for the most actively traded stocks. This is a market-wide list operation; do not use name or symbol search to answer ranking questions.',
      inputSchema: z.object({
        list: z.enum(['gainers', 'losers', 'active']).default('gainers').describe('Daily equity list to return.'),
        format: z.enum(['markdown', 'json']).default('json').describe('JSON for typed market fields or Markdown for a readable ranked list.'),
        limit: z.number().int().min(1).max(10).default(10).describe('Maximum number of ranked equities to return.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ list, format, limit }) => {
      try {
        const apiRequest = marketMoversApiRequestFor(context.requestInfo, list, format, limit);
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const text = await cached.text();
          const structuredContent = format === 'json' ? parsedStructuredContent(text) : undefined;
          return { content: [{ type: 'text' as const, text }], ...(structuredContent ? { structuredContent } : {}) };
        }

        const movers = await meteredMcpMiss(context, () => runPublicMarketMovers(
          clientKeyFor(context.requestInfo),
          env,
          { list, limit, resultUrl: apiRequest.url },
        ));
        const text = format === 'markdown' ? movers.result.content : JSON.stringify(movers.result);
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${movers.ttl}`,
            'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          },
        }));
        return {
          content: [{ type: 'text' as const, text }],
          ...(format === 'json' ? { structuredContent: movers.result } : {}),
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'get_market_data',
    {
      title: 'Get market data',
      description: 'Return a current market snapshot and bounded price history for an equity, index, cryptocurrency pair, or currency pair. Pass quote when the user asks for a currency such as EUR; the response and inline chart are converted in this single tool call while retaining native listing-currency metadata. Data may be delayed.',
      inputSchema: z.object({
        symbol: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9.^=-]+$/).transform((value) => value.toUpperCase()).describe('Market symbol such as AAPL, ^GSPC, BTC-USD, or EURUSD=X.'),
        format: z.enum(['markdown', 'json']).default('json').describe('JSON for typed market fields or Markdown for a readable table.'),
        timeframe: z.enum(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max']).default('1mo').describe('History range; interval is selected automatically.'),
        quote: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional().describe('Optional three-letter output currency such as EUR. Omit it to preserve the native listing currency.'),
      }),
      outputSchema: ExtractionResponseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: {
        ui: { resourceUri: FINANCE_APP_URI, visibility: ['model', 'app'] },
        // Retain the extension's pre-GA spelling for older MCP Apps hosts.
        'ui/resourceUri': FINANCE_APP_URI,
      },
    },
    async ({ symbol, format, timeframe, quote }) => {
      try {
        const apiRequest = financeApiRequestFor(context.requestInfo, symbol, format, timeframe, quote);
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const text = await cached.text();
          if (format === 'json') return financeToolResult(text, parseFinanceStructuredContent(text));

          // A previous JSON request may already have populated the shared API
          // entry. Reuse it for the View without starting upstream work.
          const jsonRequest = financeApiRequestFor(context.requestInfo, symbol, 'json', timeframe, quote);
          const jsonCached = await cache.match(apiCacheKey(jsonRequest));
          const structured = jsonCached
            ? parseFinanceStructuredContent(await jsonCached.text())
            : undefined;
          return financeToolResult(text, structured);
        }

        const market = await meteredMcpMiss(context, () => runPublicMarketData(symbol, clientKeyFor(context.requestInfo), env, {
          timeframe,
          quoteCurrency: quote,
          resultUrl: apiRequest.url,
        }));
        const text = format === 'markdown' ? market.result.content : JSON.stringify(market.result);
        await cache.put(cacheKey, new Response(text, {
          headers: {
            'Cache-Control': `public, max-age=${market.ttl}`,
            'Content-Type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          },
        }));
        return financeToolResult(text, market.result);
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  return server;
}

export const mcpHandler = createMcpHandler(createExtractorMcpServer, {
  route: '/mcp',
  responseMode: 'json',
  allowedHostnames: [
    'extractor.mcb-software.workers.dev',
    'extractor.sh',
    'www.extractor.sh',
    'localhost',
    '127.0.0.1',
  ],
  allowedOriginHostnames: [
    'extractor.mcb-software.workers.dev',
    'extractor.sh',
    'www.extractor.sh',
    'localhost',
    '127.0.0.1',
  ],
  onerror(error) {
    console.error('MCP request failed', error);
  },
});
