import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { HistoryStore } from '../../src/main/services/history';
import type { AgentStatus, Session } from '../../src/shared/types';

const MIN = 60e3;
const T0 = new Date(2026, 10, 5, 9, 0).getTime(); // local 09:00, so +hours stay on the same day

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'ark-hist-')), 'history.jsonl');
  const clock = { t: T0 };
  return { file, clock, store: new HistoryStore(file, () => clock.t) };
}
const agent = (fiveHour: number, weekly = 30): AgentStatus => ({
  id: 'claude', installed: true,
  fiveHour: { usedPct: fiveHour, resetsAt: 0, minutes: 300 },
  weekly: { usedPct: weekly, resetsAt: 0, minutes: 10080 },
});
const session = (contextPct: number): Session => ({ id: 's1', agent: 'claude', project: 'ark', cwd: 'x', contextPct, lastSeen: 0 });
const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('throttles and dedupes against the last written line', () => {
  const { file, clock, store } = setup();
  store.recordAgent(agent(62));
  clock.t = T0 + 1 * MIN; store.recordAgent(agent(63)); // changed, but inside 5 min: dropped
  clock.t = T0 + 6 * MIN; store.recordAgent(agent(63)); // differs from last written (62): written
  clock.t = T0 + 7 * MIN; store.recordAgent(agent(64)); // inside 5 min of the last write: dropped
  clock.t = T0 + 20 * MIN; store.recordAgent(agent(63)); // same as last written: not repeated
  expect(lines(file).map((l) => l.fiveHourPct)).toEqual([62, 63]);
});

test('days aggregates', () => {
  const { clock, store } = setup();
  [[40, 30], [70, 31], [55, 33]].forEach(([fh, wk], i) => {
    clock.t = T0 + i * 10 * MIN;
    store.recordAgent(agent(fh, wk));
  });
  [20, 48, 35].forEach((pct, i) => {
    clock.t = T0 + i * 10 * MIN;
    store.recordSession(session(pct));
  });
  expect(store.days()).toEqual([
    { day: '2026-11-05', agent: 'claude', peakFiveHourPct: 70, weeklyEndPct: 33, sessions: [{ id: 's1', project: 'ark', peakContextPct: 48 }] },
  ]);
});

test('records the reading time, not now', () => {
  const { store } = setup();
  store.recordSession(session(70), T0 - 2 * 86400e3); // a session file ingested at startup, 2 days old
  expect(store.days().map((d) => d.day)).toEqual(['2026-11-03']);
});

test('prune drops lines older than 30 days', () => {
  const { file, store } = setup();
  writeFileSync(file, [
    JSON.stringify({ kind: 'agent', t: T0 - 31 * 86400e3, agent: 'claude', fiveHourPct: 1 }),
    JSON.stringify({ kind: 'agent', t: T0 - 29 * 86400e3, agent: 'claude', fiveHourPct: 2 }),
  ].join('\n') + '\n');
  store.prune();
  expect(lines(file).map((l) => l.fiveHourPct)).toEqual([2]);
});

test('ignores corrupt lines', () => {
  const { file, store } = setup();
  store.recordAgent(agent(50));
  appendFileSync(file, 'garbage{\n');
  expect(store.days()[0].peakFiveHourPct).toBe(50);
});
