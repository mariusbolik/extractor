import {
  ExtractionError,
  searchWeb,
  toPublicExtractionResult,
  type PublicExtractionResult,
  type SearchDependencies,
} from '@extractor/core';

type SearchRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicSearch {
  result: PublicExtractionResult;
  ttl: number;
}

/**
 * Execute one uncached search through the standard request quota.
 *
 * Cache lookup happens in the Worker before this function is called, so cache
 * hits consume no quota. Unlike extraction, search has no Browser binding or
 * browser-rate-limiter dependency by design; a backend failure must stay cheap
 * and return an error instead of escalating to Browser Run.
 */
export async function runPublicSearch(
  query: string,
  clientKey: string,
  runtime: SearchRuntime,
  options: SearchDependencies = {},
): Promise<PublicSearch> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }

  const result = await searchWeb(query, options);
  // Search ranking changes more frequently than ordinary documents. One hour
  // matches the existing feed TTL while still absorbing repeated agent queries.
  return { result: toPublicExtractionResult(result), ttl: 3_600 };
}
