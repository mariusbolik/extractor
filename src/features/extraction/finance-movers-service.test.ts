import { describe, expect, it, vi } from 'vitest';
import { runPublicMarketMovers } from './finance-movers-service';

describe('public market movers service', () => {
  it('charges the standard limiter and returns a five-minute schema feed', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      finance: { result: [{ quotes: [] }], error: null },
    }), { headers: { 'Content-Type': 'application/json' } }));
    const result = await runPublicMarketMovers('client', {
      EXTRACT_RATE_LIMITER: { limit } as unknown as RateLimit,
    }, { fetcher });
    expect(limit).toHaveBeenCalledOnce();
    expect(result.ttl).toBe(300);
    expect(result.result).toMatchObject({ schemaVersion: 1, type: 'feed', attributes: { resultCount: 0 } });
  });
});
