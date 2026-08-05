import { defineConfig, envField } from 'astro/config';
import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The Cloudflare adapter currently fails to load .astro page modules in its
// workerd development runner. Keep the visual development server on Astro's
// native runtime; builds and deployments still use astro.config.mjs.
export default defineConfig({
  site: 'https://extractor.sh',
  output: 'server',
  env: {
    schema: {
      HANKO_AUTH_DOMAIN: envField.string({ context: 'client', access: 'public', default: 'https://auth.extractor.sh' }),
      DODOPAYMENTS_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_BUSINESS_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_WEBHOOK_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_ONE_TIME_PRODUCT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_ON_DEMAND_PRODUCT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      DODOPAYMENTS_ENVIRONMENT: envField.enum({
        context: 'server', access: 'secret', values: ['live_mode', 'test_mode'], default: 'test_mode',
      }),
      TURNSTILE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      TURNSTILE_SITE_KEY: envField.string({ context: 'server', access: 'public', optional: true }),
      ANONYMOUS_QUOTA_HMAC_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      BILLING_ENABLED: envField.boolean({ context: 'server', access: 'public', default: false }),
    },
  },
  integrations: [icon()],
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // Native Astro does not provide the Cloudflare virtual module. The shim
      // keeps cheap GET extraction usable during visual development.
      alias: {
        'cloudflare:workers': fileURLToPath(new URL('./src/dev/cloudflare-workers.ts', import.meta.url)),
      },
    },
    ssr: {
      noExternal: ['react-tweet'],
    },
  },
});
