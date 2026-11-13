import { expect, test } from 'vitest';
import { estimateUsd, formatUsd } from '@shared/pricing';

test('Claude: cache reads come out of input and price at the hit rate; the rest prices as plain input', () => {
  // Opus 5.5: $4 input, $0.20 cache hit, $20 output per MTok. 1M input of which 600k cached, 100k output.
  expect(estimateUsd('claude-opus-5-5', { input: 1_000_000, cached: 600_000, output: 100_000 })).toBeCloseTo(
    0.4 * 4 + 0.6 * 0.2 + 0.1 * 20,
    10,
  );
});

test('Codex: cached input is a part of input, not added to it', () => {
  // gpt-6.1-terra: $1 input, $0.05 cached, $5 output per MTok.
  expect(estimateUsd('gpt-6.1-terra', { input: 2_000_000, cached: 2_000_000, output: 0 })).toBeCloseTo(0.1, 10);
  expect(estimateUsd('gpt-6.1-terra', { input: 2_000_000, cached: 0, output: 1_000_000 })).toBeCloseTo(7, 10);
});

test('dated and [1m] Claude ids price as their base model', () => {
  const t = { input: 1_000_000, cached: 0, output: 0 };
  expect(estimateUsd('claude-haiku-4-5-20251001', t)).toBeCloseTo(1, 10);
  expect(estimateUsd('claude-opus-4-6[1m]', t)).toBeCloseTo(5, 10);
});

test('no estimate when the price cannot be worked out from summed tokens: unknown, prompt-length tiered or promotional', () => {
  const t = { input: 10, cached: 0, output: 10 };
  for (const m of ['claude-haiku-5-5', 'gpt-5.6-sol', 'codex-auto-review', 'gpt-reserve', 'some-local-model', ''])
    expect(estimateUsd(m, t)).toBeUndefined();
});

test('nonsense counts never make a negative or inflated price', () => {
  // More cached than input: the cached part is capped at input instead of going negative on the plain part.
  expect(estimateUsd('claude-opus-5-5', { input: 1_000_000, cached: 3_000_000, output: 0 })).toBeCloseTo(0.2, 10);
  expect(estimateUsd('claude-opus-5-5', { input: -5, cached: -5, output: -5 })).toBe(0);
  expect(estimateUsd('claude-opus-5-5', { input: 0, cached: 0, output: 0 })).toBe(0);
});

test('formatUsd keeps sub-cent amounts readable', () => {
  expect(formatUsd(0)).toBe('$0.00');
  expect(formatUsd(1234.567)).toBe('$1,234.57');
  expect(formatUsd(0.0042)).toBe('$0.0042');
  expect(formatUsd(0.000_000_15)).toBe('$0.00000015');
});
