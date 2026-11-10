import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { claudeImportProblem, codexProjectRules } from '../../src/main/services/engines/project-rules';

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

test('ignores a top CLAUDE.md that links outside the project', () => {
  const outside = project({ 'secret.md': 'SECRET' });
  const dir = project({});
  try { symlinkSync(join(outside, 'secret.md'), join(dir, 'CLAUDE.md'), 'file'); } catch { return; } // no symlink rights on this machine
  expect(codexProjectRules(dir)).toBeUndefined();
});

test.for(['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'])('refuses a top %s that links outside the project for Claude', (name, t) => {
  const outside = project({ 'secret.md': 'SECRET' });
  const dir = project({});
  mkdirSync(join(dir, '.claude'));
  const file = join(dir, name);
  try { symlinkSync(join(outside, 'secret.md'), file, 'file'); } catch { t.skip(); return; } // no symlink rights on this machine
  expect(claudeImportProblem(dir)).toContain(file);
  expect(claudeImportProblem(dir)).toContain('outside the project');
});

test('stops at depth 3 on a cycle', () => {
  expect(codexProjectRules(project({ 'CLAUDE.md': '@CLAUDE.md\n' }))).toBe('@CLAUDE.md');
});

// claudeImportProblem: Claude Code loads @imports of CLAUDE.md, absolute and ~ paths included (docs: memory, "Import additional files")
describe('claudeImportProblem', () => {
  const outside = project({ 'secret.md': 'SECRET' });
  const secret = join(outside, 'secret.md');

  test('nothing without a CLAUDE.md', () => {
    expect(claudeImportProblem(project({}))).toBeUndefined();
  });

  test('imports inside the project are fine, nested too', () => {
    const dir = project({ 'CLAUDE.md': '@docs/a.md\n' });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'a.md'), '@b.md');
    writeFileSync(join(dir, 'docs', 'b.md'), 'B');
    expect(claudeImportProblem(dir)).toBeUndefined();
  });

  test('refuses an absolute import outside the project, naming the file and the import', () => {
    const dir = project({ 'CLAUDE.md': `see\n@${secret}\n` });
    const p = claudeImportProblem(dir);
    expect(p).toContain(join(dir, 'CLAUDE.md'));
    expect(p).toContain(`@${secret}`);
  });

  test('refuses a parent-relative import and an inline list import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ark-rules-'));
    const proj = join(dir, 'proj');
    mkdirSync(proj);
    writeFileSync(join(dir, 'up.md'), 'UP');
    writeFileSync(join(proj, 'CLAUDE.md'), '- Personal: @../up.md\n');
    expect(claudeImportProblem(proj)).toContain('@../up.md');
  });

  test('refuses a ~ import that resolves to a file', () => {
    const home = project({ 'notes.md': 'N' });
    const dir = project({ 'CLAUDE.md': '@~/notes.md\n' });
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = process.env.USERPROFILE = home;
    try {
      expect(claudeImportProblem(dir)).toContain('@~/notes.md');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('refuses an outside import whose path has escaped spaces', () => {
    const spaced = project({ 'my notes.md': 'N' });
    const dir = project({ 'CLAUDE.md': '@' + join(spaced, 'my notes.md').replaceAll(' ', '\\ ') + '\n' });
    expect(claudeImportProblem(dir)).toContain('my notes.md');
  });

  test('refuses an outside import reached through a nested file, naming that file', () => {
    const dir = project({ 'CLAUDE.md': '@a.md\n', 'a.md': `@${secret}\n` });
    expect(claudeImportProblem(dir)).toContain(join(dir, 'a.md'));
  });

  test('refuses an outside import at the fifth hop', () => {
    const dir = project({
      'CLAUDE.md': '@a.md', 'a.md': '@b.md', 'b.md': '@c.md', 'c.md': '@d.md', 'd.md': `@${secret}`,
    });
    expect(claudeImportProblem(dir)).toContain(join(dir, 'd.md'));
  });

  test('scans CLAUDE.local.md and .claude/CLAUDE.md', () => {
    const a = project({ 'CLAUDE.local.md': `@${secret}\n` });
    expect(claudeImportProblem(a)).toContain('CLAUDE.local.md');
    const b = project({});
    mkdirSync(join(b, '.claude'));
    writeFileSync(join(b, '.claude', 'CLAUDE.md'), `@${secret}\n`);
    expect(claudeImportProblem(b)).toContain('CLAUDE.md');
  });

  test('ignores code spans, fences, emails, scoped packages and files that do not exist', () => {
    const text = [
      `use \`@${secret}\` literally`,
      '```',
      `@${secret}`,
      '```',
      'mail me@example.com or install @types/node',
      '@../nope.md',
      '',
    ].join('\n');
    expect(claudeImportProblem(project({ 'CLAUDE.md': text }))).toBeUndefined();
  });

  test('a cycle ends', () => {
    expect(claudeImportProblem(project({ 'CLAUDE.md': '@CLAUDE.md\n' }))).toBeUndefined();
  });
});
