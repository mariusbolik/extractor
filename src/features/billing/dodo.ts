import DodoPayments from 'dodopayments';
import type { CheckoutSessionCreateParams } from 'dodopayments/resources/checkout-sessions';
import { creditsForAmount } from './constants';
import { randomId } from './crypto';
import { ensureAccount } from './d1';

export type DodoEnvironment = 'live_mode' | 'test_mode';

export function dodoEnvironment(value: string | null | undefined): DodoEnvironment {
  return value === 'test_mode' ? 'test_mode' : 'live_mode';
}

export function dodoClient(
  apiKey: string,
  environment: DodoEnvironment,
  webhookKey?: string,
  maxRetries = 1,
): DodoPayments {
  return new DodoPayments({
    bearerToken: apiKey,
    environment,
    webhookKey: webhookKey ?? null,
    maxRetries,
  });
}

const CHECKOUT_FEATURES = {
  allow_currency_selection: false,
  allow_discount_code: false,
  redirect_immediately: true,
} as const;

export function buildDodoCheckoutRequest(input: {
  userId: string;
  customerId?: string | null;
  amountCents: number;
  origin: string;
  productId: string;
  intentId: string;
}): CheckoutSessionCreateParams {
  const credits = creditsForAmount(input.amountCents);
  return {
    product_cart: [{ product_id: input.productId, quantity: 1, amount: input.amountCents }],
    ...(input.customerId ? { customer: { customer_id: input.customerId } } : {}),
    metadata: {
      hanko_user_id: input.userId,
      checkout_intent_id: input.intentId,
      amount_cents: input.amountCents,
      credits,
      funding_kind: 'top_up',
    },
    customization: { theme: 'light' },
    feature_flags: CHECKOUT_FEATURES,
    return_url: `${input.origin}/dashboard/?checkout=success`,
    cancel_url: `${input.origin}/dashboard/#add-credits`,
  };
}

export function buildDodoAuthorizationRequest(input: {
  userId: string;
  customerId?: string | null;
  origin: string;
  productId: string;
  authorizationId: string;
}): CheckoutSessionCreateParams {
  return {
    product_cart: [{ product_id: input.productId, quantity: 1 }],
    ...(input.customerId ? { customer: { customer_id: input.customerId } } : {}),
    metadata: {
      hanko_user_id: input.userId,
      auto_topup_authorization_id: input.authorizationId,
      funding_kind: 'auto_top_up_authorization',
    },
    subscription_data: { on_demand: { mandate_only: true } },
    customization: { theme: 'light', show_on_demand_tag: true },
    feature_flags: CHECKOUT_FEATURES,
    return_url: `${input.origin}/dashboard/?auto_top_up=authorized`,
    cancel_url: `${input.origin}/dashboard/#automatic-funding`,
  };
}

export async function createDodoCheckout(input: {
  db: D1Database;
  apiKey: string;
  environment: DodoEnvironment;
  userId: string;
  amountCents: number;
  origin: string;
  productId: string;
}): Promise<{ id: string; url: string }> {
  const account = await ensureAccount(input.db, input.userId);
  const credits = creditsForAmount(input.amountCents);
  const intentId = randomId('checkout_');
  const now = Date.now();

  await input.db.prepare(`INSERT INTO checkout_intents
    (id, hanko_user_id, mode, amount_cents, credits, status, funding_kind, created_at, updated_at)
    VALUES (?, ?, 'payment', ?, ?, 'creating', 'top_up', ?, ?)`).bind(
    intentId,
    input.userId,
    input.amountCents,
    credits,
    now,
    now,
  ).run();

  try {
    const checkout = await dodoClient(input.apiKey, input.environment).checkoutSessions.create(
      buildDodoCheckoutRequest({
        userId: input.userId,
        customerId: account.dodo_customer_id,
        amountCents: input.amountCents,
        origin: input.origin,
        productId: input.productId,
        intentId,
      }),
    );
    if (!checkout.checkout_url) throw new Error('Dodo checkout did not return a hosted URL.');
    await input.db.prepare(`UPDATE checkout_intents
      SET dodo_checkout_id = ?, status = 'open', updated_at = ? WHERE id = ?`)
      .bind(checkout.session_id, Date.now(), intentId).run();
    return { id: checkout.session_id, url: checkout.checkout_url };
  } catch (error) {
    await input.db.prepare(`UPDATE checkout_intents SET status = 'failed', updated_at = ? WHERE id = ?`)
      .bind(Date.now(), intentId).run();
    throw error;
  }
}

export async function createDodoAutoTopUpAuthorization(input: {
  db: D1Database;
  apiKey: string;
  environment: DodoEnvironment;
  userId: string;
  origin: string;
  productId: string;
}): Promise<{ id: string; url: string }> {
  const account = await ensureAccount(input.db, input.userId);
  const authorizationId = randomId('auto_auth_');
  const now = Date.now();
  await input.db.prepare(`INSERT INTO auto_topup_authorizations
    (id, hanko_user_id, status, created_at, updated_at) VALUES (?, ?, 'creating', ?, ?)`)
    .bind(authorizationId, input.userId, now, now).run();
  try {
    const checkout = await dodoClient(input.apiKey, input.environment).checkoutSessions.create(
      buildDodoAuthorizationRequest({
        userId: input.userId,
        customerId: account.dodo_customer_id,
        origin: input.origin,
        productId: input.productId,
        authorizationId,
      }),
    );
    if (!checkout.checkout_url) throw new Error('Dodo authorization did not return a hosted URL.');
    await input.db.prepare(`UPDATE auto_topup_authorizations
      SET dodo_checkout_id = ?, status = 'open', updated_at = ? WHERE id = ?`)
      .bind(checkout.session_id, Date.now(), authorizationId).run();
    return { id: checkout.session_id, url: checkout.checkout_url };
  } catch (error) {
    await input.db.prepare(`UPDATE auto_topup_authorizations SET status = 'failed', updated_at = ? WHERE id = ?`)
      .bind(Date.now(), authorizationId).run();
    throw error;
  }
}

export async function dodoCustomerEmail(
  apiKey: string,
  environment: DodoEnvironment,
  customerId: string,
): Promise<string> {
  const customer = await dodoClient(apiKey, environment).customers.retrieve(customerId);
  if (!customer.email) throw new Error('Dodo customer has no billing email.');
  return customer.email;
}
