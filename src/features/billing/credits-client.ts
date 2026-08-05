import { randomId } from './crypto';

export interface CreditSnapshot {
  balance: number;
  usage30Days: number;
  cycle: null | { key: string; grant: number; used: number; startedAt: number | null; endsAt: number | null };
}

async function call<T>(stub: DurableObjectStub, path: string, body?: unknown): Promise<T> {
  const response = await stub.fetch(`https://credits.internal${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json<T>();
  if (!response.ok && response.status >= 500) throw new Error(`Credit store failed with ${response.status}.`);
  return result;
}

function accountStub(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string): DurableObjectStub {
  return env.ACCOUNT_CREDITS.getByName(userId);
}

export async function getCreditSnapshot(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string): Promise<CreditSnapshot> {
  return call(accountStub(env, userId), '/snapshot');
}

export async function reserveAccountUsage(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string) {
  const id = randomId('res_');
  const result = await call<CreditSnapshot & {
    ok: boolean;
    reason?: string;
    meterKind?: 'paid';
  }>(accountStub(env, userId), '/reserve', { id });
  return { ...result, id };
}

export async function finishAccountReservation(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string, id: string, commit: boolean) {
  return call<CreditSnapshot & {
    ok: boolean;
    meterKind: 'paid';
    alertPercent?: 80 | 90 | 100;
    alertEpoch?: number;
  }>(
    accountStub(env, userId),
    commit ? '/commit' : '/refund',
    { id },
  );
}

export async function grantCredits(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string, input: {
  id: string; credits: number; cycleKey?: string; cycleStartedAt?: number; cycleEndsAt?: number;
}) {
  return call<CreditSnapshot & { ok: boolean }>(accountStub(env, userId), '/grant', input);
}

export async function reverseCredits(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string, id: string, credits: number) {
  return call<CreditSnapshot & { ok: boolean }>(accountStub(env, userId), '/reverse', { id, credits });
}

export async function reserveAutoTopUp(env: Pick<Env, 'ACCOUNT_CREDITS'>, userId: string, input: {
  id: string;
  fundingPeriod: string;
  amountCents: number;
  monthlyLimitCents: number;
  triggerCredits: number;
}) {
  return call<CreditSnapshot & {
    ok: boolean;
    reason?: 'charge_pending' | 'above_trigger' | 'monthly_limit';
    spentCents?: number;
    pendingAmountCents?: number;
  }>(accountStub(env, userId), '/auto-top-up/reserve', input);
}

export async function finishAutoTopUp(
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  userId: string,
  id: string,
  commit: boolean,
) {
  return call<CreditSnapshot & { ok: boolean; spentCents?: number }>(
    accountStub(env, userId),
    commit ? '/auto-top-up/commit' : '/auto-top-up/release',
    { id },
  );
}
