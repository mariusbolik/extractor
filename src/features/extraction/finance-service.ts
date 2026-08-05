import {
  ExtractionError,
  getMarketData,
  toPublicExtractionResult,
  type FinanceDependencies,
  type PublicExtractionResult,
} from '@extractor/core';

type FinanceRuntime = Pick<Env, 'EXTRACT_RATE_LIMITER'>;

export interface PublicMarketData {
  result: PublicExtractionResult;
  ttl: number;
}

/** Run one uncached market-data request through the standard request quota. */
export async function runPublicMarketData(
  symbol: string,
  clientKey: string,
  runtime: FinanceRuntime,
  options: FinanceDependencies = {},
): Promise<PublicMarketData> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }

  return {
    result: toPublicExtractionResult(await getMarketData(symbol, options)),
    ttl: 300,
  };
}
