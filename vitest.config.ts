import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Workspace packages are separate Vite roots by default. Keep one root
    // command that exercises both the Cloudflare integration and core logic.
    include: [
      'src/**/*.test.ts',
      'packages/**/*.test.ts',
    ],
    // Vitest has no built-in `bun` environment. Bun remains the command
    // runner; `node` selects the server-side globals used by these tests.
    environment: 'node',
  },
});
