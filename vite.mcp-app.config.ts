import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  publicDir: false,
  root: fileURLToPath(new URL('./src/features/mcp/apps/finance-chart', import.meta.url)),
  plugins: [viteSingleFile()],
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('./src/features/mcp/apps/generated', import.meta.url)),
    rollupOptions: {
      input: fileURLToPath(new URL('./src/features/mcp/apps/finance-chart/index.html', import.meta.url)),
    },
  },
});
