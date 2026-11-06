import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/live/**', 'node_modules/**'], environment: 'node', passWithNoTests: true },
});
