import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  // Path routing needs absolute assets when opening a nested route directly.
  base: '/',
  resolve: { conditions: ['browser'] },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  server: { port: 8765, open: false },
  // Most tests are pure logic; the UI smoke test opts into jsdom with a file-level pragma.
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
