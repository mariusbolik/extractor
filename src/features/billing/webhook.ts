import DodoPayments from 'dodopayments';
import { creditsForAmount, isValidPurchaseAmount } from './constants';
import { finishAutoTopUp, grantCredits, reverseCredits } from './credits-client';
import { dodoClient, type DodoEnvironment } from './dodo';
import { ensureAccount } from './d1';

type DodoEvent = ReturnType<DodoPayments['webhooks']['unwrap']>;
type DodoData = Record<string, any>;

function metadataString(data: DodoData, key: string): string | null {
  const value = data.metadata?.[key];
  return typeof value === 'string' && value ? value : null;
}

function metadataInteger(data: DodoData, key: string): number | null {
  const value = Number(data.metadata?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

async function accountByProviderRef(db: D1Database, data: DodoData): Promise<string | null> {
  const customerId = data.customer?.customer_id ?? data.customer_id;
  if (customerId) {
    const row = await db.prepare('SELECT hanko_user_id FROM accounts WHERE dodo_customer_id = ?')
      .bind(customerId).first<{ hanko_user_id: string }>();
    if (row) return row.hanko_user_id;
  }
  const subscriptionId = data.subscription_id;
  if (subscriptionId) {
    const row = await db.prepare('SELECT hanko_user_id FROM accounts WHERE dodo_subscription_id = ?')
      .bind(subscriptionId).first<{ hanko_user_id: string }>();
    if (row) return row.hanko_user_id;
  }
  const checkoutId = data.checkout_session_id;
  if (checkoutId) {
    const intent = await db.prepare('SELECT hanko_user_id FROM checkout_intents WHERE dodo_checkout_id = ?')
      .bind(checkoutId).first<{ hanko_user_id: string }>();
    if (intent) return intent.hanko_user_id;
    const authorization = await db.prepare(`SELECT hanko_user_id FROM auto_topup_authorizations
      WHERE dodo_checkout_id = ?`).bind(checkoutId).first<{ hanko_user_id: string }>();
    if (authorization) return authorization.hanko_user_id;
  }
  return null;
}

async function userFor(data: DodoData, db: D1Database): Promise<string | null> {
  const userId = metadataString(data, 'hanko_user_id') ?? await accountByProviderRef(db, data);
  if (userId) await ensureAccount(db, userId);
  return userId;
}

async function linkProviderRefs(db: D1Database, userId: string, data: DodoData): Promise<void> {
  const customerId = data.customer?.customer_id ?? data.customer_id;
  const subscriptionId = data.subscription_id;
  await db.prepare(`UPDATE accounts SET
    dodo_customer_id = COALESCE(?, dodo_customer_id),
    dodo_subscription_id = COALESCE(?, dodo_subscription_id),
    updated_at = ? WHERE hanko_user_id = ?`)
    .bind(customerId ?? null, subscriptionId ?? null, Date.now(), userId).run();
}

async function recordGrant(input: {
  db: D1Database;
  env: Pick<Env, 'ACCOUNT_CREDITS'>;
  userId: string;
  externalRef: string;
  credits: number;
  amountCents: number;
  occurredAt: number;
  kind?: 'purchase' | 'auto_top_up';
}): Promise<void> {
  await grantCredits(input.env, input.userId, { id: `grant:${input.externalRef}`, credits: input.credits });
  await input.db.prepare(`INSERT OR IGNORE INTO billing_ledger
    (id, hanko_user_id, kind, credits, amount_cents, payment_ref, external_ref, description, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    `ledger_${input.externalRef}`,
    input.userId,
    input.kind ?? 'purchase',
    input.credits,
    input.amountCents,
    input.externalRef,
    input.externalRef,
    input.kind === 'auto_top_up' ? 'Automatic credit top-up' : 'Credit top-up',
    input.occurredAt,
    Date.now(),
  ).run();

  const pending = await input.db.prepare('SELECT kind, occurred_at FROM pending_reversals WHERE payment_ref = ?')
    .bind(input.externalRef).first<{ kind: 'refund' | 'dispute'; occurred_at: number }>();
  if (pending) {
    await input.db.prepare('DELETE FROM pending_reversals WHERE payment_ref = ?').bind(input.externalRef).run();
  }
  const state = await input.db.prepare(`SELECT refund_final, dispute_active FROM payment_reversal_state
    WHERE payment_ref = ?`).bind(input.externalRef).first<{ refund_final: number; dispute_active: number }>();
  if (state?.refund_final) {
    await reverseOriginalGrant(input.db, input.env, input.externalRef, 'refund', pending?.occurred_at ?? input.occurredAt);
  } else if (state?.dispute_active) {
    await reverseOriginalGrant(input.db, input.env, input.externalRef, 'dispute', pending?.occurred_at ?? input.occurredAt);
  }
}

async function reverseOriginalGrant(
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  paymentRef: string,
  kind: 'refund' | 'dispute',
  occurredAt: number,
): Promise<boolean> {
  const grant = await db.prepare(`SELECT hanko_user_id, credits, amount_cents, external_ref
    FROM billing_ledger WHERE payment_ref = ? AND external_ref = ? AND credits > 0 LIMIT 1`)
    .bind(paymentRef, paymentRef).first<{ hanko_user_id: string; credits: number; amount_cents: number | null; external_ref: string }>();
  if (!grant) return false;
  const net = await db.prepare(`SELECT COALESCE(SUM(credits), 0) AS credits FROM billing_ledger WHERE payment_ref = ?`)
    .bind(paymentRef).first<{ credits: number }>();
  if ((net?.credits ?? 0) <= 0) return true;
  const reversalRef = `reversal:${kind}:${grant.external_ref}`;
  await reverseCredits(env, grant.hanko_user_id, reversalRef, grant.credits);
  await db.prepare(`INSERT OR IGNORE INTO billing_ledger
    (id, hanko_user_id, kind, credits, amount_cents, payment_ref, external_ref, description, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    `ledger_${reversalRef}`,
    grant.hanko_user_id,
    kind,
    -grant.credits,
    grant.amount_cents,
    paymentRef,
    reversalRef,
    kind === 'refund' ? 'Purchase refunded' : 'Payment disputed',
    occurredAt,
    Date.now(),
  ).run();
  return true;
}

async function restoreDisputeGrant(
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  paymentRef: string,
  occurredAt: number,
): Promise<void> {
  const state = await db.prepare(`SELECT refund_final, dispute_active FROM payment_reversal_state WHERE payment_ref = ?`)
    .bind(paymentRef).first<{ refund_final: number; dispute_active: number }>();
  if (!state || state.refund_final || state.dispute_active) return;
  const grant = await db.prepare(`SELECT hanko_user_id, credits, amount_cents, external_ref
    FROM billing_ledger WHERE payment_ref = ? AND external_ref = ? AND credits > 0 LIMIT 1`)
    .bind(paymentRef, paymentRef).first<{ hanko_user_id: string; credits: number; amount_cents: number | null; external_ref: string }>();
  if (!grant) return;
  const net = await db.prepare(`SELECT COALESCE(SUM(credits), 0) AS credits FROM billing_ledger WHERE payment_ref = ?`)
    .bind(paymentRef).first<{ credits: number }>();
  if ((net?.credits ?? 0) > 0) return;
  const restoreRef = `restore:dispute:${grant.external_ref}`;
  await grantCredits(env, grant.hanko_user_id, { id: restoreRef, credits: grant.credits });
  await db.prepare(`INSERT OR IGNORE INTO billing_ledger
    (id, hanko_user_id, kind, credits, amount_cents, payment_ref, external_ref, description, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    `ledger_${restoreRef}`,
    grant.hanko_user_id,
    'dispute_reversed',
    grant.credits,
    grant.amount_cents,
    paymentRef,
    restoreRef,
    'Dispute resolved in merchant favor',
    occurredAt,
    Date.now(),
  ).run();
}

async function reverseOrDefer(
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  paymentRef: string,
  kind: 'refund' | 'dispute',
  occurredAt: number,
): Promise<void> {
  const now = Date.now();
  if (kind === 'refund') {
    await db.prepare(`INSERT INTO payment_reversal_state
      (payment_ref, refund_final, dispute_active, updated_at) VALUES (?, 1, 0, ?)
      ON CONFLICT(payment_ref) DO UPDATE SET refund_final = 1, dispute_active = 0, updated_at = excluded.updated_at`)
      .bind(paymentRef, now).run();
  } else {
    const state = await db.prepare(`SELECT refund_final, last_dispute_at FROM payment_reversal_state
      WHERE payment_ref = ?`).bind(paymentRef).first<{ refund_final: number; last_dispute_at: number | null }>();
    if (state?.refund_final || (state?.last_dispute_at ?? 0) > occurredAt) return;
    await db.prepare(`INSERT INTO payment_reversal_state
      (payment_ref, dispute_active, last_dispute_at, updated_at) VALUES (?, 1, ?, ?)
      ON CONFLICT(payment_ref) DO UPDATE SET dispute_active = 1,
      last_dispute_at = MAX(COALESCE(last_dispute_at, 0), excluded.last_dispute_at), updated_at = excluded.updated_at`)
      .bind(paymentRef, occurredAt, now).run();
  }
  if (await reverseOriginalGrant(db, env, paymentRef, kind, occurredAt)) return;
  await db.prepare(`INSERT INTO pending_reversals (payment_ref, kind, occurred_at, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(payment_ref) DO UPDATE SET
    kind = CASE WHEN excluded.kind = 'dispute' THEN 'dispute' ELSE pending_reversals.kind END,
    occurred_at = MIN(pending_reversals.occurred_at, excluded.occurred_at)`).bind(
    paymentRef,
    kind,
    occurredAt,
    Date.now(),
  ).run();
}

async function resolveDispute(
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  paymentRef: string,
  occurredAt: number,
): Promise<void> {
  const state = await db.prepare(`SELECT refund_final, last_dispute_at FROM payment_reversal_state WHERE payment_ref = ?`)
    .bind(paymentRef).first<{ refund_final: number; last_dispute_at: number | null }>();
  if (state?.refund_final || (state?.last_dispute_at ?? 0) > occurredAt) return;
  await db.prepare(`INSERT INTO payment_reversal_state
    (payment_ref, dispute_active, last_dispute_at, updated_at) VALUES (?, 0, ?, ?)
    ON CONFLICT(payment_ref) DO UPDATE SET dispute_active = 0, last_dispute_at = excluded.last_dispute_at,
    updated_at = excluded.updated_at WHERE refund_final = 0`).bind(paymentRef, occurredAt, Date.now()).run();
  await db.prepare(`DELETE FROM pending_reversals WHERE payment_ref = ? AND kind = 'dispute'`).bind(paymentRef).run();
  await restoreDisputeGrant(db, env, paymentRef, occurredAt);
}

const HARD_DECLINES = new Set([
  'STOLEN_CARD', 'DO_NOT_HONOR', 'FRAUDULENT', 'PICKUP_CARD', 'AUTHENTICATION_FAILURE', 'LOST_CARD',
]);

async function failAutoTopUp(
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  data: DodoData,
): Promise<void> {
  const attemptId = metadataString(data, 'auto_topup_attempt_id');
  if (!attemptId) return;
  const attempt = await db.prepare(`SELECT hanko_user_id FROM auto_topup_attempts WHERE id = ?`)
    .bind(attemptId).first<{ hanko_user_id: string }>();
  if (!attempt) return;
  const errorCode = typeof data.error_code === 'string' ? data.error_code.toUpperCase() : 'PAYMENT_FAILED';
  await db.prepare(`UPDATE auto_topup_attempts SET status = 'failed', failure_code = ?, updated_at = ? WHERE id = ?`)
    .bind(errorCode, Date.now(), attemptId).run();
  await finishAutoTopUp(env, attempt.hanko_user_id, attemptId, false);
  const current = await db.prepare('SELECT failure_count FROM auto_topup_settings WHERE hanko_user_id = ?')
    .bind(attempt.hanko_user_id).first<{ failure_count: number }>();
  const failureCount = (current?.failure_count ?? 0) + 1;
  const stop = HARD_DECLINES.has(errorCode) || failureCount >= 3;
  await db.prepare(`UPDATE auto_topup_settings SET enabled = ?, status = ?, failure_count = ?,
    next_retry_at = ?, updated_at = ? WHERE hanko_user_id = ?`).bind(
    stop ? 0 : 1,
    stop ? 'requires_attention' : 'retry_wait',
    failureCount,
    stop ? null : Date.now() + 3 * 24 * 60 * 60 * 1_000,
    Date.now(),
    attempt.hanko_user_id,
  ).run();
}

async function handlePaymentSucceeded(
  data: DodoData,
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  occurredAt: number,
): Promise<void> {
  const fundingKind = metadataString(data, 'funding_kind');
  const userId = await userFor(data, db);
  if (!userId) throw new Error('Paid Dodo payment has no extractor account reference.');
  await linkProviderRefs(db, userId, data);

  if (fundingKind === 'auto_top_up_authorization' || data.total_amount === 0) return;
  const amountCents = metadataInteger(data, 'amount_cents');
  if (!isValidPurchaseAmount(amountCents)) throw new Error('Paid Dodo payment has an invalid funding amount.');
  const credits = metadataInteger(data, 'credits') ?? creditsForAmount(amountCents);
  const paymentId = String(data.payment_id ?? '');
  if (!paymentId) throw new Error('Paid Dodo payment has no payment ID.');

  if (fundingKind === 'auto_top_up') {
    const attemptId = metadataString(data, 'auto_topup_attempt_id');
    if (!attemptId) throw new Error('Automatic Dodo payment has no attempt reference.');
    const attempt = await db.prepare(`SELECT hanko_user_id, amount_cents, credits FROM auto_topup_attempts WHERE id = ?`)
      .bind(attemptId).first<{ hanko_user_id: string; amount_cents: number; credits: number }>();
    if (!attempt || attempt.hanko_user_id !== userId || attempt.amount_cents !== amountCents || attempt.credits !== credits) {
      throw new Error('Automatic Dodo payment does not match its reserved attempt.');
    }
    await recordGrant({ db, env, userId, externalRef: paymentId, credits, amountCents, occurredAt, kind: 'auto_top_up' });
    await finishAutoTopUp(env, userId, attemptId, true);
    await db.prepare(`UPDATE auto_topup_attempts SET dodo_payment_id = ?, status = 'paid', updated_at = ? WHERE id = ?`)
      .bind(paymentId, Date.now(), attemptId).run();
    await db.prepare(`UPDATE auto_topup_settings SET status = 'active', failure_count = 0,
      next_retry_at = NULL, updated_at = ? WHERE hanko_user_id = ?`).bind(Date.now(), userId).run();
  } else if (fundingKind === 'top_up') {
    const intent = await db.prepare(`SELECT hanko_user_id, amount_cents, credits FROM checkout_intents
      WHERE dodo_checkout_id = ?`).bind(data.checkout_session_id ?? '').first<{
        hanko_user_id: string;
        amount_cents: number;
        credits: number;
      }>();
    if (!intent || intent.hanko_user_id !== userId || intent.amount_cents !== amountCents || intent.credits !== credits) {
      throw new Error('Manual Dodo payment does not match its checkout intent.');
    }
    await recordGrant({ db, env, userId, externalRef: paymentId, credits, amountCents, occurredAt });
  } else {
    throw new Error('Paid Dodo payment has an unknown funding kind.');
  }

  await db.prepare(`UPDATE checkout_intents SET dodo_payment_id = ?, status = 'paid', updated_at = ?
    WHERE dodo_checkout_id = ?`).bind(paymentId, Date.now(), data.checkout_session_id ?? '').run();
}

async function handleSubscription(eventType: string, data: DodoData, db: D1Database): Promise<void> {
  if (data.on_demand !== true) return;
  const userId = await userFor(data, db);
  if (!userId) throw new Error('Dodo on-demand subscription has no extractor account reference.');
  await linkProviderRefs(db, userId, data);
  const status = String(data.status ?? eventType.slice('subscription.'.length));
  await db.prepare('UPDATE accounts SET dodo_subscription_status = ?, updated_at = ? WHERE hanko_user_id = ?')
    .bind(status, Date.now(), userId).run();

  if (eventType === 'subscription.active') {
    await db.prepare(`UPDATE auto_topup_settings SET
      enabled = CASE WHEN status = 'authorizing' OR enabled = 1 THEN 1 ELSE enabled END,
      status = CASE WHEN status = 'authorizing' OR enabled = 1 THEN 'active' ELSE status END,
      failure_count = 0, next_retry_at = NULL, updated_at = ? WHERE hanko_user_id = ?`)
      .bind(Date.now(), userId).run();
    const authorizationId = metadataString(data, 'auto_topup_authorization_id');
    if (authorizationId) {
      await db.prepare(`UPDATE auto_topup_authorizations SET status = 'active', updated_at = ? WHERE id = ?`)
        .bind(Date.now(), authorizationId).run();
    }
    return;
  }
  if (eventType === 'subscription.on_hold') {
    await db.prepare(`UPDATE auto_topup_settings SET status = 'on_hold', updated_at = ? WHERE hanko_user_id = ?`)
      .bind(Date.now(), userId).run();
    return;
  }
  if (eventType === 'subscription.plan_changed' && data.cancel_at_next_billing_date === true) {
    await db.prepare(`UPDATE auto_topup_settings SET enabled = 0, status = 'scheduled_cancel', updated_at = ?
      WHERE hanko_user_id = ?`).bind(Date.now(), userId).run();
    return;
  }
  if (['subscription.failed', 'subscription.cancelled', 'subscription.expired'].includes(eventType)) {
    await db.prepare(`UPDATE auto_topup_settings SET enabled = 0, status = ?, updated_at = ? WHERE hanko_user_id = ?`)
      .bind(status, Date.now(), userId).run();
  }
}

async function handleEvent(
  event: DodoEvent,
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
): Promise<void> {
  const data = event.data as DodoData;
  const occurredAt = Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : Date.now();

  if (event.type === 'payment.succeeded') {
    await handlePaymentSucceeded(data, db, env, occurredAt);
    return;
  }
  if (event.type === 'payment.failed' || event.type === 'payment.cancelled') {
    await failAutoTopUp(db, env, data);
    if (data.checkout_session_id) {
      await db.prepare(`UPDATE checkout_intents SET status = ?, updated_at = ? WHERE dodo_checkout_id = ?`)
        .bind(event.type.slice('payment.'.length), Date.now(), data.checkout_session_id).run();
    }
    return;
  }
  if (event.type.startsWith('subscription.')) {
    await handleSubscription(event.type, data, db);
    return;
  }
  if (event.type === 'refund.succeeded') {
    await reverseOrDefer(db, env, data.payment_id, 'refund', occurredAt);
    return;
  }
  if (event.type.startsWith('dispute.')) {
    const status = String(data.dispute_status ?? event.type.slice('dispute.'.length));
    if (status === 'dispute_won' || status === 'dispute_cancelled' || status === 'won' || status === 'cancelled') {
      await resolveDispute(db, env, data.payment_id, occurredAt);
    } else if (status === 'dispute_opened' || status === 'dispute_accepted' || status === 'dispute_lost'
      || status === 'opened' || status === 'accepted' || status === 'lost') {
      await reverseOrDefer(db, env, data.payment_id, 'dispute', occurredAt);
    }
  }
}

export async function processDodoWebhook(input: {
  request: Request;
  db: D1Database;
  env: Pick<Env, 'ACCOUNT_CREDITS'>;
  apiKey: string;
  businessId: string;
  environment: DodoEnvironment;
  webhookKey: string;
}): Promise<Response> {
  const rawBody = await input.request.text();
  const webhookId = input.request.headers.get('webhook-id');
  const webhookTimestamp = input.request.headers.get('webhook-timestamp');
  const webhookSignature = input.request.headers.get('webhook-signature');
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return Response.json({ error: 'Missing Dodo webhook signature.' }, { status: 400 });
  }

  let event: DodoEvent;
  try {
    event = dodoClient(input.apiKey, input.environment, input.webhookKey).webhooks.unwrap(rawBody, {
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': webhookTimestamp,
        'webhook-signature': webhookSignature,
      },
    });
  } catch {
    return Response.json({ error: 'Invalid Dodo webhook.' }, { status: 403 });
  }
  if (event.business_id !== input.businessId) {
    return Response.json({ error: 'Webhook belongs to a different Dodo business.' }, { status: 403 });
  }

  const now = Date.now();
  const inserted = await input.db.prepare(`INSERT OR IGNORE INTO dodo_webhook_events
    (dodo_event_id, event_type, status, received_at) VALUES (?, ?, 'processing', ?)`).bind(
    webhookId,
    event.type,
    now,
  ).run();
  if ((inserted.meta.changes ?? 0) === 0) {
    const existing = await input.db.prepare('SELECT status FROM dodo_webhook_events WHERE dodo_event_id = ?')
      .bind(webhookId).first<{ status: string }>();
    if (existing?.status === 'processed' || existing?.status === 'processing') {
      return Response.json({ received: true, duplicate: true });
    }
    await input.db.prepare(`UPDATE dodo_webhook_events SET status = 'processing', attempts = attempts + 1,
      last_error = NULL WHERE dodo_event_id = ?`).bind(webhookId).run();
  }

  try {
    await handleEvent(event, input.db, input.env);
    await input.db.prepare(`UPDATE dodo_webhook_events SET status = 'processed', processed_at = ?
      WHERE dodo_event_id = ?`).bind(Date.now(), webhookId).run();
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown webhook error';
    await input.db.prepare(`UPDATE dodo_webhook_events SET status = 'failed', last_error = ? WHERE dodo_event_id = ?`)
      .bind(message, webhookId).run();
    return Response.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}
