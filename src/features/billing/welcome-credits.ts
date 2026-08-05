import { WELCOME_CREDIT_GRANT } from './constants';
import { grantCredits } from './credits-client';
import { ensureAccount, type AccountRecord } from './d1';

const WELCOME_GRANT_VERSION = 'v1';

export async function ensureWelcomeCredits(
  db: D1Database,
  env: Pick<Env, 'ACCOUNT_CREDITS'>,
  userId: string,
  account?: AccountRecord,
): Promise<AccountRecord> {
  const current = account ?? await db.prepare('SELECT * FROM accounts WHERE hanko_user_id = ?')
    .bind(userId).first<AccountRecord>() ?? await ensureAccount(db, userId);
  if (current.welcome_credits_eligible !== 1 || current.welcome_credits_granted_at !== null) return current;

  const externalRef = `welcome:${WELCOME_GRANT_VERSION}:${userId}`;
  await grantCredits(env, userId, {
    id: `welcome:${WELCOME_GRANT_VERSION}`,
    credits: WELCOME_CREDIT_GRANT,
  });
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO billing_ledger
    (id, hanko_user_id, kind, credits, amount_cents, payment_ref, external_ref, description, occurred_at, created_at)
    VALUES (?, ?, 'welcome_bonus', ?, NULL, NULL, ?, 'Welcome credit bonus', ?, ?)`)
    .bind(`ledger_${externalRef}`, userId, WELCOME_CREDIT_GRANT, externalRef, now, now).run();
  await db.prepare(`UPDATE accounts SET welcome_credits_granted_at = COALESCE(welcome_credits_granted_at, ?),
    updated_at = ? WHERE hanko_user_id = ? AND welcome_credits_eligible = 1`)
    .bind(now, now, userId).run();
  return { ...current, welcome_credits_granted_at: current.welcome_credits_granted_at ?? now, updated_at: now };
}
