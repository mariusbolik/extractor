import {
  ExtractionError,
  searchImages,
  toPublicExtractionResult,
  type ImageSearchDependencies,
  type PublicExtractionResult,
} from '@extractor/core';

type SearchRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicImageSearch {
  result: PublicExtractionResult;
  ttl: number;
}

/** Run one uncached image search through the shared standard quota. */
export async function runPublicImageSearch(
  query: string,
  clientKey: string,
  runtime: SearchRuntime,
  options: ImageSearchDependencies = {},
): Promise<PublicImageSearch> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }

  return {
    result: toPublicExtractionResult(await searchImages(query, options)),
    ttl: 3_600,
  };
}
