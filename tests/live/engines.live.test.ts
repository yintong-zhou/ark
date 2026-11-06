// Live isolation gate (spec 6.3): starts the REAL Claude Code and Codex CLIs through Ark's session code.
// Run only with `npm run test:live`; each test makes one cheap light-tier call.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { ChatEvent } from '@shared/types';
import { claudeArgs, claudeEnv, cleanEnv } from '../../src/main/services/engines/isolation';
import { codexModels, startCodexSession } from '../../src/main/services/engines/codex-session';
import { startClaudeSession } from '../../src/main/services/engines/claude-session';
import { CLAUDE_TIER_MODEL, codexTierModel } from '../../src/main/services/engines/models';
import { jsonLines, nodeSpawn, type EngineSession, type SpawnFn } from '../../src/main/services/engines/session';
import { which } from '../../src/main/services/exec';
import { buildSkillFolder, indexSkills, type SkillEntry } from '../../src/main/services/skills';

const tmp = mkdtempSync(join(tmpdir(), 'ark-live-'));
// A killed engine can hold its cwd for a moment on Windows: wait, then clean up on a best-effort basis (it is only OS temp).
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    console.warn(`could not remove ${tmp}: ${(e as Error).message}`);
  }
});

const MARKER = 'ARK-MARKER-7';
const probe = (n: 'a' | 'b'): SkillEntry => ({
  name: `ark-probe-${n}`,
  folder: `ark-probe-${n}`,
  dir: resolve('tests/fixtures/skills', `ark-probe-${n}`),
  source: 'claude-user',
  description: `Ark isolation probe ${n.toUpperCase()}`,
});
const index = [probe('a'), probe('b')];
const names = index.map((s) => s.name);

/** A temp project whose CLAUDE.md carries the marker. */
function project(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), `Your project marker is ${MARKER}.\n`);
  return dir;
}

/** nodeSpawn that also hands every JSON line the child prints to `onLine`. */
const tee =
  (onLine: (l: Record<string, unknown>) => void): SpawnFn =>
  (command, args, o) => {
    const child = nodeSpawn(command, args, o);
    jsonLines(child.stdout, onLine);
    return child;
  };

/** Sends `text` and resolves with every event up to the first turn or error; rejects after 120 s so callers' finally blocks run. */
function ask(s: EngineSession, text: string): Promise<ChatEvent[]> {
  return new Promise((done, fail) => {
    const events: ChatEvent[] = [];
    const timer = setTimeout(() => fail(new Error('timed out waiting for the turn')), 120000);
    s.onEvent((e) => {
      events.push(e);
      if (e.type === 'turn' || e.type === 'error') {
        clearTimeout(timer);
        done(events);
      }
    });
    s.send(text);
  });
}

test('Claude Code: only the agent\'s skills, project rules kept', async () => {
  const exe = await which('claude');
  expect(exe, 'claude is not installed').toBeDefined();
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const real = indexSkills({ claudeConfigDir, home: homedir(), codexHome: process.env.CODEX_HOME ?? join(homedir(), '.codex') });
  const forbidden = new Set(real.filter((s) => s.source === 'claude-user').map((s) => s.folder));

  console.log('CLAUDE forbidden user skills:', forbidden.size);
  expect(forbidden.size, 'no ~/.claude/skills: the forbidden check would pass vacuously').toBeGreaterThan(0);

  const pluginDir = join(tmp, 'claude-plugin');
  const { folders } = buildSkillFolder('claude-plugin', pluginDir, names, index);
  const roleFile = join(tmp, 'role.md');
  writeFileSync(roleFile, 'You are Probe.\n');

  let tools: unknown; // system/init tools: the read-only guarantee is that no write or shell tool is offered
  const session = startClaudeSession({
    exe: exe!,
    cwd: project('claude-project'),
    args: claudeArgs({ model: CLAUDE_TIER_MODEL.light, roleFile, pluginDir, permissions: 'read-only' }),
    env: claudeEnv(process.env),
    expectedFolders: folders,
    forbidden,
    spawn: tee((l) => {
      if (l.type === 'system' && l.subtype === 'init') {
        tools = l.tools;
        console.log('CLAUDE init skills:', JSON.stringify(l.skills), '\nCLAUDE init plugins:', JSON.stringify(l.plugins));
        console.log('CLAUDE init tools:', JSON.stringify(l.tools));
      }
    }),
  });
  try {
    const events = await ask(session, 'Reply with your project marker and nothing else.');
    console.log('CLAUDE events:', JSON.stringify(events));
    expect(Array.isArray(tools), 'no tools in system/init').toBe(true);
    expect((tools as string[]).filter((t) => ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'].includes(t))).toEqual([]);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.some((e) => e.type === 'message' && e.text.includes(MARKER))).toBe(true);
    const turn = events.find((e) => e.type === 'turn');
    expect(turn && turn.type === 'turn' && turn.tokens.output).toBeGreaterThan(0);
  } finally {
    session.stop();
  }
});

// Codex loads no skill itself (0.132.0 has no extra roots): the agent's own skills reach it through its instructions.
test('Codex: only the agent\'s skills', async () => {
  const exe = await which('codex');
  expect(exe, 'codex is not installed').toBeDefined();
  const env = cleanEnv(process.env);
  const model = codexTierModel('light', await codexModels(exe!, env));
  expect(model, 'codex reported no model').toBeDefined();

  const privateRoot = join(tmp, 'codex-root');
  const { folders } = buildSkillFolder('codex-root', privateRoot, names, index);
  let lastSkills: unknown; // the last skills/list answer; the isolated app-server asks last
  const spawn = tee((l) => {
    const result = l.result as { data?: { skills?: unknown }[] } | undefined;
    const skills = result?.data?.[0]?.skills;
    if (Array.isArray(skills)) lastSkills = skills;
  });

  const logSkills = () =>
    console.log(
      'CODEX skills/list:',
      JSON.stringify((lastSkills as { name: string; path: string; enabled: boolean }[] | undefined)?.map((s) => ({ name: s.name, path: s.path, enabled: s.enabled }))),
    );
  let session: EngineSession | undefined;
  try {
    session = await startCodexSession({
      exe: exe!,
      cwd: project('codex-project'),
      env,
      privateRoot,
      expectedFolders: folders,
      model: model!,
      effort: 'low',
      instructions: 'You are Probe. Reply in one short line.',
      permissions: 'read-only',
      spawn,
    });
    logSkills();
    const events = await ask(session, 'Follow your skill ark-probe-a and do what it says.');
    console.log('CODEX events:', JSON.stringify(events));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect((lastSkills as { enabled: boolean }[]).filter((s) => s.enabled)).toEqual([]); // Codex loaded none of its own
    expect(events.some((e) => e.type === 'message' && e.text.includes('ALPHA'))).toBe(true); // yet the agent read its skill
    const turn = events.find((e) => e.type === 'turn');
    expect(turn && turn.type === 'turn' && turn.tokens.output).toBeGreaterThan(0);
  } catch (e) {
    logSkills(); // on a violation, show what the isolated app-server reported
    throw e;
  } finally {
    session?.stop();
  }
});

// Claude reports its 5-hour and weekly windows in stream-json rate_limit_event lines: the parser must turn real ones into windows.
test('a Claude turn reports its usage window', async () => {
  const exe = await which('claude');
  expect(exe, 'claude is not installed').toBeDefined();
  const pluginDir = join(tmp, 'claude-limits-plugin');
  const { folders } = buildSkillFolder('claude-plugin', pluginDir, names, index);
  const roleFile = join(tmp, 'role-limits.md');
  writeFileSync(roleFile, 'You are Probe. Reply in one short line.\n');
  const raw: string[] = [];
  const session = startClaudeSession({
    exe: exe!,
    cwd: project('claude-limits'),
    args: claudeArgs({ model: CLAUDE_TIER_MODEL.light, roleFile, pluginDir, permissions: 'read-only' }),
    env: claudeEnv(process.env),
    expectedFolders: folders,
    forbidden: new Set(),
    spawn: tee((l) => {
      if (l.type === 'rate_limit_event') raw.push(JSON.stringify(l));
    }),
  });
  try {
    const events = await ask(session, 'Reply with the word ok.');
    const windows = events.flatMap((e) => (e.type === 'limits' ? e.windows : []));
    const ok = windows.some((w) => (w.minutes === 300 || w.minutes === 10080) && w.usedPct >= 0 && w.usedPct <= 100 && w.resetsAt > Date.now() / 1000);
    if (!ok) console.log('CLAUDE raw rate_limit_event lines:', raw, '\nCLAUDE windows parsed:', JSON.stringify(windows));
    expect(ok, 'no usable usage window; see the raw rate_limit_event lines above').toBe(true);
  } finally {
    session.stop();
  }
});
