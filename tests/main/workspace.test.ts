import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { branchName, claudeSettingsProblem, NO_HOOKS, workspace } from '../../src/main/services/threads/workspace';

beforeAll(() => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Ark Test';
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'ark@test.local';
});

let root: string;
let repo: string;
let wt: string;
let base: string;
let mainBranch: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-ws-'));
  repo = join(root, 'repo');
  wt = join(root, 'wt');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), 'hi');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  base = git(repo, 'rev-parse', 'HEAD');
  mainBranch = git(repo, 'branch', '--show-current');
});
// Retries: on Windows a timed-out check's process tree outlives it for a moment and holds the folder (tree kill deferred).
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 }));

const pkg = (scripts: Record<string, string>) => {
  const d = join(root, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts }));
  return d;
};

test('head is undefined for a repo with no commit and for a plain folder', async () => {
  const empty = join(root, 'empty');
  mkdirSync(empty);
  git(empty, 'init', '-q');
  expect(await workspace.head(empty)).toBeUndefined();
  expect(await workspace.head(root)).toBeUndefined();
  expect(await workspace.head(repo)).toBe(base);
});

test('addWorktree creates the branch in a new folder and leaves the repo on its own branch', async () => {
  await workspace.addWorktree(repo, wt, 'ark/demo-1234abcd');
  expect(existsSync(join(wt, 'README.md'))).toBe(true);
  expect(git(repo, 'branch', '--show-current')).toBe(mainBranch);
  expect(git(wt, 'branch', '--show-current')).toBe('ark/demo-1234abcd');
});

test('addWorktree throws git stderr when the branch exists', async () => {
  await workspace.addWorktree(repo, wt, 'ark/demo-1234abcd');
  await expect(workspace.addWorktree(repo, join(root, 'wt2'), 'ark/demo-1234abcd')).rejects.toThrow(/already exists/);
});

test('commitAll commits new and changed files, and returns undefined when clean', async () => {
  await workspace.addWorktree(repo, wt, 'ark/demo-1234abcd');
  writeFileSync(join(wt, 'new.txt'), 'x');
  const sha = await workspace.commitAll(wt, 'ark: phase 1 — demo');
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  expect(await workspace.commitAll(wt, 'again')).toBeUndefined();
  expect(await workspace.diff(wt, base)).toContain('+x');
  expect(await workspace.log(wt, base)).toContain('ark: phase 1 — demo');
});

test("Ark's own git runs none of the project's hooks", async () => {
  // A hooks folder in the tree (husky-style): pre-commit fails, post-checkout leaves a mark.
  const hooks = join(repo, '.githooks');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho hooked >&2\nexit 1\n');
  writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\necho ran > "${join(root, 'post-checkout-ran').replace(/\\/g, '/')}"\n`);
  git(repo, 'config', 'core.hooksPath', '.githooks');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'hooks');
  await workspace.addWorktree(repo, wt, 'ark/demo-1234abcd');
  expect(existsSync(join(root, 'post-checkout-ran'))).toBe(false);
  writeFileSync(join(wt, 'new.txt'), 'x');
  expect(await workspace.commitAll(wt, 'ark: phase 1 — demo')).toMatch(/^[0-9a-f]{40}$/);
  expect(existsSync(NO_HOOKS)).toBe(false);
});

test('isRepoRoot is true only for the top folder of a repository, whatever the path spelling', async () => {
  const sub = join(repo, 'sub');
  mkdirSync(sub);
  expect(await workspace.isRepoRoot(repo)).toBe(true);
  expect(await workspace.isRepoRoot(`${repo.replace(/\\/g, '/')}/`)).toBe(true);
  if (process.platform === 'win32') expect(await workspace.isRepoRoot(repo.toUpperCase())).toBe(true);
  expect(await workspace.isRepoRoot(sub)).toBe(false);
  expect(await workspace.isRepoRoot(root)).toBe(false);
  expect(await workspace.isRepoRoot(join(root, 'missing'))).toBe(false);
  await workspace.addWorktree(repo, wt, 'ark/demo-1234abcd');
  expect(await workspace.isRepoRoot(wt)).toBe(true);
});

test('a check that runs past its time is reported as timed out', async () => {
  const d = pkg({ test: `node -e "setTimeout(() => {}, 2000)"` });
  const [test] = await workspace.runChecks(d, ['test'], 500);
  expect(test).toMatchObject({ script: 'test', ok: false });
  expect(test.tail).toMatch(/^timed out after 0\.5 s\n/);
}, 60_000);

test('projectChecks keeps the known scripts in order', () => {
  const d = pkg({ build: 'b', dev: 'd', test: 't', lint: 'l' });
  expect(workspace.projectChecks(d)).toEqual(['lint', 'test', 'build']);
});

test('projectChecks is empty without package.json or with broken JSON', () => {
  expect(workspace.projectChecks(root)).toEqual([]);
  const d = join(root, 'bad');
  mkdirSync(d);
  writeFileSync(join(d, 'package.json'), '{nope');
  expect(workspace.projectChecks(d)).toEqual([]);
});

test('runChecks runs every script and keeps the tail of a failure', async () => {
  const d = pkg({
    lint: `node -e "console.log('fine')"`,
    test: `node -e "console.error('boom'); process.exit(1)"`,
  });
  const r = await workspace.runChecks(d, ['lint', 'test']);
  expect(r.map((x) => [x.script, x.ok])).toEqual([['lint', true], ['test', false]]);
  expect(r[1].tail).toContain('boom');
  expect(r[1].tail).not.toContain('timed out');
  expect(r[0].tail).toBe('');
}, 60_000);

test('a check killed for too much output says so, not "timed out"', async () => {
  const d = pkg({ test: `node -e "process.stdout.write('x'.repeat(70 * 1024 * 1024))"` });
  const [r] = await workspace.runChecks(d, ['test']);
  expect(r.ok).toBe(false);
  expect(r.tail).toContain('output over 64 MB');
  expect(r.tail).not.toContain('timed out');
}, 60_000);

test('a check killed by its timeout says "timed out"', async () => {
  const d = pkg({ test: `node -e "setTimeout(() => {}, 30000)"` });
  const [r] = await workspace.runChecks(d, ['test'], 300);
  expect(r.tail).toContain('timed out after');
}, 60_000);

const settings = (text: string) => {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), text);
};

test('claudeSettingsProblem accepts a missing file and settings that skip no card', () => {
  expect(claudeSettingsProblem(root)).toBeUndefined();
  settings(JSON.stringify({ permissions: { allow: [], deny: ['Bash(rm *)'] }, hooks: {}, env: { X: '1' } }));
  expect(claudeSettingsProblem(root)).toBeUndefined();
});

test.each([
  [{ permissions: { allow: ['Bash(npm install:*)'] } }, 'permissions.allow'],
  [{ permissions: { defaultMode: 'bypassPermissions' } }, 'permissions.defaultMode'],
  [{ permissions: { additionalDirectories: ['C:/Users'] } }, 'permissions.additionalDirectories'],
  [{ apiKeyHelper: 'node steal.js' }, 'apiKeyHelper'],
  [{ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo allow' }] }] } }, 'hooks'],
])('claudeSettingsProblem names the file and the key that skips the card: %j', (s, key) => {
  settings(JSON.stringify(s));
  const p = claudeSettingsProblem(root);
  expect(p).toContain(join(root, '.claude', 'settings.json'));
  expect(p).toContain(`sets ${key},`);
});

test('claudeSettingsProblem names every offending key at once', () => {
  settings(JSON.stringify({ permissions: { allow: ['Bash(*)'], defaultMode: 'acceptEdits' }, hooks: { Stop: [] } }));
  expect(claudeSettingsProblem(root)).toContain('sets permissions.allow, permissions.defaultMode, hooks,');
});

test('claudeSettingsProblem reads a settings file that starts with a UTF-8 BOM', () => {
  const BOM = String.fromCharCode(0xfeff);
  settings(BOM + JSON.stringify({ env: { X: '1' } }));
  expect(claudeSettingsProblem(root)).toBeUndefined();
  settings(BOM + JSON.stringify({ hooks: { Stop: [{}] } }));
  expect(claudeSettingsProblem(root)).toContain('sets hooks,');
});

test('claudeSettingsProblem fails closed on a file it cannot parse', () => {
  settings('{ "permissions": { "allow": [ // trailing');
  expect(claudeSettingsProblem(root)).toMatch(/settings\.json is not valid JSON/);
  settings('[]');
  expect(claudeSettingsProblem(root)).toMatch(/is not valid JSON/);
});

test('branchName slugs the title and keeps the id prefix', () => {
  expect(branchName('Add login page!', '1234abcd-0000-0000-0000-000000000000')).toBe('ark/add-login-page-1234abcd');
  expect(branchName('x'.repeat(39) + ' yyy', '1234abcd-0')).toBe(`ark/${'x'.repeat(39)}-1234abcd`);
});
