import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // The first run downloads a mongod binary for mongodb-memory-server.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/shared/index.ts',
        'src/db/migrate-cli.ts',
        'src/jobs/cli.ts',
        'src/admin/bootstrap-cli.ts',
        'src/server.ts',
      ],
      // NFR-M3: at least 80% for the API and its copy of the shared code.
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
