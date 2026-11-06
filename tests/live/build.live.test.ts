// Live approval round trips (build permission profile) on the real Claude Code and Codex engines.
// Run only with `npm run test:live`; every agent is on the light tier and every prompt is minimal.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import type { ChatEvent } from '@shared/types';
import { AgentRunner } from '../../src/main/services/agent-runner';
import { startClaudeSession } from '../../src/main/services/engines/claude-session';
import { codexModels, startCodexSession } from '../../src/main/services/engines/codex-session';
import { engineStatus } from '../../src/main/services/engines/config';
import { cleanEnv } from '../../src/main/services/engines/isolation';
import { indexSkills, type SkillEntry } from '../../src/main/services/skills';

const tmp = mkdtempSync(join(tmpdir(), 'ark-live-build-'));
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const MARKER = 'ARK-MARKER-7';

// The probe skills are the agent's only skills; the user's real ones stay in the index so the runner forbids them.
const probe = (n: 'a' | 'b'): SkillEntry => ({
  name: `ark-probe-${n}`,
  folder: `ark-probe-${n}`,
  dir: resolve('tests/fixtures/skills', `ark-probe-${n}`),
  source: 'codex-user',
  description: `Ark isolation probe ${n.toUpperCase()}`,
});
const probes = [probe('a'), probe('b')];

const runner = new AgentRunner({
  catalog: { get: () => undefined },
  skills: () => [...indexSkills({ claudeConfigDir, home: homedir(), codexHome }), ...probes],
  engines: () => engineStatus({}),
  config: () => ({}),
  tempDir: tmp,
  codexHome,
  env: () => cleanEnv(process.env),
  startClaude: startClaudeSession,
  startCodex: startCodexSession,
  claudeLimited: () => false,
  codexModels: (exe) => codexModels(exe, cleanEnv(process.env)),
});

afterAll(async () => {
  runner.stopAll();
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    console.warn(`could not remove ${tmp}: ${(e as Error).message}`);
  }
});

/** A temp Git repo with one commit; its CLAUDE.md carries the marker. Never this repo. */
function repo(name: string): string {
  const dir = join(tmp, name);
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=Ark Test', '-c', 'user.email=test@example.com', ...a], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' });
  writeFileSync(join(dir, 'CLAUDE.md'), `Your project marker is ${MARKER}.\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

const agent = (engine: 'claude' | 'codex', skills: string[]): AgentDef => ({
  id: `live-${engine}`,
  name: `Live ${engine}`,
  description: 'live approval test',
  engine: { kind: 'engine', engine },
  tier: 'light',
  skills,
  permissions: 'build',
  prompt: 'You are a test agent. Do exactly what the user asks, with the tool they name. Reply in one short line.',
});

/** Sends `text`; answers every approval with `decide`. Resolves with all events up to the turn (or error). */
async function run(chatId: string, text: string, decide: (e: Extract<ChatEvent, { type: 'approval' }>) => boolean): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const off = runner.onEvent((id, e) => {
    if (id !== chatId) return;
    events.push(e);
    if (e.type === 'approval') runner.answer(chatId, e.id, decide(e));
  });
  try {
    await runner.turn(chatId, text, 180_000).catch((err) => events.push({ type: 'error', kind: 'engine', detail: (err as Error).message }));
  } finally {
    off();
  }
  console.log('EVENTS:', JSON.stringify(events));
  return events;
}

test('Claude build agent: skills load with --tools, deny blocks, allow runs, contextUsed is set', async () => {
  const dir = repo('claude-repo');
  const { chatId } = await runner.startAgent(agent('claude', ['ark-probe-a', 'ark-probe-b']), dir, 'build');
  try {
    // 1. isolation + tools whitelist: the session's own gate raises an error event on any violation
    const first = await run(chatId, 'Reply with your project marker and nothing else.', () => false);
    expect(first.filter((e) => e.type === 'error')).toEqual([]);
    expect(first.some((e) => e.type === 'message' && e.text.includes(MARKER))).toBe(true);
    const turn = first.find((e) => e.type === 'turn');
    // 5. contextUsed on a real stream
    expect(turn?.type === 'turn' && turn.contextUsed, 'contextUsed is not defined on a real Claude turn').toBeDefined();

    // 2. deny: approval mentions left-pad and nothing is installed
    const denied = await run(chatId, 'Run the shell command `npm install left-pad` now.', () => false);
    const ask = denied.find((e) => e.type === 'approval');
    expect(ask?.type === 'approval' && ask.detail).toContain('left-pad');
    expect(denied.filter((e) => e.type === 'error')).toEqual([]);
    expect(denied.some((e) => e.type === 'turn')).toBe(true);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);

    // 3. allow: a command that prompts must then really run
    const allowed = await run(chatId, 'Run the shell command `npm view left-pad version` and reply with the version number only.', () => true);
    const prompted = allowed.some((e) => e.type === 'approval');
    console.log(`ALLOW SHAPE: ${prompted ? 'prompted' : 'NO PROMPT, allow shape unconfirmed'}`);
    expect(allowed.filter((e) => e.type === 'error')).toEqual([]);
    if (prompted) expect(allowed.some((e) => e.type === 'message' && /\d+\.\d+\.\d+/.test(e.text))).toBe(true);
  } finally {
    runner.stop(chatId);
  }
}, 600_000);

test('Claude read-only agent: --tools whitelist keeps skills loading', async () => {
  const dir = repo('claude-ro-repo');
  const { chatId } = await runner.startAgent({ ...agent('claude', ['ark-probe-a']), permissions: 'read-only' }, dir);
  try {
    const events = await run(chatId, 'Reply with your project marker and nothing else.', () => false);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.some((e) => e.type === 'message' && e.text.includes(MARKER))).toBe(true);
  } finally {
    runner.stop(chatId);
  }
}, 200_000);

test('Codex build agent: curl asks for approval and deny ends the turn', async () => {
  const dir = repo('codex-repo');
  const { chatId } = await runner.startAgent(agent('codex', []), dir, 'build');
  try {
    const events = await run(
      chatId,
      'Run `curl https://example.com` in the shell, with escalated permissions (sandbox_permissions require_escalated), and tell me the result.',
      () => false,
    );
    const ask = events.find((e) => e.type === 'approval');
    expect(ask, 'Codex never asked for approval').toBeDefined();
    expect(ask?.type === 'approval' && ask.tool).toBe('command');
    expect(events.some((e) => e.type === 'turn')).toBe(true);
  } finally {
    runner.stop(chatId);
  }
}, 300_000);
