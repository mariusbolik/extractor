import type { APIRoute } from 'astro';

export const prerender = true;

const endpoint = 'https://extractor.mcb-software.workers.dev/mcp';
const card = {
  serverInfo: { name: 'extractor.sh', version: '1.0.0' },
  description: 'Extract public URLs as clean Markdown or normalized JSON.',
  transport: {
    type: 'streamable-http',
    endpoint,
    supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'],
  },
  authentication: { required: false },
  capabilities: { tools: true, resources: false, prompts: false },
  documentation: 'https://extractor.mcb-software.workers.dev/docs/mcp/',
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

export const GET: APIRoute = () => new Response(JSON.stringify(card), { headers });
export const HEAD: APIRoute = () => new Response(null, { headers });
