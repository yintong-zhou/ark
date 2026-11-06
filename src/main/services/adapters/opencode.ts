import { detect } from '../exec';
import type { Adapter } from './types';

// ponytail: detection only; the `opencode serve` adapter comes once OpenCode is installed and testable (spec §5.3).
export function createOpencodeAdapter(): Adapter {
  return {
    id: 'opencode',
    detect: () => detect('opencode'),
    account: async () => undefined,
    refresh: async () => [],
    start: async () => {},
    stop: () => {},
  };
}
