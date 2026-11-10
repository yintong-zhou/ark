import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  ancestorInstructions,
  checkClaudeInit,
  checkCodexMcp,
  checkCodexPersonal,
  checkCodexSkills,
  claudeArgs,
  claudeEnv,
  cleanEnv,
  codexArgs,
} from '../../src/main/services/engines/isolation';

test('cleanEnv removes the session variables and keeps the rest', () => {
  const out = cleanEnv({
    CLAUDE_CODE_PLUGIN_DIRS: 'x',
    CLAUDECODE: '1',
    CLAUDE_CONFIG_DIR: 'c',
    CLAUDE_CODE_GIT_BASH_PATH: 'b',
    PATH: 'p',
  });
  expect(out).toEqual({ CLAUDE_CONFIG_DIR: 'c', CLAUDE_CODE_GIT_BASH_PATH: 'b', PATH: 'p' });
});

test('claudeArgs is exact', () => {
  expect(claudeArgs({ model: 'haiku', roleFile: 'role.md', pluginDir: 'plug', permissions: 'read-only' })).toEqual([
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--plugin-dir',
    'plug',
    '--model',
    'haiku',
    '--append-system-prompt-file',
    'role.md',
    '--tools',
    'Read,Glob,Grep,Skill',
  ]);
});

test('claudeArgs whitelists read-only tools', () => {
  const a = claudeArgs({ model: 'haiku', roleFile: 'r', pluginDir: 'p', permissions: 'read-only' });
  expect(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 2)).toEqual(['--tools', 'Read,Glob,Grep,Skill']);
  expect(a).not.toContain('--disallowedTools');
  expect(a).not.toContain('--permission-prompt-tool');
});

test('claudeArgs gives build agents edits, shell and stdio prompts', () => {
  const a = claudeArgs({ model: 'haiku', roleFile: 'r', pluginDir: 'p', permissions: 'build' });
  const pair = (f: string) => a.slice(a.indexOf(f), a.indexOf(f) + 2);
  expect(pair('--tools')).toEqual(['--tools', 'Read,Glob,Grep,Skill,Edit,Write,Bash,PowerShell']);
  expect(pair('--permission-mode')).toEqual(['--permission-mode', 'acceptEdits']);
  expect(pair('--permission-prompt-tool')).toEqual(['--permission-prompt-tool', 'stdio']);
  expect(pair('--setting-sources')).toEqual(['--setting-sources', 'project']);
  expect(a).toContain('--strict-mcp-config');
});

test('claudeArgs allows exactly the check scripts for build agents, nothing broader', () => {
  const a = claudeArgs({ model: 'haiku', roleFile: 'r', pluginDir: 'p', permissions: 'build' });
  const i = a.indexOf('--allowedTools');
  const rules = a.slice(i + 1, a.indexOf('--permission-mode'));
  const checks = ['npm run typecheck', 'npm run lint', 'npm run test', 'npm run build', 'npm test'];
  expect(rules).toEqual([...checks.map((c) => `Bash(${c})`), ...checks.map((c) => `PowerShell(${c})`)]);
  expect(rules.join(' ')).not.toMatch(/\*|install|:/);
  expect(claudeArgs({ model: 'haiku', roleFile: 'r', pluginDir: 'p', permissions: 'read-only' })).not.toContain('--allowedTools');
});

test('codexArgs denies skills by path and MCP servers by name', () => {
  const base = ['app-server', '--disable', 'plugins', '--disable', 'apps', '--disable', 'hooks', '--disable', 'memories', '-c', 'windows.sandbox="unelevated"'];
  expect(
    codexArgs({ skillPaths: ['C:\\u\\.agents\\skills\\caveman\\SKILL.md'], mcpServers: ['node_repl', 'my.server'] }),
  ).toEqual([
    ...base,
    '-c',
    'skills.config=[{path="C:\\\\u\\\\.agents\\\\skills\\\\caveman\\\\SKILL.md",enabled=false}]',
    '-c',
    'mcp_servers.node_repl.enabled=false',
    '-c',
    'mcp_servers."my.server".enabled=false',
  ]);
  expect(codexArgs({ skillPaths: [], mcpServers: [] })).toEqual(base);
});

test('Auto build routes edits and commands to Ark; Full bypass never widens read-only tools', () => {
  const base = { model: 'haiku', roleFile: 'r', pluginDir: 'p' };
  const auto = claudeArgs({ ...base, permissions: 'build', permissionMode: 'auto' });
  expect(auto[auto.indexOf('--permission-mode') + 1]).toBe('default');
  expect(auto).not.toContain('acceptEdits');
  expect(auto).not.toContain('--dangerously-skip-permissions');
  // Reads inside the worktree are allowed by default mode; a bare Read rule would allow every path on disk.
  expect(auto[auto.indexOf('--allowedTools') + 1]).toBe('Skill');
  const full = claudeArgs({ ...base, permissions: 'build', permissionMode: 'full' });
  expect(full).toContain('--dangerously-skip-permissions');
  const read = claudeArgs({ ...base, permissions: 'read-only', permissionMode: 'full' });
  expect(read).not.toContain('--dangerously-skip-permissions');
  expect(read[read.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Skill');
});

test('checkClaudeInit accepts a clean init', () => {
  const init = {
    plugins: [
      { name: 'ark-agent', path: 'D:\\x' },
      { name: 'cc-plugin-telemetry', path: 'builtin' },
    ],
    mcp_servers: [],
    skills: ['dataviz', 'ark-agent:writing-plans'],
  };
  expect(checkClaudeInit(init, ['writing-plans'], new Set())).toEqual([]);
});

test('checkClaudeInit flags each kind of leak', () => {
  const ok = { plugins: [{ name: 'ark-agent', path: 'D:\\x' }], mcp_servers: [], skills: ['ark-agent:x'] };
  const none = new Set<string>();
  expect(
    checkClaudeInit({ ...ok, plugins: [...ok.plugins, { name: 'superpowers', path: 'D:\\y' }] }, ['x'], none),
  ).toEqual(['plugin not allowed: superpowers']);
  expect(checkClaudeInit({ ...ok, mcp_servers: [{ name: 'alpaca' }] }, ['x'], none)).toEqual([
    'MCP server not allowed: alpaca',
  ]);
  expect(checkClaudeInit({ ...ok, skills: ['ark-agent:x', 'superpowers:brainstorming'] }, ['x'], none)).toEqual([
    'skill not allowed: superpowers:brainstorming',
  ]);
  expect(checkClaudeInit({ ...ok, skills: ['ark-agent:x', 'caveman'] }, ['x'], new Set(['caveman']))).toEqual([
    'skill not allowed: caveman',
  ]);
  expect(checkClaudeInit(ok, ['x', 'y'], none)).toEqual(['skill not loaded: ark-agent:y']);
  expect(checkClaudeInit(undefined, [], none)).toEqual(['no init event']);
});

test('checkClaudeInit fails closed on a malformed init', () => {
  const ok = { plugins: [{ name: 'ark-agent', path: 'D:\\x' }], mcp_servers: [], skills: ['ark-agent:x'] };
  const none = new Set<string>();
  expect(checkClaudeInit({ ...ok, plugins: undefined }, ['x'], none)).toEqual(['init malformed: plugins']);
  expect(checkClaudeInit({ ...ok, mcp_servers: 'none' }, ['x'], none)).toEqual(['init malformed: mcp_servers']);
  expect(checkClaudeInit({ ...ok, skills: undefined }, ['x'], none)).toEqual(['skill not loaded: ark-agent:x', 'init malformed: skills']);
  expect(checkClaudeInit({ ...ok, skills: ['ark-agent:x', { name: 'caveman' }] }, ['x'], none)).toEqual([
    'init malformed: skills',
  ]);
  expect(checkClaudeInit({ ...ok, plugins: [...ok.plugins, { path: 'D:\\y' }, 'superpowers'] }, ['x'], none)).toEqual([
    'init malformed: plugins',
  ]);
  expect(checkClaudeInit({}, [], none)).toEqual([
    'init malformed: plugins',
    'init malformed: mcp_servers',
    'init malformed: skills',
  ]);
});

test('checkCodexSkills: Codex may load none', () => {
  expect(checkCodexSkills([])).toEqual([]);
  expect(checkCodexSkills([{ name: 'caveman', enabled: false }])).toEqual([]);
  expect(checkCodexSkills([{ name: 'caveman', enabled: true }, { name: 'off', enabled: false }, { name: 'a', enabled: true }])).toEqual([
    'skill not allowed: caveman',
    'skill not allowed: a',
  ]);
});

test('checkCodexMcp', () => {
  expect(checkCodexMcp({ node_repl: { enabled: false } })).toEqual([]);
  expect(checkCodexMcp({ x: {} })).toEqual(['MCP server not allowed: x']);
});

test('claudeEnv is cleanEnv plus auto-memory off', () => {
  expect(claudeEnv({ CLAUDECODE: '1', PATH: 'p' })).toEqual({ PATH: 'p', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
});

test('checkClaudeInit allows an ark-agent skill only when it is expected', () => {
  const init = { plugins: [{ name: 'ark-agent', path: 'D:\\x' }], mcp_servers: [], skills: ['ark-agent:x', 'ark-agent:stray'] };
  expect(checkClaudeInit(init, ['x'], new Set())).toEqual(['skill not allowed: ark-agent:stray']);
});

test('checkCodexPersonal flags AGENTS.md and AGENTS.override.md in the Codex home', () => {
  const home = mkdtempSync(join(tmpdir(), 'ark-codexhome-'));
  try {
    expect(checkCodexPersonal(home)).toEqual([]);
    writeFileSync(join(home, 'AGENTS.md'), 'x');
    writeFileSync(join(home, 'AGENTS.override.md'), 'x');
    expect(checkCodexPersonal(home)).toEqual([
      `personal instructions not allowed: ${join(home, 'AGENTS.md')}`,
      `personal instructions not allowed: ${join(home, 'AGENTS.override.md')}`,
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('ancestorInstructions lists CLAUDE.md and CLAUDE.local.md above the folder, not in it', () => {
  const root = mkdtempSync(join(tmpdir(), 'ark-ancestors-'));
  try {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), 'x');
    writeFileSync(join(root, 'a', 'CLAUDE.local.md'), 'x');
    writeFileSync(join(root, 'a', 'b', 'CLAUDE.md'), 'x'); // the folder itself: allowed
    // Filter to the test tree: a real CLAUDE.md further up (e.g. in the user's profile) is not ours.
    const found = ancestorInstructions(join(root, 'a', 'b')).filter((p) => p.startsWith(root));
    expect(found.sort()).toEqual([join(root, 'CLAUDE.md'), join(root, 'a', 'CLAUDE.local.md')].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
