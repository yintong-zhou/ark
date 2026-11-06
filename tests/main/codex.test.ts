import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { createCodexAdapter, parseRollout } from '../../src/main/services/adapters/codex';
import { parseAccountResult, parseRateLimitsResult } from '../../src/main/services/adapters/codex-appserver';

const lines = readFileSync(join(__dirname, '../fixtures/codex-rollout.jsonl'), 'utf8').split('\n').filter(Boolean);
const SEEN = 1_793_878_800_000;
const expected = {
  id: '01a1', agent: 'codex', project: 'proj', cwd: 'D:\\ICPN\\proj', model: 'gpt-5.6-sol',
  contextSize: 258400, contextUsed: 108875, tokens: 1116235, contextPct: 39, lastSeen: SEEN,
};
const expectedWindows = [
  { usedPct: 48, resetsAt: 1793714251, minutes: 300 },
  { usedPct: 16, resetsAt: 1793988408, minutes: 10080 },
];

test('parses rollout', () => {
  const r = parseRollout(lines.slice(0, 3), SEEN);
  expect(r.session).toEqual(expected);
  expect(r.windows).toEqual(expectedWindows);
});

test('skips truncated line', () => {
  const r = parseRollout(lines, SEEN); // 4th line is cut mid-write
  expect(r.session).toEqual(expected);
  expect(r.windows).toEqual(expectedWindows);
});

test('parseRateLimitsResult picks windows by duration', () => {
  const w = parseRateLimitsResult({
    rateLimits: {
      primary: { usedPercent: 71, windowDurationMins: 10080, resetsAt: 1794000000 },
      secondary: { usedPercent: 21, windowDurationMins: 300, resetsAt: 1793890000 },
      planType: 'team',
    },
  });
  expect(w).toEqual([
    { usedPct: 71, resetsAt: 1794000000, minutes: 10080 },
    { usedPct: 21, resetsAt: 1793890000, minutes: 300 },
  ]);
  expect(parseRateLimitsResult(undefined)).toEqual([]);
});

test('parseAccountResult', () => {
  expect(parseAccountResult({ account: { type: 'chatgpt', email: 'dev@example.com', planType: 'team' } })).toEqual({
    loggedIn: true, method: 'subscription', email: 'dev@example.com', plan: 'team',
  });
  expect(parseAccountResult({ account: { type: 'apiKey' } })).toMatchObject({ loggedIn: true, method: 'apiKey' });
  expect(parseAccountResult({ account: null })).toMatchObject({ loggedIn: false });
});

test('adapter emits on append', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ark-codex-'));
  const d = new Date();
  const day = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-x.jsonl');
  writeFileSync(file, lines.slice(0, 2).join('\n') + '\n');

  const adapter = createCodexAdapter({ sessionsDir: root, pollMs: 50 });
  const emit = vi.fn();
  await adapter.start(emit);
  appendFileSync(file, lines[2] + '\n');
  await new Promise((r) => setTimeout(r, 300));
  adapter.stop();

  expect(emit.mock.calls.some(([u]) => u.session?.contextPct === 39)).toBe(true);
});
