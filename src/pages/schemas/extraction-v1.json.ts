import type { APIRoute } from 'astro';
import { extractionJsonSchema } from '@extractor/core';

export const prerender = true;

export const GET: APIRoute = () => new Response(JSON.stringify(extractionJsonSchema(), null, 2), {
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
    'Content-Type': 'application/schema+json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  },
});
