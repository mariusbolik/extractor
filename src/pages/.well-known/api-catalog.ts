import type { APIRoute } from 'astro';

export const prerender = false;

const origin = 'https://extractor.mcb-software.workers.dev';
const links = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</llms-full.txt>; rel="service-doc"; type="text/markdown"',
  '</schemas/extraction-v1.json>; rel="describedby"; type="application/schema+json"',
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
