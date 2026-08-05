import {
  ExtractionError,
  extractUrl,
  extractionTtl,
  toPublicExtractionResult,
  type ExtractionDependencies,
  type PublicExtractionResult,
} from '@extractor/core';
import { renderPageHtml } from './browser';

type ExtractionRuntime = Pick<Env, 'BROWSER_RATE_LIMITER' | 'EXTRACT_RATE_LIMITER'> & {
  BROWSER?: BrowserRun;
};

export interface PublicExtraction {
  result: PublicExtractionResult;
  ttl: number;
}

const workerGoogleNewsFetcher: typeof fetch = async (input, init) => {
  const { fetchGoogleNewsRss } = await import('./google-news-transport');
  return fetchGoogleNewsRss(input, init);
};

/**
 * Run one cache miss through the shared limits and extraction pipeline.
 * HTTP and MCP callers both use this function so neither can accidentally
 * bypass the expensive browser-rendering limit.
 */
export async function runPublicExtraction(
  rawUrl: string,
  clientKey: string,
  runtime: ExtractionRuntime,
  options: Pick<ExtractionDependencies, 'fetcher' | 'focus' | 'googleNewsFetcher'> = {},
): Promise<PublicExtraction> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Extraction rate limit exceeded.', 429, 60);
  }

  const extracted = await extractUrl(rawUrl, {
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    googleNewsFetcher: options.googleNewsFetcher
      ?? options.fetcher
      ?? workerGoogleNewsFetcher,
    ...(runtime.BROWSER
      ? { renderPageHtml: (url: URL) => renderPageHtml(url, runtime.BROWSER!) }
      : {}),
    allowBrowser: async () => {
      const browserRate = await runtime.BROWSER_RATE_LIMITER.limit({ key: clientKey });
      return browserRate.success;
    },
    focus: options.focus,
  });

  return {
    result: toPublicExtractionResult(extracted),
    ttl: extractionTtl(extracted),
  };
}
