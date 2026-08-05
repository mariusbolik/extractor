import {
  ExtractionError,
  getMarketMovers,
  toPublicExtractionResult,
  type FinanceMoversDependencies,
  type PublicExtractionResult,
} from '@extractor/core';

type FinanceMoversRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicMarketMovers {
  result: PublicExtractionResult;
  ttl: number;
}

/** Run one uncached market-list request through the standard request quota. */
export async function runPublicMarketMovers(
  clientKey: string,
  runtime: FinanceMoversRuntime,
  options: FinanceMoversDependencies = {},
): Promise<PublicMarketMovers> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }
  return { result: toPublicExtractionResult(await getMarketMovers(options)), ttl: 300 };
}
