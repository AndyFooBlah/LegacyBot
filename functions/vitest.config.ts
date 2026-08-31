import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run the TypeScript sources. `tsc` (npm run build) emits compiled
    // copies of these tests into lib/, and the deploy flow builds before it
    // does anything — without this exclude, vitest would also pick up the
    // CommonJS lib/**/*.test.js copies and fail to import vitest itself.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'lib/**'],
  },
});
