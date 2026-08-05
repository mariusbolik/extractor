import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from '@extractor/core';
import { runPublicMarketData } from './finance-service';

const chart = {
  chart: {
    result: [{
      meta: {
        currency: 'EUR',
        symbol: 'SAP.DE',
        longName: 'SAP SE',
        regularMarketPrice: 190.25,
        regularMarketTime: 1_722_681_000,
      },
      timestamp: [1_722_643_200],
      indicators: {
        quote: [{ open: [189], high: [191], low: [188], close: [190.25], volume: [1_000] }],
      },
    }],
    error: null,
  },
};

describe('runPublicMarketData', () => {
  it('charges the standard limiter and returns a five-minute schema document', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(chart), {
      headers: { 'Content-Type': 'application/json' },
    }));

    const market = await runPublicMarketData('SAP.DE', 'client-1', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, {
      fetcher,
      timeframe: '3mo',
      resultUrl: 'https://extractor.sh/api/finance?symbol=SAP.DE&timeframe=3mo',
    });

    expect(limit).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(market.ttl).toBe(300);
    expect(ExtractionResponseSchema.parse(market.result)).toEqual(market.result);
    expect(market.result).toMatchObject({
      schemaVersion: 1,
      source: 'finance',
      type: 'document',
      attributes: {
        currency: 'EUR',
        historyTimeframe: '3mo',
        historyInterval: '1d',
      },
    });
    expect(market.result).not.toHaveProperty('method');
  });

  it('stops before upstream work when the shared quota is exhausted', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runPublicMarketData('AAPL', 'client-2', {
      EXTRACT_RATE_LIMITER: {
        limit: vi.fn(async () => ({ success: false })),
      } as unknown as RateLimit,
    }, { fetcher })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
