import { ExtractionError } from './errors';
import { extractUrl } from './extract';
import { extractionTtl } from './cache';
import { toPublicExtractionResult, type PublicExtractionResult } from './types';

type ExtractionRuntime = Pick<Env, 'BROWSER' | 'BROWSER_RATE_LIMITER' | 'EXTRACT_RATE_LIMITER'>;

export interface PublicExtraction {
  result: PublicExtractionResult;
  ttl: number;
}

/**
 * Run one cache miss through the shared limits and extraction pipeline.
 * HTTP and MCP callers both use this function so neither can accidentally
 * bypass the expensive browser-rendering limit.
 */
export async function runPublicExtraction(
  rawUrl: string,
  clientKey: string,
  runtime: ExtractionRuntime,
): Promise<PublicExtraction> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Extraction rate limit exceeded.', 429, 60);
  }

  const extracted = await extractUrl(rawUrl, {
    browser: runtime.BROWSER,
    allowBrowser: async () => {
      const browserRate = await runtime.BROWSER_RATE_LIMITER.limit({ key: clientKey });
      return browserRate.success;
    },
  });

  return {
    result: toPublicExtractionResult(extracted),
    ttl: extractionTtl(extracted),
  };
}
