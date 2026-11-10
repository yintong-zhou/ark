import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { splitFrontmatter, type Permissions } from '@shared/agent-file';
import type { PermissionMode } from '@shared/permissions';
import { obj, str } from '../json';
import { ARK_PLUGIN } from '../skills';
import { CHECK_SCRIPTS } from '../threads/workspace';

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

/** The exact check commands a build agent may run without a card (spec §6.4); any other command still asks. */
const CHECK_COMMANDS = [...CHECK_SCRIPTS.map((s) => `npm run ${s}`), 'npm test'];
const CHECK_RULES = ['Bash', 'PowerShell'].flatMap((tool) => CHECK_COMMANDS.map((c) => `${tool}(${c})`));

/**
 * Claude Code: only the project's settings, no MCP, only our plugin, and a tool whitelist: read-only
 * agents get no edit, write or shell; build agents get them, with prompts routed to Ark over stdio,
 * except the project's checks.
 */
export function claudeArgs(o: { model: string; roleFile: string; pluginDir: string; permissions: Permissions; permissionMode?: PermissionMode }): string[] {
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
            : ['--allowedTools', ...CHECK_RULES, '--permission-mode', 'acceptEdits', '--permission-prompt-tool', 'stdio'])]
      : ['--tools', 'Read,Glob,Grep,Skill']),
  ];
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
export function checkClaudeInit(init: unknown, expectedFolders: string[], forbidden: ReadonlySet<string>): string[] {
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
      const d = splitFrontmatter(readFileSync(file, 'utf8'))?.data.description;
      lines.push(`- ${f}: ${typeof d === 'string' ? d.trim().replace(/\s+/g, ' ') : ''} (file: ${file})`);
    } catch {
      missing.push(`skill not loaded: ${f}`);
    }
  }
  if (missing.length) throw new IsolationError(missing);
  return [
    '# Skills',
    '',
    'These are your skills. When a task matches one, read its SKILL.md first and follow it; resolve relative paths from the folder holding that file. You have no other skills.',
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
