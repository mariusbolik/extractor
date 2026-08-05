import { extractGoogleNews } from './adapters/google-news';
import { ExtractionError } from './errors';
import { escapeMarkdown } from './markdown';
import { normalizeChoice, normalizeCountryCode, normalizeLanguageTag } from './options';
import { normalizeSearchQuery } from './search';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult, NewsTimeframe } from './types';

const DEFAULT_NEWS_RESULTS = 10;
const MAX_NEWS_RESULTS = 50;
const NEWS_TIMEFRAMES = ['any', '1h', '1d', '7d', '30d'] as const;
const TIMEFRAME_MILLISECONDS: Record<Exclude<NewsTimeframe, 'any'>, number> = {
  '1h': 60 * 60 * 1_000,
  '1d': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
};

export interface NewsDependencies extends ExtractionDependencies {
  /** Public extractor.sh URL represented by the returned feed. */
  resultUrl?: string;
  /** Maximum number of current article entities to return. */
  limit?: number;
  language?: string;
  country?: string;
  timeframe?: NewsTimeframe;
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_NEWS_RESULTS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_NEWS_RESULTS) {
    throw new ExtractionError(
      'invalid_request',
      `Limit must be an integer from 1 to ${MAX_NEWS_RESULTS}.`,
      400,
    );
  }
  return value;
}

function publicResultUrl(value: string | undefined, query: string, limit: number): string {
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      // Fall through to the stable public endpoint below.
    }
  }
  const url = new URL('/api/news', 'https://extractor.sh');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

function newsMarkdown(query: string, items: ExtractedItem[]): string {
  const articles = items.map((item, index) => {
    const title = escapeMarkdown(item.title ?? 'News article');
    const publisher = item.author ? `\n\n   Publisher: ${escapeMarkdown(item.author)}` : '';
    const published = item.publishedAt ? `\n\n   Published: ${item.publishedAt}` : '';
    const summary = item.content ? `\n\n   ${item.content.replace(/\n/g, '\n   ')}` : '';
    return `${index + 1}. [${title}](${item.url})${publisher}${published}${summary}`;
  });
  return [`# News results for ${escapeMarkdown(query)}`, ...articles].join('\n\n');
}

/**
 * Search current public news through the existing Google News adapter.
 *
 * This wrapper turns a plain query into the ordinary public News search URL,
 * then reshapes the adapter output around extractor.sh's stable `/api/news`
 * request. The adapter retains its cost order: RSS first, ordinary HTML second,
 * and an optional host-provided browser only after both cheap requests fail.
 */
export async function searchNews(
  rawQuery: string,
  dependencies: NewsDependencies = {},
): Promise<ExtractionResult> {
  const query = normalizeSearchQuery(rawQuery);
  const limit = normalizedLimit(dependencies.limit);
  const language = normalizeLanguageTag(dependencies.language, 'en-US');
  const country = normalizeCountryCode(dependencies.country, 'US')!;
  const timeframe = normalizeChoice(dependencies.timeframe, NEWS_TIMEFRAMES, 'any', 'Timeframe');
  const sourceUrl = new URL('/search', 'https://news.google.com');
  sourceUrl.searchParams.set('q', query);
  sourceUrl.searchParams.set('hl', language);
  sourceUrl.searchParams.set('gl', country);
  sourceUrl.searchParams.set('ceid', `${country}:${language.split('-')[0]!.toLowerCase()}`);

  const extracted = await extractGoogleNews(sourceUrl, dependencies);
  const cutoff = timeframe === 'any' ? null : Date.now() - TIMEFRAME_MILLISECONDS[timeframe];
  const items = (extracted.items ?? [])
    .filter((item) => {
      if (cutoff === null) return true;
      if (!item.publishedAt) return false;
      const timestamp = Date.parse(item.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .slice(0, limit);
  const title = `News results for ${query}`;

  return {
    ...extracted,
    id: query,
    url: publicResultUrl(dependencies.resultUrl, query, limit),
    title,
    publishedAt: items[0]?.publishedAt ?? null,
    content: newsMarkdown(query, items),
    attributes: {
      ...extracted.attributes,
      feedType: 'news-search',
      query,
      language,
      country,
      timeframe,
      resultCount: items.length,
    },
    items,
  };
}
