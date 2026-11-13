import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { splitFrontmatter, type Permissions } from '@shared/agent-file';
import type { PermissionMode } from '@shared/permissions';
import { obj, str } from '../json';
import { ARK_PLUGIN } from '../skills';

/** Env vars that tie a child to the Claude Code session Ark itself may be running in. */
export const STRIPPED_ENV = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_CODE_PLUGIN_DIRS',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
] as const;

/** Thrown when the engine reports more (or less) than the agent is allowed. No retry, no fallback. */
export class IsolationError extends Error {
  constructor(readonly violations: string[]) {
    super(`Isolation check failed: ${violations.join('; ')}`);
    this.name = 'IsolationError';
  }
}

/** Copy of `env` without the variables in STRIPPED_ENV. Every engine is started with this. */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of STRIPPED_ENV) delete out[k];
  return out;
}

/** cleanEnv plus the switch that turns off Claude Code's auto-memory (the user's personal MEMORY.md). */
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...cleanEnv(env), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
}

/**
 * Claude Code: only the project's settings, no MCP, only our plugin, and a tool whitelist: read-only
 * agents get no edit, write or shell; build agents get them, with prompts routed to Ark over stdio,
 * except, in Ask, the exact `checks` commands (given only once the user allowed project code).
 */
export function claudeArgs(o: { model: string; roleFile: string; pluginDir: string; permissions: Permissions; permissionMode?: PermissionMode; checks?: string[] }): string[] {
  const rules = ['Bash', 'PowerShell'].flatMap((tool) => (o.checks ?? []).map((c) => `${tool}(${c})`));
  return [
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
    o.pluginDir,
    '--model',
    o.model,
    '--append-system-prompt-file',
    o.roleFile,
    ...(o.permissions === 'build'
      ? ['--tools', 'Read,Glob,Grep,Skill,Edit,Write,Bash,PowerShell', ...(o.permissionMode === 'full'
          ? ['--dangerously-skip-permissions']
          : o.permissionMode === 'auto'
            ? ['--allowedTools', 'Skill', '--permission-mode', 'default', '--permission-prompt-tool', 'stdio']
            : [...(rules.length ? ['--allowedTools', ...rules] : []), '--permission-mode', 'acceptEdits', '--permission-prompt-tool', 'stdio'])]
      : ['--tools', 'Read,Glob,Grep,Skill']),
  ];
}

const SETTINGS_TOP = new Set(['$schema', 'permissions']);
const SETTINGS_PERMISSIONS = new Set(['deny', 'ask']);

/**
 * Why a Claude session must not start in `dir`: Claude Code loads its .claude/settings.json (--setting-sources project),
 * and hooks, env, an API key helper, allow rules, a default mode or extra directories there could run commands, change the
 * environment or skip approval cards. Allowlist: only `$schema` and `permissions.deny|ask` (which only restrict) pass;
 * unknown means refused. Undefined when the file is missing or clean; a file that is not a JSON object fails closed.
 */
export function claudeSettingsProblem(dir: string): string | undefined {
  const file = join(dir, '.claude', 'settings.json');
  if (!existsSync(file)) return undefined;
  let s: Record<string, unknown> | undefined;
  try {
    s = obj(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); // editors on Windows write a BOM
  } catch {
    // unreadable or not JSON: s stays undefined
  }
  if (!s) return `${file} is not valid JSON, so Ark cannot tell whether it skips the approval cards. Fix or remove it, then try again.`;
  const keys = Object.keys(s).flatMap((k) => {
    if (k !== 'permissions') return SETTINGS_TOP.has(k) ? [] : [k];
    const perms = obj(s.permissions);
    return perms ? Object.keys(perms).filter((x) => !SETTINGS_PERMISSIONS.has(x)).map((x) => `permissions.${x}`) : [k];
  });
  return keys.length
    ? `${file} sets ${keys.join(', ')}, which Ark does not allow in agent sessions: they could run commands, change the environment or skip approval cards. Remove them, then try again.`
    : undefined;
}

/**
 * Names under which Claude Code could list the project's own skills and slash commands: skill folder and frontmatter
 * name, command file name (and `dir:name` for a subfolder). Both run `!` shell injection and pre-approve tools through
 * `allowed-tools`, even in `-p` (docs: code.claude.com/docs/en/skills), so none may be loaded: checkClaudeInit refuses these.
 */
export function projectSkillNames(projectDir: string): string[] {
  const names: string[] = [];
  const ls = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return []; // no such folder
    }
  };
  for (const e of ls(join(projectDir, '.claude', 'skills'))) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    names.push(e.name);
    try {
      const n = splitFrontmatter(readFileSync(join(projectDir, '.claude', 'skills', e.name, 'SKILL.md'), 'utf8'))?.data.name;
      if (typeof n === 'string') names.push(n);
    } catch {
      // no readable SKILL.md: the folder name is still forbidden
    }
  }
  const commands = (dir: string, prefix: string) => {
    for (const e of ls(dir)) {
      if (e.isDirectory()) commands(join(dir, e.name), `${prefix}${e.name}:`);
      else if (e.name.endsWith('.md')) names.push(e.name.slice(0, -3), prefix + e.name.slice(0, -3));
    }
  };
  commands(join(projectDir, '.claude', 'commands'), '');
  return names;
}

/**
 * CLAUDE.md / CLAUDE.local.md in the folders above `dir`: Claude Code loads them with no switch to
 * stop it. The folder's own file does not count, it is kept by design.
 */
export function ancestorInstructions(dir: string): string[] {
  const found: string[] = [];
  for (let d = dirname(resolve(dir)), prev = ''; d !== prev; prev = d, d = dirname(d)) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md']) {
      if (existsSync(join(d, f))) found.push(join(d, f));
    }
  }
  return found;
}

/**
 * Codex app-server switches every Ark session starts with: plugins, apps, hooks and memories off, and
 * the Windows sandbox on (without `windows.sandbox` Codex runs commands unsandboxed on Windows, even
 * for read-only threads; `unelevated` needs no admin rights). Ignored on other platforms.
 */
export const CODEX_BASE_ARGS = ['app-server', '--disable', 'plugins', '--disable', 'apps', '--disable', 'hooks', '--disable', 'memories', '-c', 'windows.sandbox="unelevated"'];

/** Codex loads these from its home into every session; one present means the agent would not be isolated. */
export function checkCodexPersonal(codexHome: string): string[] {
  return ['AGENTS.md', 'AGENTS.override.md']
    .map((f) => join(codexHome, f))
    .filter((p) => existsSync(p))
    .map((p) => `personal instructions not allowed: ${p}`);
}

/** Codex app-server with the base switches and the given skills and MCP servers disabled. */
export function codexArgs(deny: { skillPaths: string[]; mcpServers: string[] }): string[] {
  const args = [...CODEX_BASE_ARGS];
  if (deny.skillPaths.length) {
    const items = deny.skillPaths.map((p) => `{path=${JSON.stringify(p)},enabled=false}`);
    args.push('-c', `skills.config=[${items.join(',')}]`);
  }
  for (const name of deny.mcpServers) {
    const key = /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
    args.push('-c', `mcp_servers.${key}.enabled=false`);
  }
  return args;
}

/** Violations in Claude Code's `system/init` event; empty means the session is isolated. Fails closed on odd shapes. */
export function checkClaudeInit(init: unknown, expectedFolders: string[], forbidden: ReadonlySet<string>, projectCommands: ReadonlySet<string> = new Set()): string[] {
  const ev = obj(init);
  if (!ev) return ['no init event'];
  const out: string[] = [];
  const malformed = new Set<string>();
  const items = (field: 'plugins' | 'mcp_servers' | 'skills'): unknown[] => {
    const v = ev[field];
    if (Array.isArray(v)) return v;
    malformed.add(field);
    return [];
  };
  for (const p of items('plugins')) {
    const pl = obj(p);
    if (typeof pl?.name !== 'string') malformed.add('plugins');
    else if (pl.name !== ARK_PLUGIN && pl.path !== 'builtin') out.push(`plugin not allowed: ${pl.name}`);
  }
  for (const s of items('mcp_servers')) {
    out.push(`MCP server not allowed: ${str(obj(s)?.name) ?? String(s)}`);
  }
  const skills: string[] = [];
  for (const s of items('skills')) {
    if (typeof s !== 'string') malformed.add('skills');
    else skills.push(s);
  }
  for (const s of skills) {
    const bad = s.includes(':')
      ? !(s.startsWith(`${ARK_PLUGIN}:`) && expectedFolders.includes(s.slice(ARK_PLUGIN.length + 1)))
      : forbidden.has(s);
    if (bad) out.push(`skill not allowed: ${s}`);
  }
  for (const f of expectedFolders) {
    if (!skills.includes(`${ARK_PLUGIN}:${f}`)) out.push(`skill not loaded: ${ARK_PLUGIN}:${f}`);
  }
  // Personal skill names can collide with built-in commands; only project names belong in this second check.
  if (Array.isArray(ev.slash_commands)) {
    for (const command of ev.slash_commands) {
      if (typeof command === 'string' && projectCommands.has(command)) out.push(`command not allowed: ${command}`);
    }
  }
  for (const f of malformed) out.push(`init malformed: ${f}`);
  return out;
}

/**
 * Violations in Codex's skills list: none may be enabled. codex-cli 0.132.0 cannot add a skill root
 * (no `skills/extraRoots/set`), so the agent's own skills reach it as text (codexSkillsSection) and
 * Codex itself must load none.
 */
export function checkCodexSkills(skills: { name: string; enabled: boolean }[]): string[] {
  return skills.filter((s) => s.enabled).map((s) => `skill not allowed: ${s.name}`);
}

/**
 * The agent's own skills as a section of its developer instructions: name, description and the
 * SKILL.md to read, as Codex itself lists skills. Reads the private copies under `privateRoot`;
 * a folder without a readable SKILL.md is an isolation failure, never silently dropped.
 */
export function codexSkillsSection(privateRoot: string, folders: string[]): string {
  if (!folders.length) return '';
  const lines: string[] = [];
  const missing: string[] = [];
  for (const f of folders) {
    const file = join(resolve(privateRoot), f, 'SKILL.md');
    try {
      const data = splitFrontmatter(readFileSync(file, 'utf8'))?.data;
      const d = data?.description;
      lines.push(`- ${f}: ${typeof d === 'string' ? d.trim().replace(/\s+/g, ' ') : ''} (file: ${file})${data?.['disable-model-invocation'] === true ? ' - use only when the user explicitly invokes this skill' : ''}`);
    } catch {
      missing.push(`skill not loaded: ${f}`);
    }
  }
  if (missing.length) throw new IsolationError(missing);
  return [
    '# Skills',
    '',
    'These are your skills. When a task matches one, read its SKILL.md first and follow it unless it requires explicit user invocation; resolve relative paths from the folder holding that file. You have no other skills.',
    '',
    ...lines,
  ].join('\n');
}

/** Violations in Codex's MCP server status: every server must be disabled. */
export function checkCodexMcp(servers: Record<string, { enabled?: boolean }>): string[] {
  return Object.entries(servers)
    .filter(([, s]) => s.enabled !== false)
    .map(([name]) => `MCP server not allowed: ${name}`);
}
