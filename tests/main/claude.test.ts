import { mkdtempSync, existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { createClaudeAdapter, parseAuthStatus, parseStatusline } from '../../src/main/services/adapters/claude';

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', name), 'utf8'));
const SEEN = 1_793_878_800_000;

test('parses statusline', () => {
  const r = parseStatusline(fixture('claude-statusline.json'), SEEN);
  expect(r?.session).toEqual({
    id: 'abc-123', agent: 'claude', project: 'ark', cwd: 'D:\\DEVS\\ark', model: 'Opus 5.5',
    contextSize: 200000, contextPct: 46, contextUsed: 92000, costUsd: 1.25, lastSeen: SEEN,
  });
  expect(r?.windows).toEqual([
    { usedPct: 62, resetsAt: 1793900000, minutes: 300 },
    { usedPct: 38, resetsAt: 1794200000, minutes: 10080 },
  ]);
});

test('payload without rate_limits (before first response or API key)', () => {
  const raw = fixture('claude-statusline.json');
  delete raw.rate_limits;
  const r = parseStatusline(raw, SEEN);
  expect(r?.windows).toEqual([]);
  expect(r?.session.costUsd).toBe(1.25);
  expect(r?.session.id).toBe('abc-123');
});

test('missing session_id', () => {
  const raw = fixture('claude-statusline.json');
  delete raw.session_id;
  expect(parseStatusline(raw, SEEN)).toBeUndefined();
  expect(parseStatusline('nope', SEEN)).toBeUndefined();
});

test('parses auth status', () => {
  expect(parseAuthStatus(fixture('claude-auth.json'))).toEqual({
    account: { loggedIn: true, method: 'subscription', email: 'dev@example.com', plan: 'team' },
    configDir: 'C:\\Users\\dev\\.claude',
  });
  expect(parseAuthStatus({ loggedIn: true, authMethod: 'api_key' }).account.method).toBe('apiKey');
});

test('adapter ingests and prunes drop dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ark-claude-'));
  writeFileSync(join(dir, 'a.json'), JSON.stringify(fixture('claude-statusline.json')));
  const old = join(dir, 'old.json');
  writeFileSync(old, JSON.stringify({ ...fixture('claude-statusline.json'), session_id: 'old' }));
  const past = (Date.now() - 31 * 86400e3) / 1000;
  utimesSync(old, past, past);

  const adapter = createClaudeAdapter({ dropDir: dir });
  const emit = vi.fn();
  await adapter.start(emit);
  adapter.stop();

  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls[0][0].session.id).toBe('abc-123');
  expect(existsSync(old)).toBe(false);
});
