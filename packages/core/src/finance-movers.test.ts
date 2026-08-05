import { describe, expect, it, vi } from 'vitest';
import { getMarketMovers } from './finance-movers';
import { ExtractionResponseSchema } from './schema';
import { toPublicExtractionResult } from './types';

const fixture = {
  finance: {
    result: [{
      quotes: [
        {
          quoteType: 'EQUITY', symbol: 'UP', longName: 'Up Corporation', fullExchangeName: 'NasdaqGS', currency: 'USD',
          regularMarketTime: 1_786_000_000, regularMarketPrice: 125.5, regularMarketPreviousClose: 100,
          regularMarketChange: 25.5, regularMarketChangePercent: 25.5, regularMarketDayHigh: 130,
          regularMarketDayLow: 101, regularMarketVolume: 123_456, fiftyTwoWeekHigh: 140, fiftyTwoWeekLow: 70,
          marketState: 'REGULAR', exchangeTimezoneName: 'America/New_York',
        },
        { quoteType: 'CRYPTOCURRENCY', symbol: 'BTC-USD', longName: 'Bitcoin USD' },
      ],
    }],
    error: null,
  },
};

describe('market movers', () => {
  it.each([
    ['gainers', 'day_gainers'],
    ['losers', 'day_losers'],
    ['active', 'most_actives'],
  ] as const)('maps %s to one bounded public market list request', async (list, screenId) => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved');
      expect(url.searchParams.get('scrIds')).toBe(screenId);
      expect(url.searchParams.get('count')).toBe('1');
      expect(url.searchParams.get('start')).toBe('0');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
    });

    const result = toPublicExtractionResult(await getMarketMovers({ fetcher, list, limit: 1 }));
    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      source: 'finance',
      attributes: { feedType: 'market-movers', financeMoverList: list, resultCount: 1 },
    });
    expect(result.items?.[0]).toMatchObject({
      type: 'document', id: 'UP', title: 'Up Corporation',
      attributes: {
        tickerSymbol: 'UP', currency: 'USD', marketPrice: 125.5, previousClose: 100,
        change: 25.5, changePercent: 25.5, volume: 123_456, marketState: 'REGULAR',
      },
    });
    expect(result.items?.[0]?.attributes).not.toHaveProperty('provider');
    expect(result).not.toHaveProperty('method');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects invalid controls before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(getMarketMovers({ fetcher, limit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(getMarketMovers({ fetcher, list: 'trending' as 'gainers' })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed upstream data', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }));
    await expect(getMarketMovers({ fetcher })).rejects.toMatchObject({ status: 502 });
  });
});
