import { env } from 'cloudflare:workers';
import { Webhook } from 'standardwebhooks';
import { beforeAll, describe, expect, it } from 'vitest';
import schemaMigration from '../migrations/0001_schema.sql?raw';
import welcomeMigration from '../migrations/0002_welcome_credits.sql?raw';
import {
  finishAutoTopUp,
  getCreditSnapshot,
  reserveAutoTopUp,
} from '../src/features/billing/credits-client';
import { processDodoWebhook } from '../src/features/billing/webhook';
import { ensureWelcomeCredits } from '../src/features/billing/welcome-credits';

const BUSINESS_ID = 'bus_webhook_test';
const WEBHOOK_SECRET = `whsec_${btoa('extractor webhook fixture secret')}`;

beforeAll(async () => {
  // D1Database.exec treats each newline as an independent statement, while
  // migration files intentionally format CREATE TABLE over several lines.
  // Execute the same semicolon-delimited statements one at a time instead.
  const statements = `${schemaMigration}\n${welcomeMigration}`
    .replace(/^\s*--.*$/gmu, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement && !statement.startsWith('PRAGMA foreign_keys'));
  for (const statement of statements) await env.DB.prepare(statement).run();
});

describe('welcome credits', () => {
  it('grants 1,000 credits exactly once to new accounts', async () => {
    const userId = unique('welcome_user');
    await ensureWelcomeCredits(env.DB, env, userId);
    await ensureWelcomeCredits(env.DB, env, userId);

    const snapshot = await getCreditSnapshot(env, userId);
    const ledger = await env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(credits), 0) AS credits
      FROM billing_ledger WHERE hanko_user_id = ? AND kind = 'welcome_bonus'`)
      .bind(userId).first<{ count: number; credits: number }>();
    expect(snapshot.balance).toBe(1_000);
    expect(ledger).toEqual({ count: 1, credits: 1_000 });
  });

  it('does not grant welcome credits to account rows that predate the migration', async () => {
    const userId = unique('existing_user');
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO accounts (hanko_user_id, created_at, updated_at)
      VALUES (?, ?, ?)`).bind(userId, now, now).run();

    await ensureWelcomeCredits(env.DB, env, userId);

    expect((await getCreditSnapshot(env, userId)).balance).toBe(0);
    const ledger = await env.DB.prepare(`SELECT COUNT(*) AS count FROM billing_ledger
      WHERE hanko_user_id = ? AND kind = 'welcome_bonus'`).bind(userId).first<{ count: number }>();
    expect(ledger?.count).toBe(0);
  });
});

function unique(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function signedRequest(event: Record<string, unknown>, webhookId = unique('evt')): Request {
  const payload = JSON.stringify(event);
  const timestamp = new Date();
  const signature = new Webhook(WEBHOOK_SECRET).sign(webhookId, timestamp, payload);
  return new Request('https://extractor.sh/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': webhookId,
      'webhook-signature': signature,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1_000)),
    },
    body: payload,
  });
}

async function deliver(event: Record<string, unknown>, webhookId?: string): Promise<Response> {
  return processDodoWebhook({
    request: signedRequest(event, webhookId),
    db: env.DB,
    env,
    apiKey: 'test_api_key',
    businessId: BUSINESS_ID,
    environment: 'test_mode',
    webhookKey: WEBHOOK_SECRET,
  });
}

async function createManualCheckout(input: {
  userId: string;
  checkoutId: string;
  amountCents?: number;
  credits?: number;
}): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO accounts (hanko_user_id, created_at, updated_at)
    VALUES (?, ?, ?)`).bind(input.userId, now, now).run();
  await env.DB.prepare(`INSERT INTO checkout_intents
    (id, hanko_user_id, mode, amount_cents, credits, status, dodo_checkout_id, funding_kind, created_at, updated_at)
    VALUES (?, ?, 'payment', ?, ?, 'open', ?, 'top_up', ?, ?)`).bind(
    unique('checkout_intent'),
    input.userId,
    input.amountCents ?? 1_000,
    input.credits ?? 20_408,
    input.checkoutId,
    now,
    now,
  ).run();
}

function paymentEvent(input: {
  userId: string;
  checkoutId: string;
  paymentId: string;
  amountCents?: number;
  credits?: number;
}) {
  const amountCents = input.amountCents ?? 1_000;
  const credits = input.credits ?? 20_408;
  return {
    business_id: BUSINESS_ID,
    timestamp: new Date().toISOString(),
    type: 'payment.succeeded',
    data: {
      checkout_session_id: input.checkoutId,
      customer: { customer_id: unique('cus') },
      metadata: {
        hanko_user_id: input.userId,
        checkout_intent_id: unique('intent'),
        funding_kind: 'top_up',
        amount_cents: amountCents,
        credits,
      },
      payment_id: input.paymentId,
      total_amount: amountCents,
    },
  };
}

function reversalEvent(type: 'refund.succeeded' | 'dispute.opened' | 'dispute.won', paymentId: string) {
  return {
    business_id: BUSINESS_ID,
    timestamp: new Date().toISOString(),
    type,
    data: type === 'refund.succeeded'
      ? { payment_id: paymentId }
      : {
          payment_id: paymentId,
          dispute_status: type === 'dispute.opened' ? 'dispute_opened' : 'dispute_won',
        },
  };
}

async function createAutoTopUpAttempt(input: {
  userId: string;
  attemptId: string;
  subscriptionId: string;
}): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO accounts
    (hanko_user_id, dodo_subscription_id, dodo_subscription_status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)`).bind(input.userId, input.subscriptionId, now, now).run();
  await env.DB.prepare(`INSERT INTO auto_topup_settings
    (hanko_user_id, enabled, trigger_credits, amount_cents, monthly_limit_cents, status, created_at, updated_at)
    VALUES (?, 1, 0, 2000, 5000, 'active', ?, ?)`).bind(input.userId, now, now).run();
  await env.DB.prepare(`INSERT INTO auto_topup_attempts
    (id, hanko_user_id, dodo_subscription_id, period, amount_cents, credits, status, created_at, updated_at)
    VALUES (?, ?, ?, '2026-08', 2000, 40816, 'pending', ?, ?)`).bind(
    input.attemptId,
    input.userId,
    input.subscriptionId,
    now,
    now,
  ).run();
  const reserved = await reserveAutoTopUp(env, input.userId, {
    id: input.attemptId,
    fundingPeriod: '2026-08',
    amountCents: 2_000,
    monthlyLimitCents: 5_000,
    triggerCredits: 0,
  });
  expect(reserved.ok).toBe(true);
}

function autoTopUpPaymentEvent(input: {
  userId: string;
  attemptId: string;
  subscriptionId: string;
  paymentId: string;
  succeeded: boolean;
  errorCode?: string;
}) {
  return {
    business_id: BUSINESS_ID,
    timestamp: new Date().toISOString(),
    type: input.succeeded ? 'payment.succeeded' : 'payment.failed',
    data: {
      customer: { customer_id: unique('cus') },
      subscription_id: input.subscriptionId,
      metadata: {
        hanko_user_id: input.userId,
        auto_topup_attempt_id: input.attemptId,
        funding_kind: 'auto_top_up',
        amount_cents: 2_000,
        credits: 40_816,
      },
      payment_id: input.paymentId,
      total_amount: 2_000,
      ...(input.succeeded ? {} : { error_code: input.errorCode ?? 'INSUFFICIENT_FUNDS' }),
    },
  };
}

describe('Dodo webhook settlement', () => {
  it('rejects a forged signature before writing an event', async () => {
    const response = await processDodoWebhook({
      request: new Request('https://extractor.sh/api/billing/webhook', {
        method: 'POST',
        headers: {
          'webhook-id': unique('forged'),
          'webhook-signature': 'v1,not-valid',
          'webhook-timestamp': String(Math.floor(Date.now() / 1_000)),
        },
        body: '{}',
      }),
      db: env.DB,
      env,
      apiKey: 'test_api_key',
      businessId: BUSINESS_ID,
      environment: 'test_mode',
      webhookKey: WEBHOOK_SECRET,
    });
    expect(response.status).toBe(403);
  });

  it('grants a paid checkout exactly once when Dodo retries the same event', async () => {
    const userId = unique('manual_user');
    const checkoutId = unique('checkout');
    const paymentId = unique('pay');
    const webhookId = unique('evt_paid');
    await createManualCheckout({ userId, checkoutId });
    const event = paymentEvent({ userId, checkoutId, paymentId });

    expect((await deliver(event, webhookId)).status).toBe(200);
    const duplicate = await deliver(event, webhookId);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ received: true, duplicate: true });
    expect((await getCreditSnapshot(env, userId)).balance).toBe(20_408);
    const ledger = await env.DB.prepare('SELECT COUNT(*) AS count FROM billing_ledger WHERE payment_ref = ?')
      .bind(paymentId).first<{ count: number }>();
    expect(ledger?.count).toBe(1);
  });

  it('reverses the full grant when a refund arrives before the payment event', async () => {
    const userId = unique('refund_user');
    const checkoutId = unique('checkout');
    const paymentId = unique('pay');
    await createManualCheckout({ userId, checkoutId });

    expect((await deliver(reversalEvent('refund.succeeded', paymentId))).status).toBe(200);
    expect((await deliver(paymentEvent({ userId, checkoutId, paymentId }))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(0);
    const ledger = await env.DB.prepare('SELECT COALESCE(SUM(credits), 0) AS credits FROM billing_ledger WHERE payment_ref = ?')
      .bind(paymentId).first<{ credits: number }>();
    expect(ledger?.credits).toBe(0);
  });

  it('restores credits after a dispute is won but never after a final refund', async () => {
    const userId = unique('dispute_user');
    const checkoutId = unique('checkout');
    const paymentId = unique('pay');
    await createManualCheckout({ userId, checkoutId });
    expect((await deliver(paymentEvent({ userId, checkoutId, paymentId }))).status).toBe(200);
    expect((await deliver(reversalEvent('dispute.opened', paymentId))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(0);
    expect((await deliver(reversalEvent('dispute.won', paymentId))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(20_408);
    expect((await deliver(reversalEvent('refund.succeeded', paymentId))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(0);
    expect((await deliver(reversalEvent('dispute.won', paymentId))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(0);
  });

  it('settles an on-demand charge only after payment succeeds', async () => {
    const userId = unique('auto_paid_user');
    const attemptId = unique('auto_attempt');
    const subscriptionId = unique('sub');
    const paymentId = unique('pay');
    await createAutoTopUpAttempt({ userId, attemptId, subscriptionId });

    expect((await deliver(autoTopUpPaymentEvent({
      userId, attemptId, subscriptionId, paymentId, succeeded: true,
    }))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(40_816);
    const attempt = await env.DB.prepare('SELECT status, dodo_payment_id FROM auto_topup_attempts WHERE id = ?')
      .bind(attemptId).first<{ status: string; dodo_payment_id: string }>();
    expect(attempt).toMatchObject({ status: 'paid', dodo_payment_id: paymentId });

    const nextId = unique('next_auto');
    const next = await reserveAutoTopUp(env, userId, {
      id: nextId, fundingPeriod: '2026-08', amountCents: 2_000,
      monthlyLimitCents: 5_000, triggerCredits: 50_000,
    });
    expect(next).toMatchObject({ ok: true, spentCents: 2_000 });
    if (next.ok) await finishAutoTopUp(env, userId, nextId, false);
  });

  it('grants nothing and disables automatic funding after a hard decline', async () => {
    const userId = unique('auto_failed_user');
    const attemptId = unique('auto_attempt');
    const subscriptionId = unique('sub');
    await createAutoTopUpAttempt({ userId, attemptId, subscriptionId });

    expect((await deliver(autoTopUpPaymentEvent({
      userId,
      attemptId,
      subscriptionId,
      paymentId: unique('pay'),
      succeeded: false,
      errorCode: 'STOLEN_CARD',
    }))).status).toBe(200);
    expect((await getCreditSnapshot(env, userId)).balance).toBe(0);
    const setting = await env.DB.prepare('SELECT enabled, status FROM auto_topup_settings WHERE hanko_user_id = ?')
      .bind(userId).first<{ enabled: number; status: string }>();
    expect(setting).toMatchObject({ enabled: 0, status: 'requires_attention' });
    const attempt = await env.DB.prepare('SELECT status, failure_code FROM auto_topup_attempts WHERE id = ?')
      .bind(attemptId).first<{ status: string; failure_code: string }>();
    expect(attempt).toMatchObject({ status: 'failed', failure_code: 'STOLEN_CARD' });
  });
});
