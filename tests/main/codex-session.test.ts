import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { ChatEvent } from '@shared/types';
import { AppServerClient } from '../../src/main/services/engines/app-server-client';
import { CODEX_BASE_ARGS, codexModels, startCodexSession } from '../../src/main/services/engines/codex-session';
import { codexArgs, IsolationError } from '../../src/main/services/engines/isolation';
import { appServerRequest } from '../../src/main/services/adapters/codex-appserver';
import { fakeAppServer } from '../helpers/fake-app-server';

const flush = () => new Promise((r) => setTimeout(r, 10));
const CAVEMAN = 'C:\\u\\.agents\\skills\\caveman\\SKILL.md';
const ROOT = mkdtempSync(join(tmpdir(), 'ark-codex-root-'));
mkdirSync(join(ROOT, 'reviewer'));
writeFileSync(join(ROOT, 'reviewer', 'SKILL.md'), '---\nname: reviewer\ndescription: Reviews\n  a diff.\n---\nbody\n');
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const skill = (name: string, path: string, enabled = true) => ({ name, path, enabled });
const skillsResult = (...skills: ReturnType<typeof skill>[]) => ({ data: [{ cwd: 'D:\\p', skills, errors: [] }] });

/** Handlers for a machine with one user skill and one MCP server; the isolated server shows no enabled skill. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same loose handler type as fakeAppServer
function handlers(o: { after?: unknown; mcpAfter?: Record<string, unknown>; sandboxed?: boolean; canWrite?: boolean } = {}): Record<string, (p: any) => unknown> {
  let lists = 0;
  let reads = 0;
  return {
    // The sandbox probe: the command writes ARK_PROBE unless the policy is a sandbox that holds.
    'command/exec': (p: { env: { ARK_PROBE: string }; sandboxPolicy: { type: string } }) => {
      if (o.canWrite !== false && (p.sandboxPolicy.type === 'dangerFullAccess' || o.sandboxed === false)) writeFileSync(p.env.ARK_PROBE, 'x');
      return { exitCode: 0 };
    },
    'skills/list': () => (lists++ === 0 ? skillsResult(skill('caveman', CAVEMAN)) : (o.after ?? skillsResult(skill('caveman', CAVEMAN, false)))),
    'config/read': () => ({ config: { mcp_servers: reads++ === 0 ? { node_repl: {} } : (o.mcpAfter ?? { node_repl: { enabled: false } }) } }),
    'thread/start': () => ({ thread: { id: 't1' } }),
    'turn/start': () => ({ turn: { id: 'u1' } }),
  };
}

const opts = (spawn: ReturnType<typeof fakeAppServer>['spawn']) => ({
  exe: 'C:\\codex.exe',
  cwd: 'D:\\p',
  env: {},
  privateRoot: ROOT,
  expectedFolders: ['reviewer'],
  model: 'gpt-6-luna',
  effort: 'low' as const,
  instructions: 'You are Reviewer.',
  permissions: 'read-only' as const,
  spawn,
});

test('Full access is explicit and only applies to a developer build', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession({ ...opts(fake.spawn), permissions: 'build', permissionMode: 'full' });
  expect(fake.requests.find((r) => r.method === 'thread/start')?.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
  session.stop();
});

test('Auto build refuses a Codex protocol without a complete pre-execution gate', async () => {
  const fake = fakeAppServer(handlers());
  await expect(startCodexSession({ ...opts(fake.spawn), permissions: 'build', permissionMode: 'auto' })).rejects.toThrow('Auto build');
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
});

test('AppServerClient answers by id and rejects JSON-RPC errors', async () => {
  const fake = fakeAppServer({ ok: (p) => ({ echo: p }) });
  const client = await AppServerClient.open('C:\\codex.exe', ['app-server'], { cwd: 'D:\\p', env: {}, spawn: fake.spawn });
  await expect(client.request('ok', { a: 1 })).resolves.toEqual({ echo: { a: 1 } });
  await expect(client.request('missing', {})).rejects.toThrow('no handler for missing');
  const sent = fake.children[0].written().map((l) => JSON.parse(l));
  expect(sent[0]).toEqual({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ark', title: 'Ark', version: '0.1.0' }, capabilities: null } });
  expect(sent[1]).toEqual({ method: 'initialized' });
  client.close();
  expect(fake.children[0].killed).toBe(true);
});

test('AppServerClient request times out and rejects when the process exits', async () => {
  const fake = fakeAppServer({});
  const client = await AppServerClient.open('C:\\codex.exe', ['app-server'], { cwd: 'D:\\p', env: {}, spawn: fake.spawn });
  fake.children[0].stdin.removeAllListeners('data'); // the server stops answering
  await expect(client.request('hang', {}, 20)).rejects.toThrow('hang timed out');
  const pending = expect(client.request('hang', {}, 5000)).rejects.toThrow('boom');
  fake.children[0].exit(1, 'boom');
  await pending;
});

test('AppServerClient retries a startup that cannot open the state database, and only that', async () => {
  let n = 0;
  const flaky = fakeAppServer({
    initialize: () => {
      if (n++ < 2) throw new Error('failed to initialize sqlite state runtime under C:\\x');
      return {};
    },
  });
  const o = { cwd: 'D:\\p', env: {}, retryDelayMs: 1 };
  const client = await AppServerClient.open('C:\\codex.exe', ['app-server'], { ...o, spawn: flaky.spawn });
  expect(flaky.spawns).toHaveLength(3);
  expect(flaky.children.slice(0, 2).every((c) => c.killed)).toBe(true);
  client.close();

  const other = fakeAppServer({
    initialize: () => {
      throw new Error('something else');
    },
  });
  await expect(AppServerClient.open('C:\\codex.exe', ['app-server'], { ...o, spawn: other.spawn })).rejects.toThrow('something else');
  expect(other.spawns).toHaveLength(1);

  const always = fakeAppServer({
    initialize: () => {
      throw new Error('failed to initialize sqlite state runtime');
    },
  });
  await expect(AppServerClient.open('C:\\codex.exe', ['app-server'], { ...o, spawn: always.spawn })).rejects.toThrow('state runtime');
  expect(always.spawns).toHaveLength(5);
});

test('AppServerClient starts .cmd shims through a shell', async () => {
  const fake = fakeAppServer({});
  const client = await AppServerClient.open('C:\\npm\\codex.cmd', ['app-server'], { cwd: 'D:\\p', env: {}, spawn: fake.spawn });
  expect(fake.spawns[0].command).toBe('"C:\\npm\\codex.cmd"');
  client.close();
});

test('enumerates, then denies every found skill by path and every MCP server', async () => {
  const fake = fakeAppServer(handlers());
  await startCodexSession(opts(fake.spawn));
  expect(fake.spawns[0].args).toEqual(CODEX_BASE_ARGS);
  expect(fake.spawns[1].args).toEqual(codexArgs({ skillPaths: [CAVEMAN], mcpServers: ['node_repl'] }));
  expect(fake.requests.find((r) => r.method === 'skills/list')?.params).toEqual({ cwds: ['D:\\p'], forceReload: true });
  expect(fake.requests.find((r) => r.method === 'config/read')?.params).toEqual({ includeLayers: false, cwd: 'D:\\p' });
  expect(fake.children[0].killed).toBe(true);
});

test('skips skills that are already disabled when building the deny list', async () => {
  const h = handlers();
  let n = 0;
  h['skills/list'] = () => (n++ === 0 ? skillsResult(skill('caveman', CAVEMAN), skill('off', 'C:\\u\\off\\SKILL.md', false)) : skillsResult());
  const fake = fakeAppServer(h);
  await startCodexSession(opts(fake.spawn));
  expect(fake.spawns[1].args).toEqual(codexArgs({ skillPaths: [CAVEMAN], mcpServers: ['node_repl'] }));
});

test('verifies the isolated server, then starts the thread; no skill root is set', async () => {
  const fake = fakeAppServer(handlers());
  await startCodexSession(opts(fake.spawn));
  const second = fake.requests.filter((r) => r.spawn === 1);
  expect(second.map((r) => r.method)).toEqual(['initialize', 'skills/list', 'config/read', 'command/exec', 'command/exec', 'thread/start']);
  expect(second.filter((r) => r.method === 'command/exec').map((r) => (r.params as { sandboxPolicy: unknown }).sandboxPolicy)).toEqual([
    { type: 'dangerFullAccess' },
    { type: 'readOnly', networkAccess: false },
  ]);
});

test('refuses to start when the sandbox does not hold', async () => {
  const fake = fakeAppServer(handlers({ sandboxed: false }));
  const err = await startCodexSession(opts(fake.spawn)).catch((e) => e);
  expect(err).toBeInstanceOf(IsolationError);
  expect(err.violations).toEqual(['sandbox not enforced']);
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
  expect(fake.children[1].killed).toBe(true);
  expect(existsSync(join(ROOT, '.sandbox-probe'))).toBe(false); // the probe cleans up
});

test('refuses to start when the sandbox probe cannot write even unsandboxed', async () => {
  const fake = fakeAppServer(handlers({ canWrite: false }));
  const err = await startCodexSession(opts(fake.spawn)).catch((e) => e);
  expect(err.violations).toEqual(['sandbox check could not run']);
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
});

test('lists the private skills in the developer instructions', async () => {
  const fake = fakeAppServer(handlers());
  await startCodexSession(opts(fake.spawn));
  const text = (fake.requests.find((r) => r.method === 'thread/start')?.params as { developerInstructions: string }).developerInstructions;
  expect(text.startsWith('You are Reviewer.\n\n# Skills\n')).toBe(true);
  expect(text).toContain(`- reviewer: Reviews a diff. (file: ${join(ROOT, 'reviewer', 'SKILL.md')})`);
});

test('refuses to start when a private skill has no SKILL.md', async () => {
  const fake = fakeAppServer(handlers());
  const err = await startCodexSession({ ...opts(fake.spawn), expectedFolders: ['reviewer', 'gone'] }).catch((e) => e);
  expect(err).toBeInstanceOf(IsolationError);
  expect(err.violations).toEqual(['skill not loaded: gone']);
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
  expect(fake.children[1].killed).toBe(true);
});

test('an agent without skills gets its instructions unchanged', async () => {
  const fake = fakeAppServer(handlers());
  await startCodexSession({ ...opts(fake.spawn), expectedFolders: [] });
  expect(fake.requests.find((r) => r.method === 'thread/start')?.params).toMatchObject({ developerInstructions: 'You are Reviewer.' });
});

test('refuses to start when a foreign skill is still enabled', async () => {
  const fake = fakeAppServer(handlers({ after: skillsResult(skill('caveman', CAVEMAN)) }));
  const err = await startCodexSession(opts(fake.spawn)).catch((e) => e);
  expect(err).toBeInstanceOf(IsolationError);
  expect(err.violations).toEqual(['skill not allowed: caveman']);
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
  expect(fake.children[1].killed).toBe(true);
});

test('refuses when an MCP server is still enabled', async () => {
  const fake = fakeAppServer(handlers({ mcpAfter: { node_repl: { enabled: true } } }));
  const err = await startCodexSession(opts(fake.spawn)).catch((e) => e);
  expect(err).toBeInstanceOf(IsolationError);
  expect(err.violations).toEqual(['MCP server not allowed: node_repl']);
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
});

test('rejects and closes the client when an enumerate request fails', async () => {
  const h = handlers();
  h['config/read'] = () => {
    throw new Error('nope');
  };
  const fake = fakeAppServer(h);
  await expect(startCodexSession(opts(fake.spawn))).rejects.toThrow('nope');
  expect(fake.children).toHaveLength(1);
  expect(fake.children[0].killed).toBe(true);
});

test.each([
  ['a missing config', {}],
  ['a non-object mcp_servers', { config: { mcp_servers: 5 } }],
])('rejects and closes the client on %s in the verification read', async (_n, answer) => {
  const h = handlers();
  let reads = 0;
  h['config/read'] = () => (reads++ === 0 ? { config: { mcp_servers: { node_repl: {} } } } : answer);
  const fake = fakeAppServer(h);
  await expect(startCodexSession(opts(fake.spawn))).rejects.toThrow('config/read: malformed answer');
  expect(fake.requests.some((r) => r.method === 'thread/start')).toBe(false);
  expect(fake.children[1].killed).toBe(true);
});

test('rejects on a malformed config/read while enumerating', async () => {
  const h = handlers();
  h['config/read'] = () => ({});
  const fake = fakeAppServer(h);
  await expect(startCodexSession(opts(fake.spawn))).rejects.toThrow('config/read: malformed answer');
  expect(fake.children).toHaveLength(1);
  expect(fake.children[0].killed).toBe(true);
});

test('answers a server-initiated request with a JSON-RPC error', async () => {
  const fake = fakeAppServer({});
  const client = await AppServerClient.open('C:\\codex.exe', ['app-server'], { cwd: 'D:\\p', env: {}, spawn: fake.spawn });
  const seen: string[] = [];
  client.onNotification((m) => seen.push(m));
  fake.children[0].emitLine({ id: 'srv-1', method: 'item/tool/requestUserInput', params: {} });
  await flush();
  expect(fake.children[0].written().map((l) => JSON.parse(l))).toContainEqual({
    id: 'srv-1',
    error: { code: -32601, message: 'Method not supported by Ark' },
  });
  expect(seen).toEqual([]);
  client.close();
});

test('closes the client when the thread cannot start', async () => {
  const h = handlers();
  h['thread/start'] = () => ({});
  const fake = fakeAppServer(h);
  await expect(startCodexSession(opts(fake.spawn))).rejects.toThrow();
  expect(fake.children[1].killed).toBe(true);
});

test('starts the thread read-only with the role instructions', async () => {
  const fake = fakeAppServer(handlers());
  await startCodexSession(opts(fake.spawn));
  expect(fake.requests.find((r) => r.method === 'thread/start')?.params).toEqual({
    model: 'gpt-6-luna',
    cwd: 'D:\\p',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    developerInstructions: expect.stringMatching(/^You are Reviewer\.\n\n# Skills\n/),
  });
});

test('sends a turn and emits message and tokens', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  session.send('who are you?');
  expect(session.busy).toBe(true);
  expect(() => session.send('again')).toThrow('busy');
  await flush();
  expect(fake.requests.find((r) => r.method === 'turn/start')?.params).toEqual({
    threadId: 't1',
    effort: 'low',
    input: [{ type: 'text', text: 'who are you?', text_elements: [] }],
  });
  fake.notify('item/completed', { item: { type: 'agentMessage', text: 'I am Reviewer.' } });
  fake.notify('item/completed', { item: { type: 'reasoning', text: 'hidden' } });
  fake.notify('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 13700, cachedInputTokens: 4224, outputTokens: 18 } } });
  fake.notify('turn/completed', { turn: { status: 'completed' } });
  await flush();
  expect(events).toEqual([
    { type: 'message', text: 'I am Reviewer.' },
    { type: 'turn', model: 'gpt-6-luna', tokens: { input: 13700, cached: 4224, output: 18 } },
  ]);
  expect(session.busy).toBe(false);
});

test('turn carries modelContextWindow', async () => {
  for (const [window, expected] of [[272000, 272000], [null, undefined]] as const) {
    const fake = fakeAppServer(handlers());
    const session = await startCodexSession(opts(fake.spawn));
    const events: ChatEvent[] = [];
    session.onEvent((e) => events.push(e));
    session.send('hi');
    await flush();
    fake.notify('thread/tokenUsage/updated', {
      tokenUsage: { last: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, modelContextWindow: window },
    });
    fake.notify('turn/completed', { turn: { status: 'completed' } });
    await flush();
    expect(events[0]).toMatchObject({ type: 'turn' });
    expect((events[0] as { contextWindow?: number }).contextWindow).toBe(expected);
  }
});

test('a skill appearing between turns stops the session with an isolation error', async () => {
  const h = handlers();
  const fake = fakeAppServer(h);
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  h['skills/list'] = () => skillsResult(); // turn 1: still clean
  session.send('one');
  await flush();
  fake.notify('turn/completed', { turn: { status: 'completed' } });
  await flush();
  events.length = 0;
  h['skills/list'] = () => skillsResult(skill('late', 'C:\\u\\late\\SKILL.md')); // turn 2: a user skill appeared
  session.send('two');
  expect(session.busy).toBe(true);
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'isolation', detail: expect.stringContaining('skill not allowed') }]);
  expect(fake.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1);
  expect(fake.children[1].killed).toBe(true);
  expect(session.busy).toBe(false);
  expect(() => session.send('three')).toThrow('session ended');
});

test('a failed turn emits only the error and clears busy', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  session.send('x');
  await flush();
  fake.notify('turn/completed', { turn: { status: 'failed' } });
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'engine', detail: 'turn failed' }]);
  expect(session.busy).toBe(false);
});

test('a failed turn says why when Codex does', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  session.send('x');
  await flush();
  fake.notify('turn/completed', { turn: { status: 'failed', error: { message: 'model not found' } } });
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'engine', detail: 'turn failed: model not found' }]);
});

test('a rejected turn/start emits an engine error and clears busy', async () => {
  const h = handlers();
  h['turn/start'] = () => {
    throw new Error('bad turn');
  };
  const fake = fakeAppServer(h);
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  session.send('x');
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'engine', detail: 'bad turn' }]);
  expect(session.busy).toBe(false);
});

test('stop kills the client, emits nothing and refuses new turns', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  session.stop();
  fake.children[1].exit(0);
  await flush();
  expect(fake.children[1].killed).toBe(true);
  expect(events).toEqual([]);
  expect(() => session.send('x')).toThrow('session ended');
});

test('reports app-server exit', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  fake.children[1].exit(1, 'crashed');
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'exit', detail: 'crashed' }]);
  expect(() => session.send('x')).toThrow('session ended');
});

test('codexModels maps model/list', async () => {
  const fake = fakeAppServer({
    'model/list': () => ({ data: [{ id: 'gpt-6.1-sol', hidden: false, isDefault: true }, { id: 'old', hidden: true }] }),
  });
  await expect(codexModels('C:\\codex.exe', {}, fake.spawn)).resolves.toEqual([
    { id: 'gpt-6.1-sol', hidden: false, isDefault: true },
    { id: 'old', hidden: true, isDefault: false },
  ]);
  expect(fake.spawns[0].args).toEqual(CODEX_BASE_ARGS);
  expect(fake.children[0].killed).toBe(true);
});

test('appServerRequest resolves undefined when initialize is never answered', async () => {
  const started = Date.now();
  const r = await appServerRequest('C:\\no\\such\\codex.exe', 'account/read', {}, 200);
  expect(r).toBeUndefined();
  expect(Date.now() - started).toBeLessThan(3000);
});

test('sends an attached image as a data URL after the text', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  session.send('what is this?', [{ mime: 'image/png', data: 'AAAA' }]);
  await flush();
  expect(fake.requests.find((r) => r.method === 'turn/start')?.params).toEqual({
    threadId: 't1',
    effort: 'low',
    input: [
      { type: 'text', text: 'what is this?', text_elements: [] },
      { type: 'image', url: 'data:image/png;base64,AAAA' },
    ],
  });
});

const sentLines = (fake: ReturnType<typeof fakeAppServer>) => fake.children[1].written().map((l) => JSON.parse(l) as Record<string, unknown>);

test('a build session starts workspace-write on-request and turns command approvals into events', async () => {
  const fake = fakeAppServer(handlers());
  const s = await startCodexSession({ ...opts(fake.spawn), permissions: 'build' });
  expect(fake.requests.find((r) => r.method === 'thread/start')?.params).toMatchObject({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  const events: ChatEvent[] = [];
  s.onEvent((e) => events.push(e));
  fake.children[1].emitLine({ id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'curl x', cwd: 'D:\\p' } });
  fake.children[1].emitLine({ id: 8, method: 'item/fileChange/requestApproval', params: { reason: 'write outside', grantRoot: 'C:\\o' } });
  await flush();
  expect(events).toContainEqual({ type: 'approval', id: '7', tool: 'command', detail: 'D:\\p> curl x', request: { engine: 'codex', tool: 'command', input: { command: 'curl x', cwd: 'D:\\p' }, cwd: 'D:\\p' } });
  expect(events).toContainEqual(expect.objectContaining({ type: 'approval', id: '8', tool: 'file change', detail: 'C:\\o (write outside)' }));
  s.answer('7', false);
  s.answer('8', true);
  expect(sentLines(fake)).toContainEqual({ id: 7, result: { decision: 'decline' } });
  expect(sentLines(fake)).toContainEqual({ id: 8, result: { decision: 'accept' } });
  expect(() => s.answer('7', true)).toThrow('This request is no longer pending');
});

test('pending Codex approvals are dropped on turn/completed', async () => {
  const fake = fakeAppServer(handlers());
  const s = await startCodexSession({ ...opts(fake.spawn), permissions: 'build' });
  fake.children[1].emitLine({ id: 9, method: 'item/commandExecution/requestApproval', params: { command: 'x' } });
  await flush();
  fake.notify('turn/completed', { turn: { status: 'completed' } });
  await flush();
  expect(() => s.answer('9', true)).toThrow('This request is no longer pending');
});

test('a build session still refuses other server requests with -32601', async () => {
  const fake = fakeAppServer(handlers());
  await startCodexSession({ ...opts(fake.spawn), permissions: 'build' });
  fake.children[1].emitLine({ id: 5, method: 'item/permissions/requestApproval', params: {} });
  await flush();
  expect(sentLines(fake)).toContainEqual({ id: 5, error: { code: -32601, message: 'Method not supported by Ark' } });
});

test('a read-only session still answers approvals with -32601', async () => {
  const fake = fakeAppServer(handlers());
  const s = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  s.onEvent((e) => events.push(e));
  fake.children[1].emitLine({ id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'curl x' } });
  await flush();
  expect(events).toEqual([]);
  expect(sentLines(fake)).toContainEqual({ id: 7, error: { code: -32601, message: 'Method not supported by Ark' } });
});

test('account/rateLimits/updated becomes a limits event', async () => {
  const fake = fakeAppServer(handlers());
  const session = await startCodexSession(opts(fake.spawn));
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  fake.notify('account/rateLimits/updated', { rateLimits: { primary: null, secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1793988408 } } });
  await flush();
  expect(events).toEqual([{ type: 'limits', engine: 'codex', windows: [{ usedPct: 16, resetsAt: 1793988408, minutes: 10080 }] }]);
});
