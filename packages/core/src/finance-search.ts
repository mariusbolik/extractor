import { ExtractionError } from './errors';
import { fetchPublicPage } from './fetch';
import { escapeMarkdown } from './markdown';
import { normalizeFinanceSymbol } from './adapters/yahoo-finance';
import { normalizeSearchQuery } from './search';
import type { ExtractedItem, ExtractionResult, FinanceSearchDependencies } from './types';

type JsonObject = Record<string, unknown>;

const MAX_RESULTS = 10;
const SEARCH_CACHE: RequestInitCfProperties = {
  cacheEverything: true,
  cacheTtl: 3_600,
  cacheTtlByStatus: { '200-299': 3_600, '300-599': 0 },
};

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isoFromUnix(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return MAX_RESULTS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new ExtractionError('invalid_request', `Limit must be an integer from 1 to ${MAX_RESULTS}.`, 400);
  }
  return value;
}

function searchEndpoint(query: string, limit: number): URL {
  const endpoint = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('quotesCount', String(Math.min(40, limit * 4)));
  endpoint.searchParams.set('newsCount', '0');
  endpoint.searchParams.set('enableFuzzyQuery', 'false');
  return endpoint;
}

function publicResultUrl(query: string, limit: number, instrument: 'equity' | 'crypto', candidate?: string): string {
  if (candidate) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname === 'extractor.sh') return url.toString();
    } catch {
      // Fall through to the stable provider-neutral representation.
    }
  }
  const url = new URL('/api/finance/search', 'https://extractor.sh');
  url.searchParams.set('q', query);
  if (limit !== MAX_RESULTS) url.searchParams.set('limit', String(limit));
  if (instrument !== 'equity') url.searchParams.set('instrument', instrument);
  url.searchParams.set('format', 'json');
  return url.toString();
}

function financeItem(value: unknown, instrument: 'equity' | 'crypto'): ExtractedItem | null {
  const quote = objectValue(value);
  const quoteType = textValue(quote?.quoteType)?.toUpperCase();
  if (!quote || (instrument === 'equity' ? quoteType !== 'EQUITY' : quoteType !== 'CRYPTOCURRENCY')) return null;
  const rawSymbol = textValue(quote.symbol);
  if (!rawSymbol) return null;

  let symbol: string;
  try {
    symbol = normalizeFinanceSymbol(rawSymbol);
  } catch {
    return null;
  }

  const name = textValue(quote.longname) ?? textValue(quote.shortname) ?? symbol;
  const exchange = textValue(quote.exchDisp) ?? textValue(quote.fullExchangeName) ?? textValue(quote.exchange);
  const currency = textValue(quote.currency);
  const validCurrency = currency && /^[A-Za-z0-9._-]{1,12}$/.test(currency) ? currency : null;
  const sector = textValue(quote.sector);
  const industry = textValue(quote.industry);
  const marketPrice = numberValue(quote.regularMarketPrice);
  const publishedAt = isoFromUnix(quote.regularMarketTime);
  const url = new URL('/api/finance', 'https://extractor.sh');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('format', 'json');
  const lines = [
    `## ${escapeMarkdown(name)} (${escapeMarkdown(symbol)})`,
    exchange ? `Exchange: ${escapeMarkdown(exchange)}` : '',
    validCurrency ? `Listing currency: ${escapeMarkdown(validCurrency)}` : '',
    sector ? `Sector: ${escapeMarkdown(sector)}` : '',
    industry ? `Industry: ${escapeMarkdown(industry)}` : '',
  ].filter(Boolean);

  return {
    type: 'document',
    source: 'finance',
    id: symbol,
    url: url.toString(),
    title: name,
    author: null,
    publishedAt,
    content: lines.join('\n\n'),
    media: [],
    attributes: {
      tickerSymbol: symbol,
      instrumentType: quoteType,
      ...(exchange ? { exchange } : {}),
      ...(validCurrency ? { currency: validCurrency } : {}),
      ...(sector ? { sector } : {}),
      ...(industry ? { industry } : {}),
      ...(marketPrice !== null ? { marketPrice } : {}),
    },
  };
}

function markdown(query: string, items: ExtractedItem[], instrument: 'equity' | 'crypto'): string {
  return [
    `# ${instrument === 'crypto' ? 'Crypto' : 'Stock'} results for ${escapeMarkdown(query)}`,
    ...items.map((item, index) => {
      const symbol = item.attributes.tickerSymbol ?? item.id ?? 'Unknown';
      const details = [item.attributes.exchange, item.attributes.currency, item.attributes.industry].filter(Boolean).join(' · ');
      return `${index + 1}. [${escapeMarkdown(item.title ?? symbol)} (${escapeMarkdown(symbol)})](${item.url})${details ? ` — ${escapeMarkdown(details)}` : ''}`;
    }),
  ].join('\n\n');
}

/** Search public equity or crypto symbols without enriching each result. */
export async function searchStocks(
  rawQuery: string,
  dependencies: FinanceSearchDependencies = {},
): Promise<ExtractionResult> {
  const query = normalizeSearchQuery(rawQuery);
  const limit = normalizedLimit(dependencies.limit);
  const instrument = dependencies.instrument ?? 'equity';
  const page = await fetchPublicPage(
    searchEndpoint(query, limit),
    dependencies.fetcher,
    'application/json',
    { 'Accept-Language': 'en-US,en;q=0.9' },
    SEARCH_CACHE,
  );

  let payload: JsonObject;
  try {
    payload = objectValue(JSON.parse(page.body)) ?? {};
  } catch {
    throw new ExtractionError('upstream_error', 'Finance search returned malformed data.', 502);
  }
  if (!Array.isArray(payload.quotes)) {
    throw new ExtractionError('upstream_error', 'Finance search returned an unexpected response.', 502);
  }

  const seen = new Set<string>();
  const items = payload.quotes.flatMap((value) => {
    const item = financeItem(value, instrument);
    if (!item || !item.id || seen.has(item.id)) return [];
    seen.add(item.id);
    return [item];
  }).slice(0, limit);
  const resultUrl = publicResultUrl(query, limit, instrument, dependencies.resultUrl);

  return {
    type: 'feed',
    source: 'finance',
    id: `stock-search:${query.toLowerCase()}`,
    url: resultUrl,
    title: `${instrument === 'crypto' ? 'Crypto' : 'Stock'} results for ${query}`,
    author: null,
    publishedAt: null,
    content: markdown(query, items, instrument),
    media: [],
    attributes: {
      feedType: instrument === 'crypto' ? 'crypto-search' : 'stock-search',
      query,
      resultCount: items.length,
    },
    items,
    method: 'finance-search-json',
  };
}
