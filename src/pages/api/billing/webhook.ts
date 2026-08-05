import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { DODOPAYMENTS_ENVIRONMENT, getSecret } from 'astro:env/server';
import { dodoEnvironment } from '../../../features/billing/dodo';
import { processDodoWebhook } from '../../../features/billing/webhook';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const apiKey = getSecret('DODOPAYMENTS_API_KEY');
  const businessId = getSecret('DODOPAYMENTS_BUSINESS_ID');
  const webhookKey = getSecret('DODOPAYMENTS_WEBHOOK_KEY');
  if (!apiKey || !businessId || !webhookKey) {
    return Response.json({ error: 'Webhook is not configured.' }, { status: 503 });
  }
  return processDodoWebhook({
    request,
    db: env.DB,
    env,
    apiKey,
    businessId,
    environment: dodoEnvironment(DODOPAYMENTS_ENVIRONMENT),
    webhookKey,
  });
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
