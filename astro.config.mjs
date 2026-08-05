import { defineConfig, envField, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://extractor.sh',
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  env: {
    schema: {
      HANKO_AUTH_DOMAIN: envField.string({
        context: 'client',
        access: 'public',
        default: 'https://auth.extractor.sh',
      }),
      DODOPAYMENTS_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_BUSINESS_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_WEBHOOK_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_ONE_TIME_PRODUCT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_ON_DEMAND_PRODUCT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_ENVIRONMENT: envField.enum({
        context: 'server', access: 'secret', values: ['live_mode', 'test_mode'], default: 'live_mode',
      }),
      TURNSTILE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      TURNSTILE_SITE_KEY: envField.string({ context: 'server', access: 'public', optional: true }),
      ANONYMOUS_QUOTA_HMAC_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      LLMBASE_SERVICE_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      BILLING_ENABLED: envField.boolean({ context: 'server', access: 'public', default: false }),
    },
  },
  integrations: [icon()],
  session: {
    // extractor.sh has no user sessions; this prevents automatic KV provisioning.
    driver: sessionDrivers.lruCache({ max: 1 }),
  },
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['react-tweet'],
    },
  },
});
