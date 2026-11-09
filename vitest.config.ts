import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
            'apps/cli/src/**/*.test.ts',
            'apps/cli/test/**/*.test.ts',
            'apps/collector/src/**/*.test.ts',
            'apps/collector/test/**/*.test.ts',
            'lab/src/**/*.test.ts',
            'lab/test/**/*.test.ts',
          ],
          // Wall-clock budgets run alone in the perf project (see package.json "test").
          exclude: ['**/*.perf.test.ts', '**/node_modules/**'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'perf',
          environment: 'node',
          include: ['packages/*/test/**/*.perf.test.ts', 'apps/*/test/**/*.perf.test.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
      'apps/web',
    ],
  },
});
