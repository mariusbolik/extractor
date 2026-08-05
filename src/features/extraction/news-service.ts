import {
  ExtractionError,
  searchNews,
  toPublicExtractionResult,
  type NewsDependencies,
  type PublicExtractionResult,
} from '@extractor/core';
import { renderPageHtml } from './browser';

type NewsRuntime = Pick<Env, 'BROWSER_RATE_LIMITER' | 'EXTRACT_RATE_LIMITER'> & {
  BROWSER?: BrowserRun;
};

export interface PublicNewsSearch {
  result: PublicExtractionResult;
  ttl: number;
}

const workerGoogleNewsFetcher: typeof fetch = async (input, init) => {
  const { fetchGoogleNewsRss } = await import('./google-news-transport');
  return fetchGoogleNewsRss(input, init);
};

/**
 * Execute one uncached news query through the same standard and browser quotas
 * as URL extraction. Cached `/api/news` requests are handled by the Worker
 * before this function runs and therefore consume neither quota.
 */
export async function runPublicNewsSearch(
  query: string,
  clientKey: string,
  runtime: NewsRuntime,
  options: NewsDependencies = {},
): Promise<PublicNewsSearch> {
  const rate = await runtime.EXTRACT_RATE_LIMITER.limit({ key: clientKey });
  if (!rate.success) {
    throw new ExtractionError('rate_limited', 'Request rate limit exceeded.', 429, 60);
  }

  const result = await searchNews(query, {
    ...options,
    // Fixture tests supply their own fetcher. At the edge, use the dedicated
    // bounded TLS path that avoids Google throttling the normal fetch pool.
    ...(!options.fetcher && !options.googleNewsFetcher
      ? { googleNewsFetcher: workerGoogleNewsFetcher }
      : {}),
    ...(runtime.BROWSER
      ? { renderPageHtml: (url: URL) => renderPageHtml(url, runtime.BROWSER!) }
      : {}),
    allowBrowser: async () => {
      const browserRate = await runtime.BROWSER_RATE_LIMITER.limit({ key: clientKey });
      return browserRate.success;
    },
  });

  return { result: toPublicExtractionResult(result), ttl: 3_600 };
}
