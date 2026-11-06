import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { Adapter, AdapterUpdate } from '../../src/main/services/adapters/types';
import { HistoryStore } from '../../src/main/services/history';
import { UsageService } from '../../src/main/services/usage';
import type { Session } from '../../src/shared/types';

const NOW = 1_793_878_800_000;
const S = NOW / 1000;

async function setup() {
  let emit: (u: AdapterUpdate) => void = () => {};
  const adapter: Adapter = {
    id: 'claude',
    detect: async () => ({ installed: true, version: '2.1.318' }),
    account: async () => ({ loggedIn: true, method: 'subscription' }),
    refresh: async () => [],
    start: async (e) => { emit = e; },
    stop: () => {},
  };
  const file = join(mkdtempSync(join(tmpdir(), 'ark-usage-')), 'history.jsonl');
  const service = new UsageService([adapter], new HistoryStore(file, () => NOW), () => NOW);
  await service.start();
  return { service, file, emit: (u: Omit<AdapterUpdate, 'agent'>) => emit({ agent: 'claude', ...u }) };
}
const session = (lastSeen: number, contextPct = 10): Session => ({ id: 's1', agent: 'claude', project: 'ark', cwd: 'x', contextPct, lastSeen });

test('start detects agents and their account', async () => {
  const { service } = await setup();
  expect(service.get().agents[0]).toMatchObject({ id: 'claude', installed: true, version: '2.1.318', account: { loggedIn: true } });
});

test('start pulls fresh windows from live sources', async () => {
  const adapter: Adapter = {
    id: 'codex',
    detect: async () => ({ installed: true }),
    account: async () => undefined,
    refresh: async () => [{ usedPct: 18, resetsAt: S + 500, minutes: 10080 }],
    start: async () => {},
    stop: () => {},
  };
  const file = join(mkdtempSync(join(tmpdir(), 'ark-usage-')), 'history.jsonl');
  const service = new UsageService([adapter], new HistoryStore(file, () => NOW), () => NOW);
  await service.start();
  expect(service.get().agents[0].weekly?.usedPct).toBe(18);
});

test('one failing adapter does not stop the others', async () => {
  const boom = async () => { throw new Error('boom'); };
  const broken: Adapter = { id: 'opencode', detect: boom, account: boom, refresh: boom, start: boom, stop: () => {} };
  const codex: Adapter = {
    id: 'codex',
    detect: async () => ({ installed: true }),
    account: async () => undefined,
    refresh: async () => [{ usedPct: 18, resetsAt: S + 500, minutes: 10080 }],
    start: async () => {},
    stop: () => {},
  };
  const file = join(mkdtempSync(join(tmpdir(), 'ark-usage-')), 'history.jsonl');
  const service = new UsageService([broken, codex], new HistoryStore(file, () => NOW), () => NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await service.start();
  expect(service.get().agents.find((a) => a.id === 'codex')).toMatchObject({ installed: true, weekly: { usedPct: 18 } });
  await expect(service.refresh()).resolves.toBeDefined();
});

test('ready waits for detection, so no premature "not installed"', async () => {
  let detected!: () => void;
  const adapter: Adapter = {
    id: 'claude',
    detect: () => new Promise((r) => { detected = () => r({ installed: true }); }),
    account: async () => undefined,
    refresh: async () => [],
    start: async () => {},
    stop: () => {},
  };
  const file = join(mkdtempSync(join(tmpdir(), 'ark-usage-')), 'history.jsonl');
  const service = new UsageService([adapter], new HistoryStore(file, () => NOW), () => NOW);
  void service.start();
  const state = service.ready();
  detected();
  expect((await state).agents[0].installed).toBe(true);
});

test('stale window ignored', async () => {
  const { service, emit } = await setup();
  emit({ windows: [{ usedPct: 40, resetsAt: S + 100, minutes: 300 }] });
  emit({ windows: [{ usedPct: 90, resetsAt: S - 100, minutes: 300 }] });
  expect(service.get().agents[0].fiveHour?.usedPct).toBe(40);
});

test('weekly as primary', async () => {
  const { service, emit } = await setup();
  emit({ windows: [{ usedPct: 71, resetsAt: S + 9, minutes: 10080 }, { usedPct: 21, resetsAt: S + 9, minutes: 300 }] });
  expect(service.get().agents[0]).toMatchObject({ fiveHour: { usedPct: 21 }, weekly: { usedPct: 71 } });
});

test('session upsert keeps newer', async () => {
  const { service, emit } = await setup();
  emit({ session: session(NOW - 1000, 30) });
  emit({ session: session(NOW - 2000, 20) });
  expect(service.get().sessions).toEqual([session(NOW - 1000, 30)]);
});

test('drops sessions older than 7 days', async () => {
  const { service, emit } = await setup();
  emit({ session: session(NOW - 8 * 86400e3) });
  expect(service.get().sessions).toEqual([]);
});

test('does not record expired windows in history', async () => {
  const { emit, file } = await setup();
  emit({ windows: [{ usedPct: 90, resetsAt: S - 3600, minutes: 300 }] }); // last week's reading from an old file
  expect(existsSync(file)).toBe(false);
});

test('notifies and records', async () => {
  const { service, emit, file } = await setup();
  const cb = vi.fn();
  service.onChanged(cb);
  emit({ windows: [{ usedPct: 40, resetsAt: S + 100, minutes: 300 }] });
  emit({ session: session(NOW) });
  expect(cb).toHaveBeenCalledTimes(2);
  expect(existsSync(file) && readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
});

test('a sparse update keeps the other window', async () => {
  const { service, emit } = await setup();
  emit({ windows: [{ usedPct: 40, resetsAt: S + 3000, minutes: 300 }, { usedPct: 10, resetsAt: S + 90000, minutes: 10080 }] });
  emit({ windows: [{ usedPct: 12, resetsAt: S + 90000, minutes: 10080 }] });
  const a = service.get().agents[0];
  expect(a.fiveHour?.usedPct).toBe(40);
  expect(a.weekly?.usedPct).toBe(12);
});
