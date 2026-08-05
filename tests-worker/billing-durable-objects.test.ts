import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

async function post(stub: DurableObjectStub, path: string, body: object) {
  const response = await stub.fetch(`https://billing.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json<any>() };
}

describe('AccountCredits Durable Object', () => {
  it('atomically prevents concurrent reservations from overspending', async () => {
    const stub = env.ACCOUNT_CREDITS.getByName(`concurrent-${crypto.randomUUID()}`);
    await post(stub, '/grant', { id: 'grant:one', credits: 1 });
    const attempts = await Promise.all([
      post(stub, '/reserve', { id: 'reservation:a', paidOnly: true }),
      post(stub, '/reserve', { id: 'reservation:b', paidOnly: true }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 200 && attempt.body.ok)).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 402)).toHaveLength(1);
  });

  it('commits once, refunds once, and keeps operations idempotent', async () => {
    const stub = env.ACCOUNT_CREDITS.getByName(`idempotent-${crypto.randomUUID()}`);
    await post(stub, '/grant', { id: 'grant:two', credits: 2 });
    await post(stub, '/grant', { id: 'grant:two', credits: 2 });
    await post(stub, '/reserve', { id: 'reservation:commit', paidOnly: true });
    await post(stub, '/commit', { id: 'reservation:commit' });
    await post(stub, '/commit', { id: 'reservation:commit' });
    await post(stub, '/reserve', { id: 'reservation:refund', paidOnly: true });
    await post(stub, '/refund', { id: 'reservation:refund' });
    await post(stub, '/refund', { id: 'reservation:refund' });
    const snapshot = await (await stub.fetch('https://billing.test/snapshot')).json<any>();
    expect(snapshot.balance).toBe(1);
    expect(snapshot.usage30Days).toBe(1);
  });

  it('allows a full refund reversal to make a used balance negative and block misses', async () => {
    const stub = env.ACCOUNT_CREDITS.getByName(`negative-${crypto.randomUUID()}`);
    await post(stub, '/grant', { id: 'grant:purchase', credits: 2 });
    for (const id of ['reservation:1', 'reservation:2']) {
      await post(stub, '/reserve', { id, paidOnly: true });
      await post(stub, '/commit', { id });
    }
    await post(stub, '/reverse', { id: 'reversal:purchase', credits: 2 });
    const snapshot = await (await stub.fetch('https://billing.test/snapshot')).json<any>();
    expect(snapshot.balance).toBe(-2);
    expect((await post(stub, '/reserve', { id: 'reservation:blocked', paidOnly: true })).status).toBe(402);
  });

  it('emits each funded-balance usage alert exactly once', async () => {
    const stub = env.ACCOUNT_CREDITS.getByName(`alerts-${crypto.randomUUID()}`);
    await post(stub, '/grant', { id: 'grant:alerts', credits: 10 });
    const alerts: number[] = [];
    for (let index = 1; index <= 10; index += 1) {
      const id = `reservation:alert:${index}`;
      await post(stub, '/reserve', { id, paidOnly: true });
      const committed = await post(stub, '/commit', { id });
      if (committed.body.alertPercent) alerts.push(committed.body.alertPercent);
    }
    expect(alerts).toEqual([80, 90, 100]);

    const replay = await post(stub, '/commit', { id: 'reservation:alert:10' });
    expect(replay.body.alertPercent).toBeUndefined();
  });

  it('treats the one-time welcome grant as idempotent non-expiring account credits', async () => {
    const stub = env.ACCOUNT_CREDITS.getByName(`welcome-${crypto.randomUUID()}`);
    await post(stub, '/grant', { id: 'welcome:v1', credits: 1_000 });
    await post(stub, '/grant', { id: 'welcome:v1', credits: 1_000 });
    await post(stub, '/reserve', { id: 'reservation:welcome' });
    await post(stub, '/commit', { id: 'reservation:welcome' });
    const snapshot = await (await stub.fetch('https://billing.test/snapshot')).json<any>();
    expect(snapshot.balance).toBe(999);
    expect(snapshot.usage30Days).toBe(1);
    expect(snapshot).not.toHaveProperty('freeAllowance');
  });

  it('allows only one concurrent auto-top-up and enforces the monthly cap atomically', async () => {
    const stub = env.ACCOUNT_CREDITS.getByName(`auto-top-up-${crypto.randomUUID()}`);
    const input = { fundingPeriod: '2026-08', amountCents: 2_000, monthlyLimitCents: 4_000, triggerCredits: 0 };
    const attempts = await Promise.all([
      post(stub, '/auto-top-up/reserve', { ...input, id: 'auto:a' }),
      post(stub, '/auto-top-up/reserve', { ...input, id: 'auto:b' }),
    ]);
    expect(attempts.filter((attempt) => attempt.body.ok)).toHaveLength(1);
    const winner = attempts.find((attempt) => attempt.body.ok)!;
    const winnerId = winner === attempts[0] ? 'auto:a' : 'auto:b';
    await post(stub, '/auto-top-up/commit', { id: winnerId });
    const second = await post(stub, '/auto-top-up/reserve', { ...input, id: 'auto:c' });
    expect(second.body.ok).toBe(true);
    await post(stub, '/auto-top-up/commit', { id: 'auto:c' });
    const capped = await post(stub, '/auto-top-up/reserve', { ...input, id: 'auto:d' });
    expect(capped.body).toMatchObject({ ok: false, reason: 'monthly_limit', spentCents: 4_000 });
  });
});

describe('AnonymousQuota Durable Object', () => {
  it('never admits more than 10 concurrent daily reservations', async () => {
    const stub = env.ANONYMOUS_QUOTA.getByName(`quota-${crypto.randomUUID()}`);
    const attempts = await Promise.all(Array.from({ length: 25 }, (_, index) =>
      post(stub, '/reserve', { id: `reservation:${index}` })));
    expect(attempts.filter((attempt) => attempt.status === 200 && attempt.body.ok)).toHaveLength(10);
    expect(attempts.filter((attempt) => attempt.status === 429)).toHaveLength(15);
  });

  it('returns capacity when failed work is refunded', async () => {
    const stub = env.ANONYMOUS_QUOTA.getByName(`refund-${crypto.randomUUID()}`);
    await post(stub, '/reserve', { id: 'failed-work' });
    const refunded = await post(stub, '/refund', { id: 'failed-work' });
    expect(refunded.body.remaining).toBe(10);
  });
});
