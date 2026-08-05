import { dodoCustomerEmail, type DodoEnvironment } from './dodo';

const ALERT_SENDER = 'billing@extractor.sh';
const TOP_UP_URL = 'https://extractor.sh/dashboard/?topup=1#add-credits';

export async function sendUsageAlert(input: {
  db: D1Database;
  email: SendEmail;
  dodoApiKey: string;
  dodoEnvironment: DodoEnvironment;
  userId: string;
  percent: 80 | 90 | 100;
  epoch: number;
  remaining: number;
}): Promise<void> {
  const alertId = `${input.userId}:${input.epoch}:${input.percent}`;
  const inserted = await input.db.prepare(`INSERT OR IGNORE INTO usage_alerts
    (id, hanko_user_id, percent, status, created_at) VALUES (?, ?, ?, 'sending', ?)`).bind(
    alertId,
    input.userId,
    input.percent,
    Date.now(),
  ).run();
  if ((inserted.meta.changes ?? 0) === 0) return;

  const account = await input.db.prepare('SELECT dodo_customer_id FROM accounts WHERE hanko_user_id = ?')
    .bind(input.userId).first<{ dodo_customer_id: string | null }>();
  if (!account?.dodo_customer_id) {
    await input.db.prepare(`UPDATE usage_alerts SET status = 'skipped', last_error = ? WHERE id = ?`)
      .bind('No Dodo customer is linked.', alertId).run();
    return;
  }

  try {
    const destination = await dodoCustomerEmail(input.dodoApiKey, input.dodoEnvironment, account.dodo_customer_id);
    const exhausted = input.percent === 100;
    await input.email.send({
      to: { name: 'extractor.sh customer', email: destination },
      from: { name: 'extractor.sh billing', email: ALERT_SENDER },
      subject: exhausted ? 'Your extractor.sh credits are exhausted' : `${input.percent}% of your extractor.sh credits are used`,
      text: exhausted
        ? `Your prepaid extractor.sh balance has reached zero. Paid cache misses will stop until you add credits. Cache hits remain free.\n\nTop up: ${TOP_UP_URL}`
        : `${input.percent}% of the credits available after your latest funding event have been used. ${input.remaining.toLocaleString('en-US')} credits remain.\n\nTop up: ${TOP_UP_URL}`,
    });
    await input.db.prepare(`UPDATE usage_alerts SET status = 'sent', sent_at = ? WHERE id = ?`)
      .bind(Date.now(), alertId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed.';
    await input.db.prepare(`UPDATE usage_alerts SET status = 'failed', last_error = ? WHERE id = ?`)
      .bind(message, alertId).run();
    throw error;
  }
}
