import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import type { ChatEvent } from '@shared/types';
import { AgentRunner, type RunnerDeps } from '../../src/main/services/agent-runner';
import { claudeArgs } from '../../src/main/services/engines/isolation';
import type { EngineSession } from '../../src/main/services/engines/session';
import type { SkillEntry } from '../../src/main/services/skills';

let root: string;
let project: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-runner-'));
  project = join(root, 'project');
  mkdirSync(project);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const agent = (over: Partial<AgentDef> = {}): AgentDef => ({
  id: 'tester',
  name: 'Tester',
  description: 'd',
  engine: { kind: 'auto' },
  tier: 'light',
  skills: ['alpha'],
  permissions: 'read-only',
  prompt: 'You are a tester.',
  ...over,
});

function skill(name: string, source: SkillEntry['source'] = 'agents-user'): SkillEntry {
  const dir = join(root, 'src-skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\nbody`);
  return { name, folder: name, dir, source, description: 'd' };
}

class FakeSession implements EngineSession {
  busy = false;
  sent: string[] = [];
  stopped = false;
  private cbs: ((e: ChatEvent) => void)[] = [];
  send(t: string) {
    this.sent.push(t);
  }
  stop() {
    this.stopped = true;
  }
  answered: [string, boolean][] = [];
  answer(id: string, allow: boolean) {
    this.answered.push([id, allow]);
  }
  onEvent(cb: (e: ChatEvent) => void) {
    this.cbs.push(cb);
  }
  emit(e: ChatEvent) {
    this.cbs.forEach((cb) => cb(e));
  }
}

function setup(o: { limited?: boolean; claude?: boolean; codex?: boolean; skills?: SkillEntry[]; agent?: AgentDef } = {}) {
  const session = new FakeSession();
  const claudeCalls: Record<string, unknown>[] = [];
  const codexCalls: Record<string, unknown>[] = [];
  const a = o.agent ?? agent();
  const deps: RunnerDeps = {
    catalog: { get: (id) => (id === a.id ? a : undefined) },
    skills: () => o.skills ?? [skill('alpha')],
    engines: async () => [
      { id: 'claude', installed: o.claude ?? true, path: 'C:\\bin\\claude.exe', manual: false },
      { id: 'codex', installed: o.codex ?? true, path: 'C:\\bin\\codex.exe', manual: false },
    ],
    config: () => ({}),
    tempDir: join(root, 'tmp'),
    codexHome: join(root, 'codex-home'),
    env: () => ({ X: '1' }),
    startClaude: ((opts) => {
      claudeCalls.push(opts as unknown as Record<string, unknown>);
      return session;
    }) as RunnerDeps['startClaude'],
    startCodex: (async (opts) => {
      codexCalls.push(opts as unknown as Record<string, unknown>);
      return session;
    }) as RunnerDeps['startCodex'],
    claudeLimited: () => o.limited ?? false,
    codexModels: async () => [
      { id: 'gpt-6', hidden: false, isDefault: true },
      { id: 'gpt-6-luna', hidden: false, isDefault: false },
    ],
  };
  return { runner: new AgentRunner(deps), deps, session, claudeCalls, codexCalls, agent: a };
}

const sessionsDir = () => join(root, 'tmp', 'ark', 'sessions');

test('a thread Auto preference starts the actual Codex engine', async () => {
  const t = setup();
  const started = await t.runner.startAgent(t.agent, project, 'read-only', 'auto', 'codex');
  expect(started.engine).toBe('codex');
  expect(t.codexCalls).toHaveLength(1);
  expect(t.claudeCalls).toHaveLength(0);
  expect(t.codexCalls[0]).toMatchObject({ permissionMode: 'auto', permissions: 'read-only' });
});

test("starts Claude with only the agent's skills and its role file", async () => {
  const t = setup({ skills: [skill('alpha'), skill('beta')] });
  const started = await t.runner.start('tester', project);
  const dir = join(sessionsDir(), started.chatId);
  expect(started).toMatchObject({ engine: 'claude', model: 'haiku' });
  expect(readdirSync(join(dir, 'plugin', 'skills'))).toEqual(['alpha']);
  expect(readFileSync(join(dir, 'role.md'), 'utf8')).toBe('You are a tester.');
  const o = t.claudeCalls[0];
  expect(o.args).toEqual(claudeArgs({ model: 'haiku', roleFile: join(dir, 'role.md'), pluginDir: join(dir, 'plugin'), permissions: 'read-only' }));
  expect(o).toMatchObject({ exe: 'C:\\bin\\claude.exe', cwd: project, expectedFolders: ['alpha'], env: { X: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
});

test('refuses an agent whose skill is not installed', async () => {
  const t = setup({ agent: agent({ skills: ['x'] }) });
  await expect(t.runner.start('tester', project)).rejects.toThrow('Skill not installed: x');
  expect(existsSync(sessionsDir()) ? readdirSync(sessionsDir()) : []).toEqual([]); // nothing left behind
  expect(t.claudeCalls).toHaveLength(0);
});

test('a Claude agent under a folder with CLAUDE.md is refused before spawning', async () => {
  writeFileSync(join(root, 'CLAUDE.md'), 'x'); // root is the parent of project
  const { runner, claudeCalls } = setup();
  await expect(runner.start('tester', project)).rejects.toThrow(/Isolation check failed/);
  expect(claudeCalls).toHaveLength(0);
});

test('an unknown agent is refused', async () => {
  await expect(setup().runner.start('nobody', project)).rejects.toThrow('Unknown agent');
});

test('a limited Claude moves an auto agent to Codex', async () => {
  const t = setup({ limited: true });
  const started = await t.runner.start('tester', project);
  expect(started).toMatchObject({ engine: 'codex', rerouted: true });
  expect(t.codexCalls).toHaveLength(1);
  expect(t.claudeCalls).toHaveLength(0);
});

test('auto runs on Codex when Claude is missing', async () => {
  const t = setup({ claude: false });
  const started = await t.runner.start('tester', project);
  expect(started).toMatchObject({ engine: 'codex', model: 'gpt-6-luna' });
  expect(t.codexCalls[0]).toMatchObject({ model: 'gpt-6-luna', effort: 'low', exe: 'C:\\bin\\codex.exe', expectedFolders: ['alpha'] });
  expect(readdirSync(t.codexCalls[0].privateRoot as string)).toEqual(['alpha']);
});

test('gives Codex the role plus the project rules', async () => {
  writeFileSync(join(project, 'CLAUDE.md'), 'Use tabs.');
  const t = setup({ claude: false });
  await t.runner.start('tester', project);
  expect(t.codexCalls[0].instructions).toBe('You are a tester.\n\n# Project instructions\n\nUse tabs.');
});

test('a failed Codex start leaves nothing behind and keeps its message', async () => {
  const t = setup({ claude: false });
  t.deps.startCodex = async () => {
    throw new Error('Isolation check failed: skill not allowed: z');
  };
  await expect(new AgentRunner(t.deps).start('tester', project)).rejects.toThrow('Isolation check failed: skill not allowed: z');
  expect(readdirSync(sessionsDir())).toEqual([]);
});

test('Codex personal instructions refuse the start and leave nothing behind', async () => {
  const t = setup({ claude: false });
  mkdirSync(t.deps.codexHome, { recursive: true });
  writeFileSync(join(t.deps.codexHome, 'AGENTS.md'), 'my rules');
  await expect(t.runner.start('tester', project)).rejects.toThrow(
    `personal instructions not allowed: ${join(t.deps.codexHome, 'AGENTS.md')}`,
  );
  expect(t.codexCalls).toHaveLength(0);
  expect(readdirSync(sessionsDir())).toEqual([]);
});

test('no Codex model for the tier is an error', async () => {
  const t = setup({ claude: false });
  t.deps.codexModels = async () => [];
  await expect(new AgentRunner(t.deps).start('tester', project)).rejects.toThrow('No Codex model for tier light');
  expect(readdirSync(sessionsDir())).toEqual([]);
});

test("forbids the project's own skills and the user's Claude skills", async () => {
  mkdirSync(join(project, '.claude', 'skills', 'local-skill'), { recursive: true });
  const t = setup({ skills: [skill('alpha'), skill('mine', 'claude-user')] });
  await t.runner.start('tester', project);
  const forbidden = t.claudeCalls[0].forbidden as Set<string>;
  expect(forbidden.has('local-skill')).toBe(true);
  expect(forbidden.has('mine')).toBe(true);
  expect(forbidden.has('alpha')).toBe(false);
});

test('Claude forbids user skills by folder and by frontmatter name', async () => {
  const t = setup({ skills: [skill('alpha'), { ...skill('mine', 'claude-user'), folder: 'x-folder', name: 'x-name' }] });
  await t.runner.start('tester', project);
  const forbidden = t.claudeCalls[0].forbidden as Set<string>;
  expect(forbidden.has('x-folder')).toBe(true);
  expect(forbidden.has('x-name')).toBe(true);
});

test('forwards session events with the chat id, until unsubscribed', async () => {
  const t = setup();
  const got: [string, ChatEvent][] = [];
  const off = t.runner.onEvent((id, e) => got.push([id, e]));
  const { chatId } = await t.runner.start('tester', project);
  t.session.emit({ type: 'message', text: 'hi' });
  expect(got).toEqual([[chatId, { type: 'message', text: 'hi' }]]);
  off();
  t.session.emit({ type: 'message', text: 'again' });
  expect(got).toHaveLength(1);
});

test('send reaches the session; an unknown chat throws', async () => {
  const t = setup();
  const { chatId } = await t.runner.start('tester', project);
  t.runner.send(chatId, 'hello');
  expect(t.session.sent).toEqual(['hello']);
  expect(() => t.runner.send('nope', 'x')).toThrow('Unknown chat');
});

test('stop and stopAll stop sessions and remove their folders, even when removal fails', async () => {
  const t = setup();
  const a = await t.runner.start('tester', project);
  const b = await t.runner.start('tester', project);
  t.runner.stop(a.chatId);
  expect(t.session.stopped).toBe(true);
  expect(existsSync(join(sessionsDir(), a.chatId))).toBe(false);
  expect(existsSync(join(sessionsDir(), b.chatId))).toBe(true);
  t.runner.stopAll();
  expect(readdirSync(sessionsDir())).toEqual([]);
  expect(() => t.runner.stop(a.chatId)).not.toThrow(); // already gone
  expect(() => t.runner.send(b.chatId, 'x')).toThrow('Unknown chat');
});

test('a throwing session.stop still removes the folder', async () => {
  const t = setup();
  const { chatId } = await t.runner.start('tester', project);
  t.session.stop = vi.fn(() => {
    throw new Error('boom');
  });
  expect(() => t.runner.stop(chatId)).toThrow('boom');
  expect(existsSync(join(sessionsDir(), chatId))).toBe(false);
});

/** Emits events as soon as the runner sends, so a one-shot that subscribes late would miss them. */
function drive(t: ReturnType<typeof setup>, events: ChatEvent[]) {
  t.session.send = (text: string) => {
    t.session.sent.push(text);
    events.forEach((e) => t.session.emit(e));
  };
}
const turn: ChatEvent = { type: 'turn', model: 'haiku', tokens: { input: 1, cached: 0, output: 1 } };

test('oneShot joins messages until the turn and stops', async () => {
  const t = setup();
  drive(t, [{ type: 'message', text: 'a' }, { type: 'message', text: 'b' }, turn, { type: 'message', text: 'late' }]);
  await expect(t.runner.oneShot(agent(), project, 'hi')).resolves.toBe('a\n\nb');
  expect(t.session.sent).toEqual(['hi']);
  expect(t.session.stopped).toBe(true);
  expect(readdirSync(sessionsDir())).toEqual([]);
});

test('turn resolves with joined messages, model and tokens', async () => {
  const t = setup();
  const { chatId } = await t.runner.startAgent(agent(), project);
  const p = t.runner.turn(chatId, 'hi');
  t.session.emit({ type: 'message', text: 'a' });
  t.session.emit({ type: 'message', text: 'b' });
  t.session.emit({ type: 'turn', model: 'haiku', tokens: { input: 1, cached: 0, output: 1 }, contextWindow: 200000 });
  await expect(p).resolves.toEqual({ text: 'a\n\nb', model: 'haiku', tokens: { input: 1, cached: 0, output: 1 }, contextWindow: 200000 });
  expect(t.session.sent).toEqual(['hi']);
});

test('turn rejects on error', async () => {
  const t = setup();
  const { chatId } = await t.runner.startAgent(agent(), project);
  const p = t.runner.turn(chatId, 'hi');
  t.session.emit({ type: 'error', kind: 'engine', detail: 'boom' });
  await expect(p).rejects.toThrow('boom');
});

test('stop rejects a pending turn with "stopped"', async () => {
  const t = setup();
  const { chatId } = await t.runner.startAgent(agent(), project);
  const p = t.runner.turn(chatId, 'hi');
  t.runner.stop(chatId);
  await expect(p).rejects.toThrow('stopped');
  expect(t.session.stopped).toBe(true);
});

test('oneShot rejects on error and still stops', async () => {
  const t = setup();
  drive(t, [{ type: 'error', kind: 'isolation', detail: 'skill not allowed' }]);
  await expect(t.runner.oneShot(agent(), project, 'hi')).rejects.toThrow('skill not allowed');
  expect(t.session.stopped).toBe(true);
  expect(readdirSync(sessionsDir())).toEqual([]);
});

test('oneShot times out, and stops when send throws', async () => {
  const t = setup();
  await expect(t.runner.oneShot(agent(), project, 'hi', 20)).rejects.toThrow('timed out');
  expect(t.session.stopped).toBe(true);
  const u = setup();
  u.session.send = () => {
    throw new Error('busy');
  };
  await expect(u.runner.oneShot(agent(), project, 'hi')).rejects.toThrow('busy');
  expect(u.session.stopped).toBe(true);
});

test('a start still in flight when stopAll runs stops its session and leaves nothing behind', async () => {
  const t = setup({ claude: false });
  let release!: () => void;
  t.deps.startCodex = async () => {
    await new Promise<void>((r) => (release = r));
    return t.session;
  };
  const runner = new AgentRunner(t.deps);
  const pending = runner.start('tester', project);
  const settled = expect(pending).rejects.toThrow('Ark is closing');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  runner.stopAll();
  release();
  await settled;
  expect(t.session.stopped).toBe(true);
  expect(readdirSync(sessionsDir())).toEqual([]);
});

test('turn does not reject on an approval event and answer reaches the session', async () => {
  const t = setup();
  const { chatId } = await t.runner.start('tester', project);
  const turn = t.runner.turn(chatId, 'go');
  t.session.emit({ type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  t.runner.answer(chatId, 'r1', true);
  expect(t.session.answered).toEqual([['r1', true]]);
  t.session.emit({ type: 'message', text: 'done' });
  t.session.emit({ type: 'turn', model: 'm', tokens: { input: 1, cached: 0, output: 1 } });
  await expect(turn).resolves.toMatchObject({ text: 'done' });
  expect(() => t.runner.answer('nope', 'r1', true)).toThrow('Unknown chat');
});

test('start() is always read-only; startAgent with build gets the build profile', async () => {
  const def = agent({ permissions: 'build' });
  const t = setup({ agent: def });
  const a = await t.runner.start('tester', project);
  const dirA = join(sessionsDir(), a.chatId);
  expect(t.claudeCalls[0].args).toEqual(claudeArgs({ model: 'haiku', roleFile: join(dirA, 'role.md'), pluginDir: join(dirA, 'plugin'), permissions: 'read-only' }));
  const b = await t.runner.startAgent(def, project, 'build');
  const dirB = join(sessionsDir(), b.chatId);
  expect(t.claudeCalls[1].args).toEqual(claudeArgs({ model: 'haiku', roleFile: join(dirB, 'role.md'), pluginDir: join(dirB, 'plugin'), permissions: 'build' }));
  const c = setup({ claude: false, agent: def });
  await c.runner.start('tester', project);
  await c.runner.startAgent(def, project, 'build');
  expect(c.codexCalls.map((x) => x.permissions)).toEqual(['read-only', 'build']);
});

test('a Claude build start preallows the project checks only with project code consent', async () => {
  const def = agent({ permissions: 'build' });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 't' } }));
  const t = setup({ agent: def });
  await t.runner.startAgent(def, project, 'build', 'ask', undefined, true);
  expect(t.claudeCalls[0].args).toContain('Bash(npm run test)');
  expect(t.claudeCalls[0].args).toContain('PowerShell(npm test)');
  await t.runner.startAgent(def, project, 'build', 'ask', undefined, false);
  await t.runner.startAgent(def, project, 'build', 'ask');
  for (const call of t.claudeCalls.slice(1)) expect((call.args as string[]).some((x) => /^(Bash|PowerShell)\(/.test(x))).toBe(false);
  // Codex starts the same either way.
  const c = setup({ claude: false, agent: def });
  await c.runner.startAgent(def, project, 'build', 'ask', undefined, true);
  await c.runner.startAgent(def, project, 'build', 'ask', undefined, false);
  const strip = (x: Record<string, unknown>) => ({ ...x, privateRoot: undefined, expectedFolders: undefined });
  expect(strip(c.codexCalls[0])).toEqual(strip(c.codexCalls[1]));
});

/** Writes <dir>/.claude/settings.json, as a project would. */
const writeSettings = (dir: string, o: object) => {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(o));
};

test('refuses to start Claude on project settings outside the allowlist, before spawning', async () => {
  const t = setup();
  writeSettings(project, { env: { ANTHROPIC_BASE_URL: 'http://x' } });
  // read-only chat, the path that had no check
  await expect(t.runner.start('tester', project)).rejects.toThrow(/settings\.json sets env/);
  expect(t.claudeCalls).toHaveLength(0);
});

test('a Claude settings file does not block a Codex session', async () => {
  const t = setup({ claude: false });
  writeSettings(project, { hooks: { Stop: [{}] } });
  const r = await t.runner.start('tester', project);
  expect(r.engine).toBe('codex');
  expect(t.codexCalls).toHaveLength(1);
});

test('refuses to start Claude on a CLAUDE.md that imports a file outside the project, before spawning', async () => {
  const t = setup();
  const secret = join(root, 'secret.md');
  writeFileSync(secret, 'SECRET');
  writeFileSync(join(project, 'CLAUDE.md'), `@${secret}\n`);
  await expect(t.runner.start('tester', project)).rejects.toThrow(/CLAUDE\.md imports @.*secret\.md/);
  expect(t.claudeCalls).toHaveLength(0);
});

test('a CLAUDE.md import outside the project does not block a Codex session', async () => {
  const t = setup({ claude: false });
  const secret = join(root, 'secret.md');
  writeFileSync(secret, 'SECRET');
  writeFileSync(join(project, 'CLAUDE.md'), `@${secret}\n`);
  expect((await t.runner.start('tester', project)).engine).toBe('codex');
});

test("forbids the project's skills by frontmatter name and its slash commands", async () => {
  mkdirSync(join(project, '.claude', 'skills', 'dir-name'), { recursive: true });
  writeFileSync(join(project, '.claude', 'skills', 'dir-name', 'SKILL.md'), '---\nname: shown-name\ndescription: x\n---\nbody');
  mkdirSync(join(project, '.claude', 'commands', 'team'), { recursive: true });
  writeFileSync(join(project, '.claude', 'commands', 'deploy.md'), '!`rm -rf x`');
  writeFileSync(join(project, '.claude', 'commands', 'team', 'nested.md'), 'x');
  const t = setup();
  await t.runner.start('tester', project);
  const forbidden = t.claudeCalls[0].forbidden as Set<string>;
  for (const n of ['dir-name', 'shown-name', 'deploy', 'nested', 'team:nested']) expect(forbidden.has(n)).toBe(true);
});
