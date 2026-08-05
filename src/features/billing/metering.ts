import { accountForApiKey } from './d1';
import { finishAccountReservation, reserveAccountUsage } from './credits-client';
import { finishAnonymousReservation, reserveAnonymousQuota } from './quota-client';
import { ensureWelcomeCredits } from './welcome-credits';

export type MeterReservation =
  | { kind: 'paid'; userId: string; id: string; remaining: number }
  | { kind: 'anonymous'; key: string; id: string; remaining: number }
  | { kind: 'service'; key: string };

export interface MeterFinish {
  kind: MeterReservation['kind'];
  remaining: number;
  alertPercent?: 80 | 90 | 100;
  alertEpoch?: number;
}

export class MeteringError extends Error {
  constructor(
    public readonly code: 'invalid_api_key' | 'insufficient_credits' | 'daily_quota_exhausted' | 'billing_unavailable',
    message: string,
    public readonly status: 401 | 402 | 429 | 503,
  ) {
    super(message);
  }
}

function bearerToken(request: Request): string | null | 'invalid' {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? 'invalid';
}

async function reserveAccountMeter(
  userId: string,
  env: Pick<Env, 'DB' | 'ACCOUNT_CREDITS'>,
  welcomeCreditsPending = true,
): Promise<MeterReservation> {
  if (welcomeCreditsPending) await ensureWelcomeCredits(env.DB, env, userId);
  const reservation = await reserveAccountUsage(env, userId);
  if (!reservation.ok) {
    throw new MeteringError(
      'insufficient_credits',
      'The account has insufficient extraction credits.',
      402,
    );
  }
  return { kind: 'paid', userId, id: reservation.id, remaining: reservation.balance };
}

export async function reserveRequestMeter(
  request: Request,
  env: Pick<Env, 'DB' | 'ACCOUNT_CREDITS' | 'ANONYMOUS_QUOTA'>,
  quotaSecret: string | undefined,
  authenticatedUserId: string | null = null,
  authenticatedServiceKey: string | null = null,
): Promise<MeterReservation> {
  // The Worker authenticates this private lane before cache lookup. It keeps
  // the same endpoint limits while deliberately bypassing customer credits.
  if (authenticatedServiceKey) return { kind: 'service', key: authenticatedServiceKey };

  const token = bearerToken(request);
  if (token !== null) {
    if (token === 'invalid') throw new MeteringError('invalid_api_key', 'The API key is invalid.', 401);
    const apiKey = await accountForApiKey(env.DB, token);
    if (!apiKey) throw new MeteringError('invalid_api_key', 'The API key is invalid or revoked.', 401);
    return reserveAccountMeter(apiKey.userId, env, apiKey.welcomeCreditsPending);
  }

  if (authenticatedUserId) return reserveAccountMeter(authenticatedUserId, env);

  if (!quotaSecret) throw new MeteringError('billing_unavailable', 'Anonymous quota metering is not configured.', 503);
  const ip = request.headers.get('cf-connecting-ip') || 'local-development';
  const reservation = await reserveAnonymousQuota(env, ip, quotaSecret);
  if (!reservation.ok) throw new MeteringError('daily_quota_exhausted', 'The daily anonymous allowance is exhausted. Please create an account.', 429);
  return { kind: 'anonymous', key: reservation.key, id: reservation.id, remaining: reservation.remaining };
}

export async function finishRequestMeter(
  reservation: MeterReservation,
  env: Pick<Env, 'ACCOUNT_CREDITS' | 'ANONYMOUS_QUOTA'>,
  commit: boolean,
): Promise<MeterFinish> {
  if (reservation.kind === 'service') {
    return { kind: 'service', remaining: 0 };
  }
  if (reservation.kind === 'paid') {
    const result = await finishAccountReservation(env, reservation.userId, reservation.id, commit);
    return {
      kind: 'paid',
      remaining: result.balance,
      ...(result.alertPercent ? { alertPercent: result.alertPercent, alertEpoch: result.alertEpoch } : {}),
    };
  }
  const result = await finishAnonymousReservation(env, reservation.key, reservation.id, commit);
  return { kind: 'anonymous', remaining: result.remaining };
}

export function meteringErrorResponse(error: MeteringError): Response {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  if (error.status === 429) headers.set('Retry-After', '86400');
  return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
    status: error.status,
    headers,
  });
}
