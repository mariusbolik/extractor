import { env } from 'cloudflare:workers';
import { McpServer, type McpRequestContext } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { apiCacheKey, runPublicExtraction, toExtractionError } from '../extraction';

const PRODUCTION_ORIGIN = 'https://extractor.mcb-software.workers.dev';

function apiRequestFor(requestInfo: Request | undefined, rawUrl: string, format: 'json' | 'markdown'): Request {
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  const url = new URL('/api/extract', origin);
  url.searchParams.set('url', rawUrl);
  url.searchParams.set('format', format);
  return new Request(url, { method: 'GET' });
}

function clientKeyFor(requestInfo: Request | undefined): string {
  return requestInfo?.headers.get('cf-connecting-ip') || 'mcp-local-development';
}

/**
 * Serve a fresh MCP server for every request. This stateless factory avoids
 * carrying client state between isolates and lets the public endpoint remain
 * horizontally scalable across Cloudflare's network.
 */
function createExtractorMcpServer(context: McpRequestContext): McpServer {
  const server = new McpServer({ name: 'extractor.sh', version: '1.0.0' });

  server.registerTool(
    'extract_public_url',
    {
      title: 'Extract a public URL',
      description: 'Extract one ordinary public HTTP or HTTPS page URL as clean Markdown or normalized extractor.sh JSON. Use Markdown for reading or summarizing and JSON for stable typed fields. The tool does not accept credentials or private URLs.',
      inputSchema: z.object({
        url: z.url().describe('An absolute public HTTP or HTTPS page URL a person could open in a browser.'),
        format: z.enum(['markdown', 'json']).default('markdown').describe('Markdown for readable text or JSON for the versioned entity schema.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, format }) => {
      try {
        const apiRequest = apiRequestFor(context.requestInfo, url, format);
        const cache = (caches as CacheStorage & { default: Cache }).default;
        const cacheKey = apiCacheKey(apiRequest);
        const cached = await cache.match(cacheKey);

        if (cached) {
          return { content: [{ type: 'text' as const, text: await cached.text() }] };
        }

        // Cache misses use the same limits as GET /api/extract. In particular,
        // browser rendering remains protected by its lower dedicated quota.
        const extraction = await runPublicExtraction(url, clientKeyFor(context.requestInfo), env);
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
        const normalized = toExtractionError(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `${normalized.code}: ${normalized.message}` }],
        };
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
