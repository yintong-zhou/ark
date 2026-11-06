import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { buildSkillFolder, indexSkills, type SkillRoots } from '../../src/main/services/skills';

let root: string;
let roots: SkillRoots;
let B: string;

function skill(dir: string, description?: string) {
  mkdirSync(dir, { recursive: true });
  const header = description === undefined ? '' : `---\nname: x\ndescription: ${description}\n---\n`;
  writeFileSync(join(dir, 'SKILL.md'), `${header}body\n`);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-skills-'));
  const claude = join(root, 'claude');
  const home = join(root, 'home');
  const codex = join(root, 'codex');
  const A = join(root, 'plugins', 'A');
  B = join(root, 'plugins', 'B');
  const X = join(root, 'plugins', 'X');
  skill(join(claude, 'skills', 'handoff'), 'Hand off work');
  mkdirSync(join(claude, 'skills', 'empty'), { recursive: true });
  skill(join(B, 'skills', 'writing-plans'), 'Write plans');
  skill(join(X, 'skills', 'handoff'));
  skill(join(home, '.agents', 'skills', 'caveman'));
  skill(join(home, '.agents', 'skills', 'handoff'));
  skill(join(codex, 'skills', 'mine'));
  skill(join(codex, 'skills', '.system', 'imagegen'));
  mkdirSync(join(claude, 'plugins'), { recursive: true });
  writeFileSync(
    join(claude, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'superpowers@official': [
          { scope: 'project', installPath: A },
          { scope: 'user', installPath: B },
        ],
        'x@official': [{ scope: 'local', installPath: X }],
      },
    }),
  );
  roots = { claudeConfigDir: claude, home, codexHome: codex };
});

const names = () => indexSkills(roots).map((s) => s.name);

test('indexes every source', () => {
  const idx = indexSkills(roots).filter((s) => s.name !== 'x:handoff');
  expect(idx.map((s) => s.name)).toEqual(['handoff', 'superpowers:writing-plans', 'caveman', 'mine', 'imagegen']);
  expect(idx.map((s) => s.source)).toEqual(['claude-user', 'claude-plugin', 'agents-user', 'codex-user', 'codex-system']);
  expect(idx[1].dir.startsWith(B)).toBe(true);
});

test('first source wins for the same name', () => {
  const handoff = indexSkills(roots).filter((s) => s.name === 'handoff');
  expect(handoff).toHaveLength(1);
  expect(handoff[0].source).toBe('claude-user');
});

test('skips folders without SKILL.md', () => {
  expect(names()).not.toContain('empty');
});

test('reads the description', () => {
  const idx = indexSkills(roots);
  expect(idx.find((s) => s.name === 'handoff')?.description).toBe('Hand off work');
  expect(idx.find((s) => s.name === 'caveman')?.description).toBe('');
});

test('a missing installed_plugins.json means no plugin skills', () => {
  const idx = indexSkills({ ...roots, claudeConfigDir: join(root, 'nowhere') });
  expect(idx.some((s) => s.source === 'claude-plugin')).toBe(false);
  expect(idx.map((s) => s.name)).toContain('caveman');
});

test('claude-plugin layout writes plugin.json and copies only the requested skills', () => {
  const target = join(root, 'out-plugin');
  const r = buildSkillFolder('claude-plugin', target, ['superpowers:writing-plans'], indexSkills(roots));
  expect(readFileSync(join(target, '.claude-plugin', 'plugin.json'), 'utf8')).toBe(
    '{"name":"ark-agent","version":"0.0.0","description":"Ark private skills for one agent session"}',
  );
  expect(existsSync(join(target, 'skills', 'writing-plans', 'SKILL.md'))).toBe(true);
  expect(existsSync(join(target, 'skills', 'caveman'))).toBe(false);
  expect(r).toEqual({ missing: [], folders: ['writing-plans'] });
});

test('codex-root layout copies under the target', () => {
  const target = join(root, 'out-codex');
  buildSkillFolder('codex-root', target, ['caveman'], indexSkills(roots));
  expect(existsSync(join(target, 'caveman', 'SKILL.md'))).toBe(true);
});

test('reports skills that are not installed', () => {
  const r = buildSkillFolder('codex-root', join(root, 'out-missing'), ['nope'], indexSkills(roots));
  expect(r.missing).toEqual(['nope']);
});

test('rejects two skills with the same folder', () => {
  expect(() => buildSkillFolder('codex-root', join(root, 'out-dup'), ['handoff', 'x:handoff'], indexSkills(roots))).toThrow(
    'Two skills named handoff',
  );
});

test('copies a symlinked skill folder as a real folder', () => {
  const src = join(root, 'real-skill');
  skill(src, 'Linked');
  const home = join(root, 'home-link');
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
  symlinkSync(src, join(home, '.agents', 'skills', 'linked'), 'junction'); // junction: no privilege needed on Windows
  const index = indexSkills({ claudeConfigDir: join(root, 'nowhere'), home, codexHome: join(root, 'nowhere') });
  expect(index.map((s) => s.name)).toEqual(['linked']);
  const target = join(root, 'out-link');
  buildSkillFolder('codex-root', target, ['linked'], index);
  expect(lstatSync(join(target, 'linked')).isSymbolicLink()).toBe(false);
  expect(existsSync(join(target, 'linked', 'SKILL.md'))).toBe(true);
});
