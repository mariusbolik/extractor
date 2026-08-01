import type { ExtractionResult } from './types';

export const API_CACHE_VERSION = '2026-08-schema-v1';

const COLLECTION_TTL = 3_600;
const PRODUCT_TTL = 3_600;
const DOCUMENT_TTL = 2_592_000;

/**
 * Keep Cache API keys independent from the browser-visible URL. Incrementing
 * the version makes a deployment stop reading responses written by an older
 * extraction contract without having to purge the whole Cloudflare cache.
 */
export function apiCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.set('__extractor_cache', API_CACHE_VERSION);
  return new Request(url.toString(), { method: 'GET' });
}

/** Frequently changing collections and products get shorter cache lives. */
export function extractionTtl(result: Pick<ExtractionResult, 'items' | 'type'>): number {
  if (result.items !== undefined) return COLLECTION_TTL;
  if (result.type === 'product') return PRODUCT_TTL;
  return DOCUMENT_TTL;
}
