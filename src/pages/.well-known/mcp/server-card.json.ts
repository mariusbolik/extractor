import type { APIRoute } from 'astro';

export const prerender = true;

const endpoint = 'https://extractor.sh/mcp';
const card = {
  serverInfo: { name: 'extractor.sh', version: '1.9.0' },
  description: 'Search webpages, current news, public images, public videos, places, stocks, and market movers or extract supported public URLs—including exact LinkedIn profiles—as clean Markdown or normalized JSON. Finance results support requested quote currencies and include an MCP Apps price chart for compatible chats.',
  transport: {
    type: 'streamable-http',
    endpoint,
    supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'],
  },
  authentication: {
    required: false,
    schemes: [{ type: 'http', scheme: 'bearer', description: 'Optional ext_live_ API key using the account balance; new accounts receive 1,000 welcome credits once.' }],
  },
  capabilities: { tools: true, resources: true, prompts: false },
  resources: [{
    uri: 'ui://extractor.sh/finance/price-chart-v1.html',
    name: 'Market price chart',
    mimeType: 'text/html;profile=mcp-app',
  }],
  tools: [
    {
      name: 'extract_public_url',
      description: 'Extract a public URL as Markdown or normalized JSON, optionally focused on a requested topic.',
      inputs: ['url', 'format', 'focus'],
    },
    {
      name: 'search_web',
      description: 'Find relevant public webpages and return ordered titles, URLs, and snippets.',
      inputs: ['query', 'format', 'limit', 'language', 'country', 'site'],
    },
    {
      name: 'search_images',
      description: 'Find openly licensed public images with source and license metadata.',
      inputs: ['query', 'format', 'limit', 'usage', 'orientation'],
    },
    {
      name: 'search_videos',
      description: 'Find relevant or newest public videos with creator, duration, date, description, and thumbnail metadata when available.',
      inputs: ['query', 'format', 'limit', 'language', 'country', 'platform', 'sort', 'creator'],
    },
    {
      name: 'search_places',
      description: 'Resolve named public places and addresses into coordinates and normalized address fields.',
      inputs: ['query', 'format', 'limit', 'language', 'country', 'lat', 'lon', 'type'],
    },
    {
      name: 'search_news',
      description: 'Find current public news with locale and recent-timeframe controls.',
      inputs: ['query', 'format', 'limit', 'language', 'country', 'timeframe'],
    },
    {
      name: 'search_stocks',
      description: 'Resolve company names and partial tickers into ordered public equity listings.',
      inputs: ['query', 'instrument', 'format', 'limit'],
    },
    {
      name: 'get_market_movers',
      description: 'Return daily equity gainers, losers, or most-active stocks as an already-ranked typed feed.',
      inputs: ['list', 'format', 'limit'],
    },
    {
      name: 'get_market_data',
      description: 'Retrieve a typed market snapshot and bounded history in the native or requested quote currency, with an inline chart in MCP Apps-capable chats.',
      inputs: ['symbol', 'format', 'timeframe', 'quote'],
    },
  ],
  documentation: 'https://extractor.sh/docs/mcp/',
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

export const GET: APIRoute = () => new Response(JSON.stringify(card), { headers });
export const HEAD: APIRoute = () => new Response(null, { headers });
