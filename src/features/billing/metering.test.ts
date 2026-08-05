import { describe, expect, it, vi } from 'vitest';
import { generateApiKey } from './crypto';
import { finishRequestMeter, reserveRequestMeter } from './metering';

function accountEnvironment(responses: Array<Record<string, unknown>>) {
  const fetch = vi.fn(async () => Response.json(responses.shift() ?? {}));
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ id: 'key_test', hanko_user_id: 'user_test' })),
      })),
    })),
  } as unknown as D1Database;
  const accountCredits = {
    getByName: vi.fn(() => ({ fetch } as unknown as DurableObjectStub)),
  } as unknown as DurableObjectNamespace;
  return {
    env: {
      DB: db,
      ACCOUNT_CREDITS: accountCredits,
      ANONYMOUS_QUOTA: {} as DurableObjectNamespace,
    },
    db,
    fetch,
  };
}

describe('account request metering', () => {
  it('accepts an already-authenticated service reservation without touching credits', async () => {
    const env = {
      DB: {} as D1Database,
      ACCOUNT_CREDITS: {} as DurableObjectNamespace,
      ANONYMOUS_QUOTA: {} as DurableObjectNamespace,
    };
    const request = new Request('https://extractor.sh/api/search?q=test', {
      headers: { Authorization: 'Bearer service-secret' },
    });

    const reservation = await reserveRequestMeter(request, env, undefined, null, 'service:v1.subject');
    expect(reservation).toEqual({ kind: 'service', key: 'service:v1.subject' });
    expect(await finishRequestMeter(reservation, env, true)).toEqual({ kind: 'service', remaining: 0 });
  });

  it('reports usage against the unified account credit balance', async () => {
    const snapshot = {
      balance: 999,
      usage30Days: 1,
      cycle: null,
    };
    const { env, fetch } = accountEnvironment([
      { ok: true, meterKind: 'paid', ...snapshot },
      { ok: true, meterKind: 'paid', ...snapshot },
    ]);
    const request = new Request('https://extractor.sh/api/extract?url=https://example.com/', {
      headers: { Authorization: `Bearer ${generateApiKey()}` },
    });

    const reservation = await reserveRequestMeter(request, env, undefined);
    expect(reservation).toMatchObject({ kind: 'paid', userId: 'user_test', remaining: 999 });
    expect(await finishRequestMeter(reservation, env, true)).toEqual({ kind: 'paid', remaining: 999 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports the exact balance for purchased credits too', async () => {
    const snapshot = {
      balance: 24,
      usage30Days: 1_001,
      cycle: null,
    };
    const { env } = accountEnvironment([
      { ok: true, meterKind: 'paid', ...snapshot },
      { ok: true, meterKind: 'paid', ...snapshot },
    ]);
    const request = new Request('https://extractor.sh/api/extract?url=https://example.com/', {
      headers: { Authorization: `Bearer ${generateApiKey()}` },
    });

    const reservation = await reserveRequestMeter(request, env, undefined);
    expect(reservation).toMatchObject({ kind: 'paid', userId: 'user_test', remaining: 24 });
    expect(await finishRequestMeter(reservation, env, true)).toEqual({ kind: 'paid', remaining: 24 });
  });

  it('uses a valid Hanko session for first-party website tools without an API key', async () => {
    const snapshot = {
      balance: 999,
      usage30Days: 1,
      cycle: null,
    };
    const { env } = accountEnvironment([{ ok: true, meterKind: 'paid', ...snapshot }]);
    const request = new Request('https://extractor.sh/api/extract?url=https://example.com/', {
      headers: { Cookie: 'hanko=session_test' },
    });

    const reservation = await reserveRequestMeter(request, env, undefined, 'user_session');

    expect(reservation).toMatchObject({ kind: 'paid', userId: 'user_session', remaining: 999 });
  });

  it('does not let a Hanko session override an invalid Bearer key', async () => {
    const { env } = accountEnvironment([]);
    const request = new Request('https://extractor.sh/api/extract?url=https://example.com/', {
      headers: { Authorization: 'Bearer invalid', Cookie: 'hanko=session_test' },
    });

    await expect(reserveRequestMeter(request, env, undefined, 'user_session')).rejects.toMatchObject({
      code: 'invalid_api_key',
      status: 401,
    });
  });
});

describe('anonymous request metering', () => {
  it('prompts an exhausted anonymous caller to create an account', async () => {
    const quotaFetch = vi.fn(async () => Response.json({ ok: false, reason: 'daily_quota_exhausted', remaining: 0 }, { status: 429 }));
    const env = {
      DB: {} as D1Database,
      ACCOUNT_CREDITS: {} as DurableObjectNamespace,
      ANONYMOUS_QUOTA: {
        getByName: vi.fn(() => ({ fetch: quotaFetch } as unknown as DurableObjectStub)),
      } as unknown as DurableObjectNamespace,
    };

    await expect(reserveRequestMeter(
      new Request('https://extractor.sh/api/search?q=test', { headers: { 'cf-connecting-ip': '203.0.113.4' } }),
      env,
      'quota-secret',
      null,
    )).rejects.toMatchObject({
      code: 'daily_quota_exhausted',
      message: 'The daily anonymous allowance is exhausted. Please create an account.',
      status: 429,
    });
  });
});
