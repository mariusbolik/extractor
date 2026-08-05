PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  hanko_user_id TEXT PRIMARY KEY,
  dodo_customer_id TEXT,
  dodo_subscription_id TEXT,
  dodo_subscription_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_dodo_customer
  ON accounts(dodo_customer_id) WHERE dodo_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_dodo_subscription
  ON accounts(dodo_subscription_id) WHERE dodo_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  hanko_user_id TEXT NOT NULL REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_keys_active_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys(hanko_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkout_intents (
  id TEXT PRIMARY KEY,
  hanko_user_id TEXT NOT NULL REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  dodo_checkout_id TEXT,
  dodo_payment_id TEXT,
  mode TEXT NOT NULL CHECK (mode = 'payment'),
  amount_cents INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL,
  funding_kind TEXT NOT NULL DEFAULT 'top_up',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_dodo_checkout
  ON checkout_intents(dodo_checkout_id) WHERE dodo_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_dodo_payment
  ON checkout_intents(dodo_payment_id) WHERE dodo_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_ledger (
  id TEXT PRIMARY KEY,
  hanko_user_id TEXT NOT NULL REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount_cents INTEGER,
  payment_ref TEXT,
  external_ref TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_ledger_account ON billing_ledger(hanko_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS billing_ledger_payment ON billing_ledger(payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS usage_alerts (
  id TEXT PRIMARY KEY,
  hanko_user_id TEXT NOT NULL REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  percent INTEGER NOT NULL CHECK (percent IN (80, 90, 100)),
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS usage_alerts_account ON usage_alerts(hanko_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_reversals (
  payment_ref TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('refund', 'dispute')),
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dodo_webhook_events (
  dodo_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS auto_topup_settings (
  hanko_user_id TEXT PRIMARY KEY REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  trigger_credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  monthly_limit_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_topup_authorizations (
  id TEXT PRIMARY KEY,
  hanko_user_id TEXT NOT NULL REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  dodo_checkout_id TEXT UNIQUE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auto_topup_authorizations_account
  ON auto_topup_authorizations(hanko_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auto_topup_attempts (
  id TEXT PRIMARY KEY,
  hanko_user_id TEXT NOT NULL REFERENCES accounts(hanko_user_id) ON DELETE CASCADE,
  dodo_subscription_id TEXT NOT NULL,
  dodo_payment_id TEXT UNIQUE,
  period TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auto_topup_attempts_account
  ON auto_topup_attempts(hanko_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auto_topup_attempts_status
  ON auto_topup_attempts(status, updated_at);

CREATE TABLE IF NOT EXISTS payment_reversal_state (
  payment_ref TEXT PRIMARY KEY,
  refund_final INTEGER NOT NULL DEFAULT 0 CHECK (refund_final IN (0, 1)),
  dispute_active INTEGER NOT NULL DEFAULT 0 CHECK (dispute_active IN (0, 1)),
  last_dispute_at INTEGER,
  updated_at INTEGER NOT NULL
);
