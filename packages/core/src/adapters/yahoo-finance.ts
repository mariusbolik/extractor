import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
import { normalizeChoice } from '../options';
import type {
  EntityAttributes,
  ExtractionDependencies,
  ExtractionResult,
  FinanceDependencies,
  FinanceInterval,
  FinanceTimeframe,
  MarketEvent,
  MarketHistoryPoint,
} from '../types';
import { yahooFinanceSymbol } from '../url';

type JsonObject = Record<string, unknown>;

const MARKET_CACHE: RequestInitCfProperties = {
  cacheEverything: true,
  cacheTtl: 300,
  cacheTtlByStatus: { '200-299': 300, '300-599': 0 },
};

export const FINANCE_TIMEFRAMES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max'] as const;
const HISTORY_POINT_LIMIT = 512;
const MARKET_EVENT_LIMIT = 128;

export function normalizeFinanceSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,32}$/.test(symbol)) {
    throw new ExtractionError(
      'invalid_request',
      'Symbol must be 1 to 32 characters using letters, numbers, period, caret, hyphen, or equals.',
      400,
    );
  }
  return symbol;
}

export function normalizeFinanceTimeframe(value: string | undefined): FinanceTimeframe {
  return normalizeChoice(value, FINANCE_TIMEFRAMES, '1mo', 'Timeframe');
}

export function normalizeFinanceQuoteCurrency(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ExtractionError('invalid_request', 'Quote currency must be a three-letter code such as EUR or USD.', 400);
  }
  return currency;
}

export function financeInterval(timeframe: FinanceTimeframe): FinanceInterval {
  if (timeframe === '1d') return '5m';
  if (timeframe === '5d') return '15m';
  if (timeframe === '5y') return '1wk';
  if (timeframe === 'max') return '1mo';
  return '1d';
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function rounded(value: number, digits = 8): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function marketValue(value: unknown): number | null {
  const number = numberValue(value);
  return number !== null && number >= 0 ? rounded(number) : null;
}

function integerValue(value: unknown): number | null {
  const number = numberValue(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

function isoFromUnix(value: unknown): string | null {
  const seconds = numberValue(value);
  if (seconds === null) return null;
  const timestamp = new Date(seconds * 1_000);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function assign<T extends EntityAttributes, K extends keyof T>(
  attributes: T,
  key: K,
  value: T[K] | null,
): void {
  if (value !== null) attributes[key] = value;
}

function historyFromChart(result: JsonObject): MarketHistoryPoint[] {
  const timestamps = arrayValue(result.timestamp);
  const indicators = objectValue(result.indicators);
  const quote = objectValue(arrayValue(indicators?.quote)[0]);
  const adjusted = objectValue(arrayValue(indicators?.adjclose)[0]);
  if (!quote) return [];

  const opens = arrayValue(quote.open);
  const highs = arrayValue(quote.high);
  const lows = arrayValue(quote.low);
  const closes = arrayValue(quote.close);
  const volumes = arrayValue(quote.volume);
  const adjustedCloses = arrayValue(adjusted?.adjclose);
  const history: MarketHistoryPoint[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = isoFromUnix(timestamps[index]);
    if (!timestamp) continue;

    const point: MarketHistoryPoint = { timestamp };
    const open = marketValue(opens[index]);
    const high = marketValue(highs[index]);
    const low = marketValue(lows[index]);
    const close = marketValue(closes[index]);
    const adjustedClose = marketValue(adjustedCloses[index]);
    const volume = integerValue(volumes[index]);
    if (open !== null) point.open = open;
    if (high !== null) point.high = high;
    if (low !== null) point.low = low;
    if (close !== null) point.close = close;
    if (adjustedClose !== null) point.adjustedClose = adjustedClose;
    if (volume !== null) point.volume = volume;

    // A market holiday can be represented by a timestamp with no quote data.
    // Leaving those empty rows out keeps JSON and Markdown equally useful.
    if (Object.keys(point).length > 1) history.push(point);
  }

  return history.slice(-HISTORY_POINT_LIMIT);
}

function marketEventsFromChart(result: JsonObject): MarketEvent[] {
  const events = objectValue(result.events);
  if (!events) return [];
  const output: MarketEvent[] = [];

  for (const raw of Object.values(objectValue(events.dividends) ?? {})) {
    const dividend = objectValue(raw);
    const timestamp = isoFromUnix(dividend?.date);
    const amount = marketValue(dividend?.amount);
    if (!timestamp) continue;
    output.push({
      type: 'dividend',
      timestamp,
      ...(amount !== null ? { amount } : {}),
    });
  }

  for (const raw of Object.values(objectValue(events.splits) ?? {})) {
    const split = objectValue(raw);
    const timestamp = isoFromUnix(split?.date);
    if (!timestamp) continue;
    const numerator = numberValue(split?.numerator);
    const denominator = numberValue(split?.denominator);
    const splitRatio = textValue(split?.splitRatio);
    output.push({
      type: 'split',
      timestamp,
      ...(numerator !== null && numerator > 0 ? { numerator: rounded(numerator) } : {}),
      ...(denominator !== null && denominator > 0 ? { denominator: rounded(denominator) } : {}),
      ...(splitRatio ? { splitRatio } : {}),
    });
  }

  return output
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-MARKET_EVENT_LIMIT);
}

function chartEndpoint(symbol: string, timeframe: FinanceTimeframe, interval: FinanceInterval): URL {
  const endpoint = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, 'https://query1.finance.yahoo.com');
  endpoint.searchParams.set('interval', interval);
  endpoint.searchParams.set('range', timeframe);
  endpoint.searchParams.set('events', 'div,splits');
  endpoint.searchParams.set('includeAdjustedClose', 'true');
  return endpoint;
}

async function fetchChartResult(
  symbol: string,
  timeframe: FinanceTimeframe,
  interval: FinanceInterval,
  fetcher: typeof fetch | undefined,
  publicSourceName: string,
): Promise<JsonObject> {
  const page = await fetchPublicPage(
    chartEndpoint(symbol, timeframe, interval),
    fetcher,
    'application/json',
    { 'Accept-Language': 'en-US,en;q=0.9' },
    MARKET_CACHE,
  );

  let payload: JsonObject;
  try {
    payload = objectValue(JSON.parse(page.body)) ?? {};
  } catch {
    throw new ExtractionError('upstream_error', `${publicSourceName} returned an invalid response.`, 502);
  }

  const chart = objectValue(payload.chart);
  const chartError = objectValue(chart?.error);
  const result = objectValue(arrayValue(chart?.result)[0]);
  if (!result) {
    const description = textValue(chartError?.description);
    throw new ExtractionError(
      'not_found',
      description ? `${publicSourceName} could not find that market symbol: ${description}` : `${publicSourceName} could not find that market symbol.`,
      404,
    );
  }
  return result;
}

interface ExchangeRateData {
  rate: number;
  timestamp: string | null;
  history: MarketHistoryPoint[];
}

function invertExchangeHistory(history: MarketHistoryPoint[]): MarketHistoryPoint[] {
  return history.flatMap((point) => {
    if (point.close === undefined || point.close <= 0) return [];
    return [{ timestamp: point.timestamp, close: rounded(1 / point.close) }];
  });
}

async function exchangeRateData(
  listingCurrency: string,
  quoteCurrency: string,
  timeframe: FinanceTimeframe,
  interval: FinanceInterval,
  fetcher: typeof fetch | undefined,
): Promise<ExchangeRateData> {
  const candidates = [
    { symbol: `${listingCurrency}${quoteCurrency}=X`, invert: false },
    { symbol: `${quoteCurrency}${listingCurrency}=X`, invert: true },
  ];

  for (const candidate of candidates) {
    try {
      const result = await fetchChartResult(candidate.symbol, timeframe, interval, fetcher, 'Currency conversion');
      const meta = objectValue(result.meta) ?? {};
      const history = historyFromChart(result);
      const recentRate = history.flatMap((point) => point.close === undefined ? [] : [point.close]).at(-1) ?? null;
      const rawRate = marketValue(meta.regularMarketPrice) ?? recentRate;
      if (rawRate === null || rawRate <= 0) continue;
      return {
        rate: candidate.invert ? rounded(1 / rawRate) : rawRate,
        timestamp: isoFromUnix(meta.regularMarketTime),
        history: candidate.invert ? invertExchangeHistory(history) : history,
      };
    } catch (error) {
      if (error instanceof ExtractionError && error.code === 'not_found') continue;
      throw error;
    }
  }

  throw new ExtractionError('upstream_error', 'The requested quote currency is currently unavailable.', 502);
}

function rateForTimestamp(history: MarketHistoryPoint[], timestamp: string, fallback: number): number {
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target)) return fallback;
  let latest: number | null = null;
  for (const point of history) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || point.close === undefined || point.close <= 0) continue;
    if (time > target) break;
    latest = point.close;
  }
  return latest ?? history.find((point) => point.close !== undefined && point.close > 0)?.close ?? fallback;
}

function convertedAmount(value: number | undefined, rate: number): number | undefined {
  return value === undefined ? undefined : rounded(value * rate);
}

function convertAttributes(
  attributes: EntityAttributes,
  listingCurrency: string,
  quoteCurrency: string,
  exchange: ExchangeRateData,
): void {
  const monetaryKeys = [
    'marketPrice', 'previousClose', 'change', 'dayHigh', 'dayLow',
    'fiftyTwoWeekHigh', 'fiftyTwoWeekLow',
  ] as const;
  for (const key of monetaryKeys) {
    const converted = convertedAmount(attributes[key], exchange.rate);
    if (converted !== undefined) attributes[key] = converted;
  }

  attributes.history = attributes.history?.map((point) => {
    const rate = rateForTimestamp(exchange.history, point.timestamp, exchange.rate);
    return {
      timestamp: point.timestamp,
      ...(convertedAmount(point.open, rate) === undefined ? {} : { open: convertedAmount(point.open, rate) }),
      ...(convertedAmount(point.high, rate) === undefined ? {} : { high: convertedAmount(point.high, rate) }),
      ...(convertedAmount(point.low, rate) === undefined ? {} : { low: convertedAmount(point.low, rate) }),
      ...(convertedAmount(point.close, rate) === undefined ? {} : { close: convertedAmount(point.close, rate) }),
      ...(convertedAmount(point.adjustedClose, rate) === undefined ? {} : { adjustedClose: convertedAmount(point.adjustedClose, rate) }),
      ...(point.volume === undefined ? {} : { volume: point.volume }),
    };
  });
  attributes.events = attributes.events?.map((event) => event.type === 'dividend' && event.amount !== undefined
    ? { ...event, amount: rounded(event.amount * rateForTimestamp(exchange.history, event.timestamp, exchange.rate)) }
    : event);
  attributes.listingCurrency = listingCurrency;
  attributes.quoteCurrency = quoteCurrency;
  attributes.exchangeRate = exchange.rate;
  if (exchange.timestamp) attributes.exchangeRateTimestamp = exchange.timestamp;
  attributes.currency = quoteCurrency;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);
}

function markdownContent(
  title: string,
  attributes: EntityAttributes,
  publishedAt: string | null,
): string {
  const currencySuffix = attributes.currency ? ` ${escapeMarkdown(attributes.currency)}` : '';
  const value = (number: number | undefined) => number === undefined ? '—' : compactNumber(number);
  const lines = [
    `# ${escapeMarkdown(title)}`,
    attributes.marketPrice === undefined ? '' : `Price: ${value(attributes.marketPrice)}${currencySuffix}`,
    attributes.listingCurrency && attributes.quoteCurrency && attributes.exchangeRate
      ? `Converted from ${escapeMarkdown(attributes.listingCurrency)} at ${value(attributes.exchangeRate)} ${escapeMarkdown(attributes.quoteCurrency)} per ${escapeMarkdown(attributes.listingCurrency)}${attributes.exchangeRateTimestamp ? ` (${attributes.exchangeRateTimestamp})` : ''}`
      : '',
    attributes.change === undefined || attributes.changePercent === undefined
      ? ''
      : `Change: ${attributes.change >= 0 ? '+' : ''}${value(attributes.change)} (${attributes.changePercent >= 0 ? '+' : ''}${value(attributes.changePercent)}%)`,
    attributes.exchange ? `Exchange: ${escapeMarkdown(attributes.exchange)}` : '',
    publishedAt ? `Market time: ${publishedAt}` : '',
    attributes.dayLow === undefined || attributes.dayHigh === undefined
      ? ''
      : `Day range: ${value(attributes.dayLow)}–${value(attributes.dayHigh)}${currencySuffix}`,
    attributes.fiftyTwoWeekLow === undefined || attributes.fiftyTwoWeekHigh === undefined
      ? ''
      : `52-week range: ${value(attributes.fiftyTwoWeekLow)}–${value(attributes.fiftyTwoWeekHigh)}${currencySuffix}`,
    attributes.volume === undefined ? '' : `Volume: ${compactNumber(attributes.volume)}`,
  ].filter(Boolean);

  const summary = lines.join('\n\n');
  if (attributes.history?.length) {
    const table = [
      '| Date | Open | High | Low | Close | Adjusted close | Volume |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...attributes.history.map((point) => [
        point.timestamp.slice(0, 10),
        value(point.open),
        value(point.high),
        value(point.low),
        value(point.close),
        value(point.adjustedClose),
        value(point.volume),
      ].join(' | ')).map((row) => `| ${row} |`),
    ].join('\n');
    const heading = attributes.historyTimeframe === '1mo' && attributes.historyInterval === '1d'
      ? 'Recent daily prices'
      : `Price history (${attributes.historyTimeframe ?? 'selected range'}, ${attributes.historyInterval ?? 'automatic interval'})`;
    const events = attributes.events?.length
      ? [
          '## Market events',
          ...attributes.events.map((event) => event.type === 'dividend'
            ? `- ${event.timestamp.slice(0, 10)} — Dividend${event.amount === undefined ? '' : `: ${value(event.amount)}${currencySuffix}`}`
            : `- ${event.timestamp.slice(0, 10)} — Split${event.splitRatio ? `: ${escapeMarkdown(event.splitRatio)}` : ''}`),
        ].join('\n')
      : '';
    return `${summary}\n\n## ${heading}\n\n${table}${events ? `\n\n${events}` : ''}`;
  }

  return summary;
}

/**
 * Convert an ordinary Yahoo Finance quote URL into a bounded market snapshot.
 * The fixed one-month, daily range supplies a useful recent trend while keeping
 * upstream work, response size, and edge-cache churn predictable. Recognized
 * URLs never use Browser Rendering: a market-data failure should be explicit,
 * not replaced with an expensive rendering attempt.
 */
async function extractMarketData(
  rawSymbol: string,
  dependencies: FinanceDependencies & { source?: 'finance' | 'yahoo-finance' } = {},
): Promise<ExtractionResult> {
  const symbol = normalizeFinanceSymbol(rawSymbol);
  const timeframe = normalizeFinanceTimeframe(dependencies.timeframe);
  const quoteCurrency = normalizeFinanceQuoteCurrency(dependencies.quoteCurrency);
  const interval = financeInterval(timeframe);
  const publicSourceName = dependencies.source === 'yahoo-finance' ? 'Yahoo Finance' : 'Market data';

  const result = await fetchChartResult(symbol, timeframe, interval, dependencies.fetcher, publicSourceName);

  const meta = objectValue(result.meta) ?? {};
  const history = historyFromChart(result);
  const events = marketEventsFromChart(result);
  const recentCloses = history.flatMap((point) => point.close === undefined ? [] : [point.close]);
  const marketPrice = marketValue(meta.regularMarketPrice) ?? recentCloses.at(-1) ?? null;
  const previousClose = recentCloses.length > 1
    ? recentCloses.at(-2)!
    : marketValue(meta.chartPreviousClose) ?? marketValue(meta.previousClose);
  const change = marketPrice !== null && previousClose !== null ? rounded(marketPrice - previousClose) : null;
  const changePercent = change !== null && previousClose !== null && previousClose !== 0
    ? rounded((change / previousClose) * 100, 6)
    : null;
  // Preserve the listing unit exactly as reported. Some exchanges quote in a
  // subunit such as GBp; uppercasing that to GBP would silently change the
  // meaning of every market value without performing a conversion.
  const currency = textValue(meta.currency);
  const validCurrency = currency && /^[A-Za-z0-9._-]{1,12}$/.test(currency) ? currency : null;
  const publishedAt = isoFromUnix(meta.regularMarketTime);
  const name = textValue(meta.longName) ?? textValue(meta.shortName) ?? symbol;
  const title = `${name} (${symbol})`;
  const defaultResultUrl = dependencies.source === 'yahoo-finance'
    ? new URL(`/quote/${encodeURIComponent(symbol)}/`, 'https://finance.yahoo.com').toString()
    : `https://extractor.sh/api/finance?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&format=json${quoteCurrency ? `&quote=${quoteCurrency}` : ''}`;
  let canonicalUrl = defaultResultUrl;
  if (dependencies.resultUrl) {
    try {
      const candidate = new URL(dependencies.resultUrl);
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') canonicalUrl = candidate.toString();
    } catch {
      // The stable default above remains the public representation.
    }
  }

  const attributes: EntityAttributes = {
    tickerSymbol: symbol,
    historyTimeframe: timeframe,
    historyInterval: interval,
    history,
    ...(events.length ? { events } : {}),
  };
  assign(attributes, 'exchange', textValue(meta.fullExchangeName) ?? textValue(meta.exchangeName));
  assign(attributes, 'currency', validCurrency);
  assign(attributes, 'instrumentType', textValue(meta.instrumentType));
  assign(attributes, 'marketPrice', marketPrice);
  assign(attributes, 'previousClose', previousClose);
  assign(attributes, 'change', change);
  assign(attributes, 'changePercent', changePercent);
  assign(attributes, 'dayHigh', marketValue(meta.regularMarketDayHigh));
  assign(attributes, 'dayLow', marketValue(meta.regularMarketDayLow));
  assign(attributes, 'fiftyTwoWeekHigh', marketValue(meta.fiftyTwoWeekHigh));
  assign(attributes, 'fiftyTwoWeekLow', marketValue(meta.fiftyTwoWeekLow));
  assign(attributes, 'volume', integerValue(meta.regularMarketVolume));
  assign(attributes, 'timezone', textValue(meta.exchangeTimezoneName) ?? textValue(meta.timezone));
  assign(attributes, 'marketState', textValue(meta.marketState));

  if (quoteCurrency) {
    if (!validCurrency || !/^[A-Z]{3}$/.test(validCurrency)) {
      throw new ExtractionError('upstream_error', 'Currency conversion is unavailable for this instrument’s listing unit.', 502);
    }
    attributes.listingCurrency = validCurrency;
    attributes.quoteCurrency = quoteCurrency;
    if (quoteCurrency !== validCurrency) {
      convertAttributes(
        attributes,
        validCurrency,
        quoteCurrency,
        await exchangeRateData(validCurrency, quoteCurrency, timeframe, interval, dependencies.fetcher),
      );
    }
  }

  return {
    type: 'document',
    source: dependencies.source ?? 'finance',
    id: symbol,
    url: canonicalUrl,
    title,
    author: null,
    publishedAt,
    content: markdownContent(title, attributes, publishedAt),
    media: [],
    attributes,
    method: 'yahoo-finance-chart',
  };
}

export async function getMarketData(
  rawSymbol: string,
  dependencies: FinanceDependencies = {},
): Promise<ExtractionResult> {
  return extractMarketData(rawSymbol, dependencies);
}

export async function extractYahooFinanceQuote(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const symbol = yahooFinanceSymbol(url);
  if (!symbol) {
    throw new ExtractionError('invalid_url', 'Use a public Yahoo Finance quote or price-history URL.', 400);
  }
  return extractMarketData(symbol, {
    fetcher: dependencies.fetcher,
    timeframe: '1mo',
    source: 'yahoo-finance',
  });
}
