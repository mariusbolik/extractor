import { DurableObject } from 'cloudflare:workers';
import {
  ANONYMOUS_DAILY_LIMIT,
  RESERVATION_TTL_MS,
} from './constants';

type JsonObject = Record<string, unknown>;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  for (const row of cursor) return row;
  return undefined;
}

export class AccountCredits extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS account_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        balance INTEGER NOT NULL DEFAULT 0,
        cycle_key TEXT,
        cycle_grant INTEGER NOT NULL DEFAULT 0,
        cycle_used INTEGER NOT NULL DEFAULT 0,
        cycle_started_at INTEGER,
        cycle_ends_at INTEGER,
        alert_basis INTEGER NOT NULL DEFAULT 0,
        alert_stage INTEGER NOT NULL DEFAULT 0,
        alert_epoch INTEGER NOT NULL DEFAULT 0,
        free_period TEXT,
        free_used INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO account_state (singleton, balance) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        meter_kind TEXT NOT NULL DEFAULT 'paid',
        quota_period TEXT
      );
      CREATE INDEX IF NOT EXISTS reservations_stale ON reservations(state, created_at);
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        credits INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auto_funding_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        period TEXT,
        spent_cents INTEGER NOT NULL DEFAULT 0,
        pending_id TEXT,
        pending_amount_cents INTEGER NOT NULL DEFAULT 0,
        pending_created_at INTEGER
      );
      INSERT OR IGNORE INTO auto_funding_state (singleton) VALUES (1);
    `);
    // Existing objects were created before usage alerts. Durable Object SQL
    // does not support ADD COLUMN IF NOT EXISTS, so migrate each column once.
    for (const statement of [
      'ALTER TABLE account_state ADD COLUMN alert_basis INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE account_state ADD COLUMN alert_stage INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE account_state ADD COLUMN alert_epoch INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE account_state ADD COLUMN free_period TEXT',
      'ALTER TABLE account_state ADD COLUMN free_used INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE reservations ADD COLUMN meter_kind TEXT NOT NULL DEFAULT 'paid'",
      'ALTER TABLE reservations ADD COLUMN quota_period TEXT',
    ]) {
      try { this.ctx.storage.sql.exec(statement); } catch { /* column already exists */ }
    }
  }

  private cleanupStale(now: number): number {
    const stalePaid = firstRow(this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM reservations
      WHERE state = 'reserved' AND meter_kind = 'paid' AND created_at < ?`,
      now - RESERVATION_TTL_MS,
    ))?.count ?? 0;
    const staleAll = firstRow(this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM reservations WHERE state = 'reserved' AND created_at < ?`,
      now - RESERVATION_TTL_MS,
    ))?.count ?? 0;
    if (stalePaid > 0) {
      this.ctx.storage.sql.exec('UPDATE account_state SET balance = balance + ? WHERE singleton = 1', stalePaid);
    }
    if (staleAll > 0) {
      this.ctx.storage.sql.exec(
        `UPDATE reservations SET state = 'stale_refunded', completed_at = ? WHERE state = 'reserved' AND created_at < ?`,
        now,
        now - RESERVATION_TTL_MS,
      );
    }
    return staleAll;
  }

  private snapshot() {
    const state = firstRow(this.ctx.storage.sql.exec<{
      balance: number;
      cycle_key: string | null;
      cycle_grant: number;
      cycle_used: number;
      cycle_started_at: number | null;
      cycle_ends_at: number | null;
    }>(`SELECT balance, cycle_key, cycle_grant, cycle_used, cycle_started_at, cycle_ends_at
      FROM account_state WHERE singleton = 1`))!;
    const usage30Days = firstRow(this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM reservations WHERE state = 'committed' AND completed_at >= ?`,
      Date.now() - 30 * 24 * 60 * 60 * 1_000,
    ))?.count ?? 0;
    return {
      balance: state.balance,
      usage30Days,
      cycle: state.cycle_key ? {
        key: state.cycle_key,
        grant: state.cycle_grant,
        used: state.cycle_used,
        startedAt: state.cycle_started_at,
        endsAt: state.cycle_ends_at,
      } : null,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    if (request.method === 'GET' && url.pathname === '/snapshot') {
      this.cleanupStale(now);
      return json(this.snapshot());
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const body = await request.json<JsonObject>();
    this.cleanupStale(now);

    if (url.pathname === '/reserve') {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'invalid_reservation' }, 400);
      const existing = firstRow(this.ctx.storage.sql.exec<{ state: string; meter_kind: 'paid' }>(
        'SELECT state, meter_kind FROM reservations WHERE id = ?',
        id,
      ));
      if (existing) return json({ ok: existing.state === 'reserved', meterKind: existing.meter_kind, ...this.snapshot() });
      const state = firstRow(this.ctx.storage.sql.exec<{ balance: number }>(
        'SELECT balance FROM account_state WHERE singleton = 1',
      ))!;
      if (state.balance < 1) return json({ ok: false, reason: 'insufficient_credits', ...this.snapshot() }, 402);
      this.ctx.storage.sql.exec('UPDATE account_state SET balance = balance - 1 WHERE singleton = 1');
      this.ctx.storage.sql.exec(
        `INSERT INTO reservations (id, state, created_at, meter_kind, quota_period)
        VALUES (?, 'reserved', ?, 'paid', ?)`,
        id,
        now,
        null,
      );
      return json({ ok: true, reservationId: id, meterKind: 'paid', ...this.snapshot() });
    }

    if (url.pathname === '/commit' || url.pathname === '/refund') {
      const id = String(body.id ?? '');
      const reservation = firstRow(this.ctx.storage.sql.exec<{
        state: string;
        meter_kind: 'paid';
      }>('SELECT state, meter_kind FROM reservations WHERE id = ?', id));
      if (!reservation) return json({ ok: false, reason: 'unknown_reservation', ...this.snapshot() }, 404);
      if (reservation.state !== 'reserved') {
        return json({ ok: true, idempotent: true, meterKind: reservation.meter_kind, ...this.snapshot() });
      }
      if (url.pathname === '/commit') {
        this.ctx.storage.sql.exec(`UPDATE reservations SET state = 'committed', completed_at = ? WHERE id = ?`, now, id);
        if (reservation.meter_kind === 'paid') {
          this.ctx.storage.sql.exec(`UPDATE account_state SET cycle_used = CASE
            WHEN cycle_key IS NOT NULL AND (cycle_started_at IS NULL OR cycle_started_at <= ?) AND (cycle_ends_at IS NULL OR cycle_ends_at >= ?)
            THEN cycle_used + 1 ELSE cycle_used END WHERE singleton = 1`, now, now);
          const alert = firstRow(this.ctx.storage.sql.exec<{
            balance: number;
            alert_basis: number;
            alert_stage: number;
            alert_epoch: number;
          }>('SELECT balance, alert_basis, alert_stage, alert_epoch FROM account_state WHERE singleton = 1'))!;
          const used = Math.max(0, alert.alert_basis - alert.balance);
          const alertPercent = alert.alert_basis > 0
            ? ([80, 90, 100] as const).find((threshold) =>
              alert.alert_stage < threshold && used * 100 >= threshold * alert.alert_basis)
            : undefined;
          if (alertPercent) {
            this.ctx.storage.sql.exec('UPDATE account_state SET alert_stage = ? WHERE singleton = 1', alertPercent);
            return json({
              ok: true,
              meterKind: reservation.meter_kind,
              alertPercent,
              alertEpoch: alert.alert_epoch,
              ...this.snapshot(),
            });
          }
        }
      } else {
        this.ctx.storage.sql.exec(`UPDATE reservations SET state = 'refunded', completed_at = ? WHERE id = ?`, now, id);
        if (reservation.meter_kind === 'paid') {
          this.ctx.storage.sql.exec('UPDATE account_state SET balance = balance + 1 WHERE singleton = 1');
        }
      }
      return json({ ok: true, meterKind: reservation.meter_kind, ...this.snapshot() });
    }

    if (url.pathname === '/grant' || url.pathname === '/reverse') {
      const id = String(body.id ?? '');
      const credits = Number(body.credits);
      if (!id || !Number.isSafeInteger(credits) || credits < 1) return json({ error: 'invalid_operation' }, 400);
      const existing = firstRow(this.ctx.storage.sql.exec<{ id: string }>('SELECT id FROM operations WHERE id = ?', id));
      if (existing) return json({ ok: true, idempotent: true, ...this.snapshot() });
      const signedCredits = url.pathname === '/grant' ? credits : -credits;
      this.ctx.storage.sql.exec('INSERT INTO operations (id, kind, credits, created_at) VALUES (?, ?, ?, ?)', id, url.pathname.slice(1), signedCredits, now);
      this.ctx.storage.sql.exec('UPDATE account_state SET balance = balance + ? WHERE singleton = 1', signedCredits);
      if (url.pathname === '/grant') {
        this.ctx.storage.sql.exec(`UPDATE account_state SET
          alert_basis = MAX(balance, 0), alert_stage = 0, alert_epoch = alert_epoch + 1
          WHERE singleton = 1`);
      }
      if (url.pathname === '/grant' && typeof body.cycleKey === 'string' && body.cycleKey) {
        this.ctx.storage.sql.exec(`UPDATE account_state SET cycle_key = ?, cycle_grant = ?, cycle_used = 0,
          cycle_started_at = ?, cycle_ends_at = ? WHERE singleton = 1`,
        body.cycleKey, credits, Number(body.cycleStartedAt) || now, Number(body.cycleEndsAt) || null);
      }
      return json({ ok: true, ...this.snapshot() });
    }

    if (url.pathname === '/auto-top-up/reserve') {
      const id = String(body.id ?? '');
      const fundingPeriod = String(body.fundingPeriod ?? '');
      const amountCents = Number(body.amountCents);
      const monthlyLimitCents = Number(body.monthlyLimitCents);
      const triggerCredits = Number(body.triggerCredits);
      if (!id || !/^\d{4}-(0[1-9]|1[0-2])$/.test(fundingPeriod)
        || !Number.isSafeInteger(amountCents) || amountCents < 1
        || !Number.isSafeInteger(monthlyLimitCents) || monthlyLimitCents < amountCents
        || !Number.isSafeInteger(triggerCredits) || triggerCredits < 0) {
        return json({ error: 'invalid_auto_top_up' }, 400);
      }
      const balance = firstRow(this.ctx.storage.sql.exec<{ balance: number }>(
        'SELECT balance FROM account_state WHERE singleton = 1',
      ))!.balance;
      const funding = firstRow(this.ctx.storage.sql.exec<{
        period: string | null;
        spent_cents: number;
        pending_id: string | null;
        pending_amount_cents: number;
      }>(`SELECT period, spent_cents, pending_id, pending_amount_cents
        FROM auto_funding_state WHERE singleton = 1`))!;
      if (funding.period !== fundingPeriod) {
        this.ctx.storage.sql.exec(`UPDATE auto_funding_state SET period = ?, spent_cents = 0,
          pending_id = NULL, pending_amount_cents = 0, pending_created_at = NULL WHERE singleton = 1`, fundingPeriod);
        funding.period = fundingPeriod;
        funding.spent_cents = 0;
        funding.pending_id = null;
        funding.pending_amount_cents = 0;
      }
      if (funding.pending_id === id) {
        return json({ ok: true, idempotent: true, period: fundingPeriod,
          spentCents: funding.spent_cents, pendingAmountCents: funding.pending_amount_cents, ...this.snapshot() });
      }
      if (funding.pending_id) return json({ ok: false, reason: 'charge_pending', ...this.snapshot() }, 409);
      if (balance > triggerCredits) return json({ ok: false, reason: 'above_trigger', ...this.snapshot() }, 409);
      if (funding.spent_cents + amountCents > monthlyLimitCents) {
        return json({ ok: false, reason: 'monthly_limit', period: fundingPeriod,
          spentCents: funding.spent_cents, ...this.snapshot() }, 409);
      }
      this.ctx.storage.sql.exec(`UPDATE auto_funding_state SET pending_id = ?, pending_amount_cents = ?,
        pending_created_at = ? WHERE singleton = 1`, id, amountCents, now);
      return json({ ok: true, period: fundingPeriod, spentCents: funding.spent_cents,
        pendingAmountCents: amountCents, ...this.snapshot() });
    }

    if (url.pathname === '/auto-top-up/commit' || url.pathname === '/auto-top-up/release') {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'invalid_auto_top_up' }, 400);
      const funding = firstRow(this.ctx.storage.sql.exec<{
        period: string | null;
        spent_cents: number;
        pending_id: string | null;
        pending_amount_cents: number;
      }>(`SELECT period, spent_cents, pending_id, pending_amount_cents
        FROM auto_funding_state WHERE singleton = 1`))!;
      if (!funding.pending_id) {
        return json({ ok: true, idempotent: true, period: funding.period,
          spentCents: funding.spent_cents, ...this.snapshot() });
      }
      if (funding.pending_id !== id) return json({ ok: false, reason: 'different_charge_pending', ...this.snapshot() }, 409);
      if (url.pathname === '/auto-top-up/commit') {
        this.ctx.storage.sql.exec(`UPDATE auto_funding_state SET
          spent_cents = spent_cents + pending_amount_cents,
          pending_id = NULL, pending_amount_cents = 0, pending_created_at = NULL WHERE singleton = 1`);
      } else {
        this.ctx.storage.sql.exec(`UPDATE auto_funding_state SET
          pending_id = NULL, pending_amount_cents = 0, pending_created_at = NULL WHERE singleton = 1`);
      }
      const updated = firstRow(this.ctx.storage.sql.exec<{ period: string | null; spent_cents: number }>(
        'SELECT period, spent_cents FROM auto_funding_state WHERE singleton = 1',
      ))!;
      return json({ ok: true, period: updated.period, spentCents: updated.spent_cents, ...this.snapshot() });
    }

    return json({ error: 'not_found' }, 404);
  }
}

export class AnonymousQuota extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS quota_reservations_state ON reservations(state, created_at);
    `);
    this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.getAlarm() === null) {
        await this.ctx.storage.setAlarm(Date.now() + 2 * 24 * 60 * 60 * 1_000);
      }
    });
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM reservations');
  }

  private cleanup(now: number): void {
    this.ctx.storage.sql.exec(`UPDATE reservations SET state = 'stale_refunded', completed_at = ?
      WHERE state = 'reserved' AND created_at < ?`, now, now - RESERVATION_TTL_MS);
  }

  private used(): number {
    return firstRow(this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM reservations WHERE state IN ('reserved', 'committed')`,
    ))?.count ?? 0;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    this.cleanup(now);
    if (request.method === 'GET' && url.pathname === '/snapshot') {
      const used = this.used();
      return json({ used, remaining: Math.max(0, ANONYMOUS_DAILY_LIMIT - used) });
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const body = await request.json<JsonObject>();
    const id = String(body.id ?? '');
    if (!id) return json({ error: 'invalid_reservation' }, 400);
    const existing = firstRow(this.ctx.storage.sql.exec<{ state: string }>('SELECT state FROM reservations WHERE id = ?', id));

    if (url.pathname === '/reserve') {
      if (existing) {
        const used = this.used();
        return json({ ok: existing.state === 'reserved', remaining: Math.max(0, ANONYMOUS_DAILY_LIMIT - used) });
      }
      const used = this.used();
      if (used >= ANONYMOUS_DAILY_LIMIT) return json({ ok: false, reason: 'daily_quota_exhausted', remaining: 0 }, 429);
      this.ctx.storage.sql.exec(`INSERT INTO reservations (id, state, created_at) VALUES (?, 'reserved', ?)`, id, now);
      return json({ ok: true, reservationId: id, remaining: ANONYMOUS_DAILY_LIMIT - used - 1 });
    }

    if ((url.pathname === '/commit' || url.pathname === '/refund') && existing) {
      if (existing.state === 'reserved') {
        this.ctx.storage.sql.exec('UPDATE reservations SET state = ?, completed_at = ? WHERE id = ?',
          url.pathname === '/commit' ? 'committed' : 'refunded', now, id);
      }
      const used = this.used();
      return json({ ok: true, remaining: Math.max(0, ANONYMOUS_DAILY_LIMIT - used) });
    }
    return json({ ok: false, reason: 'unknown_reservation' }, 404);
  }
}
