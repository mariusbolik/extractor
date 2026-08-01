import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://extractor.mcb-software.workers.dev',
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
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
