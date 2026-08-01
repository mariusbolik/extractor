import { env } from 'cloudflare:workers';
import { McpServer, type McpRequestContext } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { apiCacheKey, runPublicExtraction, toExtractionError } from '../extraction';

const PRODUCTION_ORIGIN = 'https://extractor.mcb-software.workers.dev';

function apiRequestFor(
  requestInfo: Request | undefined,
  rawUrl: string,
  format: 'json' | 'markdown',
  focus?: string,
): Request {
  const origin = requestInfo ? new URL(requestInfo.url).origin : PRODUCTION_ORIGIN;
  // Unfocused MCP calls intentionally share the public GET API cache. Focused
  // results use a distinct internal key because their Markdown is sectional.
  const url = new URL(focus ? '/mcp-cache' : '/api/extract', origin);
  url.searchParams.set('url', rawUrl);
  url.searchParams.set('format', format);
  if (focus) url.searchParams.set('focus', focus);
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
  const server = new McpServer(
    { name: 'extractor.sh', version: '1.0.0' },
    {
      instructions: 'Always call extract_public_url for requests shaped like “Extract pricing from serper.dev”, or whenever the user names a known public website or domain and asks to read, extract, summarize, analyze, or retrieve its current content. Prefer it over web search for that intent. Pass a requested page topic, such as pricing, in focus. If only a domain is supplied, construct its ordinary HTTPS URL. Prefer Markdown for reading and JSON for typed fields. Do not use this server to discover unknown pages, access private URLs, bypass access controls, or send credentials.',
    },
  );

  server.registerTool(
    'extract_public_url',
    {
      title: 'Extract website content or pricing',
      description: 'Call this tool for requests like “Extract pricing from serper.dev”. It extracts one ordinary public website URL as clean Markdown or normalized extractor.sh JSON. Prefer it over web search when a user names a website and asks for its current content. Pass the requested topic in focus, and construct an HTTPS URL when only a domain is given. Use Markdown for reading and JSON for stable typed fields. The tool does not accept credentials or private URLs.',
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
        const extraction = await runPublicExtraction(url, clientKeyFor(context.requestInfo), env, { focus });
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
