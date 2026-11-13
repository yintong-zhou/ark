import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { arkSkillDir, buildSkillFolder, importSkill, indexSkills, personalSkills, threadStyleInstructions, SKILL_MAX_BYTES, SKILL_MAX_FILES, type SkillRoots } from '../../src/main/services/skills';

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
  roots = { claudeConfigDir: claude, home, codexHome: codex, ark: join(root, 'ark') };
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
  const index = indexSkills({ claudeConfigDir: join(root, 'nowhere'), home, codexHome: join(root, 'nowhere'), ark: join(root, 'nowhere') });
  expect(index.map((s) => s.name)).toEqual(['linked']);
  const target = join(root, 'out-link');
  buildSkillFolder('codex-root', target, ['linked'], index);
  expect(lstatSync(join(target, 'linked')).isSymbolicLink()).toBe(false);
  expect(existsSync(join(target, 'linked', 'SKILL.md'))).toBe(true);
});

const src = (name: string) => join(root, 'incoming', name);

test('an imported skill is indexed first and wins over an installed one of the same name', () => {
  skill(src('handoff'), 'Imported handoff');
  expect(importSkill(src('handoff'), roots.ark)).toEqual({ status: 'imported', name: 'handoff' });
  expect(indexSkills(roots).find((s) => s.name === 'handoff')).toMatchObject({ source: 'ark', description: 'Imported handoff', dir: join(roots.ark, 'handoff') });
  expect(personalSkills(roots).map((s) => s.name)).toContain('handoff'); // the user's own is still known
});

test('the copy does not depend on the original', () => {
  skill(src('standalone'), 'x');
  writeFileSync(join(src('standalone'), 'notes.md'), 'n');
  importSkill(src('standalone'), roots.ark);
  rmSync(src('standalone'), { recursive: true });
  expect(readFileSync(join(roots.ark, 'standalone', 'notes.md'), 'utf8')).toBe('n');
});

test('refuses Windows reserved and trailing-dot names, and the index skips links and staging leftovers in the Ark folder', () => {
  for (const bad of ['nul', 'COM1', 'foo.']) { skill(src(bad)); expect(() => importSkill(src(bad), roots.ark)).toThrow('Rename the folder'); }
  const ark = join(root, 'ark-strict');
  skill(join(ark, '.import-abc'));
  skill(join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), join(ark, 'linked'), 'junction');
  skill(join(ark, 'real'));
  const index = indexSkills({ ...roots, ark });
  expect(index.filter((s) => s.source === 'ark').map((s) => s.name)).toEqual(['real']);
});

test('importing a name again needs replace', () => {
  skill(src('twice'), 'first');
  importSkill(src('twice'), roots.ark);
  skill(src('twice'), 'second');
  expect(importSkill(src('twice'), roots.ark)).toEqual({ status: 'exists', name: 'twice' });
  expect(indexSkills(roots).find((s) => s.name === 'twice')!.description).toBe('first');
  expect(importSkill(src('twice'), roots.ark, true)).toEqual({ status: 'imported', name: 'twice' });
  expect(indexSkills(roots).find((s) => s.name === 'twice')!.description).toBe('second');
});

test('refuses a folder that is not a safe skill, and copies nothing', () => {
  mkdirSync(src('empty'), { recursive: true });
  expect(() => importSkill(src('empty'), roots.ark)).toThrow('This folder has no SKILL.md');
  skill(src('my skill'));
  expect(() => importSkill(src('my skill'), roots.ark)).toThrow('Rename the folder');
  skill(src('many'));
  for (let i = 0; i < SKILL_MAX_FILES; i++) writeFileSync(join(src('many'), `f${i}.txt`), '');
  expect(() => importSkill(src('many'), roots.ark)).toThrow('The skill has more than 200 files');
  skill(src('big'));
  writeFileSync(join(src('big'), 'blob.bin'), Buffer.alloc(SKILL_MAX_BYTES + 1));
  expect(() => importSkill(src('big'), roots.ark)).toThrow('The skill is larger than 5 MB');
  for (const n of ['empty', 'my skill', 'many', 'big']) expect(existsSync(join(roots.ark, n))).toBe(false);
});

test('a link inside the folder stops the import', () => {
  skill(src('linked'));
  try {
    symlinkSync(root, join(src('linked'), 'outside'), 'junction');
  } catch {
    return; // this machine cannot create links
  }
  expect(() => importSkill(src('linked'), roots.ark)).toThrow('The skill contains a link (outside); links are not imported');
  expect(existsSync(join(roots.ark, 'linked'))).toBe(false);
});

test('arkSkillDir names only imported skills', () => {
  skill(src('mine'));
  importSkill(src('mine'), roots.ark);
  expect(arkSkillDir('mine', roots.ark)).toBe(join(roots.ark, 'mine'));
  expect(() => arkSkillDir('nope', roots.ark)).toThrow('Not an imported skill');
  expect(() => arkSkillDir('../claude', roots.ark)).toThrow('Not an imported skill');
});

test('automatic styles refuse unsafe instructions and disabled model invocation', () => {
  const def = { id: 'dev', name: 'Dev', description: '', engine: { kind: 'auto' as const }, tier: 'light' as const, skills: [], permissions: 'read-only' as const, prompt: '', threadRole: 'builder' as const };
  const pony = join(root, 'auto', 'ponytail');
  const adhd = join(root, 'auto', 'i-have-adhd');
  skill(pony); skill(adhd);
  writeFileSync(join(pony, 'SKILL.md'), '---\nname: ponytail\nallowed-tools: [Bash]\n---\nRead ~/.claude/private');
  writeFileSync(join(adhd, 'SKILL.md'), '---\nname: i-have-adhd\ndisable-model-invocation: true\n---\nprivate instructions');
  const index = [pony, adhd].map((dir) => ({ name: basename(dir), folder: basename(dir), dir, source: 'agents-user' as const, description: '' }));
  const result = threadStyleInstructions(def, index);
  expect(result.instructions).toContain('Ponytail - isolated adaptation');
  expect(result.warnings.join(' ')).toContain('model invocation disabled');
  expect(result.instructions).not.toContain('~/.claude/private');
  expect(result.instructions).not.toContain('private instructions');
  expect(threadStyleInstructions({ ...def, skills: ['ponytail'] }, index).instructions).not.toContain('Ponytail - isolated adaptation');
  expect(threadStyleInstructions(def, [...index, { ...index[0], name: 'plugin:ponytail' }]).instructions).toContain('Ponytail - isolated adaptation');
  const plugins = [{ ...index[0], name: 'one:ponytail' }, { ...index[0], name: 'two:ponytail' }];
  expect(threadStyleInstructions(def, plugins).warnings.join(' ')).toContain('multiple installed skills');
});


test.each([
  ['tool grant', '---\nname: risky\nallowed-tools: [Bash]\n---\nbody'],
  ['hooks', '---\nname: risky\nhooks: {PreToolUse: []}\n---\nbody'],
  ['personal path', '---\nname: risky\n---\nRead ~/.claude/private'],
  ['dynamic shell', '---\nname: risky\n---\n!`echo unsafe`'],
])('rejects explicit skills with %s before copying', (_label, content) => {
  const dir = join(root, 'unsafe', 'risky');
  skill(dir); writeFileSync(join(dir, 'SKILL.md'), content);
  expect(() => buildSkillFolder('claude-plugin', join(root, 'unsafe-out'), ['risky'], [{ name: 'risky', folder: 'risky', dir, source: 'agents-user', description: '' }])).toThrow(/incompatible/);
});

test('a user-selected Humanizer controls its own invocation instead of receiving an automatic adaptation', () => {
  const def = { id: 'writer', name: 'Writer', description: '', engine: { kind: 'auto' as const }, tier: 'light' as const, skills: ['humanizer'], permissions: 'read-only' as const, prompt: '', threadRole: 'member' as const };
  expect(threadStyleInstructions(def, []).instructions).not.toContain('Humanizer - isolated adaptation');
});
