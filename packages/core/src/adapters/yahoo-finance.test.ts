import { describe, expect, it, vi } from 'vitest';
import { toPublicExtractionResult } from '../types';
import { extractYahooFinanceQuote, financeInterval, getMarketData, normalizeFinanceQuoteCurrency, normalizeFinanceSymbol } from './yahoo-finance';

const chartFixture = {
  chart: {
    result: [{
      meta: {
        currency: 'USD',
        symbol: 'AAPL',
        exchangeName: 'NMS',
        fullExchangeName: 'NasdaqGS',
        instrumentType: 'EQUITY',
        regularMarketTime: 1_722_681_000,
        regularMarketPrice: 219.86,
        regularMarketDayHigh: 221.89,
        regularMarketDayLow: 219.23,
        regularMarketVolume: 48_215_000,
        fiftyTwoWeekHigh: 237.49,
        fiftyTwoWeekLow: 164.08,
        exchangeTimezoneName: 'America/New_York',
        longName: 'Apple Inc.',
      },
      timestamp: [1_722_470_400, 1_722_556_800, 1_722_643_200],
      indicators: {
        quote: [{
          open: [218.5, 219.2, 220.1],
          high: [221.1, 222.5, 221.89],
          low: [217.8, 218.9, 219.23],
          close: [218.36, 219.86, 219.85],
          volume: [62_500_000, 51_200_000, 48_215_000],
        }],
        adjclose: [{ adjclose: [218.1, 219.6, 219.85] }],
      },
    }],
    error: null,
  },
};

describe('extractYahooFinanceQuote', () => {
  it('returns a bounded market snapshot and recent daily history', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(chartFixture), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const fetcher = fetchMock as unknown as typeof fetch;

    const result = await extractYahooFinanceQuote(
      new URL('https://finance.yahoo.com/quote/AAPL/history/'),
      { fetcher },
    );
    const publicResult = toPublicExtractionResult(result);

    expect(result).toMatchObject({
      type: 'document',
      source: 'yahoo-finance',
      id: 'AAPL',
      url: 'https://finance.yahoo.com/quote/AAPL/',
      title: 'Apple Inc. (AAPL)',
      method: 'yahoo-finance-chart',
      attributes: {
        tickerSymbol: 'AAPL',
        exchange: 'NasdaqGS',
        currency: 'USD',
        instrumentType: 'EQUITY',
        marketPrice: 219.86,
        previousClose: 219.86,
        dayHigh: 221.89,
        dayLow: 219.23,
        volume: 48_215_000,
        timezone: 'America/New_York',
      },
    });
    expect(result.attributes.history).toHaveLength(3);
    expect(result.content).toContain('## Recent daily prices');
    expect(result.content).toContain('| Date | Open | High | Low | Close | Adjusted close | Volume |');
    expect(publicResult).toMatchObject({ schemaVersion: 1, source: 'yahoo-finance' });
    expect(publicResult).not.toHaveProperty('method');

    const [requestUrl, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.hostname).toBe('query1.finance.yahoo.com');
    expect(requestUrl.pathname).toBe('/v8/finance/chart/AAPL');
    expect(requestUrl.searchParams.get('interval')).toBe('1d');
    expect(requestUrl.searchParams.get('range')).toBe('1mo');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
  });

  it.each([
    ['1d', '5m'], ['5d', '15m'], ['1mo', '1d'], ['3mo', '1d'],
    ['6mo', '1d'], ['1y', '1d'], ['5y', '1wk'], ['max', '1mo'],
  ] as const)('maps timeframe %s to interval %s', (timeframe, interval) => {
    expect(financeInterval(timeframe)).toBe(interval);
  });

  it('canonicalizes symbols and rejects malformed or oversized values', () => {
    expect(normalizeFinanceSymbol(' btc-usd ')).toBe('BTC-USD');
    expect(normalizeFinanceSymbol('eurusd=x')).toBe('EURUSD=X');
    expect(() => normalizeFinanceSymbol('AAPL USD')).toThrow('Symbol must be');
    expect(() => normalizeFinanceSymbol('A'.repeat(33))).toThrow('Symbol must be');
  });

  it('canonicalizes optional quote currencies and rejects malformed values', () => {
    expect(normalizeFinanceQuoteCurrency(undefined)).toBeUndefined();
    expect(normalizeFinanceQuoteCurrency(' eur ')).toBe('EUR');
    expect(() => normalizeFinanceQuoteCurrency('EU')).toThrow('three-letter');
    expect(() => normalizeFinanceQuoteCurrency('EURO')).toThrow('three-letter');
  });

  it('converts snapshots and history into one requested quote currency', async () => {
    const fxFixture = {
      chart: { result: [{
        meta: { currency: 'EUR', symbol: 'USDEUR=X', regularMarketPrice: 0.9, regularMarketTime: 1_722_681_300 },
        timestamp: [1_722_470_400, 1_722_556_800, 1_722_643_200],
        indicators: { quote: [{ close: [0.8, 0.85, 0.9] }] },
      }], error: null },
    };
    const requestedPaths: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      return new Response(JSON.stringify(url.pathname.endsWith('/USDEUR%3DX') ? fxFixture : chartFixture), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const publicResult = toPublicExtractionResult(await getMarketData('AAPL', {
      fetcher,
      timeframe: '1d',
      quoteCurrency: 'eur',
      resultUrl: 'https://extractor.sh/api/finance?symbol=AAPL&timeframe=1d&quote=EUR&format=json',
    }));

    expect(requestedPaths).toEqual(['/v8/finance/chart/AAPL', '/v8/finance/chart/USDEUR%3DX']);
    expect(publicResult.url).toContain('quote=EUR');
    expect(publicResult.attributes).toMatchObject({
      currency: 'EUR',
      listingCurrency: 'USD',
      quoteCurrency: 'EUR',
      exchangeRate: 0.9,
      exchangeRateTimestamp: '2024-08-03T10:35:00.000Z',
      marketPrice: 197.874,
      dayHigh: 199.701,
      volume: 48_215_000,
    });
    expect(publicResult.attributes.history?.[0]).toMatchObject({ close: 174.688, volume: 62_500_000 });
    expect(publicResult.attributes.history?.[2]).toMatchObject({ close: 197.865, volume: 48_215_000 });
    expect(publicResult.content).toContain('Price: 197.874 EUR');
    expect(publicResult.content).toContain('Converted from USD at 0.9 EUR per USD');
  });

  it('does not fetch exchange rates when the requested quote matches the listing currency', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(chartFixture), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const result = await getMarketData('AAPL', { fetcher, quoteCurrency: 'USD' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.attributes).toMatchObject({
      currency: 'USD', listingCurrency: 'USD', quoteCurrency: 'USD', marketPrice: 219.86,
    });
    expect(result.attributes.exchangeRate).toBeUndefined();
  });

  it('returns provider-neutral configurable history, market state, and bounded events', async () => {
    const enriched = structuredClone(chartFixture);
    const result = enriched.chart.result[0] as typeof enriched.chart.result[0] & Record<string, unknown>;
    Object.assign(result.meta, { marketState: 'REGULAR' });
    Object.assign(result, {
      events: {
        dividends: { a: { date: 1_722_470_400, amount: 0.25 } },
        splits: { b: { date: 1_722_556_800, numerator: 4, denominator: 1, splitRatio: '4:1' } },
      },
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('range')).toBe('5y');
      expect(url.searchParams.get('interval')).toBe('1wk');
      return new Response(JSON.stringify(enriched), { headers: { 'Content-Type': 'application/json' } });
    });

    const publicResult = toPublicExtractionResult(await getMarketData('aapl', {
      fetcher,
      timeframe: '5y',
      resultUrl: 'https://extractor.sh/api/finance?symbol=AAPL&timeframe=5y&format=json',
    }));

    expect(publicResult).toMatchObject({
      source: 'finance',
      id: 'AAPL',
      attributes: {
        currency: 'USD',
        historyTimeframe: '5y',
        historyInterval: '1wk',
        marketState: 'REGULAR',
        events: [
          { type: 'dividend', amount: 0.25 },
          { type: 'split', numerator: 4, denominator: 1, splitRatio: '4:1' },
        ],
      },
    });
    expect(publicResult.content).toContain('## Price history (5y, 1wk)');
    expect(publicResult.content).toContain('## Market events');
  });

  it('preserves the exact listing currency unit without conversion', async () => {
    const payload = structuredClone(chartFixture);
    payload.chart.result[0].meta.currency = 'GBp';
    payload.chart.result[0].meta.symbol = 'LSE.L';
    const result = await getMarketData('LSE.L', {
      fetcher: async () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }),
    });
    expect(result.attributes.currency).toBe('GBp');
    expect(result.attributes.marketPrice).toBe(219.86);
  });

  it('caps history at 512 usable points', async () => {
    const timestamps = Array.from({ length: 520 }, (_, index) => 1_700_000_000 + index * 86_400);
    const values = timestamps.map((_, index) => index + 1);
    const payload = {
      chart: { result: [{
        meta: { currency: 'USD', symbol: 'CAP', regularMarketPrice: 520 },
        timestamp: timestamps,
        indicators: { quote: [{ open: values, high: values, low: values, close: values, volume: values }] },
      }], error: null },
    };
    const result = await getMarketData('CAP', {
      fetcher: async () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }),
      timeframe: 'max',
    });
    expect(result.attributes.history).toHaveLength(512);
    expect(result.attributes.history?.[0]?.close).toBe(9);
  });

  it('returns a precise not-found error instead of launching a browser', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } },
    }), { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    await expect(extractYahooFinanceQuote(
      new URL('https://finance.yahoo.com/quote/UNKNOWN123/'),
      { fetcher },
    )).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: expect.stringContaining('No data found'),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps provider-neutral finance errors free of retrieval details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      chart: { result: null, error: { code: 'Not Found', description: 'No data found' } },
    }), { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    await expect(getMarketData('UNKNOWN123', { fetcher })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Market data could not find that market symbol: No data found',
    });
  });
});
