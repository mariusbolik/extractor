import type { APIRoute } from 'astro';

export const prerender = false;

const origin = 'https://extractor.sh';
const links = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</llms-full.txt>; rel="service-doc"; type="text/markdown"',
  '</schemas/extraction-v1.json>; rel="describedby"; type="application/schema+json"',
  '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
].join(', ');

const catalog = {
  linkset: [
    {
      anchor: `${origin}/.well-known/api-catalog`,
      item: [
        {
          href: `${origin}/api/extract`,
          title: 'Public URL extraction API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/search`,
          title: 'Public web search API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/news`,
          title: 'Public news search API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/images`,
          title: 'Public image search API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/videos`,
          title: 'Public video search API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/places`,
          title: 'Public place search API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/finance`,
          title: 'Public finance API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/finance/search`,
          title: 'Public stock-symbol search API',
          type: 'application/json',
        },
        {
          href: `${origin}/api/finance/movers`,
          title: 'Public daily market movers API',
          type: 'application/json',
        },
        {
          href: `${origin}/mcp`,
          title: 'Hosted MCP search, extraction, and rich finance chart server',
          type: 'application/json',
        },
        {
          href: `${origin}/auth.md`,
          title: 'Optional Bearer API-key authentication, welcome credits, and prepaid credits',
          type: 'text/markdown',
        },
      ],
      'service-desc': [
        {
          href: `${origin}/openapi.json`,
          title: 'extractor.sh OpenAPI 3.1 specification',
          type: 'application/vnd.oai.openapi+json',
        },
      ],
      'service-doc': [
        {
          href: `${origin}/llms-full.txt`,
          title: 'extractor.sh agent documentation',
          type: 'text/markdown',
        },
      ],
      describedby: [
        {
          href: `${origin}/schemas/extraction-v1.json`,
          title: 'extractor.sh extraction response schema v1',
          type: 'application/schema+json',
        },
        {
          href: `${origin}/.well-known/mcp/server-card.json`,
          title: 'extractor.sh MCP Server Card',
          type: 'application/json',
        },
      ],
    },
  ],
};

function headers(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
    'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    Link: links,
    'X-Content-Type-Options': 'nosniff',
  });
}

export const GET: APIRoute = () => new Response(JSON.stringify(catalog), { headers: headers() });

export const HEAD: APIRoute = () => new Response(null, { headers: headers() });
