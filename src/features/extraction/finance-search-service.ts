import {
  ExtractionError,
  searchStocks,
  toPublicExtractionResult,
  type FinanceSearchDependencies,
  type PublicExtractionResult,
} from '@extractor/core';

type FinanceSearchRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicStockSearch {
  result: PublicExtractionResult;
  ttl: number;
}

/** Run one uncached stock-symbol search through the standard request quota. */
export async function runPublicStockSearch(
  query: string,
  clientKey: string,
  runtime: FinanceSearchRuntime,
  options: FinanceSearchDependencies = {},
): Promise<PublicStockSearch> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }
  return { result: toPublicExtractionResult(await searchStocks(query, options)), ttl: 3_600 };
}
