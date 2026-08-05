import {
  ExtractionError,
  searchPlaces,
  toPublicExtractionResult,
  type PlaceSearchDependencies,
  type PublicExtractionResult,
} from '@extractor/core';

type SearchRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicPlaceSearch {
  result: PublicExtractionResult;
  ttl: number;
}

/** Run one submitted place lookup through the shared standard quota. */
export async function runPublicPlaceSearch(
  query: string,
  clientKey: string,
  runtime: SearchRuntime,
  options: PlaceSearchDependencies = {},
): Promise<PublicPlaceSearch> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }

  return {
    result: toPublicExtractionResult(await searchPlaces(query, options)),
    ttl: 3_600,
  };
}
