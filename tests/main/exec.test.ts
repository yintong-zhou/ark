import { expect, test } from 'vitest';
import { gitBashFromGit, pickExecutable } from '../../src/main/services/exec';

test('pickExecutable skips the extensionless npm shim', () => {
  expect(pickExecutable(['C:/nodejs/codex', 'C:/nodejs/codex.cmd'])).toBe('C:/nodejs/codex.cmd');
  expect(pickExecutable(['C:/u/.local/bin/claude.exe'])).toBe('C:/u/.local/bin/claude.exe');
  expect(pickExecutable(['C:/x/tool.BAT'])).toBe('C:/x/tool.BAT');
  expect(pickExecutable(['C:/nodejs/codex'])).toBeUndefined();
  expect(pickExecutable([])).toBeUndefined();
});

test('gitBashFromGit finds bin/bash.exe from any git.exe location', () => {
  const slash = (p: string) => p.replace(/\\/g, '/');
  const has = (p: string) => slash(p) === 'C:/Git/bin/bash.exe';
  expect(slash(gitBashFromGit('C:/Git/cmd/git.exe', has) ?? '')).toBe('C:/Git/bin/bash.exe');
  expect(slash(gitBashFromGit('C:/Git/mingw64/bin/git.exe', has) ?? '')).toBe('C:/Git/bin/bash.exe');
  expect(gitBashFromGit('C:/Other/git.exe', has)).toBeUndefined();
});
