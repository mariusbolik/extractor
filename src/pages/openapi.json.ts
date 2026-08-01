import type { APIRoute } from 'astro';
import { extractionJsonSchema } from '../features/extraction/schema';

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
      version: '1.0.0',
      description: 'Extract supported public webpage, commerce, news, social, audio, podcast, and video URLs into clean Markdown or normalized JSON.',
      license: { name: 'Proprietary' },
    },
    servers: [{ url: 'https://extractor.mcb-software.workers.dev' }],
    externalDocs: {
      description: 'Agent-readable documentation',
      url: 'https://extractor.mcb-software.workers.dev/llms-full.txt',
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
              description: 'Rate limit exceeded.',
              headers: { 'Retry-After': { schema: { type: 'integer' } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            500: { description: 'The extracted result failed internal response validation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            502: { description: 'The upstream source failed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            504: { description: 'The upstream source timed out.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
    },
    components: {
      schemas: {
        ExtractionResponse: extractionJsonSchema(),
        ErrorResponse: errorSchema,
      },
    },
  };

  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/vnd.oai.openapi+json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
