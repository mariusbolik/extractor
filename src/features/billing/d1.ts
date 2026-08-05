import { generateApiKey, hashApiKey, randomId } from './crypto';
import { MAX_ACTIVE_API_KEYS } from './constants';

export interface AccountRecord {
  hanko_user_id: string;
  dodo_customer_id: string | null;
  dodo_subscription_id: string | null;
  dodo_subscription_status: string | null;
  welcome_credits_eligible: number;
  welcome_credits_granted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface AutoTopUpRecord {
  hanko_user_id: string;
  enabled: number;
  trigger_credits: number;
  amount_cents: number;
  monthly_limit_cents: number;
  status: string;
  failure_count: number;
  next_retry_at: number | null;
  updated_at: number;
}

export interface DashboardData {
  apiKeys: Array<{ id: string; key_hint: string; name: string; created_at: number }>;
  ledger: Array<{
    id: string;
    kind: string;
    credits: number;
    amount_cents: number | null;
    description: string;
    occurred_at: number;
  }>;
  autoTopUp: AutoTopUpRecord | null;
  autoTopUpSpentCents: number;
}

export async function ensureAccount(db: D1Database, userId: string): Promise<AccountRecord> {
  const now = Date.now();
  await db.prepare(`INSERT INTO accounts
    (hanko_user_id, welcome_credits_eligible, created_at, updated_at) VALUES (?, 1, ?, ?)
    ON CONFLICT(hanko_user_id) DO UPDATE SET updated_at = excluded.updated_at`).bind(userId, now, now).run();
  const account = await db.prepare('SELECT * FROM accounts WHERE hanko_user_id = ?').bind(userId).first<AccountRecord>();
  if (!account) throw new Error('Account could not be created.');
  return account;
}

export async function accountForApiKey(db: D1Database, apiKey: string): Promise<{
  userId: string;
  keyId: string;
  welcomeCreditsPending: boolean;
} | null> {
  if (!/^ext_live_[A-Za-z0-9_-]{20,}$/.test(apiKey)) return null;
  const keyHash = await hashApiKey(apiKey);
  const row = await db.prepare(`SELECT api_keys.id, api_keys.hanko_user_id,
    accounts.welcome_credits_eligible, accounts.welcome_credits_granted_at
    FROM api_keys JOIN accounts ON accounts.hanko_user_id = api_keys.hanko_user_id
    WHERE api_keys.key_hash = ? AND api_keys.revoked_at IS NULL`)
    .bind(keyHash).first<{
      id: string;
      hanko_user_id: string;
      welcome_credits_eligible: number;
      welcome_credits_granted_at: number | null;
    }>();
  return row ? {
    userId: row.hanko_user_id,
    keyId: row.id,
    welcomeCreditsPending: row.welcome_credits_eligible === 1 && row.welcome_credits_granted_at === null,
  } : null;
}

export async function listApiKeys(db: D1Database, userId: string) {
  const result = await db.prepare(`SELECT id, key_hint, name, created_at
    FROM api_keys WHERE hanko_user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`).bind(userId).all();
  return result.results;
}

export async function createApiKey(db: D1Database, userId: string, name: string) {
  await ensureAccount(db, userId);
  const existing = await db.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE hanko_user_id = ? AND revoked_at IS NULL')
    .bind(userId).first<{ count: number }>();
  if ((existing?.count ?? 0) >= MAX_ACTIVE_API_KEYS) throw new Error('You can have at most two active API keys.');
  const apiKey = generateApiKey();
  const keyHash = await hashApiKey(apiKey);
  const keyHint = `${apiKey.slice(0, 13)}…${apiKey.slice(-4)}`;
  const id = randomId('key_');
  await db.prepare(`INSERT INTO api_keys (id, hanko_user_id, key_hash, key_hint, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(id, userId, keyHash, keyHint, name.slice(0, 50), Date.now()).run();
  return { id, apiKey, keyHint, name: name.slice(0, 50) };
}

export async function revokeApiKey(db: D1Database, userId: string, keyId: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE api_keys SET revoked_at = ?
    WHERE id = ? AND hanko_user_id = ? AND revoked_at IS NULL`).bind(Date.now(), keyId, userId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function recentLedger(db: D1Database, userId: string, limit = 20) {
  const result = await db.prepare(`SELECT id, kind, credits, amount_cents, description, occurred_at
    FROM billing_ledger WHERE hanko_user_id = ? ORDER BY occurred_at DESC LIMIT ?`).bind(userId, limit).all();
  return result.results;
}

export async function getAutoTopUp(db: D1Database, userId: string): Promise<AutoTopUpRecord | null> {
  return db.prepare(`SELECT hanko_user_id, enabled, trigger_credits, amount_cents,
    monthly_limit_cents, status, failure_count, next_retry_at, updated_at
    FROM auto_topup_settings WHERE hanko_user_id = ?`).bind(userId).first<AutoTopUpRecord>();
}

export async function getDashboardData(
  db: D1Database,
  userId: string,
  autoTopUpPeriod: string,
): Promise<DashboardData> {
  const [apiKeys, ledger, autoTopUp, autoTopUpSpent] = await db.batch([
    db.prepare(`SELECT id, key_hint, name, created_at
      FROM api_keys WHERE hanko_user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`).bind(userId),
    db.prepare(`SELECT id, kind, credits, amount_cents, description, occurred_at
      FROM billing_ledger WHERE hanko_user_id = ? ORDER BY occurred_at DESC LIMIT 20`).bind(userId),
    db.prepare(`SELECT hanko_user_id, enabled, trigger_credits, amount_cents,
      monthly_limit_cents, status, failure_count, next_retry_at, updated_at
      FROM auto_topup_settings WHERE hanko_user_id = ?`).bind(userId),
    db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM auto_topup_attempts
      WHERE hanko_user_id = ? AND period = ? AND status = 'paid'`).bind(userId, autoTopUpPeriod),
  ]);

  return {
    apiKeys: apiKeys.results as DashboardData['apiKeys'],
    ledger: ledger.results as DashboardData['ledger'],
    autoTopUp: (autoTopUp.results[0] as unknown as AutoTopUpRecord | undefined) ?? null,
    autoTopUpSpentCents: Number((autoTopUpSpent.results[0] as { cents?: number } | undefined)?.cents ?? 0),
  };
}
