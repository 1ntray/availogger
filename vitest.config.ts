import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.{ts,mjs}'], hookTimeout: 30_000, testTimeout: 15_000, maxWorkers: 4 },
});
