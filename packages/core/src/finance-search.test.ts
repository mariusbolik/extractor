import { describe, expect, it, vi } from 'vitest';
import { toPublicExtractionResult } from './types';
import { searchStocks } from './finance-search';

const fixture = {
  quotes: [
    {
      symbol: 'AAPL', quoteType: 'EQUITY', longname: 'Apple Inc.', exchDisp: 'NASDAQ',
      currency: 'USD', sector: 'Technology', industry: 'Consumer Electronics', regularMarketPrice: 219.86,
      regularMarketTime: 1_722_681_000,
    },
    { symbol: 'APC.DE', quoteType: 'EQUITY', shortname: 'Apple Inc.', exchDisp: 'XETRA', currency: 'EUR' },
    { symbol: '^AAPL', quoteType: 'INDEX', shortname: 'Not a stock' },
    { symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY', shortname: 'Bitcoin USD', currency: 'USD' },
    { symbol: 'AAPL', quoteType: 'EQUITY', shortname: 'Duplicate' },
    { symbol: 'bad symbol', quoteType: 'EQUITY', shortname: 'Malformed' },
  ],
};

describe('searchStocks', () => {
  it('returns a bounded provider-neutral schema-v1 equity feed', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain('/finance/search');
      expect(url.searchParams.get('q')).toBe('Apple');
      expect(url.searchParams.get('quotesCount')).toBe('8');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
    });

    const result = toPublicExtractionResult(await searchStocks('  Apple  ', {
      fetcher,
      limit: 2,
      resultUrl: 'https://extractor.sh/api/finance/search?q=Apple&limit=2&format=json',
    }));

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: 'finance',
      type: 'feed',
      attributes: { feedType: 'stock-search', query: 'Apple', resultCount: 2 },
      items: [
        { id: 'AAPL', attributes: { tickerSymbol: 'AAPL', currency: 'USD', sector: 'Technology' } },
        { id: 'APC.DE', attributes: { tickerSymbol: 'APC.DE', currency: 'EUR' } },
      ],
    });
    expect(result.content).toContain('Apple Inc. (AAPL)');
    expect(result).not.toHaveProperty('method');
    expect(JSON.stringify(result)).not.toContain('query1.finance');
  });

  it('returns an empty successful feed and rejects invalid controls', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ quotes: [] }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const empty = await searchStocks('No such company', { fetcher });
    expect(empty.items).toEqual([]);
    expect(empty.attributes.resultCount).toBe(0);
    await expect(searchStocks('', { fetcher })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchStocks('Apple', { fetcher, limit: 11 })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
  });

  it('can select crypto instruments without changing the equity default', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(fixture), {
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = toPublicExtractionResult(await searchStocks('Bitcoin', {
      fetcher,
      instrument: 'crypto',
    }));

    expect(result).toMatchObject({
      schemaVersion: 1,
      attributes: { feedType: 'crypto-search', resultCount: 1 },
      items: [{ id: 'BTC-USD', attributes: { instrumentType: 'CRYPTOCURRENCY' } }],
    });
  });

  it('rejects malformed upstream data without exposing retrieval details', async () => {
    await expect(searchStocks('Apple', {
      fetcher: async () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    })).rejects.toMatchObject({ code: 'upstream_error', status: 502, message: 'Finance search returned malformed data.' });
  });
});
