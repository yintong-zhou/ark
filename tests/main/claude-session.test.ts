import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { expect, test } from 'vitest';
import type { ChatEvent } from '@shared/types';
import { startClaudeSession } from '../../src/main/services/engines/claude-session';
import { jsonLines, spawnCommand } from '../../src/main/services/engines/session';
import { FakeChild } from '../helpers/fake-child';

const fixture = readFileSync('tests/fixtures/claude-stream.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>);
const [init, assistant, result] = fixture;

const flush = () => new Promise((r) => setTimeout(r, 10));

function start(cwd = 'D:\\x', exe = 'C:\\claude.exe') {
  const child = new FakeChild();
  const spawned: { command: string; args: string[]; cwd: string; shell: boolean }[] = [];
  const session = startClaudeSession({
    exe,
    cwd,
    args: ['-p'],
    env: {},
    expectedFolders: ['ark-probe-a'],
    forbidden: new Set(),
    spawn: (command, args, o) => {
      spawned.push({ command, args, cwd: o.cwd, shell: o.shell });
      return child;
    },
  });
  const events: ChatEvent[] = [];
  session.onEvent((e) => events.push(e));
  return { child, session, events, spawned };
}

test('sends the user text as one stream-json line', () => {
  const { child, session } = start();
  session.send('hi');
  expect(child.written().map((l) => JSON.parse(l))).toEqual([
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
  ]);
});

test('emits the assistant text and the turn tokens', async () => {
  const { child, session, events } = start();
  session.send('hi');
  expect(session.busy).toBe(true);
  fixture.forEach((l) => child.emitLine(l));
  await flush();
  expect(events).toEqual([
    { type: 'message', text: 'noted.' },
    { type: 'turn', model: 'claude-haiku-5-5', tokens: { input: 24240, cached: 17329, output: 5 } },
  ]);
  expect(session.busy).toBe(false);
});

test('turn carries the context window from modelUsage', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine({ ...result, modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000 } } });
  await flush();
  expect(events[0]).toMatchObject({ type: 'turn', contextWindow: 1000000 });
  const b = start();
  b.session.send('hi');
  b.child.emitLine(init);
  b.child.emitLine({ ...result, modelUsage: undefined });
  await flush();
  expect(b.events[0]).toMatchObject({ type: 'turn' });
  expect((b.events[0] as { contextWindow?: number }).contextWindow).toBeUndefined();
});

test('context fill comes from the last request, the window from the turn model', async () => {
  const { child, session, events } = start();
  const usage = (n: number) => ({ input_tokens: 1, cache_creation_input_tokens: n, cache_read_input_tokens: 10 * n, output_tokens: 1 });
  session.send('hi');
  child.emitLine(init);
  child.emitLine({ ...assistant, message: { ...(assistant.message as object), usage: usage(100) } });
  child.emitLine({ ...assistant, message: { ...(assistant.message as object), usage: usage(300) } });
  child.emitLine({
    ...result,
    modelUsage: { 'claude-sonnet-5-5': { contextWindow: 200000 }, 'claude-haiku-5-5': { contextWindow: 1000000 } },
  });
  await flush();
  const turn = events.find((e) => e.type === 'turn');
  expect(turn).toMatchObject({ contextUsed: 1 + 300 + 3000, contextWindow: 1000000 });
  expect((turn as { tokens: unknown }).tokens).toEqual({ input: 2 + 6909 + 17329, cached: 17329, output: 5 }); // still the summed result usage
  // the next turn starts clean; no model key matches, so the first entry gives the window
  events.length = 0;
  session.send('again');
  child.emitLine({ ...result, modelUsage: { other: { contextWindow: 5 } } });
  await flush();
  expect(events[0]).toMatchObject({ type: 'turn', contextWindow: 5 });
  expect((events[0] as { contextUsed?: number }).contextUsed).toBeUndefined();
});

const lastLine = (child: FakeChild) => JSON.parse(child.written().at(-1) as string) as unknown;
const canUse = (id: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'control_request',
  request_id: id,
  request: { subtype: 'can_use_tool', tool_name: 'Bash', input, ...extra },
});

test('a can_use_tool request becomes an approval event and allow answers with the input', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine(canUse('r1', { command: 'npm ci' }));
  await flush();
  expect(events).toContainEqual({ type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci', request: { engine: 'claude', tool: 'Bash', input: { command: 'npm ci' }, cwd: 'D:\\x' } });
  session.answer('r1', true);
  expect(lastLine(child)).toEqual({
    type: 'control_response',
    response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: { command: 'npm ci' } } },
  });
  expect(() => session.answer('r1', false)).toThrow('This request is no longer pending');
});

test('deny answers with the Ark message', async () => {
  const { child, session } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine(canUse('r2', { file_path: 'a.txt' }, { display_name: 'Write' }));
  await flush();
  session.answer('r2', false);
  expect(lastLine(child)).toEqual({
    type: 'control_response',
    response: { subtype: 'success', request_id: 'r2', response: { behavior: 'deny', message: 'The user denied this in Ark.' } },
  });
});

test('after an approved arbitrary shell command, subsequent checks do not assume the initial cwd or environment', async () => {
  const { child, session, events } = start();
  session.send('build');
  child.emitLine(init);
  child.emitLine(canUse('change', { command: 'cd C:\\outside' }));
  await flush();
  session.answer('change', true);
  child.emitLine(canUse('check', { command: 'npm test' }));
  await flush();
  const e = events.find((e) => e.type === 'approval' && e.id === 'check');
  expect(e).toMatchObject({ request: { input: { arkShellStateUnknown: true } } });
});

test('approval detail falls back to the description, then to the input', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine(canUse('a', { x: 1 }, { description: 'Does a thing' }));
  child.emitLine(canUse('b', { x: 1 }));
  await flush();
  expect(events).toContainEqual(expect.objectContaining({ type: 'approval', id: 'a', tool: 'Bash', detail: 'Does a thing' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'approval', id: 'b', tool: 'Bash', detail: '{"x":1}' }));
});

test('a control_request before init is not forwarded', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(canUse('r1', { command: 'rm -rf /' }));
  child.emitLine(init);
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'isolation', detail: 'no init event' }]);
  expect(child.killed).toBe(true);
});

test('an unknown control_request subtype is answered with an error', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine({ type: 'control_request', request_id: 'x1', request: { subtype: 'hook_callback' } });
  await flush();
  expect(events).toEqual([]);
  expect(lastLine(child)).toEqual({ type: 'control_response', response: { subtype: 'error', request_id: 'x1', error: 'Not supported by Ark' } });
});

test('pending approvals are dropped on result and on stop', async () => {
  const { child, session } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine(canUse('r1', { command: 'a' }));
  child.emitLine(canUse('r2', { command: 'b' }));
  child.emitLine(result);
  await flush();
  expect(() => session.answer('r1', true)).toThrow('This request is no longer pending');
  session.send('again');
  child.emitLine(canUse('r3', { command: 'c' }));
  await flush();
  session.stop();
  expect(() => session.answer('r3', true)).toThrow('This request is no longer pending');
});

test('contextWindow is found for a model id with a suffix', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine({ ...init, model: 'claude-opus-5-5' });
  child.emitLine({ ...result, modelUsage: { other: { contextWindow: 5 }, 'claude-opus-5-5[1m]': { contextWindow: 1000000 } } });
  await flush();
  expect(events[0]).toMatchObject({ type: 'turn', contextWindow: 1000000 });
});

test('contextWindow prefers the exact model key over a prefix match', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine({ ...init, model: 'claude-opus-5-5' });
  child.emitLine({ ...result, modelUsage: { 'claude-opus-5': { contextWindow: 1 }, 'claude-opus-5-5': { contextWindow: 2 } } });
  await flush();
  expect(events[0]).toMatchObject({ type: 'turn', contextWindow: 2 });
});

test('stops on an init that breaks isolation', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine({ ...init, plugins: [...(init.plugins as unknown[]), { name: 'superpowers', path: 'C:\\p' }] });
  child.emitLine(assistant);
  await flush();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'error', kind: 'isolation' });
  expect((events[0] as { detail: string }).detail).toContain('plugin not allowed: superpowers');
  expect(child.killed).toBe(true);
  expect(() => session.send('again')).toThrow('session ended');
});

test('reports an unexpected exit with the stderr tail', async () => {
  const { child, session, events } = start();
  child.exit(1, 'not logged in');
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'exit', detail: 'not logged in' }]);
  expect(() => session.send('x')).toThrow('session ended');
});

test('reports the exit code when stderr is empty', async () => {
  const { child, events } = start();
  child.exit(3);
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'exit', detail: 'exit code 3' }]);
});

test('stop kills the child and emits nothing', async () => {
  const { child, session, events } = start();
  session.stop();
  child.exit(null);
  await flush();
  expect(child.killed).toBe(true);
  expect(events).toEqual([]);
});

test('refuses a second message while a turn runs', () => {
  const { session } = start();
  session.send('one');
  expect(() => session.send('two')).toThrow('busy');
});

test('a non-success result emits only the engine error and frees the session', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine({ ...result, subtype: 'error_max_turns' });
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'engine', detail: 'error_max_turns' }]);
  expect(session.busy).toBe(false);
});

test('keeps the cwd as given', () => {
  const cwd = 'D:\\Progetti Ark\\città';
  expect(start(cwd).spawned[0].cwd).toBe(cwd);
});

test('starts a .cmd shim through the shell with quoted args, and an .exe directly', () => {
  const cmd = start('D:\\x', 'C:\\n\\claude.cmd');
  expect(cmd.spawned[0]).toMatchObject({ command: '"C:\\n\\claude.cmd"', args: ['-p'], shell: true });
  const exe = start('D:\\x', 'C:\\n\\claude.exe');
  expect(exe.spawned[0]).toMatchObject({ command: 'C:\\n\\claude.exe', args: ['-p'], shell: false });
});

test.each([
  ['assistant', assistant],
  ['result', result],
])('stops on a %s line before any init', async (_name, line) => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(line);
  child.emitLine(init);
  child.emitLine(assistant);
  child.exit(null);
  await flush();
  expect(events).toEqual([{ type: 'error', kind: 'isolation', detail: 'no init event' }]);
  expect(child.killed).toBe(true);
  expect(() => session.send('again')).toThrow('session ended');
});

test('forwards the assistant text after a clean init', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine(assistant);
  await flush();
  expect(events).toEqual([{ type: 'message', text: 'noted.' }]);
});

test('spawnCommand quotes args for .cmd shims', () => {
  expect(spawnCommand('C:\\n\\claude.cmd', ['--plugin-dir', 'D:\\Progetti Ark\\città'])).toEqual({
    command: '"C:\\n\\claude.cmd"',
    args: ['--plugin-dir', '"D:\\Progetti Ark\\città"'],
    shell: true,
  });
  expect(spawnCommand('C:\\a.bat', ['say "hi"', 'a&b', 'ok']).args).toEqual(['"say ""hi"""', '"a&b"', 'ok']);
  expect(spawnCommand('C:\\n\\claude.exe', ['--plugin-dir', 'D:\\Progetti Ark'])).toEqual({
    command: 'C:\\n\\claude.exe',
    args: ['--plugin-dir', 'D:\\Progetti Ark'],
    shell: false,
  });
});

test('jsonLines joins split chunks and skips non-JSON lines', async () => {
  const s = new PassThrough();
  const got: unknown[] = [];
  jsonLines(s, (o) => got.push(o));
  s.write('{"a":1}\nnot json\n{"b"');
  s.write(':2}\n[1]\n{"c":3}');
  s.end();
  await flush();
  expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('sends an attached image before the text', () => {
  const { child, session } = start();
  session.send('what is this?', [{ mime: 'image/png', data: 'AAAA' }]);
  expect(child.written().map((l) => JSON.parse(l))).toEqual([
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'what is this?' },
        ],
      },
    },
  ]);
});

test('rate_limit_event becomes a limits event', async () => {
  const { child, events } = start();
  child.emitLine(init);
  child.emitLine({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.42, resetsAt: 1793900000 } });
  await flush();
  expect(events).toEqual([{ type: 'limits', engine: 'claude', windows: [{ usedPct: 42, resetsAt: 1793900000, minutes: 300 }] }]);
});

test('rate_limit_event without a usable window emits nothing', async () => {
  const { child, session, events } = start();
  session.send('hi');
  child.emitLine(init);
  child.emitLine({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
  child.emitLine({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day_opus', utilization: 0.5, resetsAt: 1793900000 } });
  child.emitLine({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1793900000 } });
  child.emitLine(assistant);
  child.emitLine(result);
  await flush();
  expect(events.some((e) => e.type === 'limits')).toBe(false);
  expect(events.some((e) => e.type === 'turn')).toBe(true);
});
