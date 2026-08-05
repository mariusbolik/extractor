import type { APIRoute } from 'astro';
import { extractionJsonSchema } from '@extractor/core';

export const prerender = true;

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
};

export const GET: APIRoute = () => {
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'extractor.sh API',
      version: '1.4.0',
      description: 'Search the public web, images, videos, news, places, and market data, or extract supported webpage, commerce, social, audio, podcast, and video URLs into clean Markdown or normalized JSON.',
      license: { name: 'Proprietary' },
    },
    servers: [{ url: 'https://extractor.sh' }],
    externalDocs: {
      description: 'Agent-readable documentation',
      url: 'https://extractor.sh/llms-full.txt',
    },
    paths: {
      '/api/extract': {
        get: {
          operationId: 'extractUrl',
          summary: 'Extract a public URL',
          description: 'Returns a schema-versioned entity as JSON by default or raw Markdown when format=markdown. Successful results are cacheable and subject to per-client rate limits.',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              description: 'Absolute public HTTP or HTTPS URL to extract.',
              schema: { type: 'string', format: 'uri', maxLength: 2048 },
              example: 'https://example.com/article',
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Response representation.',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
            {
              name: 'focus', in: 'query', required: false,
              description: 'Optional topic used to select a relevant section on generic webpages.',
              schema: { type: 'string', minLength: 1, maxLength: 80 },
            },
          ],
          responses: {
            200: {
              description: 'Extraction completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': {
                  description: 'Whether the versioned Worker cache served the response.',
                  schema: { type: 'string', enum: ['HIT', 'MISS'] },
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            404: { description: 'The public source was not found or is unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            413: { description: 'Extracted content exceeds 2 MB.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            415: { description: 'The source content type is unsupported.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            422: { description: 'The public URL could not be extracted.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: {
              description: 'The anonymous daily allowance or a per-client rate limit was exceeded.',
              headers: { 'Retry-After': { schema: { type: 'integer' } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: { description: 'The extracted result failed internal response validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'The upstream source failed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'The upstream source timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/search': {
        get: {
          operationId: 'searchWeb',
          summary: 'Search the public web',
          description: 'Returns up to ten ordered search results as a schema-versioned feed or raw Markdown. Successful results are cached for one hour and subject to the standard per-client rate limit.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Public web search query.',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
              example: 'Cloudflare Workers documentation',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of ordered results.',
              schema: { type: 'integer', minimum: 1, maximum: 10, default: 10 },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Response representation.',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
            { name: 'language', in: 'query', required: false, description: 'Canonical BCP 47 search language.', schema: { type: 'string', default: 'en-US' } },
            { name: 'country', in: 'query', required: false, description: 'Two-letter ISO search country.', schema: { type: 'string', pattern: '^[A-Za-z]{2}$', default: 'US' } },
            { name: 'site', in: 'query', required: false, description: 'Restrict results to this hostname and its subdomains.', schema: { type: 'string', maxLength: 253, pattern: '^(?:[A-Za-z0-9-]+\\.)+[A-Za-z0-9-]+$' }, example: 'linkedin.com' },
          ],
          responses: {
            200: {
              description: 'Search completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': {
                  description: 'Whether the versioned Worker cache served the response.',
                  schema: { type: 'string', enum: ['HIT', 'MISS'] },
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: {
              description: 'The anonymous daily allowance or a per-client rate limit was exceeded.',
              headers: { 'Retry-After': { schema: { type: 'integer' } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: { description: 'The search result failed internal response validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'The search index failed or returned an unexpected response.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'The search index timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/news': {
        get: {
          operationId: 'searchNews',
          summary: 'Search current public news',
          description: 'Returns up to 50 current articles as a schema-versioned feed or raw Markdown. Successful results are cached for one hour and subject to the standard per-client rate limit.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Public news search query.',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
              example: 'AI infrastructure',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of current article results.',
              schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Response representation.',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
            { name: 'language', in: 'query', required: false, description: 'Canonical BCP 47 search language.', schema: { type: 'string', default: 'en-US' } },
            { name: 'country', in: 'query', required: false, description: 'Two-letter ISO search country.', schema: { type: 'string', pattern: '^[A-Za-z]{2}$', default: 'US' } },
            { name: 'timeframe', in: 'query', required: false, description: 'Exclude undated and older articles when a recent range is selected.', schema: { type: 'string', enum: ['any', '1h', '1d', '7d', '30d'], default: 'any' } },
          ],
          responses: {
            200: {
              description: 'News search completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': {
                  description: 'Whether the versioned Worker cache served the response.',
                  schema: { type: 'string', enum: ['HIT', 'MISS'] },
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            404: { description: 'No public news results were found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: {
              description: 'The anonymous daily allowance or a per-client rate limit was exceeded.',
              headers: { 'Retry-After': { schema: { type: 'integer' } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: { description: 'The news result failed internal response validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'The public news source failed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'The public news source timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/images': {
        get: {
          operationId: 'searchImages',
          summary: 'Search openly licensed public images',
          description: 'Returns up to 20 image results as a schema-versioned feed or raw Markdown. Results include public source links and license metadata when available. Successful responses are cached for one hour.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Public image search query.',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
              example: 'coral reef',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of image results.',
              schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Response representation.',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
            { name: 'usage', in: 'query', required: false, description: 'Required open-license permissions.', schema: { type: 'string', enum: ['all', 'commercial', 'modify', 'commercial-and-modify'], default: 'all' } },
            { name: 'orientation', in: 'query', required: false, description: 'Required image orientation.', schema: { type: 'string', enum: ['any', 'landscape', 'portrait', 'square'], default: 'any' } },
          ],
          responses: {
            200: {
              description: 'Image search completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': {
                  description: 'Whether the versioned Worker cache served the response.',
                  schema: { type: 'string', enum: ['HIT', 'MISS'] },
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'The anonymous daily allowance or a per-client rate limit was exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            500: { description: 'The image result failed schema validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'Public image search is temporarily unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'Public image search timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/videos': {
        get: {
          operationId: 'searchVideos',
          summary: 'Search public videos',
          description: 'Returns up to 20 relevant or newest-first public video results as a schema-versioned feed or raw Markdown. Results include source-page links and available creator, duration, date, description, and thumbnail metadata. Safe search is strict, and successful responses are cached for one hour.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Public video search query.',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
              example: 'Cloudflare Workers tutorial',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of ordered video results.',
              schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Response representation.',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
            { name: 'language', in: 'query', required: false, description: 'Canonical BCP 47 search language.', schema: { type: 'string', default: 'en-US' } },
            { name: 'country', in: 'query', required: false, description: 'Two-letter ISO search country.', schema: { type: 'string', pattern: '^[A-Za-z]{2}$', default: 'US' } },
            { name: 'platform', in: 'query', required: false, description: 'Search any supported public video source or restrict results to YouTube.', schema: { type: 'string', enum: ['any', 'youtube'], default: 'any' } },
            { name: 'sort', in: 'query', required: false, description: 'Result ordering. Use date when the user asks for the latest or newest video.', schema: { type: 'string', enum: ['relevance', 'date'], default: 'relevance' } },
            { name: 'creator', in: 'query', required: false, description: 'Exact public creator name. Combine with date ordering and limit 1 for the creator’s latest matching upload.', schema: { type: 'string', minLength: 1, maxLength: 80 }, example: 'Taylor Swift' },
          ],
          responses: {
            200: {
              description: 'Video search completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': {
                  description: 'Whether the versioned Worker cache served the response.',
                  schema: { type: 'string', enum: ['HIT', 'MISS'] },
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'The anonymous daily allowance or a per-client rate limit was exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            500: { description: 'The video result failed schema validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'Public video search is temporarily unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'Public video search timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/places': {
        get: {
          operationId: 'searchPlaces',
          summary: 'Resolve named places and addresses',
          description: 'Returns up to ten place results with coordinates and normalized address data as a schema-versioned feed or raw Markdown. Successful responses are cached for one hour.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Named public place or address.',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
              example: 'Brandenburg Gate Berlin',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of place results.',
              schema: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Response representation.',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
            { name: 'language', in: 'query', required: false, description: 'Canonical BCP 47 result language.', schema: { type: 'string', default: 'en' } },
            { name: 'country', in: 'query', required: false, description: 'Optional two-letter ISO hard filter.', schema: { type: 'string', pattern: '^[A-Za-z]{2}$' } },
            { name: 'lat', in: 'query', required: false, description: 'Latitude for location bias; must be paired with lon.', schema: { type: 'number', minimum: -90, maximum: 90 } },
            { name: 'lon', in: 'query', required: false, description: 'Longitude for location bias; must be paired with lat.', schema: { type: 'number', minimum: -180, maximum: 180 } },
            { name: 'type', in: 'query', required: false, description: 'Place type filter.', schema: { type: 'string', enum: ['any', 'house', 'street', 'locality', 'city', 'county', 'state', 'country', 'other'], default: 'any' } },
          ],
          responses: {
            200: {
              description: 'Place search completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': {
                  description: 'Whether the versioned Worker cache served the response.',
                  schema: { type: 'string', enum: ['HIT', 'MISS'] },
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'The anonymous daily allowance or a per-client rate limit was exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            500: { description: 'The place result failed schema validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'Public place search is temporarily unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'Public place search timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/finance': {
        get: {
          operationId: 'getMarketData',
          summary: 'Get a market snapshot and price history',
          description: 'Returns a market document with an automatically selected interval and at most 512 history points. Values use the native listing currency unless quote requests a three-letter output currency. Successful responses are cached for five minutes.',
          parameters: [
            { name: 'symbol', in: 'query', required: true, description: 'Market symbol such as AAPL, ^GSPC, BTC-USD, or EURUSD=X.', schema: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9.^=-]+$' } },
            { name: 'timeframe', in: 'query', required: false, description: 'History range. The interval is selected automatically.', schema: { type: 'string', enum: ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max'], default: '1mo' } },
            { name: 'quote', in: 'query', required: false, description: 'Optional three-letter output currency such as EUR. Converted responses retain the native listing currency and exchange-rate metadata.', schema: { type: 'string', pattern: '^[A-Za-z]{3}$', example: 'EUR' } },
            { name: 'format', in: 'query', required: false, description: 'Response representation.', schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' } },
          ],
          responses: {
            200: {
              description: 'Market data request completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': { description: 'Whether the versioned Worker cache served the response.', schema: { type: 'string', enum: ['HIT', 'MISS'] } },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            404: { description: 'The market symbol is unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'The anonymous daily allowance or standard request limit was exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            500: { description: 'The market result failed schema validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'Public market data is temporarily unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'Public market data timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/finance/search': {
        get: {
          operationId: 'searchFinanceInstruments',
          summary: 'Search public equity or crypto symbols',
          description: 'Returns up to ten ordered equity or crypto listings as a schema-versioned finance feed without fetching each quote. Successful responses are cached for one hour.',
          parameters: [
            { name: 'q', in: 'query', required: true, description: 'Company or asset name, brand, or partial market symbol.', schema: { type: 'string', minLength: 1, maxLength: 200 }, example: 'Apple' },
            { name: 'limit', in: 'query', required: false, description: 'Maximum number of matching listings.', schema: { type: 'integer', minimum: 1, maximum: 10, default: 10 } },
            { name: 'instrument', in: 'query', required: false, description: 'Instrument family. Equity remains the default for backward compatibility.', schema: { type: 'string', enum: ['equity', 'crypto'], default: 'equity' } },
            { name: 'format', in: 'query', required: false, description: 'Response representation.', schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' } },
          ],
          responses: {
            200: {
              description: 'Finance instrument search completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': { description: 'Whether the versioned Worker cache served the response.', schema: { type: 'string', enum: ['HIT', 'MISS'] } },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Missing or invalid query parameter.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'The anonymous daily allowance or standard request limit was exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            500: { description: 'The finance-search result failed schema validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'Public finance search is temporarily unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'Public finance search timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/finance/movers': {
        get: {
          operationId: 'getMarketMovers',
          summary: 'Get daily equity gainers, losers, or most-active stocks',
          description: 'Returns one already-ranked daily equity list without fetching each quote separately. Successful responses are cached for five minutes.',
          parameters: [
            { name: 'list', in: 'query', required: false, description: 'Daily equity list.', schema: { type: 'string', enum: ['gainers', 'losers', 'active'], default: 'gainers' } },
            { name: 'limit', in: 'query', required: false, description: 'Maximum number of ranked equities.', schema: { type: 'integer', minimum: 1, maximum: 10, default: 10 } },
            { name: 'format', in: 'query', required: false, description: 'Response representation.', schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' } },
          ],
          responses: {
            200: {
              description: 'Market movers request completed.',
              headers: {
                'Cache-Control': { schema: { type: 'string' } },
                'X-Extractor-Cache': { description: 'Whether the versioned Worker cache served the response.', schema: { type: 'string', enum: ['HIT', 'MISS'] } },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ExtractionResponse' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            400: { description: 'Invalid list, limit, or format.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'The anonymous daily allowance or standard request limit was exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            500: { description: 'The market-movers result failed schema validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'Public market movers are temporarily unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'Public market movers timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ext_live_ API key',
          description: 'Optional account API key for external integrations using the account credit balance. New accounts receive a one-time 1,000-credit welcome bonus, and signed-in first-party website tools use the same balance automatically. Omit authentication to use the 10-operation anonymous daily allowance.',
        },
      },
      schemas: {
        ExtractionResponse: extractionJsonSchema(),
        ErrorResponse: errorSchema,
      },
    },
  };

  for (const path of Object.values(document.paths)) {
    const operation = (path as any).get;
    operation.security = [{}, { bearerAuth: [] }];
    operation.responses[401] = { description: 'The supplied API key is invalid or revoked.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } };
    operation.responses[402] = { description: 'The account has insufficient credits.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } };
    operation.responses[200].headers['X-Extractor-Free-Remaining'] = { description: 'Operations remaining in the anonymous daily allowance after a cache miss.', schema: { type: 'integer', minimum: 0 } };
    operation.responses[200].headers['X-Extractor-Credits-Used'] = { description: 'Credits committed by this response; absent on cache hits.', schema: { type: 'integer', enum: [0, 1] } };
    operation.responses[200].headers['X-Extractor-Credits-Remaining'] = { description: 'Exact prepaid balance after this operation.', schema: { type: 'integer' } };
  }

  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/vnd.oai.openapi+json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
