import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readHead, writeHead, readHandoffThresholds, readView, writeHandoffThreshold, writeView } from '../../src/main/services/settings';

test('handoff thresholds are independent, validated and survive view changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ark-settings-'));
  try {
    expect(readHandoffThresholds(dir)).toEqual({ claude: 40, codex: 40 });
    writeHandoffThreshold(dir, 'claude', 35);
    writeHandoffThreshold(dir, 'codex', 60);
    writeView(dir, 'detailed');
    expect(readView(dir)).toBe('detailed');
    expect(readHandoffThresholds(dir)).toEqual({ claude: 35, codex: 60 });
    expect(() => writeHandoffThreshold(dir, 'claude', 0)).toThrow();
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).handoffThresholds.claude).toBe(35);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the Head of Staff settings round-trip and leave the other settings alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ark-head-settings-'));
  try {
  writeView(dir, 'detailed');
  writeHead(dir, { skills: [], engine: { kind: 'engine', engine: 'codex' }, lock: false });
  expect(readHead(dir).engine).toEqual({ kind: 'engine', engine: 'codex' });
  expect(readView(dir)).toBe('detailed');
  expect(() => writeHead(dir, { skills: [] })).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
