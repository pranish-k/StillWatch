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
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      'apps/web',
    ],
  },
});
