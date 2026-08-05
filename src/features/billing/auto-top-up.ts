import { creditsForAmount } from './constants';
import { finishAutoTopUp, reserveAutoTopUp } from './credits-client';
import { dodoClient, type DodoEnvironment } from './dodo';
import { randomId } from './crypto';

export function autoTopUpPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export async function maybeTriggerAutoTopUp(input: {
  db: D1Database;
  env: Pick<Env, 'ACCOUNT_CREDITS'>;
  apiKey: string;
  environment: DodoEnvironment;
  userId: string;
  remainingCredits: number;
}): Promise<{ triggered: boolean; reason?: string; attemptId?: string; paymentId?: string }> {
  const row = await input.db.prepare(`SELECT s.enabled, s.trigger_credits, s.amount_cents,
    s.monthly_limit_cents, s.next_retry_at, a.dodo_subscription_id, a.dodo_subscription_status
    FROM auto_topup_settings s JOIN accounts a ON a.hanko_user_id = s.hanko_user_id
    WHERE s.hanko_user_id = ?`).bind(input.userId).first<{
      enabled: number;
      trigger_credits: number;
      amount_cents: number;
      monthly_limit_cents: number;
      next_retry_at: number | null;
      dodo_subscription_id: string | null;
      dodo_subscription_status: string | null;
    }>();
  if (!row?.enabled) return { triggered: false, reason: 'disabled' };
  if (!row.dodo_subscription_id) return { triggered: false, reason: 'no_mandate' };
  if (!['active', 'on_hold'].includes(row.dodo_subscription_status ?? '')) {
    return { triggered: false, reason: 'mandate_inactive' };
  }
  if (row.next_retry_at && row.next_retry_at > Date.now()) return { triggered: false, reason: 'retry_wait' };
  if (input.remainingCredits > row.trigger_credits) return { triggered: false, reason: 'above_trigger' };

  const attemptId = randomId('auto_topup_');
  const period = autoTopUpPeriod();
  const reservation = await reserveAutoTopUp(input.env, input.userId, {
    id: attemptId,
    fundingPeriod: period,
    amountCents: row.amount_cents,
    monthlyLimitCents: row.monthly_limit_cents,
    triggerCredits: row.trigger_credits,
  });
  if (!reservation.ok) return { triggered: false, reason: reservation.reason ?? 'not_reserved' };

  const credits = creditsForAmount(row.amount_cents);
  const now = Date.now();
  try {
    await input.db.prepare(`INSERT INTO auto_topup_attempts
      (id, hanko_user_id, dodo_subscription_id, period, amount_cents, credits, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?)`).bind(
      attemptId,
      input.userId,
      row.dodo_subscription_id,
      period,
      row.amount_cents,
      credits,
      now,
      now,
    ).run();
  } catch (error) {
    await finishAutoTopUp(input.env, input.userId, attemptId, false);
    throw error;
  }

  try {
    // Dodo's charge endpoint does not expose an idempotency contract. Disable
    // transport retries and hold the DO reservation across ambiguous failures;
    // blindly repeating an unknown request could charge the card twice.
    const charge = await dodoClient(input.apiKey, input.environment, undefined, 0).subscriptions.charge(
      row.dodo_subscription_id,
      {
        product_price: row.amount_cents,
        product_currency: 'USD',
        adaptive_currency_fees_inclusive: false,
        product_description: 'Extractor request credits',
        metadata: {
          hanko_user_id: input.userId,
          auto_topup_attempt_id: attemptId,
          funding_kind: 'auto_top_up',
          amount_cents: row.amount_cents,
          credits,
        },
      },
    );
    await input.db.prepare(`UPDATE auto_topup_attempts SET dodo_payment_id = ?, status = 'pending', updated_at = ?
      WHERE id = ?`).bind(charge.payment_id, Date.now(), attemptId).run();
    return { triggered: true, attemptId, paymentId: charge.payment_id };
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : NaN;
    const definitiveRejection = Number.isInteger(status) && status >= 400 && status < 500;
    await input.db.prepare(`UPDATE auto_topup_attempts SET status = ?, failure_code = ?, updated_at = ? WHERE id = ?`)
      .bind(definitiveRejection ? 'rejected' : 'unknown',
        definitiveRejection ? `HTTP_${status}` : 'AMBIGUOUS_API_RESULT', Date.now(), attemptId).run();
    if (definitiveRejection) await finishAutoTopUp(input.env, input.userId, attemptId, false);
    return { triggered: false, reason: definitiveRejection ? 'charge_rejected' : 'charge_result_unknown', attemptId };
  }
}
