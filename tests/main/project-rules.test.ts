import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { codexProjectRules } from '../../src/main/services/engines/project-rules';

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ark-rules-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

test('nothing when AGENTS.md exists', () => {
  expect(codexProjectRules(project({ 'AGENTS.md': 'a', 'CLAUDE.md': 'c' }))).toBeUndefined();
});

test('nothing when there is no CLAUDE.md', () => {
  expect(codexProjectRules(project({}))).toBeUndefined();
});

test('inlines @imports of CLAUDE.md', () => {
  expect(codexProjectRules(project({ 'CLAUDE.md': '@AGENTv2.md\n', 'AGENTv2.md': '# Rules\nX' }))).toBe('# Rules\nX');
});

test('resolves imports relative to the importing file', () => {
  const dir = project({ 'CLAUDE.md': 'top\n@docs/a.md\n' });
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'a.md'), '@b.md');
  writeFileSync(join(dir, 'docs', 'b.md'), 'B');
  expect(codexProjectRules(dir)).toBe('top\nB');
});

test('keeps imports outside the project as text', () => {
  const outside = project({ 'secret.md': 'SECRET' });
  const dir = project({ 'CLAUDE.md': `@${join(outside, 'secret.md')}\n@../nope.md\n` });
  expect(codexProjectRules(dir)).toBe(`@${join(outside, 'secret.md')}\n@../nope.md`);
});

test('stops at depth 3 on a cycle', () => {
  expect(codexProjectRules(project({ 'CLAUDE.md': '@CLAUDE.md\n' }))).toBe('@CLAUDE.md');
});
