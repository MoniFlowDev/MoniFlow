import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so `dist/` can be opened from disk or served from any subpath.
  base: './',
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  server: { port: 8765, open: false },
  // Most tests are pure logic; the UI smoke test opts into jsdom with a file-level pragma.
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
