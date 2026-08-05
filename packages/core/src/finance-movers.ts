import { ExtractionError } from './errors';
import { fetchPublicPage } from './fetch';
import { escapeMarkdown } from './markdown';
import { normalizeChoice } from './options';
import { normalizeFinanceSymbol } from './adapters/yahoo-finance';
import type { ExtractedItem, ExtractionResult, FinanceMoverList, FinanceMoversDependencies } from './types';

type JsonObject = Record<string, unknown>;

const MAX_RESULTS = 10;
const MOVER_LISTS = ['gainers', 'losers', 'active'] as const;
const SCREEN_IDS: Record<FinanceMoverList, string> = {
  gainers: 'day_gainers',
  losers: 'day_losers',
  active: 'most_actives',
};
const LIST_TITLES: Record<FinanceMoverList, string> = {
  gainers: 'Daily stock gainers',
  losers: 'Daily stock losers',
  active: 'Most active stocks',
};
const MOVERS_CACHE: RequestInitCfProperties = {
  cacheEverything: true,
  cacheTtl: 300,
  cacheTtlByStatus: { '200-299': 300, '300-599': 0 },
};

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
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

function endpointFor(list: FinanceMoverList, limit: number): URL {
  const endpoint = new URL('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved');
  endpoint.searchParams.set('scrIds', SCREEN_IDS[list]);
  endpoint.searchParams.set('count', String(limit));
  endpoint.searchParams.set('start', '0');
  endpoint.searchParams.set('lang', 'en-US');
  endpoint.searchParams.set('region', 'US');
  return endpoint;
}

function publicResultUrl(list: FinanceMoverList, limit: number, candidate?: string): string {
  if (candidate) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname === 'extractor.sh') return url.toString();
    } catch {
      // Fall through to the stable provider-neutral URL.
    }
  }
  const url = new URL('/api/finance/movers', 'https://extractor.sh');
  if (list !== 'gainers') url.searchParams.set('list', list);
  if (limit !== MAX_RESULTS) url.searchParams.set('limit', String(limit));
  url.searchParams.set('format', 'json');
  return url.toString();
}

function moverItem(value: unknown): ExtractedItem | null {
  const quote = objectValue(value);
  if (!quote || textValue(quote.quoteType)?.toUpperCase() !== 'EQUITY') return null;
  const rawSymbol = textValue(quote.symbol);
  if (!rawSymbol) return null;
  let symbol: string;
  try {
    symbol = normalizeFinanceSymbol(rawSymbol);
  } catch {
    return null;
  }

  const name = textValue(quote.longName) ?? textValue(quote.shortName) ?? textValue(quote.displayName) ?? symbol;
  const exchange = textValue(quote.fullExchangeName) ?? textValue(quote.exchange);
  const currencyValue = textValue(quote.currency);
  const currency = currencyValue && /^[A-Za-z0-9._-]{1,12}$/.test(currencyValue) ? currencyValue : null;
  const marketPrice = finiteNumber(quote.regularMarketPrice);
  const previousClose = finiteNumber(quote.regularMarketPreviousClose);
  const change = finiteNumber(quote.regularMarketChange);
  const changePercent = finiteNumber(quote.regularMarketChangePercent);
  const dayHigh = finiteNumber(quote.regularMarketDayHigh);
  const dayLow = finiteNumber(quote.regularMarketDayLow);
  const fiftyTwoWeekHigh = finiteNumber(quote.fiftyTwoWeekHigh);
  const fiftyTwoWeekLow = finiteNumber(quote.fiftyTwoWeekLow);
  const volume = nonNegativeInteger(quote.regularMarketVolume);
  const marketState = textValue(quote.marketState);
  const timezone = textValue(quote.exchangeTimezoneName);
  const publishedAt = isoFromUnix(quote.regularMarketTime);
  const url = new URL('/api/finance', 'https://extractor.sh');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('format', 'json');
  const price = marketPrice === null ? '' : `${marketPrice}${currency ? ` ${currency}` : ''}`;
  const movement = changePercent === null ? '' : `${changePercent >= 0 ? '+' : ''}${changePercent}%`;

  return {
    type: 'document',
    source: 'finance',
    id: symbol,
    url: url.toString(),
    title: name,
    author: null,
    publishedAt,
    content: [
      `## ${escapeMarkdown(name)} (${escapeMarkdown(symbol)})`,
      price ? `Price: ${escapeMarkdown(price)}` : '',
      movement ? `Daily change: ${escapeMarkdown(movement)}` : '',
      exchange ? `Exchange: ${escapeMarkdown(exchange)}` : '',
      volume === null ? '' : `Volume: ${volume.toLocaleString('en-US')}`,
    ].filter(Boolean).join('\n\n'),
    media: [],
    attributes: {
      tickerSymbol: symbol,
      instrumentType: 'EQUITY',
      ...(exchange ? { exchange } : {}),
      ...(currency ? { currency } : {}),
      ...(marketPrice !== null ? { marketPrice } : {}),
      ...(previousClose !== null ? { previousClose } : {}),
      ...(change !== null ? { change } : {}),
      ...(changePercent !== null ? { changePercent } : {}),
      ...(dayHigh !== null ? { dayHigh } : {}),
      ...(dayLow !== null ? { dayLow } : {}),
      ...(fiftyTwoWeekHigh !== null ? { fiftyTwoWeekHigh } : {}),
      ...(fiftyTwoWeekLow !== null ? { fiftyTwoWeekLow } : {}),
      ...(volume !== null ? { volume } : {}),
      ...(marketState ? { marketState } : {}),
      ...(timezone ? { timezone } : {}),
    },
  };
}

function markdown(list: FinanceMoverList, items: ExtractedItem[]): string {
  return [
    `# ${LIST_TITLES[list]}`,
    ...items.map((item, index) => {
      const symbol = item.attributes.tickerSymbol ?? item.id ?? 'Unknown';
      const price = item.attributes.marketPrice;
      const currency = item.attributes.currency;
      const change = item.attributes.changePercent;
      const details = [
        price === undefined ? null : `${price}${currency ? ` ${currency}` : ''}`,
        change === undefined ? null : `${change >= 0 ? '+' : ''}${change}%`,
        item.attributes.volume === undefined ? null : `${item.attributes.volume.toLocaleString('en-US')} volume`,
      ].filter(Boolean).join(' · ');
      return `${index + 1}. [${escapeMarkdown(item.title ?? symbol)} (${escapeMarkdown(symbol)})](${item.url})${details ? ` — ${escapeMarkdown(details)}` : ''}`;
    }),
  ].join('\n\n');
}

/** Return one bounded, already-ranked daily equity list without per-symbol enrichment. */
export async function getMarketMovers(dependencies: FinanceMoversDependencies = {}): Promise<ExtractionResult> {
  const limit = normalizedLimit(dependencies.limit);
  const list = normalizeChoice(dependencies.list, MOVER_LISTS, 'gainers', 'List');
  const page = await fetchPublicPage(
    endpointFor(list, limit),
    dependencies.fetcher,
    'application/json',
    { 'Accept-Language': 'en-US,en;q=0.9' },
    MOVERS_CACHE,
  );

  let payload: JsonObject;
  try {
    payload = objectValue(JSON.parse(page.body)) ?? {};
  } catch {
    throw new ExtractionError('upstream_error', 'Market movers returned malformed data.', 502);
  }
  const finance = objectValue(payload.finance);
  const result = Array.isArray(finance?.result) ? objectValue(finance.result[0]) : null;
  if (!result || !Array.isArray(result.quotes)) {
    throw new ExtractionError('upstream_error', 'Market movers returned an unexpected response.', 502);
  }

  const seen = new Set<string>();
  const items = result.quotes.flatMap((value) => {
    const item = moverItem(value);
    if (!item?.id || seen.has(item.id)) return [];
    seen.add(item.id);
    return [item];
  }).slice(0, limit);
  const resultUrl = publicResultUrl(list, limit, dependencies.resultUrl);

  return {
    type: 'feed',
    source: 'finance',
    id: `market-movers:${list}`,
    url: resultUrl,
    title: LIST_TITLES[list],
    author: null,
    publishedAt: items.find((item) => item.publishedAt)?.publishedAt ?? null,
    content: markdown(list, items),
    media: [],
    attributes: { feedType: 'market-movers', financeMoverList: list, resultCount: items.length },
    items,
    method: 'finance-movers-json',
  };
}
