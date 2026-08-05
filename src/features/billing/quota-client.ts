import { ANONYMOUS_DAILY_LIMIT } from './constants';
import { hmacSha256, randomId } from './crypto';

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function anonymousQuotaKey(ip: string, secret: string, now = new Date()): Promise<string> {
  return hmacSha256(secret, `${utcDate(now)}\n${ip}`);
}

async function call(stub: DurableObjectStub, path: string, id: string) {
  const response = await stub.fetch(`https://quota.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return response.json<{ ok: boolean; reason?: string; remaining: number }>();
}

export async function reserveAnonymousQuota(env: Pick<Env, 'ANONYMOUS_QUOTA'>, ip: string, secret: string) {
  const key = await anonymousQuotaKey(ip, secret);
  const id = randomId('anon_');
  const result = await call(env.ANONYMOUS_QUOTA.getByName(key), '/reserve', id);
  return { ...result, id, key };
}

export async function finishAnonymousReservation(env: Pick<Env, 'ANONYMOUS_QUOTA'>, key: string, id: string, commit: boolean) {
  return call(env.ANONYMOUS_QUOTA.getByName(key), commit ? '/commit' : '/refund', id);
}

export { ANONYMOUS_DAILY_LIMIT };
