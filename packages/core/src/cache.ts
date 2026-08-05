import type { ExtractionResult } from './types';

const COLLECTION_TTL = 3_600;
const PRODUCT_TTL = 3_600;
const DOCUMENT_TTL = 2_592_000;
const MARKET_TTL = 300;

/** Frequently changing collections and products get shorter cache lives. */
export function extractionTtl(result: Pick<ExtractionResult, 'items' | 'source' | 'type'>): number {
  // Market snapshots change throughout a trading session. Five minutes keeps
  // them useful without turning every caller into a new upstream request.
  if (result.source === 'yahoo-finance') return MARKET_TTL;
  if (result.items !== undefined) return COLLECTION_TTL;
  if (result.type === 'product') return PRODUCT_TTL;
  return DOCUMENT_TTL;
}
