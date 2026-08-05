import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { BILLING_ENABLED, DODOPAYMENTS_ENVIRONMENT, getSecret } from 'astro:env/server';
import { autoTopUpPeriod } from '../../../features/billing/auto-top-up';
import { isValidAutoTopUp } from '../../../features/billing/constants';
import { createDodoAutoTopUpAuthorization, dodoClient, dodoEnvironment } from '../../../features/billing/dodo';
import { ensureAccount, getAutoTopUp } from '../../../features/billing/d1';
import { requireSameOrigin, validateHankoSession } from '../../../features/billing/hanko';

export const prerender = false;

function privateJson(value: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', 'private, no-store');
  return Response.json(value, { ...init, headers });
}

async function authenticated(request: Request) {
  return validateHankoSession(request);
}

export const GET: APIRoute = async ({ request }) => {
  const session = await authenticated(request);
  if (!session) return privateJson({ error: 'Authentication required.' }, { status: 401 });
  const [setting, account, spent] = await Promise.all([
    getAutoTopUp(env.DB, session.userId),
    ensureAccount(env.DB, session.userId),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM auto_topup_attempts
      WHERE hanko_user_id = ? AND period = ? AND status = 'paid'`)
      .bind(session.userId, autoTopUpPeriod()).first<{ cents: number }>(),
  ]);
  return privateJson({
    enabled: setting?.enabled === 1,
    status: setting?.status ?? 'disabled',
    triggerCredits: setting?.trigger_credits ?? null,
    amountCents: setting?.amount_cents ?? null,
    monthlyLimitCents: setting?.monthly_limit_cents ?? null,
    monthlySpentCents: spent?.cents ?? 0,
    nextRetryAt: setting?.next_retry_at ?? null,
    mandateStatus: account.dodo_subscription_status,
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!requireSameOrigin(request)) return privateJson({ error: 'Invalid origin.' }, { status: 403 });
  const session = await authenticated(request);
  if (!session) return privateJson({ error: 'Authentication required.' }, { status: 401 });
  const apiKey = getSecret('DODOPAYMENTS_API_KEY');
  const webhookKey = getSecret('DODOPAYMENTS_WEBHOOK_KEY');
  const productId = getSecret('DODOPAYMENTS_ON_DEMAND_PRODUCT_ID');
  if (!BILLING_ENABLED || !apiKey || !webhookKey || !productId || !env.DB || !env.ACCOUNT_CREDITS) {
    return privateJson({ error: 'Billing is not ready.' }, { status: 503 });
  }
  const body = await request.json<{
    triggerCredits?: unknown;
    amountCents?: unknown;
    monthlyLimitCents?: unknown;
  }>();
  if (!isValidAutoTopUp(body)) {
    return privateJson({ error: 'Invalid automatic funding limits.' }, { status: 400 });
  }
  const account = await ensureAccount(env.DB, session.userId);
  const now = Date.now();
  const alreadyAuthorized = Boolean(account.dodo_subscription_id
    && ['active', 'on_hold'].includes(account.dodo_subscription_status ?? ''));
  await env.DB.prepare(`INSERT INTO auto_topup_settings
    (hanko_user_id, enabled, trigger_credits, amount_cents, monthly_limit_cents, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hanko_user_id) DO UPDATE SET enabled = excluded.enabled,
    trigger_credits = excluded.trigger_credits, amount_cents = excluded.amount_cents,
    monthly_limit_cents = excluded.monthly_limit_cents, status = excluded.status,
    failure_count = 0, next_retry_at = NULL, updated_at = excluded.updated_at`).bind(
    session.userId,
    alreadyAuthorized ? 1 : 0,
    body.triggerCredits,
    body.amountCents,
    body.monthlyLimitCents,
    alreadyAuthorized ? 'active' : 'authorizing',
    now,
    now,
  ).run();

  if (alreadyAuthorized) return privateJson({ enabled: true, status: 'active' });
  try {
    const checkout = await createDodoAutoTopUpAuthorization({
      db: env.DB,
      apiKey,
      environment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
      userId: session.userId,
      origin: new URL(request.url).origin,
      productId,
    });
    return privateJson({ enabled: false, status: 'authorizing', ...checkout }, { status: 201 });
  } catch (error) {
    console.error('Dodo automatic funding authorization failed', error);
    await env.DB.prepare(`UPDATE auto_topup_settings SET status = 'authorization_failed', updated_at = ?
      WHERE hanko_user_id = ?`).bind(Date.now(), session.userId).run();
    return privateJson({ error: 'Automatic funding authorization could not be created.' }, { status: 502 });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!requireSameOrigin(request)) return privateJson({ error: 'Invalid origin.' }, { status: 403 });
  const session = await authenticated(request);
  if (!session) return privateJson({ error: 'Authentication required.' }, { status: 401 });
  const account = await ensureAccount(env.DB, session.userId);
  await env.DB.prepare(`UPDATE auto_topup_settings SET enabled = 0, status = 'disabled', updated_at = ?
    WHERE hanko_user_id = ?`).bind(Date.now(), session.userId).run();
  if (!account.dodo_subscription_id) return privateJson({ enabled: false, status: 'disabled' });
  const apiKey = getSecret('DODOPAYMENTS_API_KEY');
  if (!apiKey) return privateJson({ enabled: false, status: 'disabled', mandateCancellationPending: true }, { status: 202 });
  try {
    await dodoClient(apiKey, dodoEnvironment(DODOPAYMENTS_ENVIRONMENT)).subscriptions.update(
      account.dodo_subscription_id,
      { status: 'cancelled' },
    );
    return privateJson({ enabled: false, status: 'disabled' });
  } catch (error) {
    console.error('Dodo automatic funding mandate cancellation failed', error);
    return privateJson({ enabled: false, status: 'disabled', mandateCancellationPending: true }, { status: 202 });
  }
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'GET, POST, DELETE' } });
