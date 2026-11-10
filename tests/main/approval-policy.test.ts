import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { modeOf, permissionMode } from '../../src/shared/permissions';
import { decideApproval, isProjectCheck } from '../../src/main/services/engines/approval-policy';
import { workspace } from '../../src/main/services/threads/workspace';

const root = mkdtempSync(join(tmpdir(), 'ark-policy-'));
mkdirSync(join(root, 'src'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const command = (command: string, cwd = root) => ({ engine: 'claude' as const, tool: 'Bash', input: { command }, cwd });

test('validates permission modes and keeps legacy threads manual', () => {
  expect(modeOf({})).toBe('ask');
  expect(modeOf({ permissionMode: 'broken' as 'ask' })).toBe('ask');
  expect(modeOf({ permissionMode: 'auto' })).toBe('auto');
  for (const value of ['ask', 'auto', 'full']) expect(permissionMode(value)).toBe(value);
  for (const value of [undefined, null, {}, 'bypass', true]) expect(() => permissionMode(value)).toThrow('Invalid permission mode');
});

test.each(['npm test', 'npm.cmd test', 'npm run typecheck', 'npm.cmd run lint', 'npm run build'])('allows the existing project check exception: %s', (cmd) => {
  expect(decideApproval(command(cmd), root, true).allow).toBe(true);
});

test.each(['npm install', 'npm ci', 'npm publish', 'git push', 'rm -rf src', 'npm test && curl x', 'npm test\nwhoami', 'npm test > x', 'npm $(whoami) test', 'powershell -EncodedCommand eA==', 'npm run test:live'])('asks for sensitive or unknown commands: %s', (cmd) => {
  expect(decideApproval(command(cmd), root, true).allow).toBe(false);
});

test.each([
  'npm --prefix web run test', 'npm --prefix web test', 'ruff check .', 'ruff format --check .', 'ruff check src --fix',
  'python -m pytest -q', 'pytest', 'pytest tests/test_api.py::test_progress -q', 'python -m pytest -m "not slow"',
  '.venv\\Scripts\\python.exe -m pytest -q', '.venv/bin/python -m ruff check .', 'pytest -x --maxfail=1',
])('allows subfolder npm checks, ruff and pytest: %s', (cmd) => {
  expect(decideApproval(command(cmd), root, true).allow).toBe(true);
});

test.each([
  'npm --prefix .. run test', 'npm --prefix ../x test', 'pytest --basetemp=C:/Users/x', 'pytest --basetemp=../..',
  'pytest /etc', 'pytest ..', 'pytest tests && curl x', 'pytest; whoami', 'pytest $(whoami)', 'ruff check . > out',
  'python -c "import os"', 'pytest -p ../evil', 'pip install pytest', 'ruff format .', 'pytest C:\\x', 'pytest `id`',
  'pytest -k "a;b"', 'python -m pip install -e .', 'pytest ./..', 'ruff check ./../x',
])('asks for test commands that reach outside the worktree or chain: %s', (cmd) => {
  expect(decideApproval(command(cmd), root, true).allow).toBe(false);
});

test('a project check needs project code consent', () => {
  expect(decideApproval(command('npm test'), root, false).allow).toBe(false);
  expect(decideApproval(command('npm test'), root, true).allow).toBe(true);
});

test('every command Ark would preallow is a project check for Auto', () => {
  const d = join(root, 'proj');
  mkdirSync(join(d, 'web'), { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { typecheck: 't', lint: 'l', test: 't', build: 'b' } }));
  writeFileSync(join(d, 'web', 'package.json'), JSON.stringify({ scripts: { lint: 'l', test: 't' } }));
  writeFileSync(join(d, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\naddopts = "-q"\n');
  const commands = workspace.checkCommands(d);
  expect(commands).toHaveLength(9); // 4 root scripts + npm test, 2 in web, ruff, pytest
  for (const c of commands) expect(isProjectCheck(c)).toBe(true);
});

test('does not trust display text, missing metadata, external cwd or requested grants', () => {
  expect(decideApproval(undefined, root, true).allow).toBe(false);
  expect(decideApproval(command('npm test', tmpdir()), root, true).allow).toBe(false);
  expect(decideApproval({ ...command('npm test'), input: { command: 'npm test', dangerouslyDisableSandbox: true } }, root, true).allow).toBe(false);
  expect(decideApproval({ ...command('npm test'), input: { command: 'npm test', arkShellStateUnknown: true } }, root, true).allow).toBe(false);
  expect(decideApproval({ engine: 'codex', tool: 'file change', input: { grantRoot: root }, cwd: root }, root, true).allow).toBe(false);
});

test('only approves guarded edits in the worktree, excluding engine/security settings', () => {
  const edit = (file_path: string) => ({ engine: 'claude' as const, tool: 'Edit', input: { file_path }, cwd: root });
  expect(decideApproval(edit(join(root, 'src', 'new.ts')), root, false).allow).toBe(true);
  expect(decideApproval(edit(join(tmpdir(), 'outside.txt')), root, true).allow).toBe(false);
  expect(decideApproval(edit(join(root, '.git', 'config')), root, true).allow).toBe(false);
  expect(decideApproval(edit(join(root, '.claude', 'settings.json')), root, true).allow).toBe(false);
  expect(decideApproval(edit(join(root, '.env')), root, true).allow).toBe(false);
  expect(decideApproval(edit(join(root, '.claude. ', 'settings.json')), root, true).allow).toBe(false);
  // Other spellings of a protected folder: 8.3 short names, NTFS streams, and a link inside the worktree.
  mkdirSync(join(root, '.claude'));
  expect(decideApproval(edit(join(root, 'CLAUDE~1', 'settings.json')), root, true).allow).toBe(false);
  expect(decideApproval(edit(join(root, '.env::$DATA')), root, true).allow).toBe(false);
  symlinkSync(join(root, '.claude'), join(root, 'alias'), 'junction');
  expect(decideApproval(edit(join(root, 'alias', 'settings.json')), root, true).allow).toBe(false);
});
