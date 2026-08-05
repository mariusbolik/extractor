import {
  ExtractionError,
  searchVideos,
  toPublicExtractionResult,
  type PublicExtractionResult,
  type VideoSearchDependencies,
} from '@extractor/core';

type SearchRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicVideoSearch {
  result: PublicExtractionResult;
  ttl: number;
}

/** Run one uncached video search through the shared standard quota. */
export async function runPublicVideoSearch(
  query: string,
  clientKey: string,
  runtime: SearchRuntime,
  options: VideoSearchDependencies = {},
): Promise<PublicVideoSearch> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }

  return {
    result: toPublicExtractionResult(await searchVideos(query, options)),
    ttl: 3_600,
  };
}
