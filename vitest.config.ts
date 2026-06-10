import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    hookTimeout: 300_000,
    include: [
      'server/**/*.test.ts',
      'public/**/*.test.ts',
      'shared/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.ts'],
      exclude: ['server/index.ts', '**/*.test.ts'],
    },
  },
});
