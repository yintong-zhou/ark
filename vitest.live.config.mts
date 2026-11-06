import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Live gate: hits the real Claude Code and Codex CLIs. Run only through `npm run test:live`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['tests/live/**/*.test.ts'], environment: 'node', testTimeout: 180000, reporters: ['verbose'] },
});
