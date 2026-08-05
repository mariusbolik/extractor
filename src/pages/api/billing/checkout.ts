import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { BILLING_ENABLED, DODOPAYMENTS_ENVIRONMENT, getSecret } from 'astro:env/server';
import { creditsForAmount, isValidPurchaseAmount } from '../../../features/billing/constants';
import { requireSameOrigin, validateHankoSession } from '../../../features/billing/hanko';
import { createDodoCheckout, dodoEnvironment } from '../../../features/billing/dodo';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!requireSameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  const session = await validateHankoSession(request);
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const apiKey = getSecret('DODOPAYMENTS_API_KEY');
  const businessId = getSecret('DODOPAYMENTS_BUSINESS_ID');
  const webhookKey = getSecret('DODOPAYMENTS_WEBHOOK_KEY');
  const oneTimeProductId = getSecret('DODOPAYMENTS_ONE_TIME_PRODUCT_ID');
  if (!BILLING_ENABLED || !apiKey || !businessId || !webhookKey || !oneTimeProductId || !env.DB || !env.ACCOUNT_CREDITS) {
    return Response.json({ error: 'Billing is not ready.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const body = await request.json<{ amountCents?: unknown }>();
  if (!isValidPurchaseAmount(body.amountCents)) {
    return Response.json({ error: 'Amount must be from $10.00 to $4,900.00 in cent increments.' }, { status: 400 });
  }
  try {
    const checkout = await createDodoCheckout({
      db: env.DB,
      apiKey,
      environment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
      userId: session.userId,
      amountCents: body.amountCents,
      origin: new URL(request.url).origin,
      productId: oneTimeProductId,
    });
    return Response.json({ ...checkout, credits: creditsForAmount(body.amountCents) }, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('Dodo checkout creation failed', error);
    return Response.json({ error: 'Checkout could not be created.' }, { status: 502 });
  }
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
