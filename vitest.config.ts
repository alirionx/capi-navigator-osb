import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/capi/schema.generated.ts'],
      // NF-03: at least 80 % of the lines of the request handling.
      thresholds: { lines: 80 },
    },
  },
});
